import json
import logging
import threading
import time
import uuid
from typing import Callable, Optional, Protocol

from pydantic import ValidationError

from .config import Settings
from .models import CmdAck, ConfigAck, Event, Telemetry, Thresholds, validate_command
from .storage import Storage

log = logging.getLogger(__name__)


class Publisher(Protocol):
    def publish_cmd(self, payload: dict) -> None: ...
    def publish_config(self, payload: dict) -> None: ...
    def publish_sim_scenario(self, payload: dict) -> None: ...


class DeviceOffline(Exception):
    pass


class SimulatorNotActive(Exception):
    pass


SIM_TIMEOUT_S = 15.0  # quá lâu không có nhịp tim từ simulator thì coi như đã dừng


def _to_dict(payload) -> dict:
    if isinstance(payload, dict):
        return payload
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("payload is not a JSON object")
    return data


class Service:
    def __init__(self, settings: Settings, storage: Storage, publisher: Publisher,
                 clock: Callable[[], float] = time.time,
                 broadcast: Callable[[dict], None] = lambda msg: None):
        self.settings = settings
        self.storage = storage
        self.publisher = publisher
        self.clock = clock
        self._broadcast = broadcast
        self._lock = threading.RLock()
        self._online = False
        self._last_seen: Optional[float] = None
        self._offline_since: Optional[float] = None
        self._telemetry: Optional[dict] = None
        self._config: dict = self._initial_config()
        self._sim: Optional[dict] = None
        self._sim_ts: Optional[float] = None
        self._sim_emitted: Optional[dict] = None

    # ---- helpers -------------------------------------------------------
    def _emit(self, kind: str, data: dict) -> None:
        try:
            self._broadcast({"kind": kind, "data": data})
        except Exception:
            log.exception("broadcast failed")

    def _set_online(self, online: bool) -> None:
        if online == self._online:
            return
        now = self.clock()
        self._online = online
        if online:
            data = {"online": True, "since": now, "offline_since": self._offline_since}
            if self._config["status"] == "pending":
                self._config["sent_ts"] = now
            self._offline_since = None
        else:
            self._offline_since = now
            data = {"online": False, "since": now, "last_data_ts": self._last_seen}
        self._emit("connection", data)

    # ---- ingest --------------------------------------------------------
    def on_telemetry(self, payload) -> bool:
        try:
            t = Telemetry.model_validate(_to_dict(payload))
        except (ValueError, ValidationError) as e:
            log.warning("invalid telemetry: %s", e)
            return False
        with self._lock:
            now = self.clock()
            rec = dict(t.model_dump(), ts=now)
            self._last_seen = now
            self._telemetry = rec
            self.storage.save_telemetry(rec)
            self._set_online(True)
            self._emit("telemetry", rec)
        return True

    def on_event(self, payload) -> bool:
        try:
            e = Event.model_validate(_to_dict(payload))
        except (ValueError, ValidationError) as ex:
            log.warning("invalid event: %s", ex)
            return False
        with self._lock:
            rec = dict(e.model_dump(), ts=self.clock())
            self.storage.save_event(rec)
            self._emit("event", rec)
        return True

    def on_status(self, text) -> None:
        if isinstance(text, bytes):
            text = text.decode("utf-8", "replace")
        text = str(text).strip().strip('"').lower()
        with self._lock:
            if text == "offline":
                self._set_online(False)
            elif text == "online":
                self._last_seen = self.clock()
                self._set_online(True)

    # ---- state / time --------------------------------------------------
    def get_state(self) -> dict:
        with self._lock:
            return {"online": self._online, "last_seen": self._last_seen,
                    "offline_since": self._offline_since, "telemetry": self._telemetry}

    def tick(self) -> None:
        with self._lock:
            now = self.clock()
            if (self._online and self._last_seen is not None
                    and now - self._last_seen > self.settings.offline_timeout_s):
                self._set_online(False)
            self._tick_commands(now)
            self._tick_config(now)
            self._emit_sim_if_changed()

    # ---- commands (Task 4) ---------------------------------------------
    def send_command(self, device: str, action: str, source: str = "web") -> dict:
        validate_command(device, action)
        with self._lock:
            if not self._online:
                raise DeviceOffline("esp32 is offline")
            cmd_id = uuid.uuid4().hex
            rec = {"cmd_id": cmd_id, "device": device, "action": action, "source": source,
                   "status": "pending", "sent_ts": self.clock(), "ack_ts": None,
                   "detail": None, "ts": self.clock()}
            self.storage.save_command(rec)
            self.publisher.publish_cmd({"cmd_id": cmd_id, "device": device, "action": action})
            self._emit("command", dict(rec))
            return dict(rec)

    def get_command(self, cmd_id: str) -> Optional[dict]:
        return self.storage.get_command(cmd_id)

    def _finish_command(self, cmd_id: str, status: str, detail: Optional[str]) -> Optional[dict]:
        cur = self.storage.get_command(cmd_id)
        if cur is None or cur["status"] != "pending":
            return None
        rec = self.storage.update_command(cmd_id, status=status, detail=detail,
                                          ack_ts=None if status == "timeout" else self.clock())
        self._emit("command", rec)
        return rec

    def on_cmd_ack(self, payload) -> bool:
        try:
            ack = CmdAck.model_validate(_to_dict(payload))
        except (ValueError, ValidationError) as e:
            log.warning("invalid cmd ack: %s", e)
            return False
        with self._lock:
            return self._finish_command(ack.cmd_id, ack.result, ack.detail) is not None

    def _tick_commands(self, now: float) -> None:
        for c in self.storage.list_commands(1000):
            if c["status"] == "pending" and now - c["sent_ts"] > self.settings.cmd_timeout_s:
                self._finish_command(c["cmd_id"], "timeout", "no ack from device")

    # ---- config --------------------------------------------------------
    def _initial_config(self) -> dict:
        saved = self.storage.load_config()
        if saved and saved.get("config_id"):
            # được publish lại khi MQTT kết nối, nên đang chờ ack
            return {"config_id": saved["config_id"], "thresholds": saved["thresholds"],
                    "status": "pending", "detail": None, "sent_ts": None}
        return {"config_id": None, "thresholds": Thresholds().model_dump(),
                "status": "none", "detail": None, "sent_ts": None}

    def get_config(self) -> dict:
        with self._lock:
            c = self._config
            return {"config_id": c["config_id"], "thresholds": dict(c["thresholds"]),
                    "status": c["status"], "detail": c["detail"]}

    def _save_and_emit_config(self) -> None:
        c = self._config
        self.storage.save_config({"config_id": c["config_id"], "thresholds": c["thresholds"],
                                  "ts": self.clock()})
        self._emit("config", self.get_config())

    def _publish_config(self) -> None:
        c = self._config
        self.publisher.publish_config({"config_id": c["config_id"], "thresholds": c["thresholds"]})

    def set_config(self, thresholds: Thresholds) -> dict:
        with self._lock:
            self._config = {"config_id": uuid.uuid4().hex, "thresholds": thresholds.model_dump(),
                            "status": "pending", "detail": None, "sent_ts": self.clock()}
            self._save_and_emit_config()
            self._publish_config()
            return self.get_config()

    def on_connected(self) -> None:
        with self._lock:
            if self._config["config_id"]:
                self._config["sent_ts"] = self.clock()
                self._publish_config()

    def on_config_ack(self, payload) -> bool:
        try:
            ack = ConfigAck.model_validate(_to_dict(payload))
        except (ValueError, ValidationError) as e:
            log.warning("invalid config ack: %s", e)
            return False
        with self._lock:
            c = self._config
            if ack.config_id != c["config_id"] or c["status"] not in ("pending", "timeout"):
                return False
            c["status"] = "applied" if ack.result == "ok" else "rejected"
            c["detail"] = ack.detail
            self._emit("config", self.get_config())
            return True

    def _tick_config(self, now: float) -> None:
        c = self._config
        if (c["status"] == "pending" and self._online and c["sent_ts"] is not None
                and now - c["sent_ts"] > self.settings.cmd_timeout_s):
            c["status"] = "timeout"
            c["detail"] = "no ack from device"
            self._emit("config", self.get_config())

    # ---- ESP32 giả lập (kịch bản) ----------------------------------------
    def on_sim_state(self, payload) -> bool:
        """Simulator báo đang chạy (retained, kèm nhịp tim) hoặc đã dừng."""
        try:
            data = _to_dict(payload)
            active = data["active"]
            scenarios = data.get("scenarios", [])
            if not isinstance(active, bool) or not isinstance(scenarios, list):
                raise ValueError("bad sim state")
            scenarios = [{"id": str(x["id"]), "label": str(x["label"])} for x in scenarios]
        except (ValueError, KeyError, TypeError) as e:
            log.warning("invalid sim state: %s", e)
            return False
        with self._lock:
            self._sim = {"active": active, "scenario": data.get("scenario"), "scenarios": scenarios}
            self._sim_ts = self.clock()
            self._emit_sim_if_changed()
        return True

    def get_sim(self) -> dict:
        with self._lock:
            sim = self._sim
            alive = (sim is not None and sim["active"] and self._sim_ts is not None
                     and self.clock() - self._sim_ts <= SIM_TIMEOUT_S)
            if not alive:
                return {"active": False, "scenario": None, "scenarios": []}
            return {"active": True, "scenario": sim["scenario"], "scenarios": list(sim["scenarios"])}

    def _emit_sim_if_changed(self) -> None:
        current = self.get_sim()
        if current != self._sim_emitted:
            self._sim_emitted = current
            self._emit("sim", current)

    def set_sim_scenario(self, scenario: str) -> None:
        with self._lock:
            sim = self.get_sim()
            if not sim["active"]:
                raise SimulatorNotActive("simulator is not running")
            if scenario not in {x["id"] for x in sim["scenarios"]}:
                raise ValueError(f"unknown scenario: {scenario}")
            self.publisher.publish_sim_scenario({"scenario": scenario})


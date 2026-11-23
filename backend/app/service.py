import json
import logging
import math
from collections import deque
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


class PublishFailed(Exception):
    """Backend không publish được lệnh lên MQTT (lệnh không đến ESP32)."""


class SafetyOverride(Exception):
    """Lệnh bị chặn vì ràng buộc an toàn đang hiệu lực."""

    def __init__(self, reason: str):
        super().__init__(f"safety_override:{reason}")
        self.reason = reason


# Trạng thái telemetry đích mà một lệnh `ok` phải dẫn tới (để suy ra xác nhận vật lý)
CONFIRM_FIELD = {"fan": ("fan_on", {"on": True, "off": False}),
                 "led1": ("led1_on", {"on": True, "off": False}),
                 "door": ("door_command", {"open": "open", "close": "closed"})}
CONFIRM_WAIT_S = 30.0  # quá lâu không thấy telemetry khớp thì thôi chờ xác nhận

SIM_TIMEOUT_S = 15.0  # quá lâu không có nhịp tim từ simulator thì coi như đã dừng


def percentile(values: list[float], p: float) -> Optional[float]:
    """Phân vị theo phương pháp nearest-rank (p trong 0..100). Rỗng -> None."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100.0 * len(ordered)))
    return ordered[rank - 1]


def _summary(values: list[float]) -> dict:
    if not values:
        return {"count": 0, "avg": None, "p95": None, "max": None}
    return {"count": len(values), "avg": sum(values) / len(values),
            "p95": percentile(values, 95), "max": max(values)}


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
        self._real_device_last_seen: Optional[float] = None
        # Lệnh đang chờ ACK, giữ trong RAM để tick() và chống lệnh trùng KHÔNG phải truy vấn DB
        self._pending: dict[str, dict] = {}
        self._storage_errors = 0
        self._storage_last_error_ts: Optional[float] = None
        self._storage_ok = True
        self._load_pending()
        self._rx_intervals: deque = deque(maxlen=1000)  # giây giữa 2 telemetry liên tiếp
        self._awaiting_confirm: dict[str, dict] = {}  # cmd_id -> lệnh `ok` chờ telemetry khớp

    def _load_pending(self) -> None:
        """Sau khi backend khởi động lại: nạp lại các lệnh còn `pending` để vẫn được xử lý timeout."""
        try:
            for c in self.storage.list_commands(200):
                if c.get("status") == "pending":
                    self._pending[c["cmd_id"]] = {"device": c["device"], "action": c["action"],
                                                  "sent_ts": c["sent_ts"]}
        except Exception as ex:
            log.warning("could not load pending commands: %s", ex)

    # ---- helpers -------------------------------------------------------
    def _emit(self, kind: str, data: dict) -> None:
        try:
            self._broadcast({"kind": kind, "data": data})
        except Exception:
            log.exception("broadcast failed")

    def _set_online(self, online: bool, reason: Optional[str] = None) -> None:
        if online == self._online:
            return
        now = self.clock()
        self._online = online
        if reason is None:
            reason = "telemetry" if online else ("timeout" if self._last_seen else "status")
        if online:
            data = {"online": True, "since": now, "offline_since": self._offline_since}
            if self._config["status"] == "pending":
                self._config["sent_ts"] = now
            self._offline_since = None
        else:
            self._offline_since = now
            data = {"online": False, "since": now, "last_data_ts": self._last_seen}
        self._emit("connection", data)
        if hasattr(self.storage, "save_connection_event"):
            try:
                self.storage.save_connection_event(
                    state="online" if online else "offline",
                    reason=reason,
                    ts=now,
                )
            except Exception:
                log.exception("failed to save connection event")

    # ---- ingest --------------------------------------------------------
    def on_telemetry(self, payload) -> bool:
        try:
            raw_dict = _to_dict(payload)
            is_sim = bool(raw_dict.get("is_sim", False))
            t = Telemetry.model_validate(raw_dict)
        except (ValueError, ValidationError) as e:
            log.warning("invalid telemetry: %s", e)
            return False
        with self._lock:
            now = self.clock()
            if not is_sim:
                # Dữ liệu từ phần cứng ESP32 thật
                self._real_device_last_seen = now
            elif self._real_device_last_seen is not None and (now - self._real_device_last_seen) < 10.0:
                # Đang có ESP32 thật gửi dữ liệu: bỏ qua telemetry giả lập để nhường quyền tuyệt đối
                return True

            rec = dict(t.model_dump(), ts=now)

        # Ghi DB ngoài khóa: DB chậm/ngừng không được làm treo get_state(), health(), tick().
        stored: Optional[bool] = None
        storage_error = False
        try:
            stored = self.storage.save_telemetry(rec)
        except Exception as ex:
            log.error("failed to save telemetry to storage: %s", ex)
            storage_error = True

        with self._lock:
            if storage_error:
                self._storage_ok = False
                self._storage_errors += 1
                self._storage_last_error_ts = now
            else:
                self._storage_ok = True

            if stored is False:
                # Duplicate: idempotent ignore, do not overwrite state or re-broadcast
                return True

            # Không để telemetry cũ (out-of-order / late arrival) ghi đè trạng thái mới
            is_out_of_order = False
            if (self._telemetry and rec.get("boot_id") and rec.get("seq") is not None
                    and self._telemetry.get("boot_id") == rec.get("boot_id")
                    and self._telemetry.get("seq") is not None
                    and rec["seq"] < self._telemetry["seq"]):
                is_out_of_order = True

            if not is_out_of_order:
                self._telemetry = rec
            if self._online and self._last_seen is not None and now >= self._last_seen:
                self._rx_intervals.append(now - self._last_seen)
            self._last_seen = now
            self._set_online(True, reason="telemetry")
            self._emit("telemetry", rec)
            if not is_out_of_order:
                self._confirm_commands(rec, now)
        return True

    def on_event(self, payload) -> bool:
        try:
            e = Event.model_validate(_to_dict(payload))
        except (ValueError, ValidationError) as ex:
            log.warning("invalid event: %s", ex)
            return False
        rec = dict(e.model_dump(), ts=self.clock())
        try:
            self.storage.save_event(rec)
        except Exception as ex:
            log.error("failed to save event to storage: %s", ex)
        with self._lock:
            self._emit("event", rec)
        return True

    def on_status(self, text) -> None:
        if isinstance(text, bytes):
            text = text.decode("utf-8", "replace")
        text = str(text).strip().strip('"').lower()
        with self._lock:
            if text == "offline":
                self._set_online(False, reason="status")
            elif text == "online":
                self._last_seen = self.clock()
                self._set_online(True, reason="status")

    # ---- state / time --------------------------------------------------
    def health(self) -> dict:
        """Tình trạng hạ tầng. Lỗi MQTT/DB được công bố, không bị che giấu."""
        with self._lock:
            probe = getattr(self.publisher, "is_connected", None)
            try:
                mqtt_connected = bool(probe()) if callable(probe) else None
            except Exception:
                mqtt_connected = False
            return {"mqtt": {"connected": mqtt_connected},
                    "storage": {"ok": self._storage_ok, "errors": self._storage_errors,
                                "last_error_ts": self._storage_last_error_ts},
                    "device_online": self._online}

    def get_state(self) -> dict:
        with self._lock:
            return {"online": self._online, "last_seen": self._last_seen,
                    "offline_since": self._offline_since, "telemetry": self._telemetry}

    def tick(self) -> None:
        with self._lock:
            now = self.clock()
            if (self._online and self._last_seen is not None
                    and now - self._last_seen > self.settings.offline_timeout_s):
                self._set_online(False, reason="timeout")
            self._tick_commands(now)
            self._tick_config(now)
            self._emit_sim_if_changed()

    # ---- commands (Task 4) ---------------------------------------------
    def _safety_block(self, device: str, action: str) -> Optional[str]:
        """Lý do an toàn chặn lệnh, hoặc None. Dựa trên telemetry mới nhất."""
        t = self._telemetry or {}
        if device == "fan" and action == "off":
            if t.get("heat_alarm"):
                return "heat_alarm"
            if t.get("smoke_alarm"):
                return "smoke_alarm"
        if device == "door" and action == "close" and t.get("gas_alarm"):
            return "gas_alarm"
        return None

    def send_command(self, device: str, action: str, source: str = "web") -> dict:
        validate_command(device, action)
        with self._lock:
            if not self._online:
                raise DeviceOffline("esp32 is offline")
            now = self.clock()
            # Lệnh trùng: cùng thiết bị + hành động đang chờ ACK -> trả lại lệnh cũ, không publish lại
            for cid, c in self._pending.items():
                if (c["device"] == device and c["action"] == action
                        and now - c["sent_ts"] <= self.settings.cmd_timeout_s):
                    existing = self.storage.get_command(cid)
                    if existing is not None and existing["status"] == "pending":
                        return dict(existing, duplicate=True)
            cmd_id = uuid.uuid4().hex
            rec = {"cmd_id": cmd_id, "device": device, "action": action, "source": source,
                   "status": "pending", "sent_ts": now, "ack_ts": None,
                   "confirmed_ts": None, "detail": None, "ts": now}
            reason = self._safety_block(device, action)
            if reason is not None:
                rec.update(status="failed", detail=f"safety_override:{reason}")
                self.storage.save_command(rec)
                self._emit("command", dict(rec))
                raise SafetyOverride(reason)
            self.storage.save_command(rec)
            self._pending[cmd_id] = {"device": device, "action": action, "sent_ts": now}
            try:
                # `expires_ts`: thiết bị (có đồng hồ) phải bỏ qua lệnh quá hạn, tránh thực thi muộn
                # sau khi mạng nối lại (lệnh QoS 1 có thể bị giữ lại và gửi sau).
                self.publisher.publish_cmd({"cmd_id": cmd_id, "device": device, "action": action,
                                            "issued_ts": now,
                                            "expires_ts": now + self.settings.cmd_timeout_s})
            except Exception as ex:
                self._pending.pop(cmd_id, None)
                log.error("failed to publish command %s: %s", cmd_id, ex)
                rec = self.storage.update_command(cmd_id, status="failed",
                                                  detail="mqtt_publish_failed", ack_ts=None) or rec
                self._emit("command", dict(rec))
                raise PublishFailed("mqtt_publish_failed") from ex
            self._emit("command", dict(rec))
            return dict(rec)

    def get_command(self, cmd_id: str) -> Optional[dict]:
        return self.storage.get_command(cmd_id)

    def _finish_command(self, cmd_id: str, status: str, detail: Optional[str]) -> Optional[dict]:
        cur = self.storage.get_command(cmd_id)
        if cur is None or cur["status"] != "pending":
            self._pending.pop(cmd_id, None)
            return None
        rec = self.storage.update_command(cmd_id, status=status, detail=detail,
                                          ack_ts=None if status == "timeout" else self.clock())
        self._pending.pop(cmd_id, None)
        self._emit("command", rec)
        if status == "ok" and rec is not None:
            self._awaiting_confirm[cmd_id] = rec
        if rec is not None and rec.get("ack_ts") is not None:
            log.info("latency cmd_id=%s device=%s action=%s status=%s ack_ms=%.1f", cmd_id,
                     rec["device"], rec["action"], status, (rec["ack_ts"] - rec["sent_ts"]) * 1000)
        return rec

    def on_cmd_ack(self, payload) -> bool:
        try:
            ack = CmdAck.model_validate(_to_dict(payload))
        except (ValueError, ValidationError) as e:
            log.warning("invalid cmd ack: %s", e)
            return False
        with self._lock:
            if self._finish_command(ack.cmd_id, ack.result, ack.detail) is not None:
                return True
            cur = self.storage.get_command(ack.cmd_id)
            if (cur is not None and cur["status"] == "timeout"
                    and "late_ack:" not in (cur.get("detail") or "")):
                # ACK đến muộn: giữ nguyên `timeout`, chỉ ghi nhận để đối soát
                base = cur.get("detail") or "no ack from device"
                rec = self.storage.update_command(ack.cmd_id,
                                                  detail=f"{base}; late_ack:{ack.result}")
                self._emit("command", rec)
            return False

    def _confirm_commands(self, tel: dict, now: float) -> None:
        """Telemetry sau ACK khớp trạng thái đích -> ghi `confirmed_ts` (suy luận, không đo trực tiếp)."""
        for cmd_id, cmd in list(self._awaiting_confirm.items()):
            ack_ts = cmd.get("ack_ts")
            if ack_ts is None or now - ack_ts > CONFIRM_WAIT_S:
                del self._awaiting_confirm[cmd_id]
                continue
            spec = CONFIRM_FIELD.get(cmd["device"])
            if spec is None or cmd["action"] not in spec[1] or now <= ack_ts:
                continue
            if tel.get(spec[0]) == spec[1][cmd["action"]]:
                rec = self.storage.update_command(cmd_id, confirmed_ts=now)
                del self._awaiting_confirm[cmd_id]
                log.info("latency cmd_id=%s confirm_ms=%.1f", cmd_id, (now - cmd["sent_ts"]) * 1000)
                if rec is not None:
                    self._emit("command", rec)

    def _tick_commands(self, now: float) -> None:
        for cmd_id, c in list(self._pending.items()):
            if now - c["sent_ts"] > self.settings.cmd_timeout_s:
                try:
                    self._finish_command(cmd_id, "timeout", "no ack from device")
                except Exception as ex:
                    # DB đang hỏng: giữ lệnh trong _pending, thử lại ở lần tick sau; không dồn dập gọi DB
                    log.warning("could not persist command timeout %s: %s", cmd_id, ex)
                    break

    def latency_stats(self, limit: int = 1000) -> dict:
        """avg/P95/max (giây) của gửi->ACK và gửi->xác nhận (từ lệnh đã lưu), và khoảng cách telemetry."""
        ack, confirm = [], []
        for c in self.storage.list_commands(limit):
            if c.get("status") != "ok":
                continue
            if c.get("ack_ts") is not None:
                ack.append(c["ack_ts"] - c["sent_ts"])
            if c.get("confirmed_ts") is not None:
                confirm.append(c["confirmed_ts"] - c["sent_ts"])
        with self._lock:
            intervals = list(self._rx_intervals)
        return {"ack": _summary(ack), "confirm": _summary(confirm),
                "telemetry_interval": _summary(intervals)}

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


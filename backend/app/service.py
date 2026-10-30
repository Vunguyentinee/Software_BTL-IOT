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


class DeviceOffline(Exception):
    pass


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

    # ---- commands (Task 4) ---------------------------------------------
    def _tick_commands(self, now: float) -> None:
        pass

    # ---- config (Task 5) -----------------------------------------------
    def _initial_config(self) -> dict:
        return {}

    def _tick_config(self, now: float) -> None:
        pass

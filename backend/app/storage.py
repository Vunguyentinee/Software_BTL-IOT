import json
import os
import threading
from collections import deque
from typing import Optional, Protocol


class Storage(Protocol):
    def save_telemetry(self, rec: dict) -> None: ...
    def save_event(self, rec: dict) -> None: ...
    def save_command(self, rec: dict) -> None: ...
    def update_command(self, cmd_id: str, **fields) -> Optional[dict]: ...
    def get_command(self, cmd_id: str) -> Optional[dict]: ...
    def save_config(self, rec: dict) -> None: ...
    def load_config(self) -> Optional[dict]: ...
    def history(self, metric: str, start: Optional[float], end: Optional[float]) -> list[dict]: ...
    def list_events(self, limit: int = 100) -> list[dict]: ...
    def list_commands(self, limit: int = 100) -> list[dict]: ...


class InMemoryStorage:
    """Lưu trong bộ nhớ; config/command/event được ghi ra file JSON nếu có path."""

    def __init__(self, path: Optional[str] = None, max_telemetry: int = 100_000):
        self._path = path
        self._lock = threading.RLock()
        self._telemetry: deque = deque(maxlen=max_telemetry)
        self._events: list[dict] = []
        self._commands: dict[str, dict] = {}
        self._config: Optional[dict] = None
        self._load()

    def _load(self) -> None:
        if not self._path or not os.path.exists(self._path):
            return
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            self._events = list(data.get("events", []))
            self._commands = dict(data.get("commands", {}))
            self._config = data.get("config")
        except (OSError, ValueError, AttributeError):
            self._events, self._commands, self._config = [], {}, None

    def _flush(self) -> None:
        if not self._path:
            return
        d = os.path.dirname(self._path)
        if d:
            os.makedirs(d, exist_ok=True)
        tmp = self._path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"events": self._events, "commands": self._commands,
                       "config": self._config}, f)
        os.replace(tmp, self._path)

    def save_telemetry(self, rec: dict) -> None:
        with self._lock:
            self._telemetry.append(rec)

    def save_event(self, rec: dict) -> None:
        with self._lock:
            self._events.append(rec)
            self._events = self._events[-10_000:]
            self._flush()

    def save_command(self, rec: dict) -> None:
        with self._lock:
            self._commands[rec["cmd_id"]] = dict(rec)
            self._flush()

    def update_command(self, cmd_id: str, **fields) -> Optional[dict]:
        with self._lock:
            cmd = self._commands.get(cmd_id)
            if cmd is None:
                return None
            cmd.update(fields)
            self._flush()
            return dict(cmd)

    def get_command(self, cmd_id: str) -> Optional[dict]:
        with self._lock:
            cmd = self._commands.get(cmd_id)
            return dict(cmd) if cmd else None

    def save_config(self, rec: dict) -> None:
        with self._lock:
            self._config = dict(rec)
            self._flush()

    def load_config(self) -> Optional[dict]:
        with self._lock:
            return dict(self._config) if self._config else None

    def history(self, metric, start, end) -> list[dict]:
        with self._lock:
            out = []
            for r in self._telemetry:
                ts, v = r["ts"], r.get(metric)
                if v is None:
                    continue
                if (start is not None and ts < start) or (end is not None and ts > end):
                    continue
                out.append({"ts": ts, "value": v})
            return out

    def list_events(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return list(reversed(self._events))[:limit]

    def list_commands(self, limit: int = 100) -> list[dict]:
        with self._lock:
            cmds = sorted(self._commands.values(), key=lambda c: c.get("sent_ts", c.get("ts", 0)), reverse=True)
            return [dict(c) for c in cmds[:limit]]

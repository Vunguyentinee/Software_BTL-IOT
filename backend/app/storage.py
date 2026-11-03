import json
import math
import os
import threading
from collections import deque
from typing import Optional, Protocol, TypedDict


HISTORY_METRICS = frozenset({
    "temperature_c", "humidity_pct", "dht_ok", "pir_ready", "motion_detected",
    "is_dark", "fan_on", "led1_on", "led2_on", "led3_on", "heat_alarm",
    "uptime_ms", "smoke_raw", "smoke_alarm", "pump_on",
})
HISTORY_STATS_METRICS = frozenset({"temperature_c", "humidity_pct", "smoke_raw"})


class HistoryStats(TypedDict):
    count: int
    avg: Optional[float]
    min: Optional[float]
    max: Optional[float]


def validate_history_time_range(start: Optional[float], end: Optional[float]) -> None:
    if start is not None and not math.isfinite(start):
        raise ValueError("start must be finite")
    if end is not None and not math.isfinite(end):
        raise ValueError("end must be finite")
    if start is not None and end is not None and start > end:
        raise ValueError("start must be less than or equal to end")


def validate_history_stats_request(
        metric: str, start: Optional[float], end: Optional[float]) -> None:
    if metric not in HISTORY_STATS_METRICS:
        raise ValueError(f"unsupported history stats metric: {metric}")
    validate_history_time_range(start, end)


def validate_history_page_request(metric: str, start: Optional[float],
                                  end: Optional[float], limit: int, offset: int) -> None:
    if metric not in HISTORY_METRICS:
        raise ValueError(f"unsupported history metric: {metric}")
    validate_history_time_range(start, end)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError("limit must be an integer between 1 and 1000")
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("offset must be a non-negative integer")


class Storage(Protocol):
    def save_telemetry(self, rec: dict) -> None: ...
    def save_event(self, rec: dict) -> None: ...
    def save_command(self, rec: dict) -> None: ...
    def update_command(self, cmd_id: str, **fields) -> Optional[dict]: ...
    def get_command(self, cmd_id: str) -> Optional[dict]: ...
    def save_config(self, rec: dict) -> None: ...
    def load_config(self) -> Optional[dict]: ...
    def history(self, metric: str, start: Optional[float], end: Optional[float]) -> list[dict]: ...
    def history_page(self, metric: str, start: Optional[float], end: Optional[float],
                     limit: int, offset: int) -> list[dict]: ...
    def history_stats(self, metric: str, start: Optional[float],
                      end: Optional[float]) -> HistoryStats: ...
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

    def history_page(self, metric: str, start: Optional[float], end: Optional[float],
                     limit: int, offset: int) -> list[dict]:
        validate_history_page_request(metric, start, end, limit, offset)
        with self._lock:
            rows = [
                (r["ts"], write_order, r[metric])
                for write_order, r in enumerate(self._telemetry)
                if r.get(metric) is not None
                and (start is None or r["ts"] >= start)
                and (end is None or r["ts"] <= end)
            ]
        rows.sort(key=lambda row: (row[0], row[1]))
        return [
            {"ts": ts, "value": value}
            for ts, _, value in rows[offset:offset + limit]
        ]

    def history_stats(self, metric: str, start: Optional[float],
                      end: Optional[float]) -> HistoryStats:
        validate_history_stats_request(metric, start, end)
        with self._lock:
            values = [
                value
                for r in self._telemetry
                if (value := r.get(metric)) is not None
                and math.isfinite(value)
                and (start is None or r["ts"] >= start)
                and (end is None or r["ts"] <= end)
            ]
        if not values:
            return {"count": 0, "avg": None, "min": None, "max": None}
        count = len(values)
        return {
            "count": count,
            "avg": float(sum(value / count for value in values)),
            "min": float(min(values)),
            "max": float(max(values)),
        }

    def list_events(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return list(reversed(self._events))[:limit]

    def list_commands(self, limit: int = 100) -> list[dict]:
        with self._lock:
            cmds = sorted(self._commands.values(), key=lambda c: c.get("sent_ts", c.get("ts", 0)), reverse=True)
            return [dict(c) for c in cmds[:limit]]

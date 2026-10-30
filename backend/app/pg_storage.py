"""Lưu trữ bền bằng PostgreSQL. Bảng tự tạo khi khởi động (CREATE TABLE IF NOT EXISTS).

Giao diện giữ nguyên như InMemoryStorage: thời gian vào/ra là epoch giây (float),
trong database là timestamptz.
"""
import logging
import time
from typing import Optional

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL,
    temperature_c DOUBLE PRECISION,
    humidity_pct DOUBLE PRECISION,
    dht_ok BOOLEAN,
    pir_ready BOOLEAN,
    motion_detected BOOLEAN,
    is_dark BOOLEAN,
    door_command TEXT,
    fan_on BOOLEAN,
    led1_on BOOLEAN,
    led2_on BOOLEAN,
    led3_on BOOLEAN,
    heat_alarm BOOLEAN,
    uptime_ms BIGINT,
    smoke_raw INTEGER,
    smoke_alarm BOOLEAN,
    pump_on BOOLEAN,
    modes JSONB
);
CREATE INDEX IF NOT EXISTS telemetry_ts_idx ON telemetry (ts);

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL,
    value DOUBLE PRECISION,
    threshold DOUBLE PRECISION,
    reason TEXT,
    uptime_ms BIGINT
);
CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts);

CREATE TABLE IF NOT EXISTS commands (
    cmd_id TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    action TEXT NOT NULL,
    source TEXT,
    status TEXT NOT NULL,
    sent_ts TIMESTAMPTZ NOT NULL,
    ack_ts TIMESTAMPTZ,
    detail TEXT,
    ts TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS commands_sent_idx ON commands (sent_ts);

CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_id TEXT NOT NULL,
    thresholds JSONB NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);
"""

TELEMETRY_COLS = [
    "temperature_c", "humidity_pct", "dht_ok", "pir_ready", "motion_detected", "is_dark",
    "door_command", "fan_on", "led1_on", "led2_on", "led3_on", "heat_alarm", "uptime_ms",
    "smoke_raw", "smoke_alarm", "pump_on",
]
# chỉ các cột này được truy vấn lịch sử (tên cột không bao giờ lấy trực tiếp từ người dùng)
HISTORY_METRICS = set(TELEMETRY_COLS) - {"door_command"}

COMMAND_COLS = ["cmd_id", "device", "action", "source", "status", "detail"]
COMMAND_UPDATABLE = {"status", "detail", "ack_ts"}
CMD_SELECT = ("cmd_id, device, action, source, status, detail, "
              "extract(epoch from sent_ts)::float8 AS sent_ts, "
              "extract(epoch from ack_ts)::float8 AS ack_ts, "
              "extract(epoch from ts)::float8 AS ts")


class PostgresStorage:
    def __init__(self, url: str, wait_s: float = 30.0):
        self._pool = ConnectionPool(url, min_size=1, max_size=5, open=False,
                                    kwargs={"autocommit": True, "row_factory": dict_row})
        self._pool.open()
        deadline = time.monotonic() + wait_s
        while True:
            try:
                self._pool.wait(timeout=5)
                break
            except Exception:
                if time.monotonic() > deadline:
                    raise
                log.info("waiting for database…")
        with self._pool.connection() as conn:
            conn.execute(SCHEMA)

    def close(self) -> None:
        self._pool.close()

    def reset(self) -> None:
        """Xóa toàn bộ dữ liệu (dùng cho test)."""
        with self._pool.connection() as conn:
            conn.execute("TRUNCATE telemetry, events, commands, config RESTART IDENTITY")

    # ---- telemetry -----------------------------------------------------
    def save_telemetry(self, rec: dict) -> None:
        cols = ", ".join(TELEMETRY_COLS)
        marks = ", ".join(["%s"] * len(TELEMETRY_COLS))
        values = [rec.get(c) for c in TELEMETRY_COLS]
        with self._pool.connection() as conn:
            conn.execute(
                f"INSERT INTO telemetry (ts, {cols}, modes) VALUES (to_timestamp(%s), {marks}, %s)",
                [rec["ts"], *values, Jsonb(rec.get("modes") or {})])

    def history(self, metric: str, start: Optional[float], end: Optional[float]) -> list[dict]:
        if metric not in HISTORY_METRICS:
            return []
        sql = (f"SELECT extract(epoch from ts)::float8 AS ts, {metric} AS value "
               f"FROM telemetry WHERE {metric} IS NOT NULL")
        args: list = []
        if start is not None:
            sql += " AND ts >= to_timestamp(%s)"
            args.append(start)
        if end is not None:
            sql += " AND ts <= to_timestamp(%s)"
            args.append(end)
        sql += " ORDER BY ts, id"
        with self._pool.connection() as conn:
            return [dict(r) for r in conn.execute(sql, args).fetchall()]

    # ---- events --------------------------------------------------------
    def save_event(self, rec: dict) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO events (ts, type, state, value, threshold, reason, uptime_ms) "
                "VALUES (to_timestamp(%s), %s, %s, %s, %s, %s, %s)",
                [rec["ts"], rec["type"], rec["state"], rec.get("value"), rec.get("threshold"),
                 rec.get("reason"), rec.get("uptime_ms")])

    def list_events(self, limit: int = 100) -> list[dict]:
        with self._pool.connection() as conn:
            rows = conn.execute(
                "SELECT extract(epoch from ts)::float8 AS ts, type, state, value, threshold, "
                "reason, uptime_ms FROM events ORDER BY ts DESC, id DESC LIMIT %s", [limit])
            return [dict(r) for r in rows.fetchall()]

    # ---- commands ------------------------------------------------------
    def save_command(self, rec: dict) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO commands (cmd_id, device, action, source, status, detail, "
                "sent_ts, ack_ts, ts) VALUES (%s, %s, %s, %s, %s, %s, to_timestamp(%s), "
                "to_timestamp(%s), to_timestamp(%s)) "
                "ON CONFLICT (cmd_id) DO UPDATE SET status = EXCLUDED.status, "
                "detail = EXCLUDED.detail, ack_ts = EXCLUDED.ack_ts",
                [rec["cmd_id"], rec["device"], rec["action"], rec.get("source"),
                 rec["status"], rec.get("detail"), rec["sent_ts"], rec.get("ack_ts"),
                 rec.get("ts", rec["sent_ts"])])

    def update_command(self, cmd_id: str, **fields) -> Optional[dict]:
        sets, args = [], []
        for k, v in fields.items():
            if k not in COMMAND_UPDATABLE:
                continue
            if k == "ack_ts":
                sets.append("ack_ts = to_timestamp(%s)")
            else:
                sets.append(f"{k} = %s")
            args.append(v)
        if not sets:
            return self.get_command(cmd_id)
        args.append(cmd_id)
        with self._pool.connection() as conn:
            conn.execute(f"UPDATE commands SET {', '.join(sets)} WHERE cmd_id = %s", args)
        return self.get_command(cmd_id)

    def get_command(self, cmd_id: str) -> Optional[dict]:
        with self._pool.connection() as conn:
            row = conn.execute(f"SELECT {CMD_SELECT} FROM commands WHERE cmd_id = %s",
                               [cmd_id]).fetchone()
            return dict(row) if row else None

    def list_commands(self, limit: int = 100) -> list[dict]:
        with self._pool.connection() as conn:
            rows = conn.execute(f"SELECT {CMD_SELECT} FROM commands "
                                "ORDER BY sent_ts DESC LIMIT %s", [limit])
            return [dict(r) for r in rows.fetchall()]

    # ---- config --------------------------------------------------------
    def save_config(self, rec: dict) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO config (id, config_id, thresholds, ts) "
                "VALUES (1, %s, %s, to_timestamp(%s)) ON CONFLICT (id) DO UPDATE SET "
                "config_id = EXCLUDED.config_id, thresholds = EXCLUDED.thresholds, ts = EXCLUDED.ts",
                [rec["config_id"], Jsonb(rec["thresholds"]), rec.get("ts", time.time())])

    def load_config(self) -> Optional[dict]:
        with self._pool.connection() as conn:
            row = conn.execute("SELECT config_id, thresholds, extract(epoch from ts)::float8 AS ts "
                               "FROM config WHERE id = 1").fetchone()
            return dict(row) if row else None

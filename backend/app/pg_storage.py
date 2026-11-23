"""Lưu trữ bền bằng PostgreSQL. Bảng tự tạo khi khởi động (CREATE TABLE IF NOT EXISTS).

Giao diện giữ nguyên như InMemoryStorage: thời gian vào/ra là epoch giây (float),
trong database là timestamptz.
"""
import logging
import time
from typing import Iterator, Optional

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .reliability import IngestResult, ReliabilityTracker
from .storage import (HISTORY_METRICS, HistoryStats, iter_history_csv,
                      validate_history_csv_request, validate_history_page_request,
                      validate_history_stats_request, validate_history_time_range)

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
    gas_raw INTEGER,
    gas_alarm BOOLEAN,
    gas_sensor_ok BOOLEAN,
    safety_mode TEXT,
    safety_reason TEXT,
    modes JSONB,
    device_id TEXT,
    boot_id TEXT,
    seq BIGINT
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

MIGRATION_SQL = """
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS boot_id TEXT;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS gas_raw INTEGER;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS gas_alarm BOOLEAN;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS gas_sensor_ok BOOLEAN;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS safety_mode TEXT;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS safety_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_dedup_idx
ON telemetry (device_id, boot_id, seq)
WHERE device_id IS NOT NULL AND boot_id IS NOT NULL AND seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS telemetry_device_boot_seq_idx
ON telemetry (device_id, boot_id, seq);
CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events (type, ts);
CREATE INDEX IF NOT EXISTS commands_status_idx ON commands (status);
"""

TELEMETRY_COLS = [
    "temperature_c", "humidity_pct", "dht_ok", "pir_ready", "motion_detected", "is_dark",
    "door_command", "fan_on", "led1_on", "led2_on", "led3_on", "heat_alarm", "uptime_ms",
    "smoke_raw", "smoke_alarm", "pump_on",
    "gas_raw", "gas_alarm", "gas_sensor_ok", "safety_mode", "safety_reason",
]
# chỉ các cột này được truy vấn lịch sử (tên cột không bao giờ lấy trực tiếp từ người dùng)
# Column names and predicates are constants, never SQL supplied by a caller.
# PostgreSQL integer columns cannot contain non-finite values; float8 columns can.
HISTORY_STATS_SQL = {
    "temperature_c": (
        "temperature_c",
        "temperature_c NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)",
    ),
    "humidity_pct": (
        "humidity_pct",
        "humidity_pct NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)",
    ),
    "smoke_raw": ("smoke_raw", "TRUE"),
    "gas_raw": ("gas_raw", "TRUE"),
}

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
            conn.execute(MIGRATION_SQL)
        self._tracker = ReliabilityTracker()
        self._init_tracker_sessions()

    def _init_tracker_sessions(self) -> None:
        try:
            with self._pool.connection() as conn:
                rows = conn.execute(
                    "SELECT device_id, boot_id, max(seq) AS max_seq "
                    "FROM telemetry "
                    "WHERE device_id IS NOT NULL AND boot_id IS NOT NULL AND seq IS NOT NULL "
                    "GROUP BY device_id, boot_id"
                ).fetchall()
                for r in rows:
                    self._tracker.init_session(r["device_id"], r["boot_id"], r["max_seq"])
        except Exception:
            log.exception("failed to initialize tracker sessions from db")

    def close(self) -> None:
        self._pool.close()

    def reset(self) -> None:
        """Xóa toàn bộ dữ liệu (dùng cho test)."""
        with self._pool.connection() as conn:
            conn.execute("TRUNCATE telemetry, events, commands, config RESTART IDENTITY")
        self._tracker = ReliabilityTracker()

    # ---- telemetry -----------------------------------------------------
    def save_telemetry(self, rec: dict) -> bool:
        cols = ", ".join(TELEMETRY_COLS)
        marks = ", ".join(["%s"] * len(TELEMETRY_COLS))
        values = [rec.get(c) for c in TELEMETRY_COLS]
        device_id = rec.get("device_id")
        boot_id = rec.get("boot_id")
        seq = rec.get("seq")
        ts = rec["ts"]

        ingest = self._tracker.record_incoming(device_id, boot_id, seq, now=ts)
        if not ingest.stored:
            return False

        try:
            with self._pool.connection() as conn:
                row = conn.execute(
                    f"INSERT INTO telemetry (ts, {cols}, modes, device_id, boot_id, seq) "
                    f"VALUES (to_timestamp(%s), {marks}, %s, %s, %s, %s) "
                    f"ON CONFLICT (device_id, boot_id, seq) "
                    f"WHERE device_id IS NOT NULL AND boot_id IS NOT NULL AND seq IS NOT NULL "
                    f"DO NOTHING "
                    f"RETURNING id",
                    [ts, *values, Jsonb(rec.get("modes") or {}), device_id, boot_id, seq]
                ).fetchone()
        except Exception:
            self._tracker.revert_incoming(device_id, boot_id, seq, ingest)
            raise

        if row is None and boot_id is not None and seq is not None:
            self._tracker.record_db_duplicate(device_id, boot_id, seq, was_out_of_order=ingest.is_out_of_order)
            return False

        return True

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

    def history_page(self, metric: str, start: Optional[float], end: Optional[float],
                     limit: int, offset: int) -> list[dict]:
        validate_history_page_request(metric, start, end, limit, offset)
        column = metric  # Safe after the shared allowlist validation above.
        sql = (f"SELECT extract(epoch from ts)::float8 AS ts, {column} AS value "
               f"FROM telemetry WHERE {column} IS NOT NULL")
        args: list = []
        if start is not None:
            sql += " AND ts >= to_timestamp(%s)"
            args.append(start)
        if end is not None:
            sql += " AND ts <= to_timestamp(%s)"
            args.append(end)
        sql += " ORDER BY ts, id LIMIT %s OFFSET %s"
        args.extend([limit, offset])
        with self._pool.connection() as conn:
            return [dict(r) for r in conn.execute(sql, args).fetchall()]

    def history_csv(self, metric: str, start: Optional[float], end: Optional[float],
                    batch_size: int = 1000) -> Iterator[bytes]:
        validate_history_csv_request(metric, start, end, batch_size)
        with self._pool.connection() as conn:
            snapshot_id = conn.execute(
                "SELECT max(id) AS snapshot_id FROM telemetry").fetchone()["snapshot_id"]
        rows = self._history_csv_rows(metric, start, end, batch_size, snapshot_id)
        return iter_history_csv(rows)

    def _history_csv_rows(self, column: str, start: Optional[float], end: Optional[float],
                          batch_size: int, snapshot_id: Optional[int]) -> Iterator[dict]:
        if snapshot_id is None:
            return
        cursor_ts = None
        cursor_id = None
        while True:
            sql = (f"SELECT id AS cursor_id, ts AS cursor_ts, "
                   f"extract(epoch from ts)::float8 AS ts, {column} AS value "
                   f"FROM telemetry WHERE id <= %s AND {column} IS NOT NULL")
            args: list = [snapshot_id]
            if start is not None:
                sql += " AND ts >= to_timestamp(%s)"
                args.append(start)
            if end is not None:
                sql += " AND ts <= to_timestamp(%s)"
                args.append(end)
            if cursor_ts is not None:
                sql += " AND (ts, id) > (%s, %s)"
                args.extend([cursor_ts, cursor_id])
            sql += " ORDER BY ts, id LIMIT %s"
            args.append(batch_size)
            with self._pool.connection() as conn:
                batch = conn.execute(sql, args).fetchall()
            if not batch:
                return
            for row in batch:
                yield {"ts": row["ts"], "value": row["value"]}
            cursor_ts = batch[-1]["cursor_ts"]
            cursor_id = batch[-1]["cursor_id"]

    def history_stats(self, metric: str, start: Optional[float],
                      end: Optional[float]) -> HistoryStats:
        validate_history_stats_request(metric, start, end)
        column, finite_predicate = HISTORY_STATS_SQL[metric]
        sql = (f"SELECT count({column})::bigint AS count, "
               f"avg({column}::numeric)::float8 AS avg, min({column})::float8 AS min, "
               f"max({column})::float8 AS max FROM telemetry "
               f"WHERE {column} IS NOT NULL AND {finite_predicate}")
        args: list = []
        if start is not None:
            sql += " AND ts >= to_timestamp(%s)"
            args.append(start)
        if end is not None:
            sql += " AND ts <= to_timestamp(%s)"
            args.append(end)
        with self._pool.connection() as conn:
            return dict(conn.execute(sql, args).fetchone())

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

    # ---- reliability & connection --------------------------------------
    def save_connection_event(self, state: str, reason: Optional[str] = None,
                              ts: Optional[float] = None,
                              uptime_ms: Optional[int] = None) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO events (ts, type, state, reason, uptime_ms) "
                "VALUES (to_timestamp(%s), 'connection', %s, %s, %s)",
                [ts if ts is not None else time.time(), state, reason, uptime_ms]
            )

    def list_connection_events(self, limit: int = 100, start: Optional[float] = None,
                               end: Optional[float] = None) -> list[dict]:
        sql = ("SELECT extract(epoch from ts)::float8 AS ts, state, reason, uptime_ms "
               "FROM events WHERE type = 'connection'")
        args: list = []
        if start is not None:
            sql += " AND ts >= to_timestamp(%s)"
            args.append(start)
        if end is not None:
            sql += " AND ts <= to_timestamp(%s)"
            args.append(end)
        sql += " ORDER BY ts DESC, id DESC LIMIT %s"
        args.append(limit)
        with self._pool.connection() as conn:
            return [dict(r) for r in conn.execute(sql, args).fetchall()]

    def list_error_events(self, limit: int = 100, start: Optional[float] = None,
                          end: Optional[float] = None) -> list[dict]:
        sql = ("SELECT extract(epoch from ts)::float8 AS ts, type, state, value, "
               "threshold, reason, uptime_ms FROM events "
               "WHERE type != 'connection' AND (type ILIKE '%%error%%' OR type IN ('heat_alarm', 'smoke_alarm', 'dht_error', 'gas_alarm', 'gas_error'))")
        args: list = []
        if start is not None:
            sql += " AND ts >= to_timestamp(%s)"
            args.append(start)
        if end is not None:
            sql += " AND ts <= to_timestamp(%s)"
            args.append(end)
        sql += " ORDER BY ts DESC, id DESC LIMIT %s"
        args.append(limit)
        with self._pool.connection() as conn:
            return [dict(r) for r in conn.execute(sql, args).fetchall()]

    def command_stats(self, start: Optional[float] = None,
                      end: Optional[float] = None) -> dict:
        validate_history_time_range(start, end)
        sql = (
            "SELECT "
            "count(*)::bigint AS total, "
            "count(*) FILTER (WHERE status = 'ok')::bigint AS ok, "
            "count(*) FILTER (WHERE status = 'failed')::bigint AS failed, "
            "count(*) FILTER (WHERE status = 'timeout')::bigint AS timeout, "
            "count(*) FILTER (WHERE status = 'pending')::bigint AS pending, "
            "avg(extract(epoch from (ack_ts - sent_ts))::float8) FILTER (WHERE ack_ts IS NOT NULL AND sent_ts IS NOT NULL AND ack_ts >= sent_ts) AS avg_duration_s, "
            "min(extract(epoch from (ack_ts - sent_ts))::float8) FILTER (WHERE ack_ts IS NOT NULL AND sent_ts IS NOT NULL AND ack_ts >= sent_ts) AS min_duration_s, "
            "max(extract(epoch from (ack_ts - sent_ts))::float8) FILTER (WHERE ack_ts IS NOT NULL AND sent_ts IS NOT NULL AND ack_ts >= sent_ts) AS max_duration_s "
            "FROM commands WHERE 1=1"
        )
        args: list = []
        if start is not None:
            sql += " AND sent_ts >= to_timestamp(%s)"
            args.append(start)
        if end is not None:
            sql += " AND sent_ts <= to_timestamp(%s)"
            args.append(end)

        with self._pool.connection() as conn:
            res = dict(conn.execute(sql, args).fetchone())

        total = res["total"]
        ok = res["ok"]
        res["success_rate"] = float(ok / total) if total > 0 else None
        return res

    def reliability_stats(self, device_id: Optional[str] = None,
                          start: Optional[float] = None,
                          end: Optional[float] = None,
                          now: Optional[float] = None) -> dict:
        validate_history_time_range(start, end)
        sql = "SELECT count(*)::bigint AS stored_count FROM telemetry WHERE 1=1"
        args: list = []
        if device_id is not None:
            sql += " AND device_id = %s"
            args.append(device_id)
        if start is not None:
            sql += " AND ts >= to_timestamp(%s)"
            args.append(start)
        if end is not None:
            sql += " AND ts <= to_timestamp(%s)"
            args.append(end)

        with self._pool.connection() as conn:
            stored_count = conn.execute(sql, args).fetchone()["stored_count"]

        return self._tracker.get_stats(stored_count=stored_count, device_id=device_id, now=now, start=start, end=end)

    def verify_telemetry_gaps(self, device_id: str, boot_id: str) -> list[dict]:
        """Truy vấn kiểm chứng gaps trực tiếp trên dữ liệu PostgreSQL bằng SQL Window Functions."""
        sql = """
        WITH seq_diffs AS (
            SELECT
                device_id,
                boot_id,
                seq,
                lag(seq) OVER (PARTITION BY device_id, boot_id ORDER BY seq) AS prev_seq
            FROM telemetry
            WHERE device_id = %s AND boot_id = %s AND seq IS NOT NULL
        )
        SELECT
            prev_seq + 1 AS gap_start,
            seq - 1 AS gap_end,
            (seq - prev_seq - 1)::bigint AS missing_count
        FROM seq_diffs
        WHERE prev_seq IS NOT NULL AND seq > prev_seq + 1
        ORDER BY gap_start;
        """
        with self._pool.connection() as conn:
            rows = conn.execute(sql, [device_id, boot_id]).fetchall()
            return [dict(r) for r in rows]

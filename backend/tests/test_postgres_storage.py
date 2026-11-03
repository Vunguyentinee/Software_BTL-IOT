"""Hợp đồng của Storage chạy trên PostgreSQL thật.

Chỉ chạy khi đặt BTL_TEST_DATABASE_URL, ví dụ:
  postgresql://postgres:test@localhost:55432/smarthome_test
"""
import json
import os
from urllib.parse import urlparse

import pytest

URL = os.environ.get("BTL_TEST_DATABASE_URL")


def _is_allowed_test_database(url):
    if not url:
        return False
    try:
        parsed = urlparse(url)
        return parsed.port == 55432 and parsed.path.rstrip("/") == "/smarthome_test"
    except ValueError:
        return False


pytestmark = pytest.mark.skipif(
    not _is_allowed_test_database(URL),
    reason="BTL_TEST_DATABASE_URL must target smarthome_test on port 55432",
)


@pytest.fixture
def make():
    from app.pg_storage import PostgresStorage

    created = []

    def factory():
        s = PostgresStorage(URL)
        created.append(s)
        return s

    first = factory()
    first.reset()
    yield factory
    for s in created:
        s.close()


def tel(ts, temp, **extra):
    base = {"ts": ts, "temperature_c": temp, "humidity_pct": 50.0, "dht_ok": True,
            "pir_ready": True, "motion_detected": False, "is_dark": False,
            "door_command": "closed", "fan_on": False, "led1_on": False,
            "led2_on": False, "led3_on": False, "heat_alarm": False, "uptime_ms": 1,
            "smoke_raw": 300, "smoke_alarm": False, "pump_on": False,
            "modes": {"fan": "auto"}}
    base.update(extra)
    return base


def test_history_filters_by_metric_and_time(make):
    s = make()
    for ts, t in [(100, 30), (200, 31), (300, 32)]:
        s.save_telemetry(tel(ts, t))
    h = s.history("temperature_c", 150, 300)
    assert [p["ts"] for p in h] == [200, 300]
    assert h[0]["value"] == 31


def test_history_skips_null_and_unknown_metric(make):
    s = make()
    s.save_telemetry(tel(100, None, humidity_pct=None, dht_ok=False))
    s.save_telemetry(tel(200, 30))
    assert [p["ts"] for p in s.history("temperature_c", None, None)] == [200]
    assert s.history("nope; drop table telemetry", None, None) == []


def test_smoke_history_and_bool_metric(make):
    s = make()
    s.save_telemetry(tel(100, 30, smoke_raw=None))
    s.save_telemetry(tel(200, 30, smoke_raw=450))
    assert s.history("smoke_raw", None, None) == [{"ts": 200, "value": 450}]


def test_history_stats_matches_in_memory(make):
    from app.storage import InMemoryStorage

    postgres = make()
    memory = InMemoryStorage()
    records = [
        tel(100, 30, humidity_pct=30, smoke_raw=300),
        tel(200, 35, humidity_pct=35, smoke_raw=350),
        tel(300, 40, humidity_pct=40, smoke_raw=400),
        tel(400, 45, humidity_pct=45, smoke_raw=450),
    ]
    for rec in records:
        postgres.save_telemetry(rec)
        memory.save_telemetry(rec)

    expected = {"count": 4, "avg": 37.5, "min": 30.0, "max": 45.0}
    for metric in ("temperature_c", "humidity_pct"):
        assert postgres.history_stats(metric, 100, 400) == expected
        assert postgres.history_stats(metric, 100, 400) == memory.history_stats(
            metric, 100, 400)
    smoke_stats = postgres.history_stats("smoke_raw", 100, 400)
    assert smoke_stats == memory.history_stats("smoke_raw", 100, 400)
    assert isinstance(smoke_stats["count"], int)
    assert all(isinstance(smoke_stats[key], float) for key in ("avg", "min", "max"))


def test_history_stats_skips_non_finite_values_and_matches_in_memory(make):
    from app.storage import InMemoryStorage

    postgres = make()
    memory = InMemoryStorage()
    values = [30, 35, 40, None, float("nan"), float("inf"), float("-inf")]
    for ts, value in enumerate(values, start=1):
        rec = tel(ts, value, humidity_pct=value)
        postgres.save_telemetry(rec)
        memory.save_telemetry(rec)

    expected = {"count": 3, "avg": 35.0, "min": 30.0, "max": 40.0}
    for metric in ("temperature_c", "humidity_pct"):
        postgres_stats = postgres.history_stats(metric, None, None)
        assert postgres_stats == expected
        assert postgres_stats == memory.history_stats(metric, None, None)
        assert isinstance(postgres_stats["count"], int)
        assert all(isinstance(postgres_stats[key], float)
                   for key in ("avg", "min", "max"))
        json.dumps(postgres_stats, allow_nan=False)


def test_history_stats_empty_null_and_validation_match_in_memory(make):
    from app.storage import InMemoryStorage

    postgres = make()
    memory = InMemoryStorage()
    values = [None, float("nan"), float("inf"), float("-inf")]
    for ts, value in enumerate(values, start=100):
        rec = tel(ts, value, humidity_pct=value, smoke_raw=None)
        postgres.save_telemetry(rec)
        memory.save_telemetry(rec)

    empty = {"count": 0, "avg": None, "min": None, "max": None}
    for storage in (memory, postgres):
        assert storage.history_stats("temperature_c", None, None) == empty
        assert storage.history_stats("humidity_pct", None, None) == empty
        with pytest.raises(ValueError, match="unsupported history stats metric"):
            storage.history_stats("nope; drop table telemetry", None, None)
        with pytest.raises(ValueError, match="start must be less than or equal to end"):
            storage.history_stats("smoke_raw", 200, 100)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize("bound", ["start", "end"])
def test_history_stats_rejects_non_finite_time_bounds_on_both_storages(make, bad, bound):
    from app.storage import InMemoryStorage

    storages = (InMemoryStorage(), make())
    args = {"start": None, "end": None}
    args[bound] = bad
    for storage in storages:
        with pytest.raises(ValueError, match=f"{bound} must be finite"):
            storage.history_stats("temperature_c", **args)


def test_command_roundtrip(make):
    s = make()
    s.save_command({"cmd_id": "c1", "device": "fan", "action": "on", "source": "web",
                    "status": "pending", "sent_ts": 100.0, "ack_ts": None,
                    "detail": None, "ts": 100.0})
    got = s.update_command("c1", status="ok", ack_ts=101.5, detail=None)
    assert got["status"] == "ok" and got["ack_ts"] == 101.5
    assert s.get_command("c1")["sent_ts"] == 100.0
    assert s.update_command("zzz", status="ok") is None
    assert s.get_command("zzz") is None
    assert [c["cmd_id"] for c in s.list_commands()] == ["c1"]


def test_events_newest_first(make):
    s = make()
    s.save_event({"type": "pump", "state": "start", "value": 2300.0, "threshold": 2000.0,
                  "reason": "smoke", "uptime_ms": 5, "ts": 10.0})
    s.save_event({"type": "pump", "state": "end", "value": None, "threshold": None,
                  "reason": None, "uptime_ms": 9, "ts": 20.0})
    ev = s.list_events()
    assert [e["state"] for e in ev] == ["end", "start"]
    assert ev[1]["value"] == 2300.0 and ev[0]["ts"] == 20.0


def test_config_survives_new_connection(make):
    s = make()
    assert s.load_config() is None
    s.save_config({"config_id": "k1", "thresholds": {"fan_on": 36}, "ts": 1.0})
    s.save_config({"config_id": "k2", "thresholds": {"fan_on": 37}, "ts": 2.0})
    s2 = make()
    got = s2.load_config()
    assert got["config_id"] == "k2" and got["thresholds"]["fan_on"] == 37


def test_service_works_on_postgres(make):
    from app.config import Settings
    from app.service import Service
    from tests.conftest import EXAMPLE, FakeClock, FakePublisher

    s = make()
    svc = Service(Settings(), s, FakePublisher(), clock=FakeClock())
    svc.on_telemetry(EXAMPLE)
    rec = svc.send_command("fan", "on")
    svc.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"})
    assert s.get_command(rec["cmd_id"])["status"] == "ok"
    assert len(s.history("temperature_c", None, None)) == 1

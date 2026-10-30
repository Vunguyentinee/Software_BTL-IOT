"""Hợp đồng của Storage chạy trên PostgreSQL thật.

Chỉ chạy khi đặt BTL_TEST_DATABASE_URL, ví dụ:
  postgresql://postgres:test@localhost:55432/smarthome_test
"""
import os

import pytest

URL = os.environ.get("BTL_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="BTL_TEST_DATABASE_URL not set")


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

from app.storage import InMemoryStorage


def tel(ts, temp):
    return {"ts": ts, "temperature_c": temp, "humidity_pct": 50.0}


def test_history_filters_by_metric_and_time():
    s = InMemoryStorage()
    for ts, t in [(100, 30), (200, 31), (300, 32)]:
        s.save_telemetry(tel(ts, t))
    h = s.history("temperature_c", 150, 300)
    assert [p["ts"] for p in h] == [200, 300]
    assert h[0]["value"] == 31


def test_history_skips_null_values():
    s = InMemoryStorage()
    s.save_telemetry(tel(100, None))
    s.save_telemetry(tel(200, 30))
    assert [p["ts"] for p in s.history("temperature_c", None, None)] == [200]


def test_telemetry_cap():
    s = InMemoryStorage(max_telemetry=2)
    for ts in (1, 2, 3):
        s.save_telemetry(tel(ts, 30))
    assert [p["ts"] for p in s.history("temperature_c", None, None)] == [2, 3]


def test_command_update_roundtrip():
    s = InMemoryStorage()
    s.save_command({"cmd_id": "c1", "status": "pending", "ts": 1})
    s.update_command("c1", status="ok")
    assert s.get_command("c1")["status"] == "ok"
    assert s.update_command("zzz", status="ok") is None


def test_persistence_across_restart(tmp_path):
    p = str(tmp_path / "store.json")
    s = InMemoryStorage(p)
    s.save_config({"config_id": "k1", "thresholds": {"fan_on": 36}, "ts": 1})
    s.save_event({"type": "pump", "ts": 2})
    s.save_command({"cmd_id": "c1", "status": "ok", "ts": 3})
    s2 = InMemoryStorage(p)
    assert s2.load_config()["config_id"] == "k1"
    assert s2.list_events()[0]["type"] == "pump"
    assert s2.get_command("c1")["status"] == "ok"


def test_corrupt_or_missing_file_starts_empty(tmp_path):
    p = tmp_path / "store.json"
    p.write_text("{not json")
    s = InMemoryStorage(str(p))
    assert s.load_config() is None
    assert InMemoryStorage(str(tmp_path / "nope.json")).list_events() == []

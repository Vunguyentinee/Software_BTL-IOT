import json

import pytest

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


def test_history_stats_aggregates_non_null_values_with_inclusive_bounds():
    s = InMemoryStorage()
    for ts, value in [(100, 30), (200, 35), (300, 40), (400, 45)]:
        s.save_telemetry(tel(ts, value))

    assert s.history_stats("temperature_c", 100, 400) == {
        "count": 4, "avg": 37.5, "min": 30.0, "max": 45.0,
    }


def test_history_stats_skips_non_finite_values_and_is_json_serializable():
    s = InMemoryStorage()
    values = [30, 35, 40, None, float("nan"), float("inf"), float("-inf")]
    for ts, value in enumerate(values, start=1):
        s.save_telemetry(tel(ts, value))

    stats = s.history_stats("temperature_c", None, None)
    assert stats == {"count": 3, "avg": 35.0, "min": 30.0, "max": 40.0}
    assert isinstance(stats["count"], int)
    assert all(isinstance(stats[key], float) for key in ("avg", "min", "max"))
    json.dumps(stats, allow_nan=False)


def test_history_stats_empty_range_and_all_null_values():
    s = InMemoryStorage()
    for ts, value in enumerate(
            [None, float("nan"), float("inf"), float("-inf")], start=100):
        s.save_telemetry(tel(ts, value))
    empty = {"count": 0, "avg": None, "min": None, "max": None}
    assert s.history_stats("temperature_c", None, None) == empty
    assert s.history_stats("humidity_pct", 200, 300) == empty


def test_history_stats_rejects_invalid_metric_and_time_range():
    s = InMemoryStorage()
    with pytest.raises(ValueError, match="unsupported history stats metric"):
        s.history_stats("nope; drop table telemetry", None, None)
    with pytest.raises(ValueError, match="start must be less than or equal to end"):
        s.history_stats("smoke_raw", 200, 100)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize("bound", ["start", "end"])
def test_history_stats_rejects_non_finite_time_bounds(bad, bound):
    s = InMemoryStorage()
    args = {"start": None, "end": None}
    args[bound] = bad
    with pytest.raises(ValueError, match=f"{bound} must be finite"):
        s.history_stats("temperature_c", **args)


def test_history_stats_smoke_values_are_normalized_to_float():
    s = InMemoryStorage()
    for ts, value in [(1, 300), (2, 350), (3, 400)]:
        s.save_telemetry({"ts": ts, "smoke_raw": value})

    stats = s.history_stats("smoke_raw", None, None)
    assert stats == {"count": 3, "avg": 350.0, "min": 300.0, "max": 400.0}
    assert isinstance(stats["count"], int)
    assert all(isinstance(stats[key], float) for key in ("avg", "min", "max"))


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

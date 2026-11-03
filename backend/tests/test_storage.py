import csv
import io
import json

import pytest

from app.storage import InMemoryStorage, iter_history_csv


def tel(ts, temp):
    return {"ts": ts, "temperature_c": temp, "humidity_pct": 50.0}


def read_csv(chunks):
    text = b"".join(chunks).decode("utf-8")
    return text, list(csv.DictReader(io.StringIO(text, newline="")))


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


def test_history_page_reads_120_records_in_five_pages_without_gaps():
    s = InMemoryStorage()
    for value in range(120):
        s.save_telemetry(tel(1000 + value, value))

    pages = [s.history_page("temperature_c", None, None, 25, offset)
             for offset in range(0, 125, 25)]
    combined = [point for page in pages for point in page]

    assert [len(page) for page in pages] == [25, 25, 25, 25, 20]
    assert combined == [{"ts": 1000 + value, "value": value} for value in range(120)]


def test_history_page_orders_equal_timestamps_by_write_order():
    s = InMemoryStorage()
    for ts, value in [(200, 4), (100, 1), (100, 2), (100, 3), (200, 5)]:
        s.save_telemetry(tel(ts, value))

    assert s.history_page("temperature_c", None, None, 10, 0) == [
        {"ts": 100, "value": 1},
        {"ts": 100, "value": 2},
        {"ts": 100, "value": 3},
        {"ts": 200, "value": 4},
        {"ts": 200, "value": 5},
    ]


def test_history_page_handles_null_inclusive_bounds_boolean_and_empty_page():
    s = InMemoryStorage()
    records = [
        {"ts": 99, "temperature_c": 1, "fan_on": False},
        {"ts": 100, "temperature_c": 2, "fan_on": False},
        {"ts": 150, "temperature_c": None, "fan_on": True},
        {"ts": 200, "temperature_c": 3, "fan_on": True},
        {"ts": 201, "temperature_c": 4, "fan_on": False},
    ]
    for rec in records:
        s.save_telemetry(rec)

    assert s.history_page("temperature_c", 100, 200, 10, 0) == [
        {"ts": 100, "value": 2}, {"ts": 200, "value": 3},
    ]
    assert s.history_page("fan_on", 100, 200, 10, 0) == [
        {"ts": 100, "value": False}, {"ts": 150, "value": True},
        {"ts": 200, "value": True},
    ]
    assert s.history_page("temperature_c", None, None, 10, 99) == []


@pytest.mark.parametrize("limit,offset", [(0, 0), (1001, 0), (1.5, 0), (True, 0),
                                           (1, -1), (1, 1.5), (1, True)])
def test_history_page_rejects_invalid_pagination(limit, offset):
    with pytest.raises(ValueError):
        InMemoryStorage().history_page("temperature_c", None, None, limit, offset)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize("bound", ["start", "end"])
def test_history_page_rejects_non_finite_time_bounds(bad, bound):
    args = {"start": None, "end": None}
    args[bound] = bad
    with pytest.raises(ValueError, match=f"{bound} must be finite"):
        InMemoryStorage().history_page("temperature_c", limit=10, offset=0, **args)


def test_history_page_rejects_invalid_metric_and_reversed_time_range():
    s = InMemoryStorage()
    with pytest.raises(ValueError, match="unsupported history metric"):
        s.history_page("nope; drop table telemetry", None, None, 10, 0)
    with pytest.raises(ValueError, match="start must be less than or equal to end"):
        s.history_page("temperature_c", 200, 100, 10, 0)


def test_iter_history_csv_uses_utf8_and_standard_escaping():
    text, rows = read_csv(iter_history_csv([
        {"ts": 1, "value": 'giá trị, "đặc biệt"\n'},
    ]))

    assert text.startswith("ts,value\r\n")
    assert rows == [{"ts": "1.0", "value": 'giá trị, "đặc biệt"\n'}]


def test_history_csv_empty_null_and_inclusive_bounds():
    s = InMemoryStorage()
    for ts, value in [(99.0, 1.0), (100.0, 2.0), (150.0, None),
                      (200.0, 3.0), (201.0, 4.0)]:
        s.save_telemetry(tel(ts, value))

    assert b"".join(s.history_csv("temperature_c", 300, 400)) == b"ts,value\r\n"
    _, rows = read_csv(s.history_csv("temperature_c", 100, 200, batch_size=2))
    assert rows == [
        {"ts": "100.0", "value": "2.0"},
        {"ts": "200.0", "value": "3.0"},
    ]


def test_history_csv_many_rows_have_no_gaps_duplicates_or_late_writes():
    s = InMemoryStorage()
    for value in range(120):
        s.save_telemetry(tel(1000.0 + value, float(value)))

    export = s.history_csv("temperature_c", None, None, batch_size=17)
    s.save_telemetry(tel(1050.0, 999.0))
    _, rows = read_csv(export)

    assert len(rows) == 120
    assert [float(row["value"]) for row in rows] == list(map(float, range(120)))
    assert len({(row["ts"], row["value"]) for row in rows}) == 120


@pytest.mark.parametrize("batch_size", [1, 1000])
def test_history_csv_batch_size_boundaries_with_empty_and_filtered_data(batch_size):
    s = InMemoryStorage()
    for ts, value in [(99.0, 1.0), (100.0, 2.0), (200.0, 3.0), (201.0, 4.0)]:
        s.save_telemetry(tel(ts, value))

    assert b"".join(s.history_csv(
        "temperature_c", 300, 400, batch_size)) == b"ts,value\r\n"
    _, rows = read_csv(s.history_csv("temperature_c", 100, 200, batch_size))
    assert rows == [
        {"ts": "100.0", "value": "2.0"},
        {"ts": "200.0", "value": "3.0"},
    ]


def test_history_csv_normalizes_integer_and_float_timestamps():
    integer_ts = InMemoryStorage()
    float_ts = InMemoryStorage()
    integer_ts.save_telemetry(tel(100, 2.0))
    float_ts.save_telemetry(tel(100.0, 2.0))

    integer_csv = b"".join(integer_ts.history_csv("temperature_c", None, None))
    float_csv = b"".join(float_ts.history_csv("temperature_c", None, None))
    assert integer_csv == float_csv == b"ts,value\r\n100.0,2.0\r\n"


@pytest.mark.parametrize("bad_call", [
    ("invalid", None, None, 1000),
    ("temperature_c", 200, 100, 1000),
    ("temperature_c", float("nan"), None, 1000),
    ("temperature_c", None, float("inf"), 1000),
    ("temperature_c", None, None, 0),
    ("temperature_c", None, None, 1001),
    ("temperature_c", None, None, True),
])
def test_history_csv_rejects_invalid_request(bad_call):
    with pytest.raises(ValueError):
        InMemoryStorage().history_csv(*bad_call)


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

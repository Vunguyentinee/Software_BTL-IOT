import json

from tests.conftest import EXAMPLE


def kinds(broadcasts, kind):
    return [b for b in broadcasts if b["kind"] == kind]


def test_valid_telemetry_marks_online_and_stores(service, storage, clock):
    assert service.on_telemetry(EXAMPLE) is True
    assert service.get_state()["online"] is True
    h = storage.history("temperature_c", None, None)
    assert len(h) == 1 and h[0]["ts"] == clock.now


def test_telemetry_with_null_temperature_is_accepted_but_not_in_history(service, storage):
    d = dict(EXAMPLE, temperature_c=None, humidity_pct=None, dht_ok=False)
    assert service.on_telemetry(json.dumps(d).encode()) is True
    assert storage.history("temperature_c", None, None) == []
    assert service.get_state()["telemetry"]["dht_ok"] is False


def test_malformed_payloads_return_false(service):
    for bad in (b"not json", b"{}", b'{"temperature_c":"hot"}'):
        assert service.on_telemetry(bad) is False
    assert service.get_state()["online"] is False


def test_goes_offline_after_timeout(online_service, clock, broadcasts):
    n = len(kinds(broadcasts, "connection"))
    clock.advance(10.5)
    online_service.tick()
    assert online_service.get_state()["online"] is False
    assert len(kinds(broadcasts, "connection")) == n + 1
    online_service.tick()
    assert len(kinds(broadcasts, "connection")) == n + 1


def test_reconnect_broadcasts_connection_once(online_service, clock, broadcasts):
    clock.advance(11)
    online_service.tick()
    n = len(kinds(broadcasts, "connection"))
    online_service.on_telemetry(EXAMPLE)
    online_service.on_telemetry(EXAMPLE)
    assert online_service.get_state()["online"] is True
    assert len(kinds(broadcasts, "connection")) == n + 1


def test_status_offline_marks_offline_immediately(online_service):
    online_service.on_status("garbage")
    assert online_service.get_state()["online"] is True
    online_service.on_status("offline")
    assert online_service.get_state()["online"] is False


def test_event_stored_and_broadcast(service, storage, broadcasts):
    assert service.on_event(b'{"type":"pump","state":"start","uptime_ms":5}') is True
    assert storage.list_events()[0]["type"] == "pump"
    assert kinds(broadcasts, "event")
    assert service.on_event(b'{"type":"nope","state":"start","uptime_ms":5}') is False

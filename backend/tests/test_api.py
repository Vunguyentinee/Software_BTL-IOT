import asyncio

import pytest
from fastapi.testclient import TestClient

from app.api import WsHub, create_app
from tests.conftest import EXAMPLE


@pytest.fixture
def client(service):
    return TestClient(create_app(service))


def test_state_endpoint_reflects_telemetry(client, service):
    assert client.get("/api/state").json()["online"] is False
    service.on_telemetry(EXAMPLE)
    body = client.get("/api/state").json()
    assert body["online"] is True and body["telemetry"]["fan_on"] is True


def test_command_ok_returns_cmd_id_and_publishes(client, online_service, publisher):
    r = client.post("/api/devices/fan/command", json={"action": "on"})
    assert r.status_code == 200
    cmd_id = r.json()["cmd_id"]
    assert publisher.cmds[0]["cmd_id"] == cmd_id
    assert client.get(f"/api/commands/{cmd_id}").json()["status"] == "pending"


def test_command_offline_returns_409(client, publisher):
    r = client.post("/api/devices/fan/command", json={"action": "on"})
    assert r.status_code == 409 and r.json()["detail"] == "device_offline"
    assert publisher.cmds == []


def test_command_invalid_returns_422(client, online_service):
    assert client.post("/api/devices/pump/command", json={"action": "on"}).status_code == 422
    assert client.post("/api/devices/door/command", json={"action": "on"}).status_code == 422
    assert client.post("/api/devices/fan/command", json={}).status_code == 422


def test_get_command_unknown_returns_404(client):
    assert client.get("/api/commands/nope").status_code == 404


def test_put_config_valid_returns_pending(client, publisher):
    r = client.put("/api/config", json={"fan_on": 36, "fan_off": 33})
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert publisher.configs[0]["thresholds"]["fan_on"] == 36
    assert client.get("/api/config").json()["thresholds"]["fan_off"] == 33


def test_put_config_inverted_returns_422_and_publishes_nothing(client, publisher):
    r = client.put("/api/config", json={"fan_on": 30, "fan_off": 31})
    assert r.status_code == 422
    assert publisher.configs == []


def test_history_returns_points_and_rejects_unknown_metric(client, service, clock):
    service.on_telemetry(EXAMPLE)
    r = client.get("/api/history", params={"metric": "temperature_c"})
    assert r.json()[0]["value"] == 36.0
    assert client.get("/api/history", params={"metric": "bogus"}).status_code == 422
    assert client.get("/api/history", params={"metric": "temperature_c", "from": "garbage"}).status_code == 422
    future = client.get("/api/history", params={"metric": "temperature_c", "from": clock.now + 10})
    assert future.json() == []
    iso = client.get("/api/history", params={"metric": "temperature_c", "from": "1970-01-01T00:00:00Z"})
    assert len(iso.json()) == 1


def test_events_and_commands_lists(client, service):
    service.on_event({"type": "pump", "state": "start", "uptime_ms": 1})
    assert client.get("/api/events").json()[0]["type"] == "pump"
    assert client.get("/api/commands").json() == []


def test_websocket_sends_snapshot_then_broadcast(service):
    hub = WsHub()
    app = create_app(service, hub)
    with TestClient(app) as c:
        with c.websocket_connect("/ws") as ws:
            assert ws.receive_json()["kind"] == "snapshot"
            hub.threadsafe_broadcast({"kind": "telemetry", "data": {"x": 1}})
            assert ws.receive_json() == {"kind": "telemetry", "data": {"x": 1}}


def test_ws_dead_client_does_not_break_others():
    class Bad:
        async def send_json(self, m):
            raise RuntimeError("closed")

    class Good:
        def __init__(self):
            self.got = []

        async def send_json(self, m):
            self.got.append(m)

    hub = WsHub()
    good = Good()
    hub.clients = [Bad(), good]
    asyncio.run(hub.broadcast({"a": 1}))
    assert good.got == [{"a": 1}]
    assert len(hub.clients) == 1


# ---- thống kê, phân trang, CSV (Storage của Người 5) -----------------------
def _feed(service, clock, temps):
    for t in temps:
        service.on_telemetry(dict(EXAMPLE, temperature_c=t))
        clock.advance(1)


def test_history_stats(client, service, clock):
    _feed(service, clock, [30.0, 32.0, 34.0])
    r = client.get("/api/history/stats", params={"metric": "temperature_c"})
    assert r.status_code == 200
    assert r.json() == {"count": 3, "avg": 32.0, "min": 30.0, "max": 34.0}


def test_history_stats_empty_range_returns_nulls_not_zero(client, service, clock):
    _feed(service, clock, [30.0])
    r = client.get("/api/history/stats", params={"metric": "temperature_c", "from": clock.now + 100})
    assert r.json() == {"count": 0, "avg": None, "min": None, "max": None}


@pytest.mark.parametrize("params", [
    {"metric": "fan_on"},                                   # không hỗ trợ thống kê
    {"metric": "bogus"},
    {"metric": "temperature_c", "from": "nan"},
    {"metric": "temperature_c", "to": "inf"},
    {"metric": "temperature_c", "from": 200, "to": 100},
    {"metric": "temperature_c", "from": "garbage"},
])
def test_history_stats_invalid_returns_422(client, params):
    assert client.get("/api/history/stats", params=params).status_code == 422


def test_history_page(client, service, clock):
    _feed(service, clock, [1.0, 2.0, 3.0, 4.0, 5.0])
    r = client.get("/api/history/page", params={"metric": "temperature_c", "limit": 2, "offset": 2})
    assert r.status_code == 200
    assert [p["value"] for p in r.json()] == [3.0, 4.0]
    past_end = client.get("/api/history/page", params={"metric": "temperature_c", "offset": 99})
    assert past_end.json() == []


def test_history_page_defaults_to_100(client, service, clock):
    _feed(service, clock, [float(i) for i in range(120)])
    r = client.get("/api/history/page", params={"metric": "temperature_c"})
    assert len(r.json()) == 100


@pytest.mark.parametrize("extra", [
    {"limit": 0}, {"limit": 1001}, {"offset": -1}, {"limit": "x"},
    {"from": "nan"}, {"from": 200, "to": 100},
])
def test_history_page_invalid_returns_422(client, extra):
    params = {"metric": "temperature_c", **extra}
    assert client.get("/api/history/page", params=params).status_code == 422


def test_history_page_unknown_metric_returns_422(client):
    assert client.get("/api/history/page", params={"metric": "door_command"}).status_code == 422


def test_history_csv_downloads_file(client, service, clock):
    _feed(service, clock, [10.0, 11.0, 12.0])
    r = client.get("/api/history.csv", params={"metric": "temperature_c", "batch_size": 2})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    lines = r.content.decode("utf-8").split("\r\n")
    assert lines[0] == "ts,value"
    assert [l.split(",")[1] for l in lines[1:4]] == ["10.0", "11.0", "12.0"]


def test_history_csv_empty_has_header_only(client):
    r = client.get("/api/history.csv", params={"metric": "temperature_c"})
    assert r.status_code == 200 and r.content == b"ts,value\r\n"


@pytest.mark.parametrize("params", [
    {"metric": "bogus"}, {"metric": "temperature_c", "batch_size": 0},
    {"metric": "temperature_c", "batch_size": 1001},
    {"metric": "temperature_c", "from": "nan"},
    {"metric": "temperature_c", "from": 5, "to": 1},
])
def test_history_csv_invalid_is_422_before_streaming(client, params):
    r = client.get("/api/history.csv", params=params)
    assert r.status_code == 422
    assert r.headers["content-type"].startswith("application/json")

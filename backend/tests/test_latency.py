import psycopg
import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.service import percentile
from tests.conftest import authed_client, EXAMPLE


def test_percentile_nearest_rank():
    data = list(range(1, 101))
    assert percentile(data, 95) == 95
    assert percentile(data, 100) == 100
    assert percentile([5.0], 95) == 5.0
    assert percentile([], 95) is None


def _cycle(svc, clock, ack_after, confirm_after, fan_state):
    rec = svc.send_command("fan", "on" if fan_state else "off")
    clock.advance(ack_after)
    svc.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"})
    clock.advance(confirm_after)
    svc.on_telemetry(dict(EXAMPLE, fan_on=fan_state))
    return rec


def test_latency_stats_from_commands(online_service, clock):
    _cycle(online_service, clock, 0.2, 0.8, False)   # ack 0.2, confirm 1.0
    _cycle(online_service, clock, 0.4, 1.6, True)    # ack 0.4, confirm 2.0
    st = online_service.latency_stats()
    assert st["ack"]["count"] == 2
    assert st["ack"]["avg"] == pytest.approx(0.3)
    assert st["ack"]["max"] == pytest.approx(0.4)
    assert st["ack"]["p95"] == pytest.approx(0.4)
    assert st["confirm"]["count"] == 2
    assert st["confirm"]["max"] == pytest.approx(2.0)


def test_latency_stats_empty_is_none_not_zero(service):
    st = service.latency_stats()
    assert st["ack"] == {"count": 0, "avg": None, "p95": None, "max": None}
    assert st["telemetry_interval"]["count"] == 0


def test_telemetry_interval_recorded(service, clock):
    service.on_telemetry(EXAMPLE)
    clock.advance(2.0)
    service.on_telemetry(dict(EXAMPLE, uptime_ms=1))
    clock.advance(2.2)
    service.on_telemetry(dict(EXAMPLE, uptime_ms=2))
    st = service.latency_stats()["telemetry_interval"]
    assert st["count"] == 2 and st["max"] == pytest.approx(2.2)


def test_timeout_command_not_counted_as_latency(online_service, clock):
    online_service.send_command("fan", "on")
    clock.advance(5.1)
    online_service.tick()
    assert online_service.latency_stats()["ack"]["count"] == 0


@pytest.fixture
def client(online_service):
    return authed_client(online_service, "viewer")


def test_latency_endpoint(client):
    r = client.get("/api/metrics/latency")
    assert r.status_code == 200
    assert set(r.json()) == {"ack", "confirm", "telemetry_interval"}


def test_reliability_endpoint_shape(client):
    r = client.get("/api/history/reliability")
    assert r.status_code == 200
    body = r.json()
    for key in ("received_count", "stored_count", "duplicate_count", "out_of_order_count",
                "missing_packets_confirmed", "delivery_rate"):
        assert key in body


def test_reliability_rejects_inverted_range(client):
    assert client.get("/api/history/reliability?from=10&to=1").status_code == 422


def test_command_stats_endpoint(client, online_service):
    online_service.send_command("fan", "on")
    r = client.get("/api/history/commands/stats")
    assert r.status_code == 200 and r.json()["total"] == 1


def test_connections_endpoint_lists_online_event(client):
    r = client.get("/api/history/connections")
    assert r.status_code == 200
    assert any(e.get("state") == "online" for e in r.json())


def test_errors_endpoint_lists_gas_events(client, online_service):
    online_service.on_event({"type": "gas_alarm", "state": "start", "uptime_ms": 1})
    r = client.get("/api/history/errors")
    assert r.status_code == 200
    assert [e["type"] for e in r.json()] == ["gas_alarm"]


def test_limit_validation(client):
    assert client.get("/api/history/errors?limit=0").status_code == 422
    assert client.get("/api/history/connections?limit=100000").status_code == 422


def test_old_endpoints_unchanged(client):
    state = client.get("/api/state").json()
    assert set(state) == {"online", "last_seen", "offline_since", "telemetry"}
    assert client.get("/api/history?metric=temperature_c").status_code == 200
    assert client.get("/api/commands").status_code == 200
    assert client.get("/api/config").status_code == 200


class _BrokenStorage:
    """Mô phỏng PostgreSQL ngừng hoạt động."""
    def __getattr__(self, name):
        def fail(*a, **k):
            raise psycopg.OperationalError("connection refused")
        return fail


def test_history_reports_503_when_database_down(online_service):
    online_service.storage = _BrokenStorage()
    c = authed_client(online_service, "viewer")
    for url in ("/api/history?metric=temperature_c", "/api/history/stats?metric=temperature_c",
                "/api/history/reliability", "/api/commands", "/api/events"):
        r = c.get(url)
        assert r.status_code == 503, url
        assert r.json()["detail"] == "storage_unavailable"
    assert c.get("/api/state").status_code == 200   # trạng thái hiện tại vẫn trả được

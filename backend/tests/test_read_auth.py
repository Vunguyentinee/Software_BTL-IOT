"""Bắt đăng nhập khi XEM dữ liệu (viewer trở lên), WebSocket xác thực bằng tin đầu tiên, /api/auth/me."""
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import WsHub, create_app
from app.service import Service
from app.storage import InMemoryStorage
from tests.conftest import CREDENTIALS, EXAMPLE, FakePublisher, authed_client, make_settings

READ_PATHS = [
    "/api/state",
    "/api/history?metric=temperature_c",
    "/api/history/stats?metric=temperature_c",
    "/api/history/page?metric=temperature_c",
    "/api/history.csv?metric=temperature_c",
    "/api/history/reliability",
    "/api/history/commands/stats",
    "/api/history/connections",
    "/api/history/errors",
    "/api/metrics/latency",
    "/api/events",
    "/api/commands",
    "/api/commands/khong-co",
    "/api/config",
    "/api/sim",
]


@pytest.mark.parametrize("path", READ_PATHS)
def test_read_endpoints_require_login(online_service, path):
    r = authed_client(online_service, None).get(path)
    assert r.status_code == 401, path
    assert r.headers["www-authenticate"].lower().startswith("bearer")


@pytest.mark.parametrize("path", READ_PATHS)
def test_read_endpoints_reject_bad_token(online_service, path):
    r = authed_client(online_service, None).get(path, headers={"Authorization": "Bearer rac"})
    assert r.status_code == 401, path


@pytest.mark.parametrize("path", READ_PATHS)
def test_viewer_can_read(online_service, path):
    r = authed_client(online_service, "viewer").get(path)
    assert r.status_code not in (401, 403, 429), (path, r.status_code)


def test_state_content_unchanged_for_viewer(online_service):
    body = authed_client(online_service, "viewer").get("/api/state").json()
    assert body["online"] is True and body["telemetry"]["temperature_c"] == EXAMPLE["temperature_c"]


def test_health_stays_open_for_monitoring(online_service):
    assert authed_client(online_service, None).get("/api/health").status_code == 200


def test_reads_do_not_consume_control_rate_limit(online_service, publisher):
    """Web poll ACK mỗi 350 ms: đọc nhiều không được làm lệnh điều khiển bị 429."""
    c = authed_client(online_service, "operator")
    for _ in range(100):
        assert c.get("/api/state").status_code == 200
    assert c.post("/api/devices/led1/command", json={"action": "on"}).status_code == 200
    assert len(publisher.cmds) == 1


def test_reads_return_503_when_auth_not_configured(clock):
    svc = Service(make_settings(users_spec=""), InMemoryStorage(), FakePublisher(), clock=clock)
    assert TestClient(create_app(svc)).get("/api/state").status_code == 503


def test_auth_me(online_service):
    assert authed_client(online_service, None).get("/api/auth/me").status_code == 401
    for role, (user, _pw) in CREDENTIALS.items():
        assert authed_client(online_service, role).get("/api/auth/me").json() == {"username": user, "role": role}


# ---- WebSocket ------------------------------------------------------------------------
def _token(client, role):
    user, pw = CREDENTIALS[role]
    return client.post("/api/auth/login", json={"username": user, "password": pw}).json()["access_token"]


def test_ws_requires_auth_message_then_sends_snapshot(online_service):
    hub = WsHub()
    with TestClient(create_app(online_service, hub)) as c:
        tok = _token(c, "viewer")
        with c.websocket_connect("/ws") as ws:
            ws.send_json({"kind": "auth", "token": tok})
            first = ws.receive_json()
            assert first["kind"] == "snapshot" and first["data"]["online"] is True
            hub.threadsafe_broadcast({"kind": "telemetry", "data": {"x": 1}})
            assert ws.receive_json() == {"kind": "telemetry", "data": {"x": 1}}


@pytest.mark.parametrize("first_msg", [{"kind": "auth", "token": "rac"}, {"kind": "auth"}, {"kind": "hello"}, "khong-phai-json"])
def test_ws_bad_auth_closed_4401_without_data(online_service, first_msg):
    hub = WsHub()
    with TestClient(create_app(online_service, hub)) as c:
        with c.websocket_connect("/ws") as ws:
            if isinstance(first_msg, str):
                ws.send_text(first_msg)
            else:
                ws.send_json(first_msg)
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4401
        assert hub.clients == []


def test_unauthenticated_ws_gets_no_broadcast(online_service):
    """Client chưa xác thực không nằm trong danh sách nhận broadcast."""
    hub = WsHub()
    with TestClient(create_app(online_service, hub)) as c:
        with c.websocket_connect("/ws"):
            assert hub.clients == []

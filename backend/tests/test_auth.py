import base64
import json
import subprocess

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.config import Settings
from tests.conftest import CREDENTIALS, EXAMPLE, TEST_SECRET, authed_client, make_settings

CMD = "/api/devices/fan/command"


def _login(client, role):
    user, pw = CREDENTIALS[role]
    return client.post("/api/auth/login", json={"username": user, "password": pw})


def test_login_returns_jwt_with_role_and_expiry(online_service):
    r = _login(TestClient(create_app(online_service)), "operator")
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer" and body["role"] == "operator"
    assert body["expires_in"] == 3600
    claims = jwt.decode(body["access_token"], TEST_SECRET, algorithms=["HS256"],
                        options={"verify_exp": False})
    assert claims["sub"] == "op1" and claims["role"] == "operator"


def test_login_wrong_password_401(online_service):
    c = TestClient(create_app(online_service))
    r = c.post("/api/auth/login", json={"username": "op1", "password": "nope-nope"})
    assert r.status_code == 401
    r2 = c.post("/api/auth/login", json={"username": "ghost", "password": "nope-nope"})
    assert r2.status_code == 401 and r2.json() == r.json()   # không lộ user nào tồn tại


def test_login_lockout_after_repeated_failures(online_service):
    c = TestClient(create_app(online_service))
    for _ in range(5):
        assert c.post("/api/auth/login", json={"username": "op1", "password": "bad-bad-bad"}).status_code == 401
    assert c.post("/api/auth/login", json={"username": "op1", "password": "bad-bad-bad"}).status_code == 429
    # đúng mật khẩu cũng bị khóa trong lúc khóa; người dùng khác không bị ảnh hưởng
    assert _login(c, "operator").status_code == 429
    assert _login(c, "admin").status_code == 200


def test_login_lockout_expires(online_service, clock):
    c = TestClient(create_app(online_service))
    for _ in range(6):
        c.post("/api/auth/login", json={"username": "op1", "password": "bad-bad-bad"})
    clock.advance(61)
    assert _login(c, "operator").status_code == 200


def test_login_malformed_body_422(online_service):
    c = TestClient(create_app(online_service))
    assert c.post("/api/auth/login", json={"username": 1, "password": ["x"]}).status_code == 422
    assert c.post("/api/auth/login", json={"username": "a" * 5000, "password": "b"}).status_code == 422


def test_command_without_token_401_and_nothing_published(online_service, publisher, storage):
    c = authed_client(online_service, None)
    r = c.post(CMD, json={"action": "on"})
    assert r.status_code == 401
    assert r.headers["www-authenticate"].lower().startswith("bearer")
    assert publisher.cmds == []
    assert storage.list_commands() == []


@pytest.mark.parametrize("header", ["Bearer garbage", "Bearer ", "Basic abc", "abc", "bearer"])
def test_command_with_bad_authorization_header_401(online_service, publisher, header):
    c = authed_client(online_service, None)
    assert c.post(CMD, json={"action": "on"}, headers={"Authorization": header}).status_code == 401
    assert publisher.cmds == []


def test_viewer_cannot_control_403(online_service, publisher):
    c = authed_client(online_service, "viewer")
    assert c.post(CMD, json={"action": "on"}).status_code == 403
    assert c.post("/api/sim/scenario", json={"scenario": "normal"}).status_code == 403
    assert publisher.cmds == []


def test_operator_and_admin_can_send_commands(online_service, publisher):
    assert authed_client(online_service, "operator").post(CMD, json={"action": "on"}).status_code == 200
    assert authed_client(online_service, "admin").post(CMD, json={"action": "off"}).status_code == 200
    assert len(publisher.cmds) == 2


def test_put_config_requires_admin(online_service, publisher):
    body = {"fan_on": 36, "fan_off": 33}
    assert authed_client(online_service, None).put("/api/config", json=body).status_code == 401
    assert authed_client(online_service, "viewer").put("/api/config", json=body).status_code == 403
    assert authed_client(online_service, "operator").put("/api/config", json=body).status_code == 403
    assert publisher.configs == []
    assert authed_client(online_service, "admin").put("/api/config", json=body).status_code == 200
    assert len(publisher.configs) == 1


def test_read_endpoints_need_login_but_health_stays_open(online_service):
    anon = authed_client(online_service, None)
    viewer = authed_client(online_service, "viewer")
    for url in ("/api/state", "/api/commands", "/api/events", "/api/config",
                "/api/history?metric=temperature_c", "/api/metrics/latency"):
        assert anon.get(url).status_code == 401, url
        assert viewer.get(url).status_code == 200, url
    assert anon.get("/api/health").status_code == 200


def test_auth_checked_before_body_validation(online_service):
    c = authed_client(online_service, None)
    assert c.post(CMD, json={"action": 123}).status_code == 401


@pytest.mark.parametrize("body", [{"action": 123}, {"action": ["on"]}, {"action": "x" * 10_000},
                                  {}, {"action": None}])
def test_malformed_command_body_422_with_valid_token(online_service, publisher, body):
    c = authed_client(online_service, "operator")
    assert c.post(CMD, json=body).status_code == 422
    assert publisher.cmds == []


def test_malformed_json_is_422_not_500(online_service):
    c = authed_client(online_service, "operator")
    r = c.post(CMD, content=b"{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_expired_jwt_401(online_service, clock):
    c = authed_client(online_service, "operator")
    clock.advance(3601)
    assert c.post(CMD, json={"action": "on"}).status_code == 401


def test_tampered_jwt_401(online_service):
    c = authed_client(online_service, "viewer")
    token = c.headers["Authorization"].split()[1]
    claims = jwt.decode(token, TEST_SECRET, algorithms=["HS256"], options={"verify_exp": False})
    forged = jwt.encode(dict(claims, role="admin"), "another-secret-" + "y" * 40, algorithm="HS256")
    c.headers["Authorization"] = f"Bearer {forged}"
    assert c.post(CMD, json={"action": "on"}).status_code == 401
    # sửa payload nhưng giữ nguyên chữ ký cũ
    head, _payload, sig = token.split(".")
    new_payload = base64.urlsafe_b64encode(json.dumps(dict(claims, role="admin")).encode()).rstrip(b"=").decode()
    c.headers["Authorization"] = f"Bearer {head}.{new_payload}.{sig}"
    assert c.post(CMD, json={"action": "on"}).status_code == 401


def test_jwt_alg_none_rejected(online_service, clock):
    c = authed_client(online_service, None)
    now = int(clock())
    forged = jwt.encode({"sub": "admin1", "role": "admin", "iat": now, "exp": now + 999},
                        key=None, algorithm="none")
    assert c.post(CMD, json={"action": "on"}, headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_jwt_without_exp_rejected(online_service):
    c = authed_client(online_service, None)
    tok = jwt.encode({"sub": "admin1", "role": "admin"}, TEST_SECRET, algorithm="HS256")
    assert c.post(CMD, json={"action": "on"}, headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_jwt_with_unknown_role_or_user_rejected(online_service, clock):
    c = authed_client(online_service, None)
    now = int(clock())
    for claims in ({"sub": "ghost", "role": "admin"}, {"sub": "op1", "role": "root"}):
        tok = jwt.encode(dict(claims, iat=now, exp=now + 999), TEST_SECRET, algorithm="HS256")
        assert c.post(CMD, json={"action": "on"}, headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_jwt_role_downgrade_in_users_is_honoured(online_service, clock):
    """Quyền lấy theo cấu hình người dùng hiện tại, không tin tuyệt đối claim `role` trong token."""
    c = authed_client(online_service, None)
    now = int(clock())
    tok = jwt.encode({"sub": "viewer1", "role": "admin", "iat": now, "exp": now + 999},
                     TEST_SECRET, algorithm="HS256")
    r = c.post(CMD, json={"action": "on"}, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403


def test_unconfigured_auth_blocks_control_and_reads(clock, publisher, storage):
    from app.service import Service
    svc = Service(Settings(), storage, publisher, clock=clock)
    svc.on_telemetry(EXAMPLE)
    c = TestClient(create_app(svc))
    r = c.post(CMD, json={"action": "on"})
    assert r.status_code == 503 and r.json()["detail"] == "auth_not_configured"
    assert c.put("/api/config", json={"fan_on": 36, "fan_off": 33}).status_code == 503
    assert c.post("/api/auth/login", json={"username": "a", "password": "bbbbbbbb"}).status_code == 503
    assert c.get("/api/state").status_code == 503      # không bao giờ tự mở khi chưa cấu hình
    assert c.get("/api/health").status_code == 200
    assert publisher.cmds == [] and publisher.configs == []


def test_weak_jwt_secret_counts_as_unconfigured(clock, publisher, storage):
    from app.service import Service
    svc = Service(make_settings(jwt_secret="short"), storage, publisher, clock=clock)
    svc.on_telemetry(EXAMPLE)
    assert TestClient(create_app(svc)).post(CMD, json={"action": "on"}).status_code == 503


def test_rate_limit_on_control_endpoints(clock, publisher, storage):
    from app.service import Service
    svc = Service(make_settings(rate_limit_max=3, rate_limit_window_s=10.0), storage, publisher, clock=clock)
    svc.on_telemetry(EXAMPLE)
    c = authed_client(svc, "operator")
    codes = [c.post("/api/devices/led1/command", json={"action": a}).status_code
             for a in ("on", "off", "auto", "on")]
    assert codes == [200, 200, 200, 429]
    clock.advance(10.1)
    assert c.post("/api/devices/led1/command", json={"action": "off"}).status_code == 200


def test_rate_limit_response_has_retry_after(clock, publisher, storage):
    from app.service import Service
    svc = Service(make_settings(rate_limit_max=1, rate_limit_window_s=10.0), storage, publisher, clock=clock)
    svc.on_telemetry(EXAMPLE)
    c = authed_client(svc, "operator")
    c.post(CMD, json={"action": "on"})
    r = c.post(CMD, json={"action": "off"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1


def test_rate_limit_is_per_user(clock, publisher, storage):
    from app.service import Service
    svc = Service(make_settings(rate_limit_max=1, rate_limit_window_s=10.0), storage, publisher, clock=clock)
    svc.on_telemetry(EXAMPLE)
    from app.auth import AuthManager
    shared = AuthManager(svc.settings, clock=svc.clock)   # một app thật chỉ có một bộ giới hạn
    assert authed_client(svc, "operator", auth=shared).post(CMD, json={"action": "on"}).status_code == 200
    assert authed_client(svc, "operator", auth=shared).post(CMD, json={"action": "off"}).status_code == 429
    assert authed_client(svc, "admin", auth=shared).post(CMD, json={"action": "off"}).status_code == 200


def test_users_spec_validation():
    from app.auth import parse_users
    assert parse_users("") == {}
    users = parse_users("a:password1:admin, b:password2:viewer")
    assert users["a"] == ("password1", "admin") and users["b"] == ("password2", "viewer")
    bad_specs = ("a:short:admin", "a:password1:root", "a:password1", "a:p:q:r:s",
                 "a:password1:admin,a:password2:viewer")
    for bad in bad_specs:
        with pytest.raises(ValueError):
            parse_users(bad)


def test_secrets_are_not_tracked_by_git():
    root = __file__.rsplit("backend", 1)[0]
    try:
        out = subprocess.run(["git", "check-ignore", ".env", "docker/secrets/passwd"],
                             capture_output=True, text=True, cwd=root, timeout=20)
    except (OSError, subprocess.SubprocessError):
        pytest.skip("git không khả dụng")
    ignored = out.stdout.split()
    assert ".env" in ignored and "docker/secrets/passwd" in ignored

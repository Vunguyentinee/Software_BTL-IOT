import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.service import PublishFailed, SafetyOverride
from tests.conftest import EXAMPLE, authed_client


def _tel(**over):
    return dict(EXAMPLE, **over)


def test_duplicate_pending_command_returns_existing_cmd_id(online_service, publisher):
    first = online_service.send_command("fan", "on")
    second = online_service.send_command("fan", "on")
    assert second["cmd_id"] == first["cmd_id"]
    assert len(publisher.cmds) == 1
    other = online_service.send_command("fan", "off")
    assert other["cmd_id"] != first["cmd_id"]
    assert len(publisher.cmds) == 2


def test_same_command_allowed_again_after_it_finished(online_service, publisher):
    first = online_service.send_command("fan", "on")
    online_service.on_cmd_ack({"cmd_id": first["cmd_id"], "result": "ok"})
    second = online_service.send_command("fan", "on")
    assert second["cmd_id"] != first["cmd_id"]
    assert len(publisher.cmds) == 2


def test_late_ack_keeps_timeout_and_records_detail(online_service, clock):
    rec = online_service.send_command("fan", "on")
    clock.advance(5.1)
    online_service.tick()
    assert online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"}) is False
    got = online_service.get_command(rec["cmd_id"])
    assert got["status"] == "timeout"
    assert "late_ack:ok" in got["detail"]


def test_late_ack_does_not_publish_again(online_service, clock, publisher):
    rec = online_service.send_command("fan", "on")
    clock.advance(5.1)
    online_service.tick()
    online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"})
    assert len(publisher.cmds) == 1


def test_publish_error_marks_command_failed(online_service, publisher, storage):
    def boom(_payload):
        raise OSError("mqtt down")
    publisher.publish_cmd = boom
    with pytest.raises(PublishFailed):
        online_service.send_command("fan", "on")
    [cmd] = storage.list_commands()
    assert cmd["status"] == "failed" and cmd["detail"] == "mqtt_publish_failed"


def test_safety_override_blocks_fan_off_during_heat_alarm(service, publisher, storage):
    service.on_telemetry(_tel(heat_alarm=True, fan_on=True))
    with pytest.raises(SafetyOverride) as ei:
        service.send_command("fan", "off")
    assert ei.value.reason == "heat_alarm"
    assert publisher.cmds == []
    [cmd] = storage.list_commands()
    assert cmd["status"] == "failed" and cmd["detail"] == "safety_override_heat_alarm"


def test_fan_on_and_auto_allowed_during_heat_alarm(service, publisher):
    service.on_telemetry(_tel(heat_alarm=True))
    service.send_command("fan", "on")
    service.send_command("fan", "auto")
    assert len(publisher.cmds) == 2


def test_door_close_blocked_during_smoke_gas_alarm(service, publisher):
    service.on_telemetry(_tel(smoke_alarm=True, door_safety_lock=True, door_command="open"))
    with pytest.raises(SafetyOverride) as ei:
        service.send_command("door", "close")
    assert ei.value.reason == "smoke_alarm"
    assert publisher.cmds == []


def test_physical_confirmation_from_next_telemetry(online_service, clock):
    rec = online_service.send_command("fan", "off")
    clock.advance(0.5)
    online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"})
    assert online_service.get_command(rec["cmd_id"])["confirmed_ts"] is None
    clock.advance(1.0)
    online_service.on_telemetry(_tel(fan_on=False))
    got = online_service.get_command(rec["cmd_id"])
    assert got["confirmed_ts"] == clock.now


def test_no_confirmation_when_telemetry_does_not_match(online_service, clock):
    rec = online_service.send_command("fan", "off")
    online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"})
    clock.advance(1.0)
    online_service.on_telemetry(_tel(fan_on=True))
    assert online_service.get_command(rec["cmd_id"])["confirmed_ts"] is None


def test_telemetry_before_ack_is_not_confirmation(online_service, clock):
    rec = online_service.send_command("fan", "off")
    clock.advance(0.5)
    online_service.on_telemetry(_tel(fan_on=False))      # trước ACK
    online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"})
    assert online_service.get_command(rec["cmd_id"])["confirmed_ts"] is None


@pytest.fixture
def client(online_service):
    return authed_client(online_service, "operator")


def test_api_safety_override_returns_409_with_reason(service):
    service.on_telemetry(_tel(heat_alarm=True))
    c = authed_client(service, "operator")
    r = c.post("/api/devices/fan/command", json={"action": "off"})
    assert r.status_code == 409
    assert r.json() == {"detail": "safety_override", "reason": "heat_alarm"}


def test_api_publish_failure_returns_503(online_service, publisher):
    def boom(_payload):
        raise OSError("mqtt down")
    publisher.publish_cmd = boom
    r = authed_client(online_service, "operator").post("/api/devices/fan/command", json={"action": "on"})
    assert r.status_code == 503
    assert r.json()["detail"] == "mqtt_publish_failed"


def test_api_duplicate_command_flagged(client):
    a = client.post("/api/devices/fan/command", json={"action": "on"}).json()
    b = client.post("/api/devices/fan/command", json={"action": "on"}).json()
    assert b["cmd_id"] == a["cmd_id"] and b["duplicate"] is True
    assert a.get("duplicate") in (None, False)

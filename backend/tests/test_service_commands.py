import pytest

from app.service import DeviceOffline


def test_send_command_publishes_and_is_pending(online_service, publisher, storage):
    rec = online_service.send_command("fan", "on")
    assert rec["status"] == "pending"
    assert publisher.cmds[0] == {"cmd_id": rec["cmd_id"], "device": "fan", "action": "on"}
    assert storage.get_command(rec["cmd_id"])["status"] == "pending"


def test_send_command_rejected_when_offline(service, publisher, storage):
    with pytest.raises(DeviceOffline):
        service.send_command("fan", "on")
    assert publisher.cmds == []
    assert storage.list_commands() == []


@pytest.mark.parametrize("device,action", [("pump", "on"), ("door", "on")])
def test_send_command_invalid_raises_value_error(online_service, device, action):
    with pytest.raises(ValueError):
        online_service.send_command(device, action)


def test_ack_ok_sets_status_and_ack_ts(online_service, clock):
    rec = online_service.send_command("door", "open")
    clock.advance(1)
    assert online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"}) is True
    got = online_service.get_command(rec["cmd_id"])
    assert got["status"] == "ok" and got["ack_ts"] == clock.now


def test_ack_failed_keeps_detail(online_service):
    rec = online_service.send_command("fan", "on")
    online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "failed", "detail": "relay"})
    got = online_service.get_command(rec["cmd_id"])
    assert got["status"] == "failed" and got["detail"] == "relay"


def test_command_times_out_after_5s(online_service, clock, broadcasts):
    rec = online_service.send_command("led1", "off")
    clock.advance(5.1)
    online_service.on_telemetry({"temperature_c": 1})  # invalid, must not matter
    online_service.tick()
    assert online_service.get_command(rec["cmd_id"])["status"] == "timeout"
    assert any(b["kind"] == "command" and b["data"]["status"] == "timeout" for b in broadcasts)


def test_late_ack_after_timeout_is_ignored(online_service, clock):
    rec = online_service.send_command("fan", "on")
    clock.advance(5.1)
    online_service.tick()
    assert online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"}) is False
    assert online_service.get_command(rec["cmd_id"])["status"] == "timeout"


def test_duplicate_ack_and_unknown_cmd_id_ignored(online_service):
    rec = online_service.send_command("fan", "on")
    assert online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "ok"}) is True
    assert online_service.on_cmd_ack({"cmd_id": rec["cmd_id"], "result": "failed"}) is False
    assert online_service.get_command(rec["cmd_id"])["status"] == "ok"
    assert online_service.on_cmd_ack({"cmd_id": "nope", "result": "ok"}) is False
    assert online_service.on_cmd_ack(b"garbage") is False

"""Backend khớp firmware ESP32_DigitalTwin_Gas34_Safety: phiên đích, control_mode, mã detail, alarm_response, heartbeat."""
import pytest

from app.models import CmdAck, ConfigAck, Event, Telemetry
from app.service import AlarmNotFound, ControlUnavailable, SafetyOverride
from tests.conftest import EXAMPLE, authed_client

P = "home/esp32-home/"


def fw(seq=1, **over):
    """Telemetry giống firmware thật (gas/khói là MỘT cảm biến: smoke_raw / smoke_alarm)."""
    base = dict(EXAMPLE, device_id="esp32-home", boot_id="b1", connection_id=5, seq=seq,
                control_mode="remote_available", backend_state="unmonitored", tx_count=seq + 1,
                heat_alarm=False, fan_on=False, led1_on=False, door_command="closed",
                smoke_raw=300, smoke_alarm=False, door_safety_lock=False, gas_sensor_fault=False,
                active_alarms=[], pump_on=False)
    base.update(over)
    return base


@pytest.fixture
def fw_service(service):
    service.on_telemetry(fw())
    return service


# ---- model ----------------------------------------------------------------------------
def test_model_accepts_firmware_telemetry_and_keeps_session_fields():
    t = Telemetry.model_validate(fw(active_alarms=[{"alarm": "smoke_alarm", "event_id": "b1-00000001"}]))
    assert t.connection_id == 5 and t.control_mode == "remote_available" and t.tx_count == 2
    assert t.door_safety_lock is False and t.active_alarms[0]["event_id"] == "b1-00000001"


@pytest.mark.parametrize("etype", ["alarm_response", "gas_sensor_fault", "door_open_unconfirmed",
                                   "fan_rotation_unconfirmed", "local_control", "remote_control"])
def test_model_accepts_new_firmware_event_types(etype):
    Event.model_validate({"type": etype, "state": "start", "uptime_ms": 1})


@pytest.mark.parametrize("state", ["start", "retry", "escalated", "end"])
def test_model_accepts_alarm_response_states(state):
    e = Event.model_validate({"type": "alarm_response", "state": state, "event_id": "b1-00000001",
                              "alarm": "smoke_alarm", "uptime_ms": 5, "backend_ack": False})
    assert e.event_id == "b1-00000001" and e.alarm == "smoke_alarm"


def test_acks_accept_session_fields():
    assert CmdAck.model_validate({"cmd_id": "c", "result": "failed", "detail": "wrong_target_boot_id",
                                  "boot_id": "b1", "connection_id": 5}).connection_id == 5
    assert ConfigAck.model_validate({"config_id": "k", "result": "rejected", "boot_id": "b1",
                                     "connection_id": 5}).boot_id == "b1"


# ---- lệnh mang phiên đích ------------------------------------------------------------------
def test_command_carries_target_session_and_expiry(fw_service, publisher, clock):
    fw_service.send_command("fan", "on")
    cmd = publisher.cmds[0]
    assert cmd["target_boot_id"] == "b1" and cmd["target_connection_id"] == 5
    # hạn dùng: lớp phòng thủ bổ sung (firmware hiện chưa có đồng hồ nên bỏ qua trường này)
    assert cmd["issued_ts"] == clock.now and cmd["expires_ts"] == clock.now + 5.0


def test_command_without_session_info_stays_legacy(online_service, publisher):
    online_service.send_command("fan", "on")
    assert set(publisher.cmds[0]) == {"cmd_id", "device", "action", "issued_ts", "expires_ts"}


def test_command_uses_latest_session_after_reconnect(fw_service, publisher):
    fw_service.on_telemetry(fw(seq=2, connection_id=6))
    fw_service.send_command("fan", "on")
    assert publisher.cmds[0]["target_connection_id"] == 6


def test_new_boot_changes_target_boot_id(fw_service, publisher):
    fw_service.on_telemetry(fw(seq=0, boot_id="b2", connection_id=1))
    fw_service.send_command("led1", "on")
    assert publisher.cmds[0]["target_boot_id"] == "b2"


@pytest.mark.parametrize("mode", ["offline_grace", "local_auto"])
def test_command_refused_when_device_not_remote_controllable(service, publisher, storage, mode):
    service.on_telemetry(fw(control_mode=mode))
    with pytest.raises(ControlUnavailable) as ei:
        service.send_command("fan", "on")
    assert ei.value.mode == mode
    assert publisher.cmds == [] and storage.list_commands() == []


def test_api_control_unavailable_is_409_with_mode(service):
    service.on_telemetry(fw(control_mode="local_auto"))
    r = authed_client(service, "operator").post("/api/devices/fan/command", json={"action": "on"})
    assert r.status_code == 409
    assert r.json() == {"detail": "control_unavailable", "mode": "local_auto"}


# ---- ràng buộc an toàn theo mã của firmware -------------------------------------------------
def _blocked(service, storage, device, action):
    with pytest.raises(SafetyOverride) as ei:
        service.send_command(device, action)
    [cmd] = [c for c in storage.list_commands() if c["status"] == "failed"]
    return ei.value.reason, cmd["detail"]


def test_fan_off_blocked_by_heat_alarm(service, storage, publisher):
    service.on_telemetry(fw(heat_alarm=True, fan_on=True))
    assert _blocked(service, storage, "fan", "off") == ("heat_alarm", "safety_override_heat_alarm")
    assert publisher.cmds == []


def test_fan_manual_commands_blocked_while_door_safety_lock(service, storage):
    service.on_telemetry(fw(door_safety_lock=True, smoke_alarm=True))
    assert _blocked(service, storage, "fan", "on") == ("gas_fan_hold", "safety_override_gas_fan_hold")


def test_fan_auto_allowed_while_door_safety_lock(service, publisher):
    service.on_telemetry(fw(door_safety_lock=True, smoke_alarm=True))
    service.send_command("fan", "auto")
    assert len(publisher.cmds) == 1


def test_door_close_blocked_during_smoke_alarm(service, storage):
    service.on_telemetry(fw(door_safety_lock=True, smoke_alarm=True, door_command="open"))
    assert _blocked(service, storage, "door", "close") == ("smoke_alarm", "safety_override_smoke_alarm")


def test_door_close_blocked_during_hold_after_alarm_cleared(service, storage):
    service.on_telemetry(fw(door_safety_lock=True, smoke_alarm=False, door_command="open"))
    assert _blocked(service, storage, "door", "close") == ("door_hold_active", "safety_door_hold_active")


def test_door_open_allowed_during_lock(service, publisher):
    service.on_telemetry(fw(door_safety_lock=True, smoke_alarm=True, door_command="open"))
    service.send_command("door", "open")
    assert len(publisher.cmds) == 1


def test_api_safety_409_uses_firmware_reason(service):
    service.on_telemetry(fw(heat_alarm=True))
    r = authed_client(service, "operator").post("/api/devices/fan/command", json={"action": "off"})
    assert r.status_code == 409 and r.json() == {"detail": "safety_override", "reason": "heat_alarm"}


# ---- nhật ký ai gửi lệnh ---------------------------------------------------------------------
def test_command_records_who_sent_it(fw_service, storage):
    rec = fw_service.send_command("fan", "on", user="ui")
    assert rec["source"] == "web:ui" and storage.get_command(rec["cmd_id"])["source"] == "web:ui"


def test_command_without_user_keeps_plain_source(fw_service):
    assert fw_service.send_command("fan", "on")["source"] == "web"


def test_api_records_authenticated_username(fw_service, storage):
    c = authed_client(fw_service, "operator")
    cid = c.post("/api/devices/led1/command", json={"action": "on"}).json()["cmd_id"]
    assert storage.get_command(cid)["source"] == "web:op1"


def test_safety_rejected_command_also_records_user(service, storage):
    service.on_telemetry(fw(heat_alarm=True))
    with pytest.raises(SafetyOverride):
        service.send_command("fan", "off", user="ui")
    assert storage.list_commands()[0]["source"] == "web:ui"


# ---- cấu hình ngưỡng mang phiên đích, không retained --------------------------------------------
def test_config_published_with_target_session(fw_service, publisher):
    from app.models import Thresholds
    fw_service.set_config(Thresholds(fan_on=36, fan_off=33))
    cfg = publisher.configs[-1]
    assert cfg["target_boot_id"] == "b1" and cfg["target_connection_id"] == 5
    assert cfg["thresholds"]["fan_on"] == 36


def test_config_waits_for_a_known_session_then_is_sent_once(service, publisher):
    from app.models import Thresholds
    service.set_config(Thresholds(fan_on=36, fan_off=33))
    assert publisher.configs == []
    assert service.get_config()["status"] == "pending"
    service.on_telemetry(fw(seq=1))
    service.on_telemetry(fw(seq=2))
    assert len(publisher.configs) == 1


def test_config_resent_after_device_reboot_or_reconnect(fw_service, publisher):
    from app.models import Thresholds
    fw_service.set_config(Thresholds(fan_on=36, fan_off=33))
    n = len(publisher.configs)
    fw_service.on_telemetry(fw(seq=2, connection_id=6))
    assert len(publisher.configs) == n + 1
    assert publisher.configs[-1]["target_connection_id"] == 6
    fw_service.on_telemetry(fw(seq=0, boot_id="b2", connection_id=1))
    assert publisher.configs[-1]["target_boot_id"] == "b2"


def test_config_not_sent_while_device_not_remote_controllable(service, publisher):
    from app.models import Thresholds
    service.on_telemetry(fw(control_mode="offline_grace"))
    service.set_config(Thresholds(fan_on=36, fan_off=33))
    assert publisher.configs == []
    service.on_telemetry(fw(seq=2, control_mode="remote_available"))
    assert len(publisher.configs) == 1


def test_config_ack_with_session_fields_applies(fw_service, publisher):
    from app.models import Thresholds
    cfg = fw_service.set_config(Thresholds(fan_on=36, fan_off=33))
    fw_service.on_config_ack({"config_id": cfg["config_id"], "result": "ok", "boot_id": "b1", "connection_id": 5})
    assert fw_service.get_config()["status"] == "applied"


# ---- heartbeat backend ---------------------------------------------------------------------
def test_heartbeat_every_2s_with_target_session(fw_service, publisher, clock):
    fw_service.tick()
    assert publisher.heartbeats == [{"target_boot_id": "b1", "target_connection_id": 5}]
    clock.advance(1.0)
    fw_service.on_telemetry(fw(seq=2))
    fw_service.tick()
    assert len(publisher.heartbeats) == 1
    clock.advance(1.2)
    fw_service.on_telemetry(fw(seq=3))
    fw_service.tick()
    assert len(publisher.heartbeats) == 2


def test_no_heartbeat_without_session_or_when_offline(online_service, publisher, clock):
    online_service.tick()
    assert publisher.heartbeats == []


def test_no_heartbeat_when_device_offline(fw_service, publisher, clock):
    clock.advance(30)
    fw_service.tick()
    assert publisher.heartbeats == []


def test_heartbeat_publish_error_does_not_break_tick(fw_service, publisher):
    def boom(_p):
        raise OSError("mqtt down")
    publisher.publish_heartbeat = boom
    fw_service.tick()


# ---- cảnh báo: backend tự ACK, operator xác nhận ----------------------------------------------
def alarm_event(state, event_id="b1-00000001", **over):
    return dict({"type": "alarm_response", "state": state, "event_id": event_id, "alarm": "smoke_alarm",
                 "started_ms": 100, "uptime_ms": 150, "backend_ack": False, "backend_overdue": False,
                 "operator_ack": False, "operator_overdue": False}, **over)


@pytest.mark.parametrize("state", ["start", "retry", "escalated"])
def test_backend_acknowledges_alarm_notices(fw_service, publisher, state):
    assert fw_service.on_event(alarm_event(state)) is True
    assert publisher.event_acks == [{"event_id": "b1-00000001", "source": "backend"}]


def test_backend_does_not_ack_alarm_end_or_other_events(fw_service, publisher):
    fw_service.on_event(alarm_event("end"))
    fw_service.on_event({"type": "fan", "state": "start", "uptime_ms": 1})
    assert publisher.event_acks == []


def test_alarm_response_without_event_id_is_not_acked(fw_service, publisher):
    ev = alarm_event("start")
    del ev["event_id"]
    assert fw_service.on_event(ev) is True
    assert publisher.event_acks == []


def test_alarm_ack_publish_error_does_not_lose_the_event(fw_service, publisher, storage):
    def boom(_p):
        raise OSError("mqtt down")
    publisher.publish_event_ack = boom
    assert fw_service.on_event(alarm_event("start")) is True
    assert [e for e in storage.list_events() if e['type'] == 'alarm_response'] != []


def test_new_firmware_events_are_stored(fw_service, storage):
    assert fw_service.on_event({"type": "gas_sensor_fault", "state": "start", "uptime_ms": 9,
                                "value": 4095, "reason": "adc_rail"}) is True
    assert storage.list_events()[0]["type"] == "gas_sensor_fault"


def test_operator_acknowledges_an_active_alarm(service, publisher):
    service.on_telemetry(fw(active_alarms=[{"alarm": "smoke_alarm", "event_id": "b1-00000001"}]))
    out = service.ack_alarm("b1-00000001", user="ui")
    assert out == {"event_id": "b1-00000001", "source": "operator", "by": "ui"}
    assert publisher.event_acks == [{"event_id": "b1-00000001", "source": "operator"}]


def test_operator_cannot_acknowledge_unknown_alarm(fw_service, publisher):
    with pytest.raises(AlarmNotFound):
        fw_service.ack_alarm("b1-deadbeef", user="ui")
    assert publisher.event_acks == []


def test_alarm_ack_api_requires_operator(service, publisher):
    service.on_telemetry(fw(active_alarms=[{"alarm": "smoke_alarm", "event_id": "b1-00000001"}]))
    url = "/api/alarms/b1-00000001/ack"
    assert authed_client(service, None).post(url).status_code == 401
    assert authed_client(service, "viewer").post(url).status_code == 403
    assert publisher.event_acks == []
    r = authed_client(service, "operator").post(url)
    assert r.status_code == 200 and r.json()["by"] == "op1"
    assert authed_client(service, "operator").post("/api/alarms/nope/ack").status_code == 404


# ---- telemetry của thiết bị khác không được chiếm phiên đích ------------------------------------
def test_foreign_device_telemetry_is_stored_but_does_not_change_state_or_targets(fw_service, publisher, storage):
    fw_service.on_telemetry(fw(seq=7, device_id="loadtest", boot_id="evil-boot", connection_id=99, fan_on=True))
    state = fw_service.get_state()["telemetry"]
    assert state["boot_id"] == "b1" and state["connection_id"] == 5 and state["fan_on"] is False
    assert storage.reliability_stats(device_id="loadtest")["stored_count"] == 1
    fw_service.send_command("led1", "on")
    assert publisher.cmds[0]["target_boot_id"] == "b1" and publisher.cmds[0]["target_connection_id"] == 5


def test_foreign_device_telemetry_does_not_bring_device_online_or_trigger_heartbeat(service, publisher):
    service.on_telemetry(fw(device_id="someone-else"))
    assert service.get_state()["online"] is False
    service.tick()
    assert publisher.heartbeats == []


def test_telemetry_without_device_id_is_still_accepted(online_service):
    assert online_service.get_state()["online"] is True

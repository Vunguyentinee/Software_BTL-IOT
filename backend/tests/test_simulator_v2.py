"""Simulator khớp firmware ESP32_DigitalTwin_Gas34_Safety: khóa cửa theo khói/gas (một cảm biến), phiên đích, mã detail."""
import json

import pytest

from app.models import Event, Telemetry
from simulator.fake_esp32 import DOOR_HOLD_PIR_S, DOOR_HOLD_SMOKE_S, SCENARIOS, FakeEsp32

P = "home/esp32-home/"


class Rec:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload=None, qos=0, retain=False):
        self.published.append((topic, json.loads(payload) if payload else None, retain))

    def events(self):
        return [b for t, b, _ in self.published if t == P + "event"]

    def acks(self, suffix="cmd/ack"):
        return [b for t, b, _ in self.published if t == P + suffix]


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, s):
        self.now += s


@pytest.fixture
def rec():
    return Rec()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def sim(rec, clock):
    return FakeEsp32(rec, clock=clock)


def door(sim):
    return sim.build_telemetry()["door_command"]


def cmd(sim, device, action, cmd_id="c1", **target_over):
    body = {"cmd_id": cmd_id, "device": device, "action": action,
            "target_boot_id": sim.boot_id, "target_connection_id": sim.connection_id}
    body.update(target_over)
    sim.handle_message(P + "cmd", json.dumps(body).encode())


def last_ack(rec, cmd_id):
    return [a for a in rec.acks() if a["cmd_id"] == cmd_id][-1]


def test_hold_constants_match_firmware_rules():
    assert DOOR_HOLD_PIR_S == 10.0 and DOOR_HOLD_SMOKE_S == 60.0


def test_gas_and_smoke_are_one_sensor_no_separate_gas_fields(sim):
    assert "gas_leak" not in SCENARIOS
    t = sim.build_telemetry()
    assert not any(k.startswith("gas_raw") or k in ("gas_alarm", "gas_sensor_ok", "safety_mode") for k in t)


# ---- cửa theo PIR ------------------------------------------------------------------
def test_door_stays_open_10s_after_last_pir_detection(sim, clock):
    sim.set_scenario("motion_door")
    assert door(sim) == "open"
    sim.motion = False
    clock.advance(9.0)
    assert door(sim) == "open"
    clock.advance(1.5)
    assert door(sim) == "closed"


def test_new_motion_extends_the_pir_hold(sim, clock):
    sim.set_scenario("motion_door")
    door(sim)
    sim.motion = False
    clock.advance(8.0)
    sim.motion = True
    assert door(sim) == "open"
    sim.motion = False
    clock.advance(9.0)
    assert door(sim) == "open"
    clock.advance(1.5)
    assert door(sim) == "closed"


def test_door_closed_without_any_trigger(sim):
    assert door(sim) == "closed"


# ---- khóa cửa theo khói/gas ----------------------------------------------------------
def test_smoke_alarm_locks_door_open_and_reports_lock(sim, rec):
    sim.set_scenario("smoke_danger")
    t = sim.build_telemetry()
    assert t["smoke_alarm"] is True and t["door_command"] == "open" and t["door_safety_lock"] is True
    assert ("smoke_alarm", "start") in {(e["type"], e["state"]) for e in rec.events()}


def test_door_stays_open_throughout_the_alarm(sim, clock):
    sim.set_scenario("smoke_danger")
    for _ in range(5):
        clock.advance(120.0)
        assert door(sim) == "open"


def test_door_holds_60s_of_continuous_low_samples_after_alarm_clears(sim, clock):
    sim.set_scenario("smoke_danger")
    door(sim)
    sim.smoke_raw = 400
    t = sim.build_telemetry()
    assert t["smoke_alarm"] is False and t["door_command"] == "open" and t["door_safety_lock"] is True
    clock.advance(59.0)
    assert door(sim) == "open"
    clock.advance(1.5)
    t = sim.build_telemetry()
    assert t["door_command"] == "closed" and t["door_safety_lock"] is False


def test_mid_range_sample_restarts_the_low_sample_count(sim, clock):
    sim.set_scenario("smoke_danger")
    door(sim)
    sim.smoke_raw = 400
    door(sim)                              # bắt đầu đếm 60 s
    clock.advance(50.0)
    sim.smoke_raw = 1800                   # 1501..1999: không cảnh báo, nhưng hủy phần đã đếm
    assert sim.build_telemetry()["smoke_alarm"] is False
    sim.smoke_raw = 400
    door(sim)                              # đếm lại từ đây
    clock.advance(59.0)
    assert door(sim) == "open"
    clock.advance(1.5)
    assert door(sim) == "closed"


def test_realarm_during_hold_restarts_count_from_next_clear(sim, clock):
    sim.set_scenario("smoke_danger")
    door(sim)
    sim.smoke_raw = 400
    door(sim)
    clock.advance(30.0)
    sim.smoke_raw = 3000
    assert door(sim) == "open"
    clock.advance(100.0)
    assert door(sim) == "open"
    sim.smoke_raw = 400
    door(sim)
    clock.advance(59.0)
    assert door(sim) == "open"
    clock.advance(1.5)
    assert door(sim) == "closed"


def test_release_returns_door_to_auto_and_pir_hold_applies(sim, clock):
    cmd(sim, "door", "open")                       # thủ công
    sim.set_scenario("smoke_danger")
    door(sim)
    sim.smoke_raw = 400
    door(sim)
    clock.advance(61.0)
    sim.build_telemetry()
    assert sim.modes["door"] == "auto"


def test_smoke_events_are_edge_triggered_and_valid(sim, rec):
    sim.set_scenario("smoke_danger")
    for _ in range(5):
        sim.build_telemetry()
    starts = [e for e in rec.events() if e["type"] == "smoke_alarm" and e["state"] == "start"]
    assert len(starts) == 1
    for e in rec.events():
        Event.model_validate(e)


# ---- quạt ------------------------------------------------------------------------------
def test_heat_alarm_forces_fan_on_even_if_manual_off(sim, rec):
    cmd(sim, "fan", "off")
    assert sim.build_telemetry()["fan_on"] is False
    sim.set_scenario("heat_alarm")
    t = sim.build_telemetry()
    assert t["heat_alarm"] is True and t["fan_on"] is True


def test_manual_fan_off_rejected_during_heat_alarm(sim, rec):
    sim.set_scenario("heat_alarm")
    sim.build_telemetry()
    cmd(sim, "fan", "off", "c-off")
    ack = last_ack(rec, "c-off")
    assert ack["result"] == "failed" and ack["detail"] == "safety_override_heat_alarm"
    assert sim.build_telemetry()["fan_on"] is True


def test_fan_on_and_auto_accepted_during_heat_alarm(sim, rec):
    sim.set_scenario("heat_alarm")
    sim.build_telemetry()
    cmd(sim, "fan", "on", "c-on")
    cmd(sim, "fan", "auto", "c-auto")
    assert {a["cmd_id"]: a["result"] for a in rec.acks()} == {"c-on": "ok", "c-auto": "ok"}


def test_manual_fan_commands_rejected_while_door_locked(sim, rec):
    sim.set_scenario("smoke_danger")
    sim.build_telemetry()
    for action in ("on", "off"):
        cmd(sim, "fan", action, f"c-{action}")
        ack = last_ack(rec, f"c-{action}")
        assert ack["result"] == "failed" and ack["detail"] == "safety_override_gas_fan_hold"
    cmd(sim, "fan", "auto", "c-auto")
    assert last_ack(rec, "c-auto")["result"] == "ok"


def test_fan_output_frozen_while_door_locked(sim):
    sim.build_telemetry()
    assert sim.fan_on is False
    sim.set_scenario("smoke_danger")             # 32 °C: chưa đủ để bật quạt
    sim.temperature = 38.0                        # nóng lên trong lúc khóa: đầu ra quạt giữ nguyên
    assert sim.build_telemetry()["fan_on"] is False


# ---- cửa: lệnh xung đột ------------------------------------------------------------------
def test_door_close_rejected_during_smoke_alarm(sim, rec):
    sim.set_scenario("smoke_danger")
    sim.build_telemetry()
    cmd(sim, "door", "close", "c-close")
    ack = last_ack(rec, "c-close")
    assert ack["result"] == "failed" and ack["detail"] == "safety_override_smoke_alarm"
    assert door(sim) == "open"


def test_door_close_rejected_during_hold_after_alarm_cleared(sim, rec):
    sim.set_scenario("smoke_danger")
    door(sim)
    sim.smoke_raw = 400
    door(sim)
    cmd(sim, "door", "close", "c-close")
    assert last_ack(rec, "c-close")["detail"] == "safety_door_hold_active"


def test_door_open_still_accepted_during_lock(sim, rec):
    sim.set_scenario("smoke_danger")
    sim.build_telemetry()
    cmd(sim, "door", "open", "c-open")
    assert last_ack(rec, "c-open")["result"] == "ok"


def test_smoke_lock_forces_door_open_even_in_manual_mode(sim):
    cmd(sim, "door", "close")
    assert door(sim) == "closed"
    sim.set_scenario("smoke_danger")
    assert door(sim) == "open"


def test_manual_door_not_changed_by_pir_hold(sim):
    cmd(sim, "door", "close")
    sim.set_scenario("motion_door")
    assert door(sim) == "closed"


# ---- phiên đích -----------------------------------------------------------------------------
def test_command_without_target_session_rejected(sim, rec):
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "x", "device": "fan", "action": "on"}).encode())
    ack = last_ack(rec, "x")
    assert ack["result"] == "failed" and ack["detail"] == "missing_target_session"
    assert sim.build_telemetry()["fan_on"] is False


def test_command_for_wrong_boot_rejected(sim, rec):
    cmd(sim, "fan", "on", "x", target_boot_id="older-boot")
    assert last_ack(rec, "x")["detail"] == "wrong_target_boot_id"


def test_command_for_old_connection_rejected_after_reconnect(sim, rec):
    stale = sim.connection_id
    sim.connection_id += 1                   # nối lại MQTT: phiên mới
    cmd(sim, "fan", "on", "x", target_connection_id=stale)
    ack = last_ack(rec, "x")
    assert ack["detail"] == "wrong_target_connection_id" and ack["connection_id"] == sim.connection_id
    assert sim.build_telemetry()["fan_on"] is False


def test_ack_carries_boot_and_connection_ids(sim, rec):
    cmd(sim, "led1", "on", "ok1")
    ack = last_ack(rec, "ok1")
    assert ack["result"] == "ok" and ack["boot_id"] == sim.boot_id and ack["connection_id"] == sim.connection_id


def test_config_requires_target_session_and_reports_it(sim, rec):
    thresholds = {"fan_on": 36, "fan_off": 33, "heat_alarm_on": 40, "heat_alarm_off": 37,
                  "smoke_high": 2000, "smoke_low": 1500}
    sim.handle_message(P + "config/set", json.dumps({"config_id": "k1", "thresholds": thresholds}).encode())
    bad = rec.acks("config/ack")[-1]
    assert bad["result"] == "rejected" and bad["detail"] == "missing_target_session"
    assert sim.thresholds.fan_on == 35
    sim.handle_message(P + "config/set", json.dumps({
        "config_id": "k2", "thresholds": thresholds,
        "target_boot_id": sim.boot_id, "target_connection_id": sim.connection_id}).encode())
    good = rec.acks("config/ack")[-1]
    assert good["result"] == "ok" and good["boot_id"] == sim.boot_id and sim.thresholds.fan_on == 36


# ---- định danh, thứ tự và cảnh báo hiện hành ---------------------------------------------------
def test_telemetry_has_identity_session_and_increasing_seq(sim):
    first, second, third = (sim.build_telemetry() for _ in range(3))
    assert first["device_id"] == "esp32-home" and first["boot_id"]
    assert first["connection_id"] == 1 and first["control_mode"] == "remote_available"
    assert [first["seq"], second["seq"], third["seq"]] == [1, 2, 3]
    assert third["tx_count"] == 3


def test_new_boot_gets_new_boot_id_and_restarts_seq(rec, clock):
    a, b = FakeEsp32(rec, clock=clock), FakeEsp32(rec, clock=clock)
    ta, tb = a.build_telemetry(), b.build_telemetry()
    assert ta["boot_id"] != tb["boot_id"] and ta["seq"] == tb["seq"] == 1


def test_telemetry_validates_against_backend_model(sim):
    sim.set_scenario("smoke_danger")
    t = Telemetry.model_validate(sim.build_telemetry())
    assert t.smoke_alarm is True and t.door_safety_lock is True and t.connection_id == 1


def test_active_alarms_list_event_ids_for_operator_ack(sim):
    sim.set_scenario("smoke_danger")
    t = sim.build_telemetry()
    [alarm] = [a for a in t["active_alarms"] if a["alarm"] == "smoke_alarm"]
    assert alarm["event_id"].startswith(sim.boot_id + "-")
    sim.smoke_raw = 400
    assert sim.build_telemetry()["active_alarms"] == []


def test_new_alarm_gets_new_event_id(sim):
    sim.set_scenario("smoke_danger")
    first = sim.build_telemetry()["active_alarms"][0]["event_id"]
    sim.smoke_raw = 400
    sim.build_telemetry()
    sim.smoke_raw = 3000
    second = sim.build_telemetry()["active_alarms"][0]["event_id"]
    assert first != second


# ---- hạn dùng của lệnh: firmware hiện KHÔNG có đồng hồ nên mặc định không kiểm tra -------------------
@pytest.fixture
def strict_sim(rec, clock):
    return FakeEsp32(rec, clock=clock, check_expiry=True, wall_clock=clock)


def test_default_simulator_mimics_firmware_and_ignores_expiry(sim, rec, clock):
    """Giống firmware hiện tại: lệnh quá hạn nhưng đúng phiên vẫn được thực thi (lỗ hổng đã biết)."""
    cmd(sim, "fan", "on", "late", expires_ts=clock.now - 60.0)
    assert last_ack(rec, "late")["result"] == "ok"


def test_strict_simulator_rejects_expired_command(strict_sim, rec, clock):
    cmd(strict_sim, "fan", "on", "late", issued_ts=clock.now - 9, expires_ts=clock.now - 0.1)
    ack = last_ack(rec, "late")
    assert ack["result"] == "failed" and ack["detail"] == "command_expired_on_device"
    assert strict_sim.build_telemetry()["fan_on"] is False


def test_strict_simulator_accepts_fresh_and_legacy_commands(strict_sim, rec, clock):
    cmd(strict_sim, "fan", "on", "fresh", expires_ts=clock.now + 4.0)
    cmd(strict_sim, "led1", "on", "legacy")
    cmd(strict_sim, "door", "open", "bad", expires_ts="soon")
    assert [last_ack(rec, c)["result"] for c in ("fresh", "legacy", "bad")] == ["ok", "ok", "ok"]

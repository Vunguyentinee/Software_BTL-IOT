"""Simulator khớp quy tắc firmware: cửa (PIR 10 s, gas 60 s), quạt khi cảnh báo nhiệt, gas, seq/boot_id."""
import json

import pytest

from app.models import Event, Telemetry
from simulator.fake_esp32 import DOOR_HOLD_GAS_S, DOOR_HOLD_PIR_S, SCENARIOS, FakeEsp32

P = "home/esp32-home/"


class Rec:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload=None, qos=0, retain=False):
        self.published.append((topic, json.loads(payload) if payload else None, retain))

    def events(self):
        return [b for t, b, _ in self.published if t == P + "event"]

    def acks(self):
        return [b for t, b, _ in self.published if t == P + "cmd/ack"]


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
    return FakeEsp32(rec, clock=clock, wall_clock=clock)


def door(sim):
    return sim.build_telemetry()["door_command"]


def cmd(sim, device, action, cmd_id="c1"):
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": cmd_id, "device": device, "action": action}).encode())


def test_hold_constants_match_decided_rules():
    assert DOOR_HOLD_PIR_S == 10.0 and DOOR_HOLD_GAS_S == 60.0


# ---- cửa theo PIR ------------------------------------------------------------
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
    assert door(sim) == "open"           # phát hiện lại ở giây 8 -> đếm lại từ đây
    sim.motion = False
    clock.advance(9.0)                   # tổng 17 s từ lần đầu, mới 9 s từ lần cuối
    assert door(sim) == "open"
    clock.advance(1.5)
    assert door(sim) == "closed"


def test_door_closed_without_any_trigger(sim):
    assert door(sim) == "closed"


# ---- cửa theo gas -------------------------------------------------------------
def test_gas_leak_scenario_raises_gas_alarm_and_opens_door(sim, rec):
    assert "gas_leak" in SCENARIOS
    sim.set_scenario("gas_leak")
    t = sim.build_telemetry()
    assert t["gas_alarm"] is True and t["gas_raw"] >= 2000 and t["gas_sensor_ok"] is True
    assert t["door_command"] == "open"
    assert t["safety_mode"] == "gas_alert" and t["safety_reason"]
    assert ("gas_alarm", "start") in {(e["type"], e["state"]) for e in rec.events()}


def test_door_stays_open_throughout_the_gas_alarm(sim, clock):
    sim.set_scenario("gas_leak")
    for _ in range(5):
        clock.advance(120.0)
        assert door(sim) == "open"


def test_door_holds_60s_after_gas_alarm_clears(sim, clock, rec):
    sim.set_scenario("gas_leak")
    door(sim)
    sim.gas_raw = 400
    t = sim.build_telemetry()
    assert t["gas_alarm"] is False and t["door_command"] == "open"
    assert t["safety_mode"] == "normal" and t["safety_reason"] is None
    clock.advance(59.0)
    assert door(sim) == "open"
    clock.advance(1.5)
    assert door(sim) == "closed"
    assert ("gas_alarm", "end") in {(e["type"], e["state"]) for e in rec.events()}


def test_gas_realarm_cancels_and_restarts_the_60s_countdown(sim, clock):
    sim.set_scenario("gas_leak")
    door(sim)
    sim.gas_raw = 400
    door(sim)                              # hết cảnh báo lần 1: bắt đầu đếm 60 s
    clock.advance(30.0)
    sim.gas_raw = 3000                     # cảnh báo bật lại
    assert door(sim) == "open"
    clock.advance(100.0)                   # lâu hơn 60 s tính từ lần hết đầu tiên
    assert door(sim) == "open"             # vẫn mở vì cảnh báo còn bật
    sim.gas_raw = 400
    door(sim)                              # hết lần 2: đếm lại 60 s
    clock.advance(59.0)
    assert door(sim) == "open"
    clock.advance(1.5)
    assert door(sim) == "closed"


def test_gas_events_are_edge_triggered(sim, rec):
    sim.set_scenario("gas_leak")
    for _ in range(5):
        sim.build_telemetry()
    starts = [e for e in rec.events() if e["type"] == "gas_alarm" and e["state"] == "start"]
    assert len(starts) == 1
    for e in rec.events():
        Event.model_validate(e)


def test_gas_hysteresis(sim):
    sim.set_scenario("gas_leak")
    sim.build_telemetry()
    sim.gas_raw = 1800                     # giữa ngưỡng tắt (1500) và ngưỡng bật (2000)
    assert sim.build_telemetry()["gas_alarm"] is True
    sim.gas_raw = 1400
    assert sim.build_telemetry()["gas_alarm"] is False


def test_fire_alert_takes_priority_over_gas_alert(sim):
    sim.set_scenario("gas_leak")
    sim.smoke_raw = 3000
    t = sim.build_telemetry()
    assert t["safety_mode"] == "fire_alert"


# ---- quạt khi cảnh báo nhiệt -----------------------------------------------------
def test_heat_alarm_forces_fan_on_even_if_manual_off(sim):
    cmd(sim, "fan", "off")
    assert sim.build_telemetry()["fan_on"] is False
    sim.set_scenario("heat_alarm")
    t = sim.build_telemetry()
    assert t["heat_alarm"] is True and t["fan_on"] is True


def test_manual_fan_off_rejected_during_heat_alarm(sim, rec):
    sim.set_scenario("heat_alarm")
    sim.build_telemetry()
    cmd(sim, "fan", "off", "c-off")
    ack = [a for a in rec.acks() if a["cmd_id"] == "c-off"][0]
    assert ack["result"] == "failed" and ack["detail"] == "safety_override:heat_alarm"
    assert sim.build_telemetry()["fan_on"] is True


def test_fan_on_and_auto_still_accepted_during_heat_alarm(sim, rec):
    sim.set_scenario("heat_alarm")
    sim.build_telemetry()
    cmd(sim, "fan", "on", "c-on")
    cmd(sim, "fan", "auto", "c-auto")
    results = {a["cmd_id"]: a["result"] for a in rec.acks()}
    assert results == {"c-on": "ok", "c-auto": "ok"}


def test_door_close_rejected_during_gas_alarm(sim, rec):
    sim.set_scenario("gas_leak")
    sim.build_telemetry()
    cmd(sim, "door", "close", "c-close")
    ack = [a for a in rec.acks() if a["cmd_id"] == "c-close"][0]
    assert ack["result"] == "failed" and ack["detail"] == "safety_override:gas_alarm"
    assert sim.build_telemetry()["door_command"] == "open"


def test_gas_alarm_forces_door_open_even_in_manual_mode(sim):
    cmd(sim, "door", "close")
    assert door(sim) == "closed"
    sim.set_scenario("gas_leak")
    assert door(sim) == "open"


def test_manual_door_not_changed_by_pir_hold(sim, clock):
    cmd(sim, "door", "close")
    sim.set_scenario("motion_door")
    assert door(sim) == "closed"           # chế độ thủ công giữ nguyên đến khi `auto`


# ---- định danh và thứ tự bản tin ------------------------------------------------------
def test_telemetry_has_identity_and_increasing_seq(sim):
    first, second, third = (sim.build_telemetry() for _ in range(3))
    assert first["device_id"] == "esp32-home" and first["boot_id"]
    assert [first["seq"], second["seq"], third["seq"]] == [1, 2, 3]
    assert len({first["boot_id"], second["boot_id"], third["boot_id"]}) == 1


def test_new_boot_gets_new_boot_id_and_restarts_seq(rec, clock):
    a = FakeEsp32(rec, clock=clock)
    b = FakeEsp32(rec, clock=clock)
    ta, tb = a.build_telemetry(), b.build_telemetry()
    assert ta["boot_id"] != tb["boot_id"] and ta["seq"] == tb["seq"] == 1


def test_telemetry_validates_against_backend_model(sim):
    sim.set_scenario("gas_leak")
    t = Telemetry.model_validate(sim.build_telemetry())
    assert t.gas_alarm is True and t.seq == 1 and t.safety_mode == "gas_alert"


def test_normal_scenario_has_no_gas_alarm(sim):
    t = sim.build_telemetry()
    assert t["gas_alarm"] is False and t["safety_mode"] == "normal" and t["gas_sensor_ok"] is True


# ---- lệnh quá hạn (chống thực thi muộn sau khi mạng nối lại) ----------------------------
def timed_cmd(sim, cmd_id, expires_ts, device="fan", action="on"):
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": cmd_id, "device": device, "action": action,
                                              "issued_ts": expires_ts - 5.0,
                                              "expires_ts": expires_ts}).encode())


def test_expired_command_is_rejected_and_not_executed(sim, rec, clock):
    timed_cmd(sim, "late", expires_ts=clock.now - 0.1)
    ack = [a for a in rec.acks() if a["cmd_id"] == "late"][0]
    assert ack["result"] == "failed" and ack["detail"] == "expired"
    assert sim.build_telemetry()["fan_on"] is False and sim.modes["fan"] == "auto"


def test_unexpired_command_is_executed(sim, rec, clock):
    timed_cmd(sim, "fresh", expires_ts=clock.now + 4.0)
    assert [a["result"] for a in rec.acks() if a["cmd_id"] == "fresh"] == ["ok"]
    assert sim.build_telemetry()["fan_on"] is True


def test_command_without_expiry_still_accepted(sim, rec):
    cmd(sim, "fan", "on", "legacy")
    assert [a["result"] for a in rec.acks() if a["cmd_id"] == "legacy"] == ["ok"]


def test_malformed_expiry_is_ignored_not_crash(sim, rec):
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "bad", "device": "fan", "action": "on",
                                              "expires_ts": "soon"}).encode())
    assert [a["result"] for a in rec.acks() if a["cmd_id"] == "bad"] == ["ok"]

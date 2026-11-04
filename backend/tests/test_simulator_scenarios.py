import json

import pytest

from app.models import Event, Telemetry
from simulator.fake_esp32 import SCENARIOS, FakeEsp32

P = "home/esp32-home/"


class Rec:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload=None, qos=0, retain=False):
        self.published.append((topic, json.loads(payload) if payload else None, retain))

    def events(self):
        return [b for t, b, _ in self.published if t == P + "event"]

    def last_sim_state(self):
        states = [(b, r) for t, b, r in self.published if t == P + "sim/state"]
        return states[-1]


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def rec():
    return Rec()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def sim(rec, clock):
    return FakeEsp32(rec, clock=clock)


def test_scenario_ids_match_the_frontend_list():
    assert list(SCENARIOS) == ["normal", "cooling_fan", "heat_alarm", "smoke_danger", "motion_door",
                               "dark_light", "dht_error", "pir_warming_up", "esp32_offline"]


def test_heat_alarm_scenario_raises_alarm_and_fan_with_events(sim, rec):
    sim.set_scenario("heat_alarm")
    t = sim.build_telemetry()
    assert t["temperature_c"] >= 40 and t["heat_alarm"] is True and t["led3_on"] is True
    assert t["fan_on"] is True
    kinds = {(e["type"], e["state"]) for e in rec.events()}
    assert ("heat_alarm", "start") in kinds and ("fan", "start") in kinds
    start = next(e for e in rec.events() if e["type"] == "heat_alarm")
    assert start["value"] >= 40 and start["threshold"] == 40
    for e in rec.events():
        Event.model_validate(e)


def test_heat_alarm_has_hysteresis(sim):
    sim.set_scenario("heat_alarm")
    sim.build_telemetry()
    sim.temperature = 38.0                       # giữa 37 và 40: vẫn báo
    assert sim.build_telemetry()["heat_alarm"] is True
    sim.temperature = 36.9
    assert sim.build_telemetry()["heat_alarm"] is False


def test_returning_to_normal_clears_alarms_and_emits_end_events(sim, rec):
    sim.set_scenario("heat_alarm")
    sim.build_telemetry()
    sim.set_scenario("normal")
    t = sim.build_telemetry()
    assert t["heat_alarm"] is False and t["fan_on"] is False
    assert ("heat_alarm", "end") in {(e["type"], e["state"]) for e in rec.events()}


def test_smoke_scenario_triggers_alarm_and_pump_then_clears(sim, rec):
    sim.set_scenario("smoke_danger")
    t = sim.build_telemetry()
    assert t["smoke_alarm"] is True and t["pump_on"] is True and t["smoke_raw"] > 2000
    kinds = {(e["type"], e["state"]) for e in rec.events()}
    assert ("smoke_alarm", "start") in kinds and ("pump", "start") in kinds
    sim.set_scenario("normal")
    t = sim.build_telemetry()
    assert t["smoke_alarm"] is False and t["pump_on"] is False
    kinds = {(e["type"], e["state"]) for e in rec.events()}
    assert ("smoke_alarm", "end") in kinds and ("pump", "end") in kinds


def test_events_are_only_sent_on_change(sim, rec):
    sim.set_scenario("smoke_danger")
    sim.build_telemetry()
    n = len(rec.events())
    sim.build_telemetry()
    sim.build_telemetry()
    assert len(rec.events()) == n


def test_dht_error_keeps_previous_fan_state_and_reports_error(sim, rec):
    sim.set_scenario("cooling_fan")
    assert sim.build_telemetry()["fan_on"] is True
    sim.set_scenario("dht_error")
    t = sim.build_telemetry()
    assert t["dht_ok"] is False and t["temperature_c"] is None and t["humidity_pct"] is None
    assert t["fan_on"] is True                   # giữ trạng thái trước đó theo đặc tả
    Telemetry.model_validate(t)
    assert ("dht_error", "start") in {(e["type"], e["state"]) for e in rec.events()}


def test_pir_warmup_lasts_60_seconds(sim, clock):
    sim.set_scenario("pir_warming_up")
    sim.motion = True
    t = sim.build_telemetry()
    assert t["pir_ready"] is False and t["motion_detected"] is False and t["door_command"] == "closed"
    clock.now += 61
    assert sim.build_telemetry()["pir_ready"] is True


def test_motion_scenario_opens_door_and_lights_led2(sim):
    sim.set_scenario("motion_door")
    t = sim.build_telemetry()
    assert t["motion_detected"] is True and t["door_command"] == "open" and t["led2_on"] is True


def test_dark_scenario_turns_led1_on(sim):
    sim.set_scenario("dark_light")
    t = sim.build_telemetry()
    assert t["is_dark"] is True and t["led1_on"] is True


def test_offline_scenario_stops_telemetry(sim, rec):
    sim.set_scenario("esp32_offline")
    rec.published.clear()
    sim.publish_telemetry()
    assert [t for t, _, _ in rec.published if t == P + "telemetry"] == []
    sim.set_scenario("normal")
    rec.published.clear()
    sim.publish_telemetry()
    assert [t for t, _, _ in rec.published if t == P + "telemetry"] != []


def test_manual_fan_survives_scenario_change(sim):
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "c", "device": "fan", "action": "on"}).encode())
    sim.set_scenario("dark_light")
    t = sim.build_telemetry()
    assert t["fan_on"] is True and t["modes"]["fan"] == "manual"


def test_set_scenario_announces_state_retained(sim, rec):
    sim.set_scenario("smoke_danger")
    body, retained = rec.last_sim_state()
    assert retained is True
    assert body["active"] is True and body["scenario"] == "smoke_danger"
    assert {"id": "normal", "label": "Bình thường"} in body["scenarios"]
    assert [s["id"] for s in body["scenarios"]] == list(SCENARIOS)


def test_scenario_message_changes_scenario(sim):
    sim.handle_message(P + "sim/scenario", json.dumps({"scenario": "heat_alarm"}).encode())
    assert sim.scenario == "heat_alarm"


def test_unknown_scenario_is_rejected_without_crashing(sim, rec):
    with pytest.raises(ValueError):
        sim.set_scenario("lava")
    sim.handle_message(P + "sim/scenario", json.dumps({"scenario": "lava"}).encode())
    sim.handle_message(P + "sim/scenario", b"garbage")
    assert sim.scenario == "normal"


def test_drift_stays_around_the_scenario_temperature(sim):
    sim.set_scenario("heat_alarm")
    for _ in range(200):
        sim.drift()
        assert 41.0 <= sim.temperature <= 42.0

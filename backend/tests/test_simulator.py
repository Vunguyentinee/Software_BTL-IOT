import json

from app.config import Settings
from app.models import Telemetry
from app.mqtt_bridge import MqttBridge
from app.service import Service
from app.storage import InMemoryStorage
from simulator.fake_esp32 import FakeEsp32
from tests.conftest import FakeClock, FakePublisher

P = "home/esp32-home/"


class Rec:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload=None, qos=0, retain=False):
        self.published.append((topic, json.loads(payload) if payload else None, retain))


def test_build_telemetry_validates_against_model():
    sim = FakeEsp32(Rec())
    Telemetry.model_validate(sim.build_telemetry())


def test_cmd_fan_on_updates_state_and_acks_ok():
    c = Rec()
    sim = FakeEsp32(c)
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "c1", "device": "fan", "action": "on"}).encode())
    topic, body, _ = next(p for p in c.published if p[0] == P + "cmd/ack")
    assert body["cmd_id"] == "c1" and body["result"] == "ok"
    t = sim.build_telemetry()
    assert t["fan_on"] is True and t["modes"]["fan"] == "manual"
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "c2", "device": "fan", "action": "auto"}).encode())
    assert sim.build_telemetry()["modes"]["fan"] == "auto"


def test_cmd_door_open_sets_door_command():
    sim = FakeEsp32(Rec())
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "c1", "device": "door", "action": "open"}).encode())
    assert sim.build_telemetry()["door_command"] == "open"


def test_cmd_unknown_device_acks_failed():
    c = Rec()
    sim = FakeEsp32(c)
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "c1", "device": "pump", "action": "on"}).encode())
    assert c.published[-1][1]["result"] == "failed"


def test_fail_door_flag():
    c = Rec()
    sim = FakeEsp32(c, fail_door=True)
    sim.handle_message(P + "cmd", json.dumps({"cmd_id": "c1", "device": "door", "action": "open"}).encode())
    assert c.published[-1][1]["result"] == "failed"
    assert sim.build_telemetry()["door_command"] == "closed"


def test_config_set_acks_ok_and_rejects_invalid_thresholds():
    c = Rec()
    sim = FakeEsp32(c)
    good = {"config_id": "k1", "thresholds": {"fan_on": 36, "fan_off": 33, "heat_alarm_on": 40,
                                              "heat_alarm_off": 37, "smoke_high": 2000, "smoke_low": 1500}}
    sim.handle_message(P + "config/set", json.dumps(good).encode())
    assert c.published[-1][0] == P + "config/ack" and c.published[-1][1]["result"] == "ok"
    bad = {"config_id": "k2", "thresholds": {"fan_on": 30, "fan_off": 31}}
    sim.handle_message(P + "config/set", json.dumps(bad).encode())
    assert c.published[-1][1]["result"] == "rejected"
    sim.handle_message(P + "config/set", b"garbage")  # must not raise


def test_service_and_simulator_end_to_end():
    clock = FakeClock()
    holder = {}

    class ToSim:  # backend -> ESP32
        def publish(self, topic, payload=None, qos=0, retain=False):
            holder["sim"].handle_message(topic, payload.encode())

    class ToBackend:  # ESP32 -> backend
        def publish(self, topic, payload=None, qos=0, retain=False):
            holder["bridge"].handle_message(topic, payload.encode())

    bridge_holder = {}
    svc = Service(Settings(), InMemoryStorage(), FakePublisher(), clock=clock)
    bridge = MqttBridge(svc, Settings(), client=ToSim())
    svc.publisher = bridge
    sim = FakeEsp32(ToBackend())
    holder.update(sim=sim, bridge=bridge)

    sim.publish_telemetry()
    assert svc.get_state()["online"] is True
    rec = svc.send_command("fan", "on")
    assert svc.get_command(rec["cmd_id"])["status"] == "ok"
    sim.publish_telemetry()
    assert svc.get_state()["telemetry"]["fan_on"] is True
    cfg = svc.set_config(__import__("app.models", fromlist=["Thresholds"]).Thresholds(fan_on=37))
    assert svc.get_config()["status"] == "applied"

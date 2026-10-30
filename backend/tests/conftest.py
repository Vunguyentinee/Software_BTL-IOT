import pytest

from app.config import Settings
from app.service import Service
from app.storage import InMemoryStorage

EXAMPLE = {
    "temperature_c": 36.0, "humidity_pct": 70.0, "dht_ok": True,
    "pir_ready": True, "motion_detected": True, "is_dark": True,
    "door_command": "open", "fan_on": True, "led1_on": True,
    "led2_on": True, "led3_on": False, "heat_alarm": False,
    "uptime_ms": 120000,
}


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, s):
        self.now += s


class FakePublisher:
    def __init__(self):
        self.cmds = []
        self.configs = []

    def publish_cmd(self, payload):
        self.cmds.append(payload)

    def publish_config(self, payload):
        self.configs.append(payload)


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def publisher():
    return FakePublisher()


@pytest.fixture
def storage():
    return InMemoryStorage()


@pytest.fixture
def broadcasts():
    return []


@pytest.fixture
def service(clock, publisher, storage, broadcasts):
    return Service(Settings(), storage, publisher, clock=clock, broadcast=broadcasts.append)


@pytest.fixture
def online_service(service):
    service.on_telemetry(EXAMPLE)
    return service

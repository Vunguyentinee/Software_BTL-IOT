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


TEST_USERS = ("viewer1:viewerpass1:viewer,op1:operatorpass1:operator,admin1:adminpass12:admin")
TEST_SECRET = "unit-test-secret-" + "x" * 32
CREDENTIALS = {"viewer": ("viewer1", "viewerpass1"), "operator": ("op1", "operatorpass1"),
               "admin": ("admin1", "adminpass12")}


def make_settings(**over) -> Settings:
    base = dict(users_spec=TEST_USERS, jwt_secret=TEST_SECRET, bcrypt_rounds=4)
    base.update(over)
    return Settings(**base)


def authed_client(service, role="admin", **app_kwargs):
    """TestClient đã đăng nhập bằng tài khoản thử của vai trò `role` (None = chưa đăng nhập)."""
    from fastapi.testclient import TestClient
    from app.api import create_app
    client = TestClient(create_app(service, **app_kwargs))
    if role is not None:
        user, password = CREDENTIALS[role]
        token = client.post("/api/auth/login", json={"username": user, "password": password}).json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"
    return client


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
        self.sim_scenarios = []

    def publish_cmd(self, payload):
        self.cmds.append(payload)

    def publish_config(self, payload):
        self.configs.append(payload)

    def publish_sim_scenario(self, payload):
        self.sim_scenarios.append(payload)


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
    return Service(make_settings(), storage, publisher, clock=clock, broadcast=broadcasts.append)


@pytest.fixture
def online_service(service):
    service.on_telemetry(EXAMPLE)
    return service

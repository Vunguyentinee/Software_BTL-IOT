from app.config import Settings
from app.models import Thresholds
from app.service import Service
from tests.conftest import EXAMPLE, FakePublisher


def test_default_config_when_nothing_saved(service):
    c = service.get_config()
    assert c["status"] == "none" and c["config_id"] is None
    assert c["thresholds"]["fan_on"] == 35


def test_set_config_publishes_and_pending(service, publisher):
    c = service.set_config(Thresholds(fan_on=36, fan_off=33))
    assert c["status"] == "pending"
    sent = publisher.configs[0]
    assert sent["config_id"] == c["config_id"]
    assert sent["thresholds"] == {"fan_on": 36, "fan_off": 33, "heat_alarm_on": 40,
                                  "heat_alarm_off": 37, "smoke_high": 2000, "smoke_low": 1500}


def test_config_ack_ok_marks_applied(service):
    c = service.set_config(Thresholds())
    assert service.on_config_ack({"config_id": c["config_id"], "result": "ok"}) is True
    assert service.get_config()["status"] == "applied"


def test_config_ack_rejected_keeps_detail(service):
    c = service.set_config(Thresholds())
    service.on_config_ack({"config_id": c["config_id"], "result": "rejected", "detail": "range"})
    got = service.get_config()
    assert got["status"] == "rejected" and got["detail"] == "range"


def test_stale_config_ack_ignored(service):
    first = service.set_config(Thresholds())
    second = service.set_config(Thresholds(fan_on=36))
    assert service.on_config_ack({"config_id": first["config_id"], "result": "ok"}) is False
    got = service.get_config()
    assert got["config_id"] == second["config_id"] and got["status"] == "pending"
    assert service.on_config_ack(b"garbage") is False


def test_config_pending_times_out_when_online(online_service, clock):
    online_service.set_config(Thresholds())
    clock.advance(5.1)
    online_service.tick()
    assert online_service.get_config()["status"] == "timeout"


def test_config_stays_pending_while_offline(service, clock):
    service.set_config(Thresholds())
    clock.advance(60)
    service.tick()
    assert service.get_config()["status"] == "pending"


def test_config_wait_starts_when_device_comes_online(service, clock):
    service.set_config(Thresholds())
    clock.advance(60)
    service.on_telemetry(EXAMPLE)
    clock.advance(3)
    service.tick()
    assert service.get_config()["status"] == "pending"


def test_restart_republishes_saved_config(service, storage, clock):
    c = service.set_config(Thresholds(smoke_high=3000))
    p2 = FakePublisher()
    s2 = Service(Settings(), storage, p2, clock=clock)
    assert s2.get_config()["config_id"] == c["config_id"]
    s2.on_connected()
    assert p2.configs[-1]["config_id"] == c["config_id"]
    assert p2.configs[-1]["thresholds"]["smoke_high"] == 3000


def test_on_connected_without_saved_config_publishes_nothing(service, publisher):
    service.on_connected()
    assert publisher.configs == []

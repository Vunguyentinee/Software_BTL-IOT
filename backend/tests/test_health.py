from fastapi.testclient import TestClient

from app.api import create_app
from tests.conftest import EXAMPLE


class _FailingStorage:
    def __init__(self, inner):
        self.inner = inner
        self.fail = True

    def save_telemetry(self, rec):
        if self.fail:
            raise OSError("db down")
        return self.inner.save_telemetry(rec)

    def __getattr__(self, name):
        return getattr(self.inner, name)


def test_health_ok_by_default(service):
    h = service.health()
    assert h["storage"] == {"ok": True, "errors": 0, "last_error_ts": None}
    assert h["mqtt"]["connected"] is None   # publisher không báo trạng thái


def test_storage_error_is_surfaced_not_hidden(service, clock, storage):
    service.storage = _FailingStorage(storage)
    clock.advance(1)
    assert service.on_telemetry(EXAMPLE) is True        # trạng thái hiện tại vẫn cập nhật
    h = service.health()
    assert h["storage"]["ok"] is False
    assert h["storage"]["errors"] == 1 and h["storage"]["last_error_ts"] == clock.now


def test_storage_recovers(service, storage):
    failing = _FailingStorage(storage)
    service.storage = failing
    service.on_telemetry(EXAMPLE)
    failing.fail = False
    service.on_telemetry(dict(EXAMPLE, uptime_ms=5))
    h = service.health()
    assert h["storage"]["ok"] is True and h["storage"]["errors"] == 1


def test_health_reports_mqtt_from_publisher(service, publisher):
    publisher.is_connected = lambda: False
    assert service.health()["mqtt"]["connected"] is False


def test_health_endpoint(service):
    r = TestClient(create_app(service)).get("/api/health")
    assert r.status_code == 200
    assert set(r.json()) == {"mqtt", "storage", "device_online"}

"""PostgreSQL treo/ngừng không được làm treo Service (trạng thái, sức khỏe, tick) — lỗi phát hiện ở F3."""
import threading
import time

import pytest

from app.config import Settings
from app.service import Service
from app.storage import InMemoryStorage
from tests.conftest import EXAMPLE, FakeClock, FakePublisher, make_settings


class StuckStorage:
    """Bọc InMemoryStorage; các thao tác ghi/đọc chậm bị chặn đến khi `gate.set()` (mô phỏng DB không phản hồi)."""

    BLOCKING = ("save_telemetry", "save_event", "save_connection_event", "list_commands")

    def __init__(self):
        self.inner = InMemoryStorage()
        self.gate = threading.Event()
        self.gate.set()

    def __getattr__(self, name):
        attr = getattr(self.inner, name)
        if name in self.BLOCKING and callable(attr):
            def wrapper(*a, **k):
                self.gate.wait(timeout=10)
                return attr(*a, **k)
            return wrapper
        return attr


@pytest.fixture
def stuck():
    return StuckStorage()


@pytest.fixture
def svc(stuck):
    clock = FakeClock()
    return Service(make_settings(), stuck, FakePublisher(), clock=clock), clock


def finishes_within(fn, seconds=1.0):
    done = threading.Event()

    def run():
        fn()
        done.set()

    threading.Thread(target=run, daemon=True).start()
    return done.wait(seconds)


def start_in_background(fn):
    t = threading.Thread(target=fn, daemon=True)
    t.start()
    time.sleep(0.15)   # để luồng kịp chạm vào kho lưu trữ đang bị chặn
    return t


def test_state_and_health_answer_while_telemetry_write_is_stuck(svc, stuck):
    service, _ = svc
    service.on_telemetry(EXAMPLE)
    stuck.gate.clear()
    t = start_in_background(lambda: service.on_telemetry(dict(EXAMPLE, uptime_ms=5)))
    assert finishes_within(service.get_state)
    assert finishes_within(service.health)
    stuck.gate.set()
    t.join(5)


def test_state_answers_while_event_write_is_stuck(svc, stuck):
    service, _ = svc
    service.on_telemetry(EXAMPLE)
    stuck.gate.clear()
    t = start_in_background(lambda: service.on_event({"type": "fan", "state": "start", "uptime_ms": 1}))
    assert finishes_within(service.get_state)
    stuck.gate.set()
    t.join(5)


def test_tick_does_not_wait_for_a_stuck_database(svc, stuck):
    service, clock = svc
    service.on_telemetry(EXAMPLE)
    stuck.gate.clear()
    clock.advance(1)
    assert finishes_within(service.tick)
    stuck.gate.set()


def test_tick_times_out_pending_commands_without_scanning_storage(svc, stuck):
    service, clock = svc
    service.on_telemetry(EXAMPLE)
    rec = service.send_command("fan", "on")

    def forbidden(*a, **k):
        raise AssertionError("tick không được quét kho lưu trữ để tìm lệnh pending")
    stuck.inner.list_commands = forbidden
    clock.advance(5.1)
    service.tick()
    assert service.get_command(rec["cmd_id"])["status"] == "timeout"


def test_pending_commands_are_timed_out_after_backend_restart(storage, publisher):
    clock = FakeClock()
    first = Service(make_settings(), storage, publisher, clock=clock)
    first.on_telemetry(EXAMPLE)
    rec = first.send_command("fan", "on")
    clock.advance(30)
    second = Service(make_settings(), storage, FakePublisher(), clock=clock)   # backend khởi động lại
    second.tick()
    assert storage.get_command(rec["cmd_id"])["status"] == "timeout"


def test_duplicate_detection_survives_restart(storage, publisher):
    clock = FakeClock()
    first = Service(make_settings(), storage, publisher, clock=clock)
    first.on_telemetry(EXAMPLE)
    rec = first.send_command("fan", "on")
    pub2 = FakePublisher()
    second = Service(make_settings(), storage, pub2, clock=clock)
    second.on_telemetry(EXAMPLE)
    again = second.send_command("fan", "on")
    assert again["cmd_id"] == rec["cmd_id"] and pub2.cmds == []


def test_storage_error_during_tick_does_not_raise(storage, publisher):
    clock = FakeClock()
    service = Service(make_settings(), storage, publisher, clock=clock)
    service.on_telemetry(EXAMPLE)
    service.send_command("fan", "on")

    def down(*a, **k):
        raise OSError("db down")
    storage.get_command = down
    clock.advance(5.1)
    service.tick()   # không ném ngoại lệ; lệnh vẫn pending để thử lại khi DB trở lại
    del storage.get_command
    service.tick()
    [cmd] = storage.list_commands()
    assert cmd["status"] == "timeout"


def test_pg_pool_has_short_timeout_configuration():
    from app.pg_storage import PostgresStorage
    import inspect
    sig = inspect.signature(PostgresStorage.__init__)
    assert sig.parameters["pool_timeout_s"].default <= 5.0

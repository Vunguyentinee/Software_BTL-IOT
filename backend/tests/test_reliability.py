import concurrent.futures
import os
import time
from urllib.parse import urlparse

import pytest

from app.models import Telemetry
from app.reliability import ReliabilityTracker
from app.service import Service
from app.storage import InMemoryStorage
from tests.conftest import FakeClock, FakePublisher

URL = os.environ.get("BTL_TEST_DATABASE_URL")


def _is_allowed_test_database(url):
    if not url:
        return False
    try:
        parsed = urlparse(url)
        return parsed.port == 55432 and parsed.path.rstrip("/") == "/smarthome_test"
    except ValueError:
        return False


def tel(ts, temp=30.0, **extra):
    base = {
        "ts": ts, "temperature_c": temp, "humidity_pct": 50.0, "dht_ok": True,
        "pir_ready": True, "motion_detected": False, "is_dark": False,
        "door_command": "closed", "fan_on": False, "led1_on": False,
        "led2_on": False, "led3_on": False, "heat_alarm": False, "uptime_ms": 1000,
        "smoke_raw": 300, "smoke_alarm": False, "pump_on": False,
        "modes": {"fan": "auto"}
    }
    base.update(extra)
    return base


@pytest.fixture
def memory_storage():
    return InMemoryStorage()


@pytest.fixture
def postgres_storage():
    if not _is_allowed_test_database(URL):
        pytest.skip("BTL_TEST_DATABASE_URL must target smarthome_test on port 55432")
    from app.pg_storage import PostgresStorage
    s = PostgresStorage(URL)
    s.reset()
    yield s
    s.close()


@pytest.fixture(params=["memory", "postgres"])
def storage(request, memory_storage):
    if request.param == "memory":
        yield memory_storage
    else:
        if not _is_allowed_test_database(URL):
            pytest.skip("BTL_TEST_DATABASE_URL must target smarthome_test on port 55432")
        from app.pg_storage import PostgresStorage
        s = PostgresStorage(URL)
        s.reset()
        yield s
        s.close()


# ==============================================================================
# 1. Test dữ liệu legacy thiếu seq/boot_id
# ==============================================================================
def test_legacy_telemetry_missing_boot_and_seq_accepted(storage):
    # Dữ liệu legacy không có device_id, boot_id, seq
    rec1 = tel(100.0, 25.0)
    rec2 = tel(101.0, 26.0)
    assert storage.save_telemetry(rec1) is True
    assert storage.save_telemetry(rec2) is True

    # Kiểm tra các hàm lịch sử cũ vẫn hoạt động 100%
    assert len(storage.history("temperature_c", None, None)) == 2
    stats = storage.history_stats("temperature_c", None, None)
    assert stats["count"] == 2
    assert stats["min"] == 25.0
    assert stats["max"] == 26.0
    assert stats["avg"] == 25.5

    # Reliability stats cho legacy telemetry: không có duplicate, boot_count = 0
    rel = storage.reliability_stats()
    assert rel["stored_count"] == 2
    assert rel["duplicate_count"] == 0
    assert rel["boot_count"] == 0


# ==============================================================================
# 2. Test duplicate telemetry (phát hiện và không ghi đè)
# ==============================================================================
def test_duplicate_telemetry_detected_and_rejected(storage):
    dev = "esp32-home"
    boot = "boot-session-1"

    rec1 = tel(100.0, 30.0, device_id=dev, boot_id=boot, seq=1)
    rec1_dup = tel(100.5, 30.5, device_id=dev, boot_id=boot, seq=1)  # Cùng seq trong cùng boot_id
    rec2 = tel(102.0, 31.0, device_id=dev, boot_id=boot, seq=2)

    assert storage.save_telemetry(rec1) is True
    # Bản tin trùng bị phát hiện và từ chối lưu
    assert storage.save_telemetry(rec1_dup) is False
    assert storage.save_telemetry(rec2) is True

    rel = storage.reliability_stats(device_id=dev)
    assert rel["stored_count"] == 2
    assert rel["duplicate_count"] == 1


# ==============================================================================
# 3. Test out-of-order & late arrival (không ghi đè trạng thái mới)
# ==============================================================================
def test_out_of_order_telemetry_and_gap_resolution(storage):
    dev = "esp32-home"
    boot = "boot-session-1"

    # Gói 1 đến
    storage.save_telemetry(tel(100.0, 28.0, device_id=dev, boot_id=boot, seq=1))
    # Gói 3 đến trước gói 2 -> phát hiện gap cho gói 2
    storage.save_telemetry(tel(104.0, 32.0, device_id=dev, boot_id=boot, seq=3))

    rel1 = storage.reliability_stats(device_id=dev, now=105.0)
    assert rel1["out_of_order_count"] == 0
    assert rel1["missing_packets_pending"] == 1  # gói 2 đang pending

    # Gói 2 đến muộn (late arrival / out-of-order)
    storage.save_telemetry(tel(105.0, 30.0, device_id=dev, boot_id=boot, seq=2))

    rel2 = storage.reliability_stats(device_id=dev, now=106.0)
    assert rel2["out_of_order_count"] == 1
    # Gói 2 đến muộn đã vá gap!
    assert rel2["missing_packets_pending"] == 0
    assert rel2["missing_packets_confirmed"] == 0
    assert rel2["stored_count"] == 3


def test_service_does_not_overwrite_state_with_late_arrival():
    clock = FakeClock(100.0)
    storage = InMemoryStorage()
    svc = Service(Settings := type("S", (), {"offline_timeout_s": 10.0, "cmd_timeout_s": 5.0})(),
                  storage, FakePublisher(), clock=clock)

    dev = "esp32-home"
    boot = "boot-1"

    # Telemetry mới seq=5, temp=35.0
    payload5 = tel(100.0, 35.0, device_id=dev, boot_id=boot, seq=5)
    assert svc.on_telemetry(payload5) is True
    assert svc.get_state()["telemetry"]["temperature_c"] == 35.0
    assert svc.get_state()["telemetry"]["seq"] == 5

    # Telemetry đến muộn seq=4, temp=20.0
    clock.advance(1.0)
    payload4 = tel(101.0, 20.0, device_id=dev, boot_id=boot, seq=4)
    assert svc.on_telemetry(payload4) is True

    # Trạng thái hiện tại KHÔNG bị bản tin cũ ghi đè!
    assert svc.get_state()["telemetry"]["temperature_c"] == 35.0
    assert svc.get_state()["telemetry"]["seq"] == 5

    # Nhưng bản tin seq=4 vẫn được lưu vào lịch sử DB
    assert len(storage.history("temperature_c", None, None)) == 2


# ==============================================================================
# 4. Test sequence gap: pending vs confirmed packet loss
# ==============================================================================
def test_sequence_gap_pending_vs_confirmed(storage):
    dev = "esp32-home"
    boot = "boot-gap-test"

    t0 = 1000.0
    storage.save_telemetry(tel(t0, 30.0, device_id=dev, boot_id=boot, seq=1))
    storage.save_telemetry(tel(t0 + 2, 32.0, device_id=dev, boot_id=boot, seq=4))  # Missing seq=2, 3

    # Trong cửa sổ late window (mặc định 10s): lúc t0 + 5s
    rel_pending = storage.reliability_stats(device_id=dev, now=t0 + 5.0)
    assert rel_pending["gaps_count"] == 1
    assert rel_pending["missing_packets_pending"] == 2
    assert rel_pending["missing_packets_confirmed"] == 0

    # Sau khi quá cửa sổ late window: lúc t0 + 15s (đã quá 10s kể từ lúc phát hiện)
    rel_confirmed = storage.reliability_stats(device_id=dev, now=t0 + 15.0)
    assert rel_confirmed["missing_packets_pending"] == 0
    assert rel_confirmed["missing_packets_confirmed"] == 2
    # Tuyệt đối không tự suy đoán delivery rate khi chưa có bộ đếm phát từ ESP32
    assert rel_confirmed["delivery_rate"] is None


# ==============================================================================
# 5. Test ESP32 reboot: seq reset hợp lệ
# ==============================================================================
def test_esp32_reboot_seq_reset_not_duplicate(storage):
    dev = "esp32-home"

    # Phiên boot 1: seq=0, 1, 2
    storage.save_telemetry(tel(100.0, 29.0, device_id=dev, boot_id="boot-session-A", seq=0))
    storage.save_telemetry(tel(102.0, 29.5, device_id=dev, boot_id="boot-session-A", seq=1))
    storage.save_telemetry(tel(104.0, 30.0, device_id=dev, boot_id="boot-session-A", seq=2))

    # ESP32 reboot -> sinh boot_id mới: seq reset về 0, 1
    storage.save_telemetry(tel(120.0, 28.0, device_id=dev, boot_id="boot-session-B", seq=0))
    storage.save_telemetry(tel(122.0, 28.5, device_id=dev, boot_id="boot-session-B", seq=1))

    rel = storage.reliability_stats(device_id=dev)
    assert rel["stored_count"] == 5
    assert rel["duplicate_count"] == 0
    assert rel["out_of_order_count"] == 0
    assert rel["boot_count"] == 2


# ==============================================================================
# 6. Test command statistics
# ==============================================================================
def test_command_stats(storage):
    t0 = 2000.0
    storage.save_command({"cmd_id": "c1", "device": "fan", "action": "on",
                          "status": "ok", "sent_ts": t0, "ack_ts": t0 + 0.5, "ts": t0})
    storage.save_command({"cmd_id": "c2", "device": "fan", "action": "off",
                          "status": "ok", "sent_ts": t0 + 1, "ack_ts": t0 + 2.0, "ts": t0 + 1})
    storage.save_command({"cmd_id": "c3", "device": "door", "action": "open",
                          "status": "failed", "sent_ts": t0 + 2, "ack_ts": t0 + 3.0, "ts": t0 + 2})
    storage.save_command({"cmd_id": "c4", "device": "led1", "action": "on",
                          "status": "timeout", "sent_ts": t0 + 3, "ack_ts": None, "ts": t0 + 3})
    storage.save_command({"cmd_id": "c5", "device": "led1", "action": "off",
                          "status": "pending", "sent_ts": t0 + 4, "ack_ts": None, "ts": t0 + 4})

    stats = storage.command_stats(start=t0, end=t0 + 5)
    assert stats["total"] == 5
    assert stats["ok"] == 2
    assert stats["failed"] == 1
    assert stats["timeout"] == 1
    assert stats["pending"] == 1
    assert stats["success_rate"] == 2 / 5
    # durations: 0.5, 1.0, 1.0 -> avg = 2.5/3 = 0.8333...
    assert pytest.approx(stats["avg_duration_s"], rel=1e-2) == (0.5 + 1.0 + 1.0) / 3
    assert stats["min_duration_s"] == 0.5
    assert stats["max_duration_s"] == 1.0


# ==============================================================================
# 7. Test connection & error history
# ==============================================================================
def test_connection_and_error_history(storage):
    # Lưu sự kiện connection
    storage.save_connection_event("online", reason="mqtt_connect", ts=100.0)
    storage.save_connection_event("offline", reason="telemetry_timeout", ts=120.0)

    # Lưu sự kiện lỗi và cảnh báo
    storage.save_event({"type": "dht_error", "state": "start", "reason": "sensor_read_timeout",
                        "uptime_ms": 5000, "ts": 110.0})
    storage.save_event({"type": "heat_alarm", "state": "start", "value": 45.0,
                        "uptime_ms": 6000, "ts": 115.0})
    storage.save_event({"type": "pump", "state": "start", "uptime_ms": 7000, "ts": 116.0})

    conn_events = storage.list_connection_events()
    assert len(conn_events) == 2
    assert conn_events[0]["state"] == "offline" and conn_events[0]["ts"] == 120.0
    assert conn_events[1]["state"] == "online" and conn_events[1]["ts"] == 100.0

    error_events = storage.list_error_events()
    # Phải bắt được dht_error và heat_alarm
    types = [e["type"] for e in error_events]
    assert "dht_error" in types
    assert "heat_alarm" in types
    assert "connection" not in types


# ==============================================================================
# 8. Test PostgreSQL SQL gap verification bằng Window Function
# ==============================================================================
def test_sql_verify_telemetry_gaps_on_postgres(postgres_storage):
    dev = "esp32-postgres"
    boot = "boot-pg-1"

    postgres_storage.save_telemetry(tel(100.0, 30.0, device_id=dev, boot_id=boot, seq=1))
    postgres_storage.save_telemetry(tel(102.0, 30.5, device_id=dev, boot_id=boot, seq=2))
    # Tạo gap: bỏ qua seq=3, 4, 5
    postgres_storage.save_telemetry(tel(108.0, 31.0, device_id=dev, boot_id=boot, seq=6))

    gaps = postgres_storage.verify_telemetry_gaps(dev, boot)
    assert len(gaps) == 1
    assert gaps[0]["gap_start"] == 3
    assert gaps[0]["gap_end"] == 5
    assert gaps[0]["missing_count"] == 3


# ==============================================================================
# 9. Test PostgreSQL Concurrent Inserts, Transaction Rollback & Partial Unique Index
# ==============================================================================
def test_transaction_rollback_on_postgres(postgres_storage):
    dev = "esp32-rollback"
    boot = "boot-rb"

    # Mở transaction và cố tình raise Exception để kiểm tra rollback
    with postgres_storage._pool.connection() as conn:
        with pytest.raises(RuntimeError, match="forced rollback"):
            with conn.transaction():
                conn.execute(
                    "INSERT INTO telemetry (ts, temperature_c, device_id, boot_id, seq) "
                    "VALUES (to_timestamp(100.0), 30.0, %s, %s, 1)",
                    [dev, boot]
                )
                raise RuntimeError("forced rollback")

    # Xác nhận bản ghi đã bị rollback hoàn toàn, không lưu lại dữ liệu rác
    with postgres_storage._pool.connection() as conn:
        row = conn.execute(
            "SELECT count(*) AS c FROM telemetry WHERE device_id = %s AND boot_id = %s",
            [dev, boot]
        ).fetchone()
    assert row["c"] == 0


def test_concurrent_inserts_on_postgres(postgres_storage):
    dev = "esp32-concurrent"
    boot = "boot-conc"

    def insert_worker(seq):
        # Cố gắng insert cùng 1 record (hoặc các records)
        rec = tel(500.0 + seq, 30.0 + seq, device_id=dev, boot_id=boot, seq=seq)
        return postgres_storage.save_telemetry(rec)

    # Chạy 10 threads cố gắng insert cùng 1 bản tin seq=999
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(lambda _: insert_worker(999), range(10)))

    # Chỉ duy nhất 1 thread chèn thành công (True), 9 threads còn lại bị phát hiện duplicate (False)
    assert results.count(True) == 1
    assert results.count(False) == 9

    # Xác nhận trong PostgreSQL chỉ tồn tại đúng 1 hàng với seq=999
    with postgres_storage._pool.connection() as conn:
        count = conn.execute(
            "SELECT count(*) AS c FROM telemetry WHERE device_id = %s AND boot_id = %s AND seq = 999",
            [dev, boot]
        ).fetchone()["c"]
    assert count == 1


# ==============================================================================
# 10. Test Persistence across Storage Restart
# ==============================================================================
def test_persistence_across_storage_restart(postgres_storage):
    dev = "esp32-restart"
    boot = "boot-restart"

    postgres_storage.save_telemetry(tel(100.0, 25.0, device_id=dev, boot_id=boot, seq=10))
    postgres_storage.save_telemetry(tel(102.0, 26.0, device_id=dev, boot_id=boot, seq=11))

    # Đóng storage cũ và mở storage instance mới trên cùng test database
    postgres_storage.close()
    from app.pg_storage import PostgresStorage
    new_storage = PostgresStorage(URL)

    # Max seq của session phải được phục hồi từ DB
    assert new_storage._tracker._session_max_seq.get((dev, boot)) == 11

    # Nếu gửi lại seq=11 -> phải bị chặn duplicate ngay!
    assert new_storage.save_telemetry(tel(102.0, 26.0, device_id=dev, boot_id=boot, seq=11)) is False

    # Gửi tiếp seq=12 -> hợp lệ
    assert new_storage.save_telemetry(tel(104.0, 27.0, device_id=dev, boot_id=boot, seq=12)) is True
    new_storage.close()


# ==============================================================================
# 11. Test Index Performance với large dataset
# ==============================================================================
def test_indexes_and_dataset_queries(postgres_storage):
    dev = "esp32-perf"
    boot = "boot-perf"

    # Chèn nhanh 500 bản ghi
    with postgres_storage._pool.connection() as conn:
        with conn.pipeline():
            for i in range(500):
                conn.execute(
                    "INSERT INTO telemetry (ts, temperature_c, humidity_pct, device_id, boot_id, seq) "
                    "VALUES (to_timestamp(%s), %s, %s, %s, %s, %s)",
                    [1000.0 + i, 20.0 + (i % 20), 50.0, dev, boot, i]
                )

    t_start = time.perf_counter()
    stats = postgres_storage.history_stats("temperature_c", 1000.0, 1500.0)
    page = postgres_storage.history_page("temperature_c", 1000.0, 1500.0, limit=50, offset=100)
    elapsed = time.perf_counter() - t_start

    assert stats["count"] == 500
    assert len(page) == 50
    # Truy vấn phải cực nhanh nhờ index
    assert elapsed < 0.2  # Dưới 200ms


# ==============================================================================
# 12. Test Bounded Memory: Sliding Window & Pending Gaps Cleanup
# ==============================================================================
def test_bounded_memory_sliding_window_and_gaps_cleanup():
    tracker = ReliabilityTracker(
        late_window_s=5.0,
        max_seen_history=100,
        max_gap_events=50,
        max_pending_gaps=100,
    )
    dev = "esp32-mem"
    boot = "boot-mem-1"

    # Gửi 1,000 bản tin với gaps ngắt quãng
    t0 = 1000.0
    for i in range(1000):
        # Tạo gap mỗi 20 gói
        seq = i if i % 20 != 10 else i + 2
        tracker.record_incoming(dev, boot, seq, now=t0 + i)

    key = (dev, boot)
    # 1. Sliding window của seen_seqs không bao giờ vượt quá max_seen_history (100)
    assert len(tracker._session_seen_seqs[key]) <= 100
    assert len(tracker._session_seen_deque[key]) <= 100

    # 2. Danh sách gap events không bao giờ vượt quá max_gap_events (50)
    assert len(tracker._gap_events) <= 50

    # 3. Pending gaps được dọn dẹp không phình to RAM
    assert len(tracker._pending_gaps) <= 100

    # 4. Thống kê tích lũy vẫn phản ánh đúng tổng số gaps đã xảy ra
    stats = tracker.get_stats(stored_count=1000, device_id=dev, now=t0 + 1500)
    assert stats["gaps_count"] > 0
    assert stats["unresolved_gaps_beyond_window"] > 0
    assert stats["missing_packets_confirmed"] == stats["unresolved_gaps_beyond_window"]


# ==============================================================================
# 13. Test Thread Safety & Concurrent Ingestion trong Tracker
# ==============================================================================
def test_tracker_thread_safety_concurrent_ingest():
    tracker = ReliabilityTracker()
    dev = "esp32-threads"
    boot = "boot-thr"

    def worker(worker_id):
        for i in range(50):
            seq = worker_id * 100 + i
            tracker.record_incoming(dev, boot, seq, now=1000.0 + i)
            # Gửi kèm duplicate
            if i % 5 == 0:
                tracker.record_incoming(dev, boot, seq, now=1000.0 + i)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(worker, w) for w in range(8)]
        concurrent.futures.wait(futures)

    stats = tracker.get_stats(stored_count=400, device_id=dev)
    assert stats["received_count"] == 8 * 50 + 8 * 10  # 400 + 80 = 480
    assert stats["duplicate_count"] == 80


# ==============================================================================
# 14. Test Restart Consistency: Không Double-Counting Duplicate
# ==============================================================================
def test_restart_duplicate_does_not_double_count_out_of_order(postgres_storage):
    dev = "esp32-nodouble"
    boot = "boot-nodouble"

    postgres_storage.save_telemetry(tel(100.0, 25.0, device_id=dev, boot_id=boot, seq=1))
    postgres_storage.save_telemetry(tel(102.0, 25.5, device_id=dev, boot_id=boot, seq=5))

    # Giả lập backend restart: đóng và mở instance mới
    postgres_storage.close()
    from app.pg_storage import PostgresStorage
    restarted_storage = PostgresStorage(URL)

    # Gửi lại seq=1 (đã có trong DB từ trước restart).
    # Trong RAM, seq=1 chưa có trong seen_seqs, nhưng seq=1 < max_seq (5).
    # Tracker ban đầu nghi ngờ out-of-order, nhưng Postgres ON CONFLICT DO NOTHING phát hiện duplicate.
    saved = restarted_storage.save_telemetry(tel(100.0, 25.0, device_id=dev, boot_id=boot, seq=1))
    assert saved is False

    stats = restarted_storage.reliability_stats(device_id=dev)
    # Xác nhận: duplicate tăng 1, NHƯNG out_of_order KHÔNG bị đếm đúp!
    assert stats["duplicate_count"] == 1
    assert stats["out_of_order_count"] == 0
    restarted_storage.close()


# ==============================================================================
# 15. Test Database Failure Không Làm Sập Luồng Realtime
# ==============================================================================
def test_database_failure_does_not_crash_realtime_stream():
    clock = FakeClock(200.0)
    broadcast_messages = []

    class FailingStorage(InMemoryStorage):
        def save_telemetry(self, rec: dict) -> bool:
            raise RuntimeError("PostgreSQL connection timeout")

    storage = FailingStorage()
    svc = Service(
        Settings := type("S", (), {"offline_timeout_s": 10.0, "cmd_timeout_s": 5.0})(),
        storage,
        FakePublisher(),
        clock=clock,
        broadcast=lambda msg: broadcast_messages.append(msg),
    )

    dev = "esp32-db-fail"
    boot = "boot-db-fail"
    payload = tel(200.0, 36.5, device_id=dev, boot_id=boot, seq=1)

    # Khi DB lỗi, on_telemetry vẫn xử lý thành công (trả về True)
    assert svc.on_telemetry(payload) is True

    # Trạng thái realtime vẫn được cập nhật để Web giám sát thấy nhịp tim
    state = svc.get_state()
    assert state["online"] is True
    assert state["telemetry"]["temperature_c"] == 36.5
    assert state["last_seen"] == 200.0

    # WebSocket vẫn nhận được broadcast tin nhắn realtime
    telemetry_broadcasts = [m for m in broadcast_messages if m["kind"] == "telemetry"]
    assert len(telemetry_broadcasts) == 1
    assert telemetry_broadcasts[0]["data"]["temperature_c"] == 36.5


# ==============================================================================
# 16. Test Phân Loại Lý Do Offline: MQTT Status vs Timeout
# ==============================================================================
def test_offline_reason_status_vs_timeout():
    clock = FakeClock(100.0)
    storage = InMemoryStorage()
    svc = Service(
        Settings := type("S", (), {"offline_timeout_s": 10.0, "cmd_timeout_s": 5.0})(),
        storage,
        FakePublisher(),
        clock=clock,
    )

    # 1. Online do telemetry
    svc.on_telemetry(tel(100.0, 28.0))
    assert svc.get_state()["online"] is True

    # 2. Broker gửi LWT/status "offline" -> lý do phải là "status", KHÔNG phải "timeout"
    svc.on_status("offline")
    assert svc.get_state()["online"] is False
    conn_events = storage.list_connection_events()
    assert conn_events[0]["state"] == "offline"
    assert conn_events[0]["reason"] == "status"

    # 3. Thiết bị online trở lại qua MQTT status
    svc.on_status("online")
    assert svc.get_state()["online"] is True

    # 4. Quá thời gian chờ (heartbeat timeout) -> lý do phải là "timeout"
    clock.advance(15.0)
    svc.tick()
    assert svc.get_state()["online"] is False
    conn_events = storage.list_connection_events()
    assert conn_events[0]["state"] == "offline"
    assert conn_events[0]["reason"] == "timeout"


# ==============================================================================
# 17. Test Time Range Validation Cho command_stats & reliability_stats
# ==============================================================================
def test_time_range_validation_for_stats(storage):
    # start > end
    with pytest.raises(ValueError, match="start must be less than or equal to end"):
        storage.command_stats(start=200.0, end=100.0)

    with pytest.raises(ValueError, match="start must be less than or equal to end"):
        storage.reliability_stats(start=200.0, end=100.0)

    # start is NaN / infinite
    with pytest.raises(ValueError, match="start must be finite"):
        storage.command_stats(start=float("nan"), end=100.0)

    with pytest.raises(ValueError, match="end must be finite"):
        storage.reliability_stats(start=10.0, end=float("inf"))


# ==============================================================================
# 18. Test Terminology: Unresolved Gaps Beyond Window & Late Arrival Resolution
# ==============================================================================
def test_terminology_unresolved_gaps_and_late_arrival():
    tracker = ReliabilityTracker(late_window_s=10.0)
    dev = "esp32-term"
    boot = "boot-term"

    t0 = 500.0
    tracker.record_incoming(dev, boot, 1, now=t0)
    tracker.record_incoming(dev, boot, 4, now=t0 + 1.0)  # Missing 2, 3

    # Trong cửa sổ late_window (t0 + 5.0)
    stats_within = tracker.get_stats(stored_count=2, device_id=dev, now=t0 + 5.0)
    assert stats_within["missing_packets_pending"] == 2
    assert stats_within["unresolved_gaps_beyond_window"] == 0
    assert stats_within["missing_packets_confirmed"] == 0

    # Sau cửa sổ late_window (t0 + 15.0): Chưa nhận -> unresolved beyond window
    stats_beyond = tracker.get_stats(stored_count=2, device_id=dev, now=t0 + 15.0)
    assert stats_beyond["missing_packets_pending"] == 0
    assert stats_beyond["unresolved_gaps_beyond_window"] == 2
    assert stats_beyond["missing_packets_confirmed"] == 2

    # Gói 2 đến muộn lúc t0 + 20.0 (late arrival ngoài cửa sổ trễ)
    res = tracker.record_incoming(dev, boot, 2, now=t0 + 20.0)
    assert res.is_out_of_order is True
    assert res.stored is True

    stats_after_late = tracker.get_stats(stored_count=3, device_id=dev, now=t0 + 21.0)
    assert stats_after_late["out_of_order_count"] == 1
    assert stats_after_late["unresolved_gaps_beyond_window"] == 1


# ==============================================================================
# 19. Test Huge Sequence Gap (50,000 & 100,000,000) Không OOM & Late Arrival
# ==============================================================================
def test_huge_sequence_gap_no_oom_and_late_arrival():
    tracker = ReliabilityTracker(late_window_s=10.0)
    dev = "esp32-huge"
    boot = "boot-huge"

    t0 = 1000.0
    tracker.record_incoming(dev, boot, 1, now=t0)

    # 1. Gap 50,000: seq nhảy từ 1 lên 50,002 (thiếu 50,000 gói từ 2 đến 50,001)
    res_50k = tracker.record_incoming(dev, boot, 50002, now=t0 + 1.0)
    assert res_50k.is_gap is True
    assert res_50k.gap_count == 50000

    stats_50k = tracker.get_stats(stored_count=2, device_id=dev, now=t0 + 2.0)
    assert stats_50k["gaps_count"] == 1
    assert stats_50k["missing_packets_pending"] == 50000

    # Gói đến muộn trong gap 50k: seq=500 đến muộn
    res_late = tracker.record_incoming(dev, boot, 500, now=t0 + 3.0)
    assert res_late.is_out_of_order is True
    assert res_late.resolved_gap_seq == 500

    stats_after_late = tracker.get_stats(stored_count=3, device_id=dev, now=t0 + 4.0)
    assert stats_after_late["missing_packets_pending"] == 49999

    # 2. Gap 100,000,000 (100 triệu gói): seq nhảy từ 50,002 lên 100,050,003
    # Phải thực thi ngay lập tức O(1) mà KHÔNG gây OOM MemoryError!
    res_100m = tracker.record_incoming(dev, boot, 100050003, now=t0 + 5.0)
    assert res_100m.is_gap is True
    assert res_100m.gap_count == 100000000

    stats_100m = tracker.get_stats(stored_count=4, device_id=dev, now=t0 + 6.0)
    assert stats_100m["gaps_count"] == 2
    assert stats_100m["missing_packets_pending"] == 49999 + 100000000

    # 3. Sau khi quá cửa sổ late_window_s (10s) -> chuyển thành unresolved_gaps_beyond_window
    stats_expired = tracker.get_stats(stored_count=4, device_id=dev, now=t0 + 20.0)
    assert stats_expired["missing_packets_pending"] == 0
    assert stats_expired["unresolved_gaps_beyond_window"] == 49999 + 100000000


# ==============================================================================
# 20. Test Restart Duplicate Với seq == max_seq Không Sinh Gap Rác
# ==============================================================================
def test_restart_duplicate_seq_equals_max_seq_no_garbage_gap(postgres_storage):
    dev = "esp32-restart-exact"
    boot = "boot-exact"

    # Lưu gói seq=1 và seq=5 vào PostgreSQL
    postgres_storage.save_telemetry(tel(100.0, 26.0, device_id=dev, boot_id=boot, seq=1))
    postgres_storage.save_telemetry(tel(102.0, 27.0, device_id=dev, boot_id=boot, seq=5))

    # Restart backend: đóng và mở storage instance mới
    postgres_storage.close()
    from app.pg_storage import PostgresStorage
    new_storage = PostgresStorage(URL)

    # Nhận lại đúng seq=5 (bằng chính max_seq đã lưu trước restart)
    saved = new_storage.save_telemetry(tel(102.0, 27.0, device_id=dev, boot_id=boot, seq=5))
    assert saved is False  # Bị phát hiện duplicate và từ chối lưu

    stats = new_storage.reliability_stats(device_id=dev)
    assert stats["duplicate_count"] == 1
    # Tuyệt đối không sinh gap rác có count=0 hay from_seq > to_seq!
    assert stats["gaps_count"] == 0
    assert len(stats["gap_events"]) == 0
    assert stats["missing_packets_pending"] == 0
    new_storage.close()


# ==============================================================================
# 21. Test Revert Incoming Tính Nguyên Tử Khi DB Thất Bại
# ==============================================================================
def test_revert_incoming_atomicity_and_received_semantics():
    tracker = ReliabilityTracker()
    dev = "esp32-atom"
    boot = "boot-atom"

    # Nhận seq=1 thành công
    res1 = tracker.record_incoming(dev, boot, 1, now=100.0)
    assert tracker._session_max_seq[(dev, boot)] == 1
    assert tracker._received_count == 1

    # Nhận seq=4 (tạo gap 2, 3), nhưng giả lập DB INSERT thất bại (ném Exception)
    res4 = tracker.record_incoming(dev, boot, 4, now=102.0)
    assert tracker._session_max_seq[(dev, boot)] == 4
    assert tracker._received_count == 2
    assert tracker._total_gap_events_count == 1
    assert len(tracker._pending_gap_intervals) == 1

    # Gọi revert_incoming do DB rollback
    tracker.revert_incoming(dev, boot, 4, res4)

    # 1. received_count KHÔNG giảm vì bản tin thực tế đã nhận tại tầng mạng
    assert tracker._received_count == 2

    # 2. max_seq được hoàn lại về 1 (trước khi nhận seq=4)
    assert tracker._session_max_seq[(dev, boot)] == 1

    # 3. Gap rác do gói lỗi tạo ra được hủy bỏ
    assert tracker._total_gap_events_count == 0
    assert len(tracker._pending_gap_intervals) == 0

    # 4. Khi DB phục hồi, gửi lại seq=4 -> được tiếp nhận bình thường, không bị coi là duplicate
    res4_retry = tracker.record_incoming(dev, boot, 4, now=104.0)
    assert res4_retry.is_duplicate is False
    assert res4_retry.stored is True


# ==============================================================================
# 22. Test Reliability Stats Phân Tách Theo Device ID & Time Scope
# ==============================================================================
def test_reliability_stats_device_scoping_and_time_scope():
    tracker = ReliabilityTracker()

    # Thiết bị Alpha: 10 gói, 2 duplicate, 1 out-of-order
    for s in [1, 2, 2, 4, 3, 5, 6, 7, 7, 8]:
        tracker.record_incoming("dev-alpha", "boot-a", s)

    # Thiết bị Beta: 5 gói, 0 duplicate, 0 out-of-order
    for s in [1, 2, 3, 4, 5]:
        tracker.record_incoming("dev-beta", "boot-b", s)

    # Lọc theo dev-alpha: chỉ thấy số liệu của dev-alpha
    stats_alpha = tracker.get_stats(stored_count=7, device_id="dev-alpha")
    assert stats_alpha["received_count"] == 10
    assert stats_alpha["duplicate_count"] == 2
    assert stats_alpha["out_of_order_count"] == 1
    assert stats_alpha["boot_count"] == 1

    # Lọc theo dev-beta: chỉ thấy số liệu của dev-beta
    stats_beta = tracker.get_stats(stored_count=5, device_id="dev-beta")
    assert stats_beta["received_count"] == 5
    assert stats_beta["duplicate_count"] == 0
    assert stats_beta["out_of_order_count"] == 0
    assert stats_beta["boot_count"] == 1

    # Truy vấn có start và end -> trả về thông tin phạm vi đo lường rõ ràng
    stats_window = tracker.get_stats(stored_count=5, device_id="dev-alpha", start=100.0, end=200.0)
    assert stats_window["runtime_scope"] == "process_lifetime"
    assert stats_window["query_window"] == {"start": 100.0, "end": 200.0}
    assert "stored_count is filtered by [start, end]" in stats_window["scope_note"]


# ==============================================================================
# 23. Test Bounded Memory Với Hàng Trăm Boot Sessions (Session Eviction)
# ==============================================================================
def test_bounded_memory_many_boot_sessions_lru():
    tracker = ReliabilityTracker(max_sessions=100)
    dev = "esp32-many-boots"

    # Thiết bị liên tục reboot 250 lần sinh 250 boot_ids khác nhau
    for i in range(250):
        boot = f"boot-{i}"
        tracker.record_incoming(dev, boot, 1, now=1000.0 + i)

    # Tổng số session theo dõi trong RAM không bao giờ vượt quá max_sessions (100)
    assert len(tracker._session_last_active) <= 100
    assert len(tracker._session_max_seq) <= 100

    # Session mới nhất (boot-249) vẫn còn và hoạt động chuẩn xác
    assert tracker._session_max_seq.get((dev, "boot-249")) == 1


# ==============================================================================
# 24. Test Service.on_event Không Bị Sập Khi PostgreSQL Lỗi
# ==============================================================================
def test_service_on_event_does_not_crash_when_db_fails():
    clock = FakeClock(100.0)
    emitted_events = []

    class EventFailingStorage(InMemoryStorage):
        def save_event(self, rec: dict) -> None:
            raise RuntimeError("PostgreSQL connection lost")

    storage = EventFailingStorage()
    svc = Service(
        Settings := type("S", (), {"offline_timeout_s": 10.0, "cmd_timeout_s": 5.0})(),
        storage,
        FakePublisher(),
        clock=clock,
        broadcast=lambda msg: emitted_events.append(msg),
    )

    # Gửi event khi DB lỗi: không ném ngoại lệ làm sập MQTT handler
    success = svc.on_event({
        "type": "heat_alarm",
        "state": "start",
        "value": 45.0,
        "uptime_ms": 10000,
    })
    assert success is True

    # WebSocket broadcast realtime sự kiện vẫn hoạt động bình thường
    assert len(emitted_events) == 1
    assert emitted_events[0]["kind"] == "event"
    assert emitted_events[0]["data"]["type"] == "heat_alarm"


# ==============================================================================
# 25. Test Bounded Memory Khi Tất Cả Sessions Đều Có Pending Gaps
# ==============================================================================
def test_bounded_memory_all_sessions_have_pending_gaps():
    """Kiểm tra giới hạn bộ nhớ nghiêm ngặt ngay cả khi tất cả sessions đều có pending gaps.

    Khi số lượng session vượt max_sessions, session cũ nhất bị evict phải được dọn sạch
    khỏi RAM (kể cả pending gap intervals của nó), và missing packets của nó được kết
    chuyển an toàn vào unresolved counters.
    """
    tracker = ReliabilityTracker(max_sessions=10)
    dev = "esp32-gap-storm"

    # Tạo 25 sessions liên tiếp, mỗi session đều sinh 1 pending gap [2, 9] (8 missing packets)
    for i in range(25):
        boot = f"boot-{i}"
        tracker.record_incoming(dev, boot, 1, now=1000.0 + i * 2)
        tracker.record_incoming(dev, boot, 10, now=1001.0 + i * 2)

    # 1. Số sessions trong RAM bị chặn cứng ở mức tối đa 10
    assert len(tracker._session_last_active) <= 10
    assert len(tracker._session_max_seq) <= 10

    # 2. Số pending gap intervals trong RAM cũng không bị rò rỉ từ 15 sessions đã bị evict
    assert len(tracker._pending_gap_intervals) <= 10

    # 3. 15 sessions cũ nhất (từ boot-0 đến boot-14) đã bị evict:
    # 15 sessions * 8 missing packets = 120 missing packets phải được kết chuyển sang unresolved
    assert tracker._unresolved_beyond_window_count == 15 * 8
    assert tracker._unresolved_beyond_window_by_device[dev] == 15 * 8

    # 4. Khi lấy stats, tổng số missing packets confirmed phản ánh đúng các sessions bị evict
    stats = tracker.get_stats(stored_count=50, device_id=dev, now=1100.0)
    assert stats["missing_packets_confirmed"] >= 120
    assert stats["boot_count"] <= 10


# ==============================================================================
# 26. Test Hard Cap Cưỡng Chế Khi Bị Bão Interval Fragmentation
# ==============================================================================
def test_interval_fragmentation_hard_cap():
    """Kiểm tra hard cap cưỡng chế khi số gap intervals vượt trần cho phép do phân mảnh."""
    # Đặt max_pending_gap_intervals = 5
    tracker = ReliabilityTracker(max_sessions=50, max_pending_gap_intervals=5)
    dev = "esp32-fragmentation"
    boot = "boot-frag-1"

    # Gửi seq=1 và seq=100 -> tạo 1 gap lớn [2, 99] (98 missing packets)
    tracker.record_incoming(dev, boot, 1, now=1000.0)
    tracker.record_incoming(dev, boot, 100, now=1001.0)
    assert len(tracker._pending_gap_intervals) == 1

    # Gửi các late arrival rời rạc cắt nhỏ interval: 10, 20, 30, 40, 50, 60
    # Mỗi lần cắt sẽ chia đôi interval, làm bùng nổ số lượng intervals
    for late_seq in [10, 20, 30, 40, 50, 60, 70, 80]:
        tracker.record_incoming(dev, boot, late_seq, now=1002.0)

    # Số lượng intervals trong RAM bị chặn cứng không vượt quá trần 5
    assert len(tracker._pending_gap_intervals) <= 5

    # Tổng missing packets của các intervals bị đẩy ra khỏi trần được bảo toàn vào unresolved
    assert tracker._unresolved_beyond_window_count > 0

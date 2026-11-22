import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class IngestResult:
    stored: bool
    is_duplicate: bool
    is_out_of_order: bool
    is_gap: bool
    missing_seqs: list[int] = field(default_factory=list)


class ReliabilityTracker:
    """Theo dõi độ tin cậy telemetry: duplicate, out-of-order, sequence gaps.

    Đặc tính kỹ thuật:
    - Thread-safe: Toàn bộ thao tác cập nhật và đọc chỉ số được bảo vệ bằng RLock.
    - Giới hạn bộ nhớ (Bounded Memory):
      + Sliding window giới hạn W sequences gần nhất cho mỗi session.
      + Giới hạn tối đa MAX_GAP_EVENTS sự kiện gap trong RAM.
      + Tự động dọn dẹp pending gaps quá hạn, chuyển sang bộ đếm tích lũy unresolved_gaps_beyond_window.
    - Cửa sổ quan sát (Observation Window):
      + Gap mới phát hiện được xếp vào missing_packets_pending.
      + Sau late_window_s nếu chưa được bù đắp sẽ phân loại thành unresolved_gaps_beyond_window.
      + Không gọi là mất gói vĩnh viễn (permanently lost) vì gói tin đến muộn (late arrival)
        vẫn được ghi nhận và đối soát chính xác.
    - Nhất quán sau restart:
      + Phối hợp với PostgreSQL partial unique index để phân biệt chính xác giữa duplicate cũ
        và out-of-order, không đếm đúp.
      + Cho phép hoàn lại trạng thái (revert) nếu transaction lưu database thất bại.
    """

    def __init__(self, late_window_s: float = 10.0, max_seen_history: int = 5000,
                 max_gap_events: int = 1000, max_pending_gaps: int = 5000):
        self.late_window_s = late_window_s
        self.max_seen_history = max_seen_history
        self.max_gap_events = max_gap_events
        self.max_pending_gaps = max_pending_gaps

        self._lock = threading.RLock()
        self._received_count: int = 0
        self._duplicate_count: int = 0
        self._out_of_order_count: int = 0
        self._unresolved_beyond_window_count: int = 0
        self._total_gap_events_count: int = 0

        # (device_id, boot_id) -> max sequence number seen so far
        self._session_max_seq: dict[tuple[Optional[str], Optional[str]], int] = {}
        # (device_id, boot_id) -> set of seen sequence numbers (bounded by sliding window)
        self._session_seen_seqs: dict[tuple[Optional[str], Optional[str]], set[int]] = {}
        # (device_id, boot_id) -> deque of seen sequence numbers for FIFO eviction
        self._session_seen_deque: dict[tuple[Optional[str], Optional[str]], deque[int]] = {}
        # (device_id, boot_id, missing_seq) -> timestamp detected
        self._pending_gaps: dict[tuple[Optional[str], Optional[str], int], float] = {}
        # Danh sách sự kiện gap giới hạn trần (ring buffer)
        self._gap_events: deque = deque(maxlen=max_gap_events)

    def init_session(self, device_id: Optional[str], boot_id: Optional[str],
                     max_seq: Optional[int]) -> None:
        """Nạp lại trạng thái session từ database sau khi restart."""
        with self._lock:
            key = (device_id, boot_id)
            if max_seq is not None:
                self._session_max_seq[key] = max_seq

    def _mark_seen(self, key: tuple[Optional[str], Optional[str]], seq: int) -> None:
        """Thêm sequence vào sliding window có giới hạn dung lượng."""
        seen_set = self._session_seen_seqs.setdefault(key, set())
        seen_deq = self._session_seen_deque.setdefault(key, deque())

        if seq not in seen_set:
            seen_set.add(seq)
            seen_deq.append(seq)
            if len(seen_deq) > self.max_seen_history:
                oldest = seen_deq.popleft()
                seen_set.discard(oldest)

    def _cleanup_pending_gaps_if_needed(self, now: float) -> None:
        """Thu gom các gap quá hạn nếu số lượng pending gaps vượt ngưỡng an toàn."""
        if len(self._pending_gaps) <= self.max_pending_gaps:
            return

        to_evict = []
        for gap_key, det_time in self._pending_gaps.items():
            if now - det_time > self.late_window_s:
                to_evict.append(gap_key)
                if len(self._pending_gaps) - len(to_evict) <= self.max_pending_gaps:
                    break

        for k in to_evict:
            del self._pending_gaps[k]
            self._unresolved_beyond_window_count += 1

    def record_incoming(self, device_id: Optional[str], boot_id: Optional[str],
                        seq: Optional[int], now: Optional[float] = None) -> IngestResult:
        """Phân tích bản tin telemetry trước khi lưu vào database."""
        with self._lock:
            self._received_count += 1
            current_time = time.time() if now is None else now

            # Legacy data: không có boot_id hoặc seq -> coi là hợp lệ, không phân tích seq
            if boot_id is None or seq is None:
                return IngestResult(
                    stored=True,
                    is_duplicate=False,
                    is_out_of_order=False,
                    is_gap=False,
                )

            key = (device_id, boot_id)
            seen = self._session_seen_seqs.setdefault(key, set())

            # 1. Duplicate detection trong sliding window RAM
            if seq in seen:
                self._duplicate_count += 1
                return IngestResult(
                    stored=False,
                    is_duplicate=True,
                    is_out_of_order=False,
                    is_gap=False,
                )

            self._mark_seen(key, seq)

            # 2. Sequence order & gap analysis
            max_seq = self._session_max_seq.get(key)
            if max_seq is None:
                # Gói đầu tiên quan sát được của session
                self._session_max_seq[key] = seq
                return IngestResult(
                    stored=True,
                    is_duplicate=False,
                    is_out_of_order=False,
                    is_gap=False,
                )

            if seq < max_seq:
                # OUT-OF-ORDER (Late arrival)
                self._out_of_order_count += 1
                gap_key = (device_id, boot_id, seq)
                if gap_key in self._pending_gaps:
                    # Gói đến muộn đã bù đắp gap thành công!
                    del self._pending_gaps[gap_key]
                return IngestResult(
                    stored=True,
                    is_duplicate=False,
                    is_out_of_order=True,
                    is_gap=False,
                )

            if seq == max_seq + 1:
                # Tuần tự hoàn hảo
                self._session_max_seq[key] = seq
                return IngestResult(
                    stored=True,
                    is_duplicate=False,
                    is_out_of_order=False,
                    is_gap=False,
                )

            # seq > max_seq + 1: PHÁT HIỆN GAP MỚI
            missing = list(range(max_seq + 1, seq))
            for m in missing:
                self._pending_gaps[(device_id, boot_id, m)] = current_time

            self._cleanup_pending_gaps_if_needed(current_time)

            gap_event = {
                "device_id": device_id,
                "boot_id": boot_id,
                "from_seq": max_seq + 1,
                "to_seq": seq - 1,
                "count": len(missing),
                "detected_at": current_time,
            }
            self._gap_events.append(gap_event)
            self._total_gap_events_count += 1
            self._session_max_seq[key] = seq

            return IngestResult(
                stored=True,
                is_duplicate=False,
                is_out_of_order=False,
                is_gap=True,
                missing_seqs=missing,
            )

    def record_db_duplicate(self, device_id: Optional[str], boot_id: Optional[str],
                            seq: Optional[int], was_out_of_order: bool = False) -> None:
        """Ghi nhận duplicate khi PostgreSQL trả về xung đột (ON CONFLICT DO NOTHING).

        Trường hợp đặc biệt: Sau khi backend restart, seen_seqs trong RAM còn rỗng nhưng
        database đã có bản ghi. Bản tin nhận lại có seq < max_seq nên tracker ban đầu
        nghi ngờ là out-of-order. Khi Postgres xác nhận bản ghi đã tồn tại, phương thức
        này sẽ tăng duplicate_count và triệt tiêu out_of_order_count để không bị đếm đúp.
        """
        with self._lock:
            self._duplicate_count += 1
            if was_out_of_order and self._out_of_order_count > 0:
                self._out_of_order_count -= 1
            if boot_id is not None and seq is not None:
                self._mark_seen((device_id, boot_id), seq)

    def revert_incoming(self, device_id: Optional[str], boot_id: Optional[str],
                        seq: Optional[int], ingest_result: IngestResult) -> None:
        """Hủy bỏ cập nhật tracker nếu thao tác ghi database thất bại hoàn toàn."""
        with self._lock:
            if self._received_count > 0:
                self._received_count -= 1

            if ingest_result.is_duplicate:
                if self._duplicate_count > 0:
                    self._duplicate_count -= 1
                return

            if ingest_result.is_out_of_order:
                if self._out_of_order_count > 0:
                    self._out_of_order_count -= 1

            if boot_id is not None and seq is not None:
                key = (device_id, boot_id)
                if key in self._session_seen_seqs:
                    self._session_seen_seqs[key].discard(seq)

    def get_stats(self, stored_count: int, device_id: Optional[str] = None,
                  now: Optional[float] = None) -> dict:
        """Tổng hợp các chỉ số reliability có thể kiểm chứng."""
        with self._lock:
            current_time = time.time() if now is None else now
            pending = 0
            confirmed = self._unresolved_beyond_window_count

            for (dev, _, _), det_time in self._pending_gaps.items():
                if device_id is not None and dev != device_id:
                    continue
                if current_time - det_time <= self.late_window_s:
                    pending += 1
                else:
                    confirmed += 1

            boot_ids = {
                b for (d, b) in self._session_max_seq.keys()
                if b is not None and (device_id is None or d == device_id)
            }

            gap_events = [
                g for g in self._gap_events
                if device_id is None or g.get("device_id") == device_id
            ]

            return {
                "received_count": self._received_count,
                "stored_count": stored_count,
                "duplicate_count": self._duplicate_count,
                "out_of_order_count": self._out_of_order_count,
                "gaps_count": self._total_gap_events_count,
                "missing_packets_pending": pending,
                "missing_packets_confirmed": confirmed,
                "unresolved_gaps_beyond_window": confirmed,
                "boot_count": len(boot_ids),
                "late_window_s": self.late_window_s,
                # Tuyệt đối không tự suy đoán delivery rate khi chưa có bộ đếm phát từ ESP32
                "delivery_rate": None,
                "delivery_rate_note": "Chua co bo dem phat (tx_count) tu firmware ESP32 - khong tu tien suy doan delivery rate",
                "gap_events": gap_events,
            }

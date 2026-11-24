import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class IngestResult:
    stored: bool
    is_duplicate: bool
    is_out_of_order: bool
    is_gap: bool
    missing_seqs: list[int] = field(default_factory=list)
    gap_count: int = 0
    prev_max_seq: Optional[int] = None
    created_gap_interval: Optional[tuple[int, int]] = None
    resolved_gap_seq: Optional[int] = None


class ReliabilityTracker:
    """Theo dõi độ tin cậy telemetry: duplicate, out-of-order, sequence gaps.

    Đặc tính kỹ thuật & Khả năng chịu lỗi:
    - Thread-safe: Toàn bộ thao tác cập nhật và đọc chỉ số được bảo vệ bằng threading.RLock.
    - Chống OOM khi Sequence Gap cực lớn (Large Gap Protection):
      + Quản lý pending gaps theo cấu trúc khoảng (interval-based: start_seq..end_seq).
      + Khi seq nhảy đột biến (ví dụ 50,000 hay 100,000,000), bộ nhớ chỉ tiêu tốn O(1)
        thay vì cấp phát mảng hàng triệu phần tử.
      + Không làm sai lệch số lượng missing packets và bảo toàn khả năng đối soát late-arrival.
    - Giới hạn bộ nhớ Bounded Memory:
      + Sliding window giới hạn W sequences gần nhất cho mỗi session.
      + Giới hạn tối đa MAX_GAP_EVENTS sự kiện gap trong RAM (Ring Buffer).
      + Giới hạn tối đa MAX_SESSIONS phiên hoạt động gần nhất (LRU eviction cho session cũ).
      + Tự động dọn dẹp các gap intervals quá hạn, chuyển sang bộ đếm tích lũy unresolved_gaps_beyond_window.
    - Nhất quán sau restart:
      + Phối hợp với PostgreSQL partial unique index để phân biệt chính xác giữa duplicate cũ
        và out-of-order.
      + Xử lý chính xác trường hợp seq == max_seq sau restart mà không tạo gap event rác.
      + Ngữ nghĩa revert_incoming nguyên tử: giữ nguyên received_count (vì bản tin đã nhận thật),
        hoàn lại max_seq, gap intervals và seen_seq nếu thao tác ghi DB thất bại.
    - Tách biệt phạm vi thống kê theo device_id:
      + Quản lý counters riêng biệt cho từng device_id.
      + Phân biệt rõ ràng giữa Runtime Counters (vòng đời process hiện tại) và Persisted Count (lưu bền DB).
    """

    def __init__(self, late_window_s: float = 10.0, max_seen_history: int = 5000,
                 max_gap_events: int = 1000, max_pending_gap_intervals: int = 2000,
                 max_sessions: int = 500, max_pending_gaps: Optional[int] = None):
        self.late_window_s = late_window_s
        self.max_seen_history = max_seen_history
        self.max_gap_events = max_gap_events
        self.max_pending_gap_intervals = max_pending_gaps if max_pending_gaps is not None else max_pending_gap_intervals
        self.max_sessions = max_sessions

        self._lock = threading.RLock()

        # Toàn cục
        self._received_count: int = 0
        self._received_unique_count: int = 0
        self._duplicate_count: int = 0
        self._out_of_order_count: int = 0
        self._unresolved_beyond_window_count: int = 0
        self._total_gap_events_count: int = 0

        # Phân theo device_id
        self._received_by_device: dict[Optional[str], int] = defaultdict(int)
        self._received_unique_by_device: dict[Optional[str], int] = defaultdict(int)
        self._duplicate_by_device: dict[Optional[str], int] = defaultdict(int)
        self._out_of_order_by_device: dict[Optional[str], int] = defaultdict(int)
        self._gap_events_count_by_device: dict[Optional[str], int] = defaultdict(int)
        self._unresolved_beyond_window_by_device: dict[Optional[str], int] = defaultdict(int)

        # (device_id, boot_id) -> số bản tin unique nhận được tại process
        self._received_unique_by_session: dict[tuple[Optional[str], Optional[str]], int] = defaultdict(int)
        # (device_id, boot_id) -> max sequence number seen so far
        self._session_max_seq: dict[tuple[Optional[str], Optional[str]], int] = {}
        # (device_id, boot_id) -> max tx_count seen so far
        self._session_max_tx_count: dict[tuple[Optional[str], Optional[str]], int] = {}
        # (device_id, boot_id) -> min tx_count seen so far
        self._session_min_tx_count: dict[tuple[Optional[str], Optional[str]], int] = {}
        # (device_id, boot_id) -> set of seen sequence numbers (bounded by sliding window)
        self._session_seen_seqs: dict[tuple[Optional[str], Optional[str]], set[int]] = {}
        # (device_id, boot_id) -> deque of seen sequence numbers for FIFO eviction
        self._session_seen_deque: dict[tuple[Optional[str], Optional[str]], deque[int]] = {}
        # (device_id, boot_id) -> timestamp hoạt động gần nhất
        self._session_last_active: dict[tuple[Optional[str], Optional[str]], float] = {}

        # Danh sách pending gap intervals: mỗi phần tử là dict:
        # {"device_id": ..., "boot_id": ..., "start_seq": ..., "end_seq": ..., "detected_at": ...}
        self._pending_gap_intervals: list[dict] = []

        # Danh sách sự kiện gap giới hạn trần (ring buffer)
        self._gap_events: deque = deque(maxlen=max_gap_events)

    @property
    def _pending_gaps(self) -> dict:
        """Alias tương thích ngược cho các test/caller cần tra cứu gap mapping."""
        with self._lock:
            res = {}
            for interval in self._pending_gap_intervals:
                dev = interval["device_id"]
                boot = interval["boot_id"]
                det = interval["detected_at"]
                # Cắt trần an toàn để không tốn RAM nếu gap cực lớn
                end = min(interval["end_seq"], interval["start_seq"] + 500)
                for s in range(interval["start_seq"], end + 1):
                    res[(dev, boot, s)] = det
            return res

    def init_session(self, device_id: Optional[str], boot_id: Optional[str],
                     max_seq: Optional[int], max_tx_count: Optional[int] = None,
                     received_unique: Optional[int] = None) -> None:
        """Nạp lại trạng thái session từ database sau khi restart."""
        with self._lock:
            key = (device_id, boot_id)
            if max_seq is not None:
                self._session_max_seq[key] = max_seq
                self._session_last_active[key] = time.time()
                self._evict_oldest_session_if_needed()
            if max_tx_count is not None and max_tx_count > 0:
                self._session_max_tx_count[key] = max_tx_count
            if received_unique is not None and received_unique > 0:
                diff = received_unique - self._received_unique_by_session.get(key, 0)
                if diff > 0:
                    self._received_unique_by_session[key] = received_unique
                    self._received_unique_count += diff
                    if device_id:
                        self._received_unique_by_device[device_id] += diff

    def _evict_oldest_session_if_needed(self) -> None:
        """Giới hạn số lượng session theo dõi trong RAM (LRU eviction)."""
        while len(self._session_last_active) > self.max_sessions:
            oldest_key = min(self._session_last_active.keys(), key=lambda k: self._session_last_active[k])
            self._session_last_active.pop(oldest_key, None)
            self._session_max_seq.pop(oldest_key, None)
            self._session_max_tx_count.pop(oldest_key, None)
            self._session_min_tx_count.pop(oldest_key, None)
            self._received_unique_by_session.pop(oldest_key, None)
            self._session_seen_seqs.pop(oldest_key, None)
            self._session_seen_deque.pop(oldest_key, None)

            # Dọn sạch các pending gap intervals của session bị evict
            # để đảm bảo không rò rỉ RAM từ các session cũ không còn hoạt động.
            # Số gói missing của session này được chuyển an toàn sang unresolved counter.
            dev, boot = oldest_key
            retained: list[dict] = []
            for interval in self._pending_gap_intervals:
                if interval.get("device_id") == dev and interval.get("boot_id") == boot:
                    missing_count = interval["end_seq"] - interval["start_seq"] + 1
                    self._unresolved_beyond_window_count += missing_count
                    self._unresolved_beyond_window_by_device[dev] += missing_count
                else:
                    retained.append(interval)
            self._pending_gap_intervals = retained

    def _mark_seen(self, key: tuple[Optional[str], Optional[str]], seq: int, now: float) -> None:
        """Thêm sequence vào sliding window có giới hạn dung lượng."""
        self._session_last_active[key] = now
        self._evict_oldest_session_if_needed()

        seen_set = self._session_seen_seqs.setdefault(key, set())
        seen_deq = self._session_seen_deque.setdefault(key, deque())

        if seq not in seen_set:
            seen_set.add(seq)
            seen_deq.append(seq)
            if len(seen_deq) > self.max_seen_history:
                oldest = seen_deq.popleft()
                seen_set.discard(oldest)

    def _cleanup_pending_gaps_if_needed(self, now: float) -> None:
        """Thu gom các gap intervals quá hạn hoặc vượt trần an toàn (Hard Cap)."""
        if len(self._pending_gap_intervals) <= self.max_pending_gap_intervals:
            return

        # 1. Thu hồi các intervals đã quá hạn late_window_s
        retained: list[dict] = []
        for interval in self._pending_gap_intervals:
            if now - interval["detected_at"] > self.late_window_s:
                missing_count = interval["end_seq"] - interval["start_seq"] + 1
                dev = interval.get("device_id")
                self._unresolved_beyond_window_count += missing_count
                self._unresolved_beyond_window_by_device[dev] += missing_count
            else:
                retained.append(interval)

        # 2. Hard Cap cưỡng chế: Nếu sau khi lọc thời gian mà số lượng intervals vẫn vượt
        # max_pending_gap_intervals (ví dụ: bị bão late arrivals phân mảnh cực mạnh trong thời gian ngắn),
        # giải phóng các intervals cũ nhất để bảo vệ RAM tuyệt đối không tăng vô hạn.
        if len(retained) > self.max_pending_gap_intervals:
            retained.sort(key=lambda x: x["detected_at"])
            overflow_count = len(retained) - self.max_pending_gap_intervals
            for i in range(overflow_count):
                inv = retained[i]
                missing_count = inv["end_seq"] - inv["start_seq"] + 1
                dev = inv.get("device_id")
                self._unresolved_beyond_window_count += missing_count
                self._unresolved_beyond_window_by_device[dev] += missing_count
            retained = retained[overflow_count:]

        self._pending_gap_intervals = retained

    def _resolve_gap_interval(self, device_id: Optional[str], boot_id: Optional[str],
                              seq: int) -> bool:
        """Kiểm tra và bù đắp một sequence đến muộn vào pending gap intervals.

        Trả về True nếu gói tin này đã bù đắp thành công một gap interval.
        """
        for i, interval in enumerate(self._pending_gap_intervals):
            if interval["device_id"] == device_id and interval["boot_id"] == boot_id:
                start_seq = interval["start_seq"]
                end_seq = interval["end_seq"]
                if start_seq <= seq <= end_seq:
                    if start_seq == end_seq:
                        # Gap đúng 1 gói: xóa bỏ interval
                        self._pending_gap_intervals.pop(i)
                    elif seq == start_seq:
                        # Thu hẹp đầu khoảng
                        interval["start_seq"] = seq + 1
                    elif seq == end_seq:
                        # Thu hẹp cuối khoảng
                        interval["end_seq"] = seq - 1
                    else:
                        # Tách interval thành 2 khoảng: [start, seq-1] và [seq+1, end]
                        det_at = interval["detected_at"]
                        interval["end_seq"] = seq - 1
                        new_interval = {
                            "device_id": device_id,
                            "boot_id": boot_id,
                            "start_seq": seq + 1,
                            "end_seq": end_seq,
                            "detected_at": det_at,
                        }
                        self._pending_gap_intervals.append(new_interval)
                        self._cleanup_pending_gaps_if_needed(time.time())
                    return True
        return False

    def record_incoming(self, device_id: Optional[str], boot_id: Optional[str],
                        seq: Optional[int], tx_count: Optional[int] = None,
                        now: Optional[float] = None) -> IngestResult:
        """Phân tích bản tin telemetry trước khi lưu vào database."""
        with self._lock:
            current_time = time.time() if now is None else now
            self._received_count += 1
            self._received_by_device[device_id] += 1

            if tx_count is not None and tx_count < 0:
                raise ValueError("tx_count must be non-negative")

            # Legacy data: không có boot_id hoặc seq -> coi là hợp lệ, không phân tích seq
            if boot_id is None or seq is None:
                self._received_unique_count += 1
                self._received_unique_by_device[device_id] += 1
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
                self._duplicate_by_device[device_id] += 1
                return IngestResult(
                    stored=False,
                    is_duplicate=True,
                    is_out_of_order=False,
                    is_gap=False,
                )

            max_seq = self._session_max_seq.get(key)

            # 2. Xử lý trường hợp seq == max_seq khi vừa restart (seen còn rỗng)
            if max_seq is not None and seq == max_seq:
                self._duplicate_count += 1
                self._duplicate_by_device[device_id] += 1
                self._mark_seen(key, seq, current_time)
                return IngestResult(
                    stored=False,
                    is_duplicate=True,
                    is_out_of_order=False,
                    is_gap=False,
                )

            # Bản tin hợp lệ và duy nhất (unique)
            self._received_unique_count += 1
            self._received_unique_by_device[device_id] += 1
            self._received_unique_by_session[key] += 1

            if tx_count is not None and tx_count > 0:
                self._session_max_tx_count[key] = max(self._session_max_tx_count.get(key, 0), tx_count)
                if key not in self._session_min_tx_count:
                    self._session_min_tx_count[key] = tx_count
                else:
                    self._session_min_tx_count[key] = min(self._session_min_tx_count[key], tx_count)

            self._mark_seen(key, seq, current_time)

            # 3. Sequence order & gap analysis
            if max_seq is None:
                # Gói đầu tiên quan sát được của session
                self._session_max_seq[key] = seq
                return IngestResult(
                    stored=True,
                    is_duplicate=False,
                    is_out_of_order=False,
                    is_gap=False,
                    prev_max_seq=None,
                )

            if seq < max_seq:
                # OUT-OF-ORDER (Late arrival)
                self._out_of_order_count += 1
                self._out_of_order_by_device[device_id] += 1
                resolved = self._resolve_gap_interval(device_id, boot_id, seq)
                return IngestResult(
                    stored=True,
                    is_duplicate=False,
                    is_out_of_order=True,
                    is_gap=False,
                    resolved_gap_seq=seq if resolved else None,
                    prev_max_seq=max_seq,
                )

            if seq == max_seq + 1:
                # Tuần tự hoàn hảo
                self._session_max_seq[key] = seq
                return IngestResult(
                    stored=True,
                    is_duplicate=False,
                    is_out_of_order=False,
                    is_gap=False,
                    prev_max_seq=max_seq,
                )

            # seq > max_seq + 1: PHÁT HIỆN GAP MỚI (Interval-based: Không OOM kể cả gap hàng triệu gói)
            gap_start = max_seq + 1
            gap_end = seq - 1
            gap_count = gap_end - gap_start + 1

            new_interval = {
                "device_id": device_id,
                "boot_id": boot_id,
                "start_seq": gap_start,
                "end_seq": gap_end,
                "detected_at": current_time,
            }
            self._pending_gap_intervals.append(new_interval)
            self._cleanup_pending_gaps_if_needed(current_time)

            gap_event = {
                "device_id": device_id,
                "boot_id": boot_id,
                "from_seq": gap_start,
                "to_seq": gap_end,
                "count": gap_count,
                "detected_at": current_time,
            }
            self._gap_events.append(gap_event)
            self._total_gap_events_count += 1
            self._gap_events_count_by_device[device_id] += 1
            self._session_max_seq[key] = seq

            # missing_seqs: Trả về an toàn (tối đa 1000 phần tử đầu tiên để không tốn RAM nếu gap cực lớn)
            missing_preview = list(range(gap_start, min(gap_start + 1000, gap_end + 1)))

            return IngestResult(
                stored=True,
                is_duplicate=False,
                is_out_of_order=False,
                is_gap=True,
                missing_seqs=missing_preview,
                gap_count=gap_count,
                prev_max_seq=max_seq,
                created_gap_interval=(gap_start, gap_end),
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
            self._duplicate_by_device[device_id] += 1

            # Khấu trừ received_unique vì bản ghi này thực tế đã tồn tại trong DB trước restart
            if self._received_unique_count > 0:
                self._received_unique_count -= 1
            if self._received_unique_by_device[device_id] > 0:
                self._received_unique_by_device[device_id] -= 1
            key = (device_id, boot_id)
            if key in self._received_unique_by_session and self._received_unique_by_session[key] > 0:
                self._received_unique_by_session[key] -= 1

            if was_out_of_order:
                if self._out_of_order_count > 0:
                    self._out_of_order_count -= 1
                if self._out_of_order_by_device[device_id] > 0:
                    self._out_of_order_by_device[device_id] -= 1

            if boot_id is not None and seq is not None:
                self._mark_seen((device_id, boot_id), seq, time.time())

    def revert_incoming(self, device_id: Optional[str], boot_id: Optional[str],
                        seq: Optional[int], ingest_result: IngestResult) -> None:
        """Hoàn nguyên trạng thái tracker nếu thao tác ghi database thất bại hoàn toàn.

        Quy tắc nhất quán khoa học:
        - received_count: KHÔNG GIẢM. Vì bản tin thực tế đã đến tầng mạng và được backend nhận.
        - seen_seqs: Xóa sequence khỏi sliding window để thiết bị có thể gửi lại sau này.
        - max_seq, gap intervals, gap events: Hoàn lại trạng thái trước khi nhận bản tin lỗi.
        """
        with self._lock:
            key = (device_id, boot_id)

            if ingest_result.is_duplicate:
                # Gói trùng không thay đổi max_seq hay gaps, không cần revert thêm
                return

            # Xóa khỏi sliding window
            if boot_id is not None and seq is not None and key in self._session_seen_seqs:
                self._session_seen_seqs[key].discard(seq)

            # Hoàn lại out-of-order count và khôi phục gap interval nếu vừa bù gap
            if ingest_result.is_out_of_order:
                if self._out_of_order_count > 0:
                    self._out_of_order_count -= 1
                if self._out_of_order_by_device[device_id] > 0:
                    self._out_of_order_by_device[device_id] -= 1
                if ingest_result.resolved_gap_seq is not None:
                    # Tạo lại interval cho sequence chưa được lưu bền
                    r_seq = ingest_result.resolved_gap_seq
                    self._pending_gap_intervals.append({
                        "device_id": device_id,
                        "boot_id": boot_id,
                        "start_seq": r_seq,
                        "end_seq": r_seq,
                        "detected_at": time.time(),
                    })

            # Hoàn lại max_seq
            if ingest_result.prev_max_seq is not None:
                self._session_max_seq[key] = ingest_result.prev_max_seq
            elif key in self._session_max_seq:
                self._session_max_seq.pop(key, None)

            # Hủy bỏ gap interval và gap event vừa tạo (nếu có)
            if ingest_result.created_gap_interval is not None:
                start_s, end_s = ingest_result.created_gap_interval
                # Xóa interval vừa thêm
                self._pending_gap_intervals = [
                    inv for inv in self._pending_gap_intervals
                    if not (inv["device_id"] == device_id and inv["boot_id"] == boot_id
                            and inv["start_seq"] == start_s and inv["end_seq"] == end_s)
                ]
                if self._total_gap_events_count > 0:
                    self._total_gap_events_count -= 1
                if self._gap_events_count_by_device[device_id] > 0:
                    self._gap_events_count_by_device[device_id] -= 1
                if self._gap_events:
                    last_ev = self._gap_events[-1]
                    if (last_ev.get("device_id") == device_id and last_ev.get("boot_id") == boot_id
                            and last_ev.get("from_seq") == start_s):
                        self._gap_events.pop()

    def get_stats(self, stored_count: int, device_id: Optional[str] = None,
                  now: Optional[float] = None, start: Optional[float] = None,
                  end: Optional[float] = None) -> dict:
        """Tổng hợp các chỉ số reliability có thể kiểm chứng.

        Phân định phạm vi rõ ràng:
        - stored_count: Số bản ghi lưu bền trong cơ sở dữ liệu (được lọc theo start, end, device_id).
        - runtime counters: Số bản ghi đo đếm trong RAM suốt vòng đời của process hiện tại.
        - Khi có khoảng thời gian [start, end], schema công bố rõ query_window và runtime_scope
          để bài báo khoa học và người đối soát không nhầm lẫn.
        """
        with self._lock:
            current_time = time.time() if now is None else now

            has_tx = bool(
                self._session_max_tx_count
                and any(
                    (device_id is None or dev == device_id)
                    for (dev, boot) in self._session_max_tx_count.keys()
                )
            )

            # Chọn counters đúng theo device_id
            if device_id is not None:
                received = self._received_by_device[device_id]
                received_unique = self._received_unique_by_device[device_id]
                duplicate = self._duplicate_by_device[device_id]
                out_of_order = self._out_of_order_by_device[device_id]
                gaps_count = self._gap_events_count_by_device[device_id]
                unresolved_base = self._unresolved_beyond_window_by_device[device_id]
                tx_attempted = sum(
                    cnt for (dev, boot), cnt in self._session_max_tx_count.items()
                    if dev == device_id
                ) if has_tx else None
            else:
                received = self._received_count
                received_unique = self._received_unique_count
                duplicate = self._duplicate_count
                out_of_order = self._out_of_order_count
                gaps_count = self._total_gap_events_count
                unresolved_base = self._unresolved_beyond_window_count
                tx_attempted = sum(self._session_max_tx_count.values()) if has_tx else None

            pending = 0
            confirmed = unresolved_base

            for interval in self._pending_gap_intervals:
                if device_id is not None and interval["device_id"] != device_id:
                    continue
                cnt = interval["end_seq"] - interval["start_seq"] + 1
                if current_time - interval["detected_at"] <= self.late_window_s:
                    pending += cnt
                else:
                    confirmed += cnt

            boot_ids = {
                b for (d, b) in self._session_max_seq.keys()
                if b is not None and (device_id is None or d == device_id)
            }

            gap_events = [
                g for g in self._gap_events
                if device_id is None or g.get("device_id") == device_id
            ]

            # Tính toán Delivery Rate và Storage Rate chính xác từ tx_count
            delivery_rate = None
            delivery_rate_pct = None
            storage_rate = None
            storage_rate_pct = None

            if tx_attempted is not None and tx_attempted > 0:
                d_rate = float(received_unique / tx_attempted)
                if d_rate <= 1.0:
                    delivery_rate = round(d_rate, 4)
                    delivery_rate_pct = round(d_rate * 100, 2)
                    delivery_rate_note = (
                        "Observed-prefix delivery rate: received_unique / tx_attempted_count. "
                        "Phan anh ty le phan phoi toi thieu quan sat duoc qua cac phien boot."
                    )
                else:
                    delivery_rate = None
                    delivery_rate_pct = None
                    delivery_rate_note = (
                        f"Inconsistent counter: received_unique ({received_unique}) > "
                        f"tx_attempted ({tx_attempted}). Co the do simulator/firmware reset sequence bat thuong."
                    )

                if stored_count <= tx_attempted:
                    s_rate = float(stored_count / tx_attempted)
                    storage_rate = round(s_rate, 4)
                    storage_rate_pct = round(s_rate * 100, 2)
            else:
                delivery_rate = None
                delivery_rate_pct = None
                storage_rate = None
                storage_rate_pct = None
                delivery_rate_note = "Missing tx_count - chua the tinh delivery rate"

            stats = {
                "received_count": received,
                "received_unique": received_unique,
                "stored_count": stored_count,
                "stored_unique": stored_count,
                "duplicate_count": duplicate,
                "out_of_order_count": out_of_order,
                "gaps_count": gaps_count,
                "missing_packets_pending": pending,
                "missing_packets_confirmed": confirmed,
                "unresolved_gaps_beyond_window": confirmed,
                "tx_attempted_count": tx_attempted,
                "delivery_rate": delivery_rate,
                "delivery_rate_pct": delivery_rate_pct,
                "delivery_rate_note": delivery_rate_note,
                "note": delivery_rate_note,
                "storage_rate": storage_rate,
                "storage_rate_pct": storage_rate_pct,
                "boot_count": len(boot_ids),
                "late_window_s": self.late_window_s,
                "gap_events": gap_events,
            }

            # Ghi nhận ngữ cảnh phạm vi đo lường nếu có lọc theo thời gian
            if start is not None or end is not None:
                stats["runtime_scope"] = "process_lifetime"
                stats["query_window"] = {"start": start, "end": end}
                stats["scope_note"] = (
                    "stored_count is filtered by [start, end]; "
                    "runtime counters (received, duplicate, out-of-order, gaps, tx_attempted, delivery_rate) "
                    "reflect current process lifetime"
                )

            return stats

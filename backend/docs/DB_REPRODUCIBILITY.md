# Báo cáo Tái lập và Nghiệm thu Dữ liệu (Reproducibility Guide)

Tài liệu này cung cấp toàn bộ các câu truy vấn SQL độc lập, công thức toán học và kịch bản thực nghiệm để bất kỳ thành viên nào trong nhóm hoặc phản biện bài báo khoa học có thể tái lập và đối soát 100% kết quả lưu trữ của hệ thống.

---

## 1. Môi trường và Kết nối Thực nghiệm

- **Hệ quản trị CSDL**: PostgreSQL 16 (chạy trên container Docker `btl-iot-testdb`).
- **Connection URL**: `postgresql://postgres:test@127.0.0.1:55432/smarthome_test`
- **Volume lưu bền**: Named volume `pgdata` (tách biệt khỏi vòng đời process backend).

---

## 2. Các Truy vấn SQL Nghiệm thu Độ tin cậy (Reliability Verification)

### 2.1. Kiểm chứng Tính toàn vẹn và Phát hiện Sequence Gaps bằng Window Function
Truy vấn này chạy trực tiếp trên PostgreSQL, không phụ thuộc vào trạng thái RAM của backend, sử dụng hàm cửa sổ `lag()` để phát hiện mọi khoảng khuyết tuần tự:

```sql
WITH seq_diffs AS (
    SELECT
        device_id,
        boot_id,
        seq,
        lag(seq) OVER (PARTITION BY device_id, boot_id ORDER BY seq) AS prev_seq
    FROM telemetry
    WHERE device_id IS NOT NULL AND boot_id IS NOT NULL AND seq IS NOT NULL
)
SELECT
    device_id,
    boot_id,
    prev_seq + 1 AS gap_start,
    seq - 1 AS gap_end,
    (seq - prev_seq - 1)::bigint AS missing_count
FROM seq_diffs
WHERE prev_seq IS NOT NULL AND seq > prev_seq + 1
ORDER BY device_id, boot_id, gap_start;
```
- **Kết quả mong đợi**: Nếu tập kết quả rỗng, dữ liệu trong tất cả các phiên boot đạt tính toàn vẹn 100% (không khuyết gói). Nếu có hàng trả về, chỉ rõ chính xác khoảng sequence bị mất và số lượng gói khuyết.

### 2.2. Kiểm tra Tính duy nhất và Chống trùng lặp (Deduplication Check)
Xác nhận Partial Unique Index `telemetry_dedup_idx` hoạt động hiệu quả, không có bất kỳ bản tin nào bị lưu trùng:

```sql
SELECT
    device_id,
    boot_id,
    seq,
    count(*) AS duplicate_instances
FROM telemetry
WHERE device_id IS NOT NULL AND boot_id IS NOT NULL AND seq IS NOT NULL
GROUP BY device_id, boot_id, seq
HAVING count(*) > 1;
```
- **Kết quả mong đợi**: 0 hàng (không tồn tại bản tin trùng).

### 2.3. Thống kê Phân phối Telemetry theo Thiết bị, Phiên Khởi động và Phiên Kết nối MQTT
Truy vấn phân tích chi tiết dữ liệu theo bộ ba định danh `(device_id, boot_id, connection_id)`:

```sql
SELECT
    device_id,
    boot_id,
    connection_id,
    count(*)::bigint AS stored_packets,
    min(seq) AS min_seq,
    max(seq) AS max_seq,
    min(tx_count) AS min_tx_count,
    max(tx_count) AS max_tx_count,
    min(ts) AS first_seen,
    max(ts) AS last_seen
FROM telemetry
WHERE device_id IS NOT NULL AND boot_id IS NOT NULL
GROUP BY device_id, boot_id, connection_id
ORDER BY device_id, first_seen DESC;
```

### 2.4. Đối soát Tỷ lệ Phân phối (Delivery Rate) và Lưu trữ (Storage Rate) từ `tx_count`
Truy vấn SQL đối soát độc lập tỷ lệ phân phối và tỷ lệ lưu trữ dựa trên bộ đếm phát $tx\_count$:

```sql
WITH session_stats AS (
    SELECT
        device_id,
        boot_id,
        count(DISTINCT seq)::bigint AS unique_stored_packets,
        max(tx_count)::bigint AS max_tx_attempted
    FROM telemetry
    WHERE device_id IS NOT NULL AND boot_id IS NOT NULL AND seq IS NOT NULL
    GROUP BY device_id, boot_id
)
SELECT
    device_id,
    boot_id,
    unique_stored_packets,
    max_tx_attempted,
    round((unique_stored_packets::numeric / nullif(max_tx_attempted, 0) * 100), 2) AS storage_rate_pct
FROM session_stats
ORDER BY device_id, boot_id;
```

---

## 3. Thống kê Lệnh Điều khiển & Độ trễ Xác nhận (Command ACK & Confirm Latency)

Đo lường thời gian đáp ứng ACK và thời gian xác nhận thiết bị đã thực thi vật lý (`confirmed_ts`):

```sql
SELECT
    count(*)::bigint AS total_commands,
    count(*) FILTER (WHERE status = 'ok')::bigint AS ok_count,
    count(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,
    count(*) FILTER (WHERE status = 'timeout')::bigint AS timeout_count,
    count(*) FILTER (WHERE status = 'pending')::bigint AS pending_count,
    count(*) FILTER (WHERE confirmed_ts IS NOT NULL)::bigint AS confirmed_count,
    round((count(*) FILTER (WHERE status = 'ok')::numeric / nullif(count(*), 0) * 100), 2) AS success_rate_pct,
    avg(extract(epoch from (ack_ts - sent_ts))::float8) FILTER (WHERE ack_ts IS NOT NULL AND sent_ts IS NOT NULL AND ack_ts >= sent_ts) AS avg_ack_latency_s,
    min(extract(epoch from (ack_ts - sent_ts))::float8) FILTER (WHERE ack_ts IS NOT NULL AND sent_ts IS NOT NULL AND ack_ts >= sent_ts) AS min_ack_latency_s,
    max(extract(epoch from (ack_ts - sent_ts))::float8) FILTER (WHERE ack_ts IS NOT NULL AND sent_ts IS NOT NULL AND ack_ts >= sent_ts) AS max_ack_latency_s,
    avg(extract(epoch from (confirmed_ts - sent_ts))::float8) FILTER (WHERE confirmed_ts IS NOT NULL AND sent_ts IS NOT NULL AND confirmed_ts >= sent_ts) AS avg_confirm_latency_s,
    min(extract(epoch from (confirmed_ts - sent_ts))::float8) FILTER (WHERE confirmed_ts IS NOT NULL AND sent_ts IS NOT NULL AND confirmed_ts >= sent_ts) AS min_confirm_latency_s,
    max(extract(epoch from (confirmed_ts - sent_ts))::float8) FILTER (WHERE confirmed_ts IS NOT NULL AND sent_ts IS NOT NULL AND confirmed_ts >= sent_ts) AS max_confirm_latency_s
FROM commands;
```

---

## 4. Truy vấn Lịch sử Kết nối và Chuỗi Vòng đời Sự kiện (Event Lifecycle)

### 4.1. Lịch sử Mất kết nối và Trực tuyến (Online / Offline Events)
```sql
SELECT
    extract(epoch from ts)::float8 AS ts,
    to_char(ts, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
    state,
    reason,
    uptime_ms
FROM events
WHERE type = 'connection'
ORDER BY ts DESC, id DESC
LIMIT 50;
```

### 4.2. Truy vấn Chuỗi Vòng đời Sự kiện theo `event_id` (Event Lifecycle Tracking)
```sql
SELECT
    event_id,
    type,
    alarm,
    state,
    value,
    threshold,
    reason,
    to_char(ts, 'YYYY-MM-DD HH24:MI:SS.US') AS event_time,
    uptime_ms
FROM events
WHERE event_id IS NOT NULL
ORDER BY event_id, ts ASC;
```

### 4.3. Lịch sử Cảnh báo Khẩn cấp và Sự cố Cảm biến (Gas, Fire, Sensor Errors)
```sql
SELECT
    extract(epoch from ts)::float8 AS ts,
    to_char(ts, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
    type,
    state,
    event_id,
    alarm,
    value,
    threshold,
    reason
FROM events
WHERE type IN (
    'heat_alarm', 'smoke_alarm', 'dht_error', 'gas_alarm', 'gas_error',
    'gas_sensor_fault', 'door_open_unconfirmed', 'fan_rotation_unconfirmed', 'alarm_response'
) OR type ILIKE '%error%' OR type ILIKE '%fault%'
ORDER BY ts DESC, id DESC;
```

---

## 5. Thống kê Đo lường Cảm biến Gas và Khói

```sql
SELECT
    count(gas_raw)::bigint AS gas_samples_count,
    avg(gas_raw::numeric)::float8 AS avg_gas_raw,
    min(gas_raw)::float8 AS min_gas_raw,
    max(gas_raw)::float8 AS max_gas_raw,
    count(smoke_raw)::bigint AS smoke_samples_count,
    avg(smoke_raw::numeric)::float8 AS avg_smoke_raw,
    min(smoke_raw)::float8 AS min_smoke_raw,
    max(smoke_raw)::float8 AS max_smoke_raw
FROM telemetry
WHERE gas_raw IS NOT NULL OR smoke_raw IS NOT NULL;
```

---

## 6. Phân định Ranh giới Đo lường Khoa học (Scope Separation)

Để đảm bảo tính trung thực khoa học trong bài báo, bảng sau định nghĩa rõ nguồn dữ liệu và phạm vi của từng chỉ số:

| Chỉ số | Nguồn dữ liệu | Phạm vi | Hành vi sau Restart Backend | Ghi chú khoa học |
|---|---|---|---|---|
| `stored_count` | PostgreSQL `telemetry` | Lưu bền (Lọc được theo `[start, end]`) | Còn nguyên vẹn 100% | Số bản tin hợp lệ đã commit vào DB |
| `received_count` | `ReliabilityTracker` | Runtime (Vòng đời process hiện tại) | Reset về 0 | Bản tin nhận được tại tầng mạng backend |
| `duplicate_count` | `ReliabilityTracker` / Unique Index | Runtime | Reset về 0 | Bản tin trùng phát hiện được |
| `out_of_order_count` | `ReliabilityTracker` | Runtime | Reset về 0 | Bản tin đến muộn ($seq < max\_seq$) |
| `missing_packets_pending` | `ReliabilityTracker` | Runtime (Cửa sổ $T_{\text{late}} = 10s$) | Reset về 0 | Gói tin đang chờ trong cửa sổ trễ |
| `unresolved_gaps_beyond_window` | `ReliabilityTracker` | Runtime | Reset về 0 | Gói khuyết vượt quá cửa sổ trễ |
| `delivery_rate` | Firmware ESP32 `tx_count` | Chưa có | Luôn trả `None` | **Không tự bịa delivery rate giả định 100%** |

---

## 7. Ghi chú về API Endpoints và Query Parameters

- **Xuất CSV Lịch sử**: Endpoint chính thức là `GET /api/history.csv?metric=...` (chú ý URL có dấu chấm `.csv`, không phải `/csv`).
- **Khoảng thời gian truy vấn**: Các endpoint lịch sử nhận query parameters `from` (alias cho `from_`) và `to` (chấp nhận Unix timestamp epoch giây hoặc chuỗi ISO-8601).
- **Trạng thái Endpoint Mở rộng**: Các chức năng `reliability_stats()`, `command_stats()`, `list_connection_events()`, `list_error_events()` hiện đã được kiểm thử và sẵn sàng ở tầng Storage (`PostgresStorage` / `InMemoryStorage`). Các endpoint REST tương ứng chưa được định tuyến trong `backend/app/api.py` (chờ Vũ tích hợp khi cần thiết).

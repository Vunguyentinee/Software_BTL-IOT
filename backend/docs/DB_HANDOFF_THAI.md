# Bàn giao Database & History

## 1. Phạm vi đã hoàn thành

Các phần đã triển khai ở tầng Storage:

| Commit | Chức năng |
|---|---|
| `d9015e2` | `history_stats()` – COUNT/AVG/MIN/MAX |
| `19748b5` | `history_page()` – phân trang lịch sử |
| `393a3f3` | `history_csv()` – xuất CSV theo batch/keyset |
| `4bfaf05` | Integration test persistence qua Storage instance mới |

Ba method lịch sử mới có trong `Storage` Protocol, `InMemoryStorage` và `PostgresStorage`. Đồng thời, `backend/app/api.py` đã tích hợp đầy đủ 3 endpoint REST:
- `GET /api/history/stats?metric=...&from=...&to=...`
- `GET /api/history/page?metric=...&from=...&to=...&limit=...&offset=...`
- `GET /api/history.csv?metric=...&from=...&to=...&batch_size=...` (chú ý đường dẫn có đuôi `.csv`, không phải `/csv`)

Các endpoint mở rộng về độ tin cậy và sự kiện (`reliability_stats`, `command_stats`, `list_connection_events`, `list_error_events`) hiện đã hoàn tất ở tầng Storage, sẵn sàng để Vũ cân nhắc expose lên REST API khi cần thiết.

## 2. Contract Storage

### `history_stats()`

```python
history_stats(
    metric: str,
    start: Optional[float],
    end: Optional[float],
) -> HistoryStats
```

`HistoryStats` là `TypedDict`:

```python
{
    "count": int,
    "avg": float | None,
    "min": float | None,
    "max": float | None,
}
```

- Metric hợp lệ: `temperature_c`, `humidity_pct`, `smoke_raw`.
- Bỏ qua `NULL`/`None`, `NaN`, `Infinity`, `-Infinity`; không đổi thành 0.
- Không còn mẫu hợp lệ: `count = 0`, ba giá trị còn lại là `None`.
- `avg`, `min`, `max` được chuẩn hóa thành `float`, kể cả `smoke_raw`; `count` là `int`.
- PostgreSQL dùng allowlist `HISTORY_STATS_SQL`, vì vậy tên cột/predicate không lấy từ chuỗi chưa kiểm tra.

### `history_page()`

```python
history_page(
    metric: str,
    start: Optional[float],
    end: Optional[float],
    limit: int,
    offset: int,
) -> list[dict]
```

Mỗi phần tử có dạng `{"ts": <Unix timestamp giây>, "value": <giá trị metric>}`.

- `limit`: số nguyên, không nhận `bool`, từ 1 đến 1000.
- `offset`: số nguyên, không nhận `bool`, lớn hơn hoặc bằng 0.
- Bỏ hàng có giá trị metric `NULL`.
- Sắp xếp tăng dần theo timestamp; PostgreSQL dùng `ORDER BY ts, id`, InMemory dùng timestamp và thứ tự ghi.
- PostgreSQL thực thi `LIMIT/OFFSET` trong SQL với parameter binding.

### `history_csv()`

```python
history_csv(
    metric: str,
    start: Optional[float],
    end: Optional[float],
    batch_size: int = 1000,
) -> Iterator[bytes]
```

- `batch_size`: số nguyên, không nhận `bool`, từ 1 đến 1000.
- Iterator trả các chunk byte UTF-8.
- Dòng đầu: `ts,value\r\n`.
- Timestamp CSV được ghi dưới dạng `float`, giữ đơn vị Unix giây.
- `csv.writer` xử lý quoting/escaping và CRLF.
- Boolean được biểu diễn đúng contract test hiện tại là `True`/`False`.
- PostgreSQL chốt `max(id)` khi gọi method, sau đó đọc từng batch bằng keyset `(ts,id)`; không `fetchall()` toàn bộ lịch sử.
- InMemory tạo snapshot O(n) của các trường xuất. Đây là giới hạn thiết kế được chấp nhận vì `max_telemetry` giới hạn deque.

## 3. Danh sách 20 metric lịch sử

Allowlist `HISTORY_METRICS` trong `backend/app/storage.py` gồm đúng:

1. `temperature_c`
2. `humidity_pct`
3. `dht_ok`
4. `pir_ready`
5. `motion_detected`
6. `is_dark`
7. `fan_on`
8. `led1_on`
9. `led2_on`
10. `led3_on`
11. `heat_alarm`
12. `uptime_ms`
13. `smoke_raw` (Khói MQ-2 thô tại GPIO34)
14. `smoke_alarm` (Cảnh báo khói MQ-2)
15. `pump_on`
16. `gas_raw` (Legacy / Deprecated, nồng độ gas cũ)
17. `gas_alarm` (Legacy / Deprecated, cảnh báo gas cũ)
18. `gas_sensor_ok` (Legacy / Deprecated, trạng thái cảm biến gas cũ)
19. `door_safety_lock` (Mới V2: Cờ khóa an toàn cửa)
20. `gas_sensor_fault` (Mới V2: Cờ lỗi cảm biến khí)

Các trường: `safety_mode`, `safety_reason`, `control_mode`, `backend_state`, `active_alarms`, `door_command`, `modes`, `device_id`, `boot_id`, `connection_id`, `seq`, `tx_count` không nằm trong allowlist metric vẽ đồ thị. Không tự ý đưa các trường định danh hoặc chuỗi trạng thái vào biểu đồ.

Allowlist `HISTORY_STATS_METRICS`: Gồm 4 metric số: `temperature_c`, `humidity_pct`, `smoke_raw`, `gas_raw`. Các metric boolean hoặc text không hỗ trợ `history_stats()`.

## 4. Validation chung

`validate_history_time_range()` được dùng bởi ba method mới:

- `start`/`end` là Unix timestamp giây hoặc `None`;
- nếu có giá trị, phải hữu hạn; `NaN`, `Infinity`, `-Infinity` gây `ValueError`;
- nếu có cả hai, yêu cầu `start <= end`;
- lọc thời gian bao gồm cả `start` và `end`.

Metric được kiểm tra bằng allowlist trước khi nội suy tên cột vào SQL. Các giá trị thời gian, `limit`, `offset`, `batch_size` đều được truyền bằng parameter binding.

Lưu ý: method cũ `history()` được giữ nguyên để tương thích. Validation chặt nêu trên là contract của ba method mới, không nên suy diễn rằng method cũ đã được refactor giống hệt.

## 5. Phối hợp Vũ – tích hợp backend/API

### 5.1. Các Storage method mới đã hoàn thành & kiểm thử 100%

Tầng Storage (`InMemoryStorage` và `PostgresStorage`) đã hoàn thiện và kiểm thử đạt 434 tests PASS trên PostgreSQL:

| Method mới | Tham số | Kết quả trả về | Mục đích |
|---|---|---|---|
| `reliability_stats()` | `device_id`, `start`, `end`, `now` | JSON dict độ tin cậy | Số bản tin nhận, lưu, duplicate, out-of-order, gaps, pending gaps, tx_attempted_count, delivery_rate, storage_rate |
| `command_stats()` | `start`, `end` | JSON dict thống kê lệnh | Tổng lệnh, ok, failed, timeout, pending, confirmed_count, success_rate, min/avg/max duration, min/avg/max confirm latency |
| `list_connection_events()` | `limit`, `start`, `end` | `list[dict]` | Lịch sử các lần online / offline của thiết bị lưu từ bảng `events` |
| `list_error_events()` | `limit`, `start`, `end` | `list[dict]` | Lịch sử sự kiện lỗi (`dht_error`, `gas_sensor_fault`, `door_open_unconfirmed`, `fan_rotation_unconfirmed`, `alarm_response`) |
| `verify_telemetry_gaps()` | `device_id`, `boot_id` (chỉ trên Postgres) | `list[dict]` | Dùng Window function `lag()` kiểm chứng độc lập khoảng gap sequence |

### 5.2. Các REST API đã chính thức có trên main

Các endpoint sau đã được Vũ expose đầy đủ trong `backend/app/api.py`:

| Endpoint | Method gọi | Tham số query | Kết quả |
|---|---|---|---|
| `GET /api/history/reliability` | `storage.reliability_stats()` | `device_id`, `from`, `to` | `{received_count, received_unique, stored_count, stored_unique, duplicate_count, out_of_order_count, gaps_count, missing_packets_pending, missing_packets_confirmed, tx_attempted_count, delivery_rate, delivery_rate_pct, delivery_rate_note, storage_rate, storage_rate_pct, boot_count}` |
| `GET /api/history/commands/stats` | `storage.command_stats()` | `from`, `to` | `{total, ok, failed, timeout, pending, confirmed_count, success_rate, avg_duration_s, min_duration_s, max_duration_s, avg_confirm_duration_s, min_confirm_duration_s, max_confirm_duration_s}` |
| `GET /api/history/connections` | `storage.list_connection_events()` | `limit`, `from`, `to` | `[{ts, state, reason, uptime_ms}]` |
| `GET /api/history/errors` | `storage.list_error_events()` | `limit`, `from`, `to` | `[{ts, type, state, value, threshold, reason, uptime_ms}]` |
| `GET /api/history` | `storage.history()` | `metric`, `from`, `to` | `[{ts, value}]` |
| `GET /api/history/page` | `storage.history_page()` | `metric`, `from`, `to`, `limit`, `offset` | `[{ts, value}]` |
| `GET /api/history/stats` | `storage.history_stats()` | `metric`, `from`, `to` | `{count, avg, min, max}` |
| `GET /api/history.csv` | `storage.history_csv()` | `metric`, `from`, `to`, `batch_size` | Stream text/csv UTF-8 |

### 5.3. Bảo vệ trạng thái thời gian thực (`Service._telemetry`)

Khi tích hợp telemetry, `Service.on_telemetry()` đã được cấu hình cơ chế bảo vệ:
- Nếu bản tin bị phát hiện là duplicate: bỏ qua không ghi đè trạng thái và không phát broadcast lặp.
- Nếu bản tin là đến muộn (out-of-order, $seq < max\_seq$): bản tin vẫn được ghi vào database lịch sử, nhưng `Service._telemetry` giữ nguyên trạng thái mới nhất, tránh làm sai lệch giao diện web.

### 5.4. `StreamingResponse` và thời điểm xử lý lỗi

`history_csv()` hiện validation và chốt high-water trước khi trả iterator, nên Vũ cần gọi method trong `try/except` **trước** khi tạo/trả `StreamingResponse`:

```python
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

try:
    chunks = service.storage.history_csv(metric, start, end, batch_size)
except ValueError as exc:
    raise HTTPException(status_code=422, detail=str(exc))

return StreamingResponse(
    chunks,
    media_type="text/csv; charset=utf-8",
    headers={"Content-Disposition": "attachment; filename=history.csv"},
)
```

### 5.5. Giải thích các cập nhật trong `service.py` cho Vũ review

Nhằm tăng cường độ ổn định cho hệ thống và đáp ứng yêu cầu Final Review, module Database & History đã đề xuất và triển khai các thay đổi tối thiểu, có kiểm thử bảo vệ trong `backend/app/service.py`:
1. **Bảo vệ luồng Realtime khi Database gặp sự cố tạm thời**:
   - Trong `on_telemetry()`: Bọc lệnh gọi `self.storage.save_telemetry(rec)` trong `try ... except Exception`.
   - Nếu lưu vào DB thất bại (ví dụ PostgreSQL rớt kết nối mạng hoặc timeout): log lỗi bằng `log.error`, nhưng **không để ngoại lệ làm sập luồng nhận MQTT**. Trạng thái realtime `_telemetry`, cập nhật nhịp tim `_last_seen`, `_set_online(True)` và broadcast WebSocket vẫn hoạt động bình thường, giúp giao diện giám sát nhà thông minh không bị gián đoạn.
   - Không coi failed persistence là `stored = True` (gán `stored = None`).
   - Nếu bản tin là duplicate (`stored is False`): bỏ qua một cách idempotent, không ghi đè và không re-broadcast.
   - Vẫn bảo toàn 100% cơ chế ưu tiên ESP32 thật so với simulator trong commit `da4cb44`.
2. **Phân biệt lý do ngoại tuyến tường minh trong `_set_online`**:
   - `_set_online(online, reason=None)`:
     + Khi broker phát LWT hoặc tin nhắn topic status "offline": truyền tường minh `reason="status"`.
     + Khi Service `tick()` phát hiện quá thời hạn heartbeat: truyền tường minh `reason="timeout"`.
     + Giúp bảng sự kiện `events` lưu chính xác nguyên nhân mất kết nối phục vụ đối soát.

## 6. Phối hợp Hiệu – Firmware ESP32

### 6.1. Hợp đồng mở rộng Telemetry (Tương thích ngược 100%)

Để hệ thống đo đạc được độ tin cậy, Hiệu bổ sung 3 trường vào payload JSON gửi lên topic `home/esp32-home/telemetry`:

```json
{
  "device_id": "esp32-home",
  "boot_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "seq": 0,
  "temperature_c": 36.0,
  "humidity_pct": 70.0,
  "dht_ok": true,
  "pir_ready": true,
  "motion_detected": true,
  "is_dark": true,
  "door_command": "closed",
  "fan_on": false,
  "led1_on": false,
  "led2_on": false,
  "led3_on": false,
  "heat_alarm": false,
  "uptime_ms": 120000,
  "smoke_raw": 300,
  "smoke_alarm": false,
  "pump_on": false,
  "modes": {"fan": "auto"}
}
```

### 6.2. Quy ước kỹ thuật cho Firmware

1. **`device_id`**: Chuỗi cố định theo cấu hình thiết bị (ví dụ `"esp32-home"`).
2. **`boot_id`**: Chuỗi UUID ngẫu nhiên (hoặc chuỗi timestamp epoch lúc ESP32 khởi động). **Mỗi lần ESP32 reset/reboot phải sinh một `boot_id` mới**.
3. **`seq`**: Bộ đếm gói tin kiểu số nguyên không âm (`0, 1, 2, ...`), tăng 1 đơn vị sau mỗi lần publish telemetry. **Reset về 0 khi reboot**.
4. **Tính tương thích ngược**: Nếu firmware cũ chưa kịp cập nhật, các bản tin không có `device_id`, `boot_id`, `seq` vẫn được backend lưu trữ bình thường, không gây lỗi hệ thống.
5. **Bộ đếm phát ($N_{\text{sent}}$)**: Nếu Hiệu có thể bổ sung thêm trường `tx_count` (tổng số bản tin telemetry đã phát từ lúc khởi động), backend sẽ tính được tỷ lệ phân phối thực tế $delivery\_rate = N_{\text{received}} / tx\_count$.

## 7. Phối hợp Đức – frontend

Các điểm cần chốt trước khi nối UI:

- Biểu đồ: chọn metric trong allowlist; `ts` là Unix giây; `value` có thể là số hoặc boolean tùy metric; hàng `NULL` không xuất hiện.
- Thống kê: UI phải hiển thị trạng thái rỗng khi `count = 0` và `avg/min/max = null`, không hiển thị 0 giả.
- Thống kê Reliability: UI có thể hiển thị tỷ lệ lưu trữ, số bản tin trùng phát hiện được, số lần mất gói đã xác nhận (`missing_packets_confirmed`) và số gói đang chờ trễ (`missing_packets_pending`).
- Lịch sử kết nối: Hiển thị bảng online/offline với thời điểm `ts` và nguyên nhân `reason`.
- Thống kê lệnh: Hiển thị biểu đồ tỷ lệ lệnh thành công và độ trễ phản hồi ACK trung bình/min/max.

## 8. Các vấn đề cần nhóm xác nhận (Pending Team Alignments)

1. **Xác nhận với Hiệu**: Firmware có thể sinh UUID cho `boot_id` và đếm `seq` bắt đầu từ 0 được không? Có thể bổ sung thêm `tx_count` để tính delivery rate chính xác không?
2. **Xác nhận với Vũ & Đức**: Thống nhất đường dẫn URL và query parameters cho các endpoint reliability, command stats và connection history.
3. **Xác nhận về cửa vật lý**: Giữ nguyên nguyên tắc `door_command` và command ACK chỉ phản ánh tín hiệu gửi tới servo, không tự ý suy diễn thành công tắc vị trí cửa vật lý.

4. **Xác nhận với Hiệu & Kiên (Cảm biến Gas MQ-2 & An toàn)**:
   - Trạng thái hiện tại: Database & Storage đã hoàn tất migration, model, validation, phân trang, CSV và thống kê cho `gas_raw`, `gas_alarm`, `gas_sensor_ok`, `safety_mode`, `safety_reason`.
   - Đang chờ phần cứng/firmware (PENDING HARDWARE VALIDATION): Firmware ESP32 của Hiệu và điều khiển an toàn của Kiên chốt hợp đồng MQTT topic và ngưỡng cảnh báo gas thực tế.

## 9. Chạy test PostgreSQL an toàn

Integration test chỉ được phép trỏ tới database test `smarthome_test` trên cổng `55432`. Fixture trong `backend/tests/test_postgres_storage.py` và `test_reliability.py` có guard kiểm tra cả port và tên database, sau đó mới dùng `reset()` cho test isolation.

Lệnh chạy kiểm thử trên PowerShell từ thư mục backend:

```powershell
$env:BTL_TEST_DATABASE_URL = 'postgresql://postgres:test@127.0.0.1:55432/smarthome_test'
python -m pytest --basetemp='D:\IOT-BTL\_pytest_thai_temp'
```

Kết quả thực tế đạt: **239 passed** trong 8.25 giây trên PostgreSQL test container `btl-iot-testdb` (port 55432).

# Từ điển dữ liệu PostgreSQL

## 1. Quy ước

Nguồn schema duy nhất trong code hiện tại là hằng `SCHEMA` tại `backend/app/pg_storage.py`. Cột được ghi qua các method của `PostgresStorage`; miền giá trị ở tầng ứng dụng được ghi riêng khi `backend/app/models.py` có định nghĩa. Không coi validation ứng dụng là database constraint nếu SQL không khai báo constraint tương ứng.

`ts` và `sent_ts`/`ack_ts` được lưu dưới dạng `TIMESTAMPTZ`; Storage chuyển đổi với Unix timestamp giây. “Nullable” dưới đây phản ánh đúng DDL, không phản ánh việc model luôn yêu cầu một trường.

## 2. Bảng `telemetry`

Nguồn ghi: `Service.on_telemetry()` kiểm tra payload bằng `models.Telemetry`, gắn `ts` từ đồng hồ backend, sau đó gọi `PostgresStorage.save_telemetry()`.

| Cột | Kiểu PostgreSQL | Nullable | PK/constraint | Ý nghĩa theo source | Nguồn dữ liệu |
|---|---|---:|---|---|---|
| `id` | `BIGSERIAL` | Không | PK | Số thứ tự hàng do PostgreSQL cấp; dùng làm khóa phụ khi sắp xếp lịch sử | PostgreSQL sequence |
| `ts` | `TIMESTAMPTZ` | Không | `NOT NULL` | Thời điểm backend nhận và lưu telemetry | `Service.clock()` → `to_timestamp()` |
| `temperature_c` | `DOUBLE PRECISION` | Có | — | Trường `temperature_c`; source cho phép `null` | Payload telemetry đã qua `Telemetry` |
| `humidity_pct` | `DOUBLE PRECISION` | Có | — | Trường `humidity_pct`; source cho phép `null` | Payload telemetry đã qua `Telemetry` |
| `dht_ok` | `BOOLEAN` | Có | — | Cờ DHT hợp lệ | Payload telemetry đã qua `Telemetry` |
| `pir_ready` | `BOOLEAN` | Có | — | Cờ PIR sẵn sàng | Payload telemetry đã qua `Telemetry` |
| `motion_detected` | `BOOLEAN` | Có | — | Trạng thái phát hiện chuyển động | Payload telemetry đã qua `Telemetry` |
| `is_dark` | `BOOLEAN` | Có | — | Trạng thái tối do thiết bị báo | Payload telemetry đã qua `Telemetry` |
| `door_command` | `TEXT` | Có | — | Giá trị lệnh/trạng thái điều khiển cửa mà telemetry báo; model giới hạn `open` hoặc `closed` | Payload telemetry đã qua `Telemetry` |
| `fan_on` | `BOOLEAN` | Có | — | Trạng thái quạt bật/tắt được telemetry báo | Payload telemetry đã qua `Telemetry` |
| `led1_on` | `BOOLEAN` | Có | — | Trạng thái LED 1 | Payload telemetry đã qua `Telemetry` |
| `led2_on` | `BOOLEAN` | Có | — | Trạng thái LED 2 | Payload telemetry đã qua `Telemetry` |
| `led3_on` | `BOOLEAN` | Có | — | Trạng thái LED 3 | Payload telemetry đã qua `Telemetry` |
| `heat_alarm` | `BOOLEAN` | Có | — | Trạng thái cảnh báo nhiệt | Payload telemetry đã qua `Telemetry` |
| `uptime_ms` | `BIGINT` | Có | — | Giá trị uptime do thiết bị gửi; tên trường thể hiện đơn vị `ms` | Payload telemetry đã qua `Telemetry` |
| `smoke_raw` | `INTEGER` | Có | — | Giá trị khói thô; model cho phép `null` | Payload telemetry đã qua `Telemetry` |
| `smoke_alarm` | `BOOLEAN` | Có | — | Trạng thái cảnh báo khói | Payload telemetry; mặc định model là `False` |
| `pump_on` | `BOOLEAN` | Có | — | Trạng thái bơm | Payload telemetry; mặc định model là `False` |
| `modes` | `JSONB` | Có | — | Map chế độ thiết bị; giá trị model là `auto` hoặc `manual` | Payload telemetry; `save_telemetry()` ghi `{}` nếu thiếu/falsy |
| `device_id` | `TEXT` | Có | Partial Unique Index | Định danh thiết bị phần cứng (ví dụ: `esp32-home`). Nullable để tương thích dữ liệu legacy | Payload `Telemetry` hoặc Settings |
| `boot_id` | `TEXT` | Có | Partial Unique Index | Định danh phiên khởi động duy nhất của thiết bị (UUID hoặc boot timestamp) | Payload `Telemetry` |
| `seq` | `BIGINT` | Có | Partial Unique Index | Số thứ tự tuần tự của gói tin trong phiên khởi động | Payload `Telemetry` |

Chỉ mục tường minh:
- `telemetry_ts_idx ON telemetry (ts)`: Phục vụ lọc và truy vấn lịch sử thời gian.
- `telemetry_dedup_idx UNIQUE ON telemetry (device_id, boot_id, seq) WHERE device_id IS NOT NULL AND boot_id IS NOT NULL AND seq IS NOT NULL`: Ngăn chặn hoàn toàn trùng lặp bản tin ở cấp độ database, đồng thời không gây xung đột với bản tin legacy (`NULL`).
- `telemetry_device_boot_seq_idx ON telemetry (device_id, boot_id, seq)`: Tối ưu hóa truy vấn sequence gap, session statistics và window functions.

### Lưu ý riêng về cửa

`commands.device = 'door'` cùng `commands.action = 'open'|'close'|'auto'` biểu diễn yêu cầu điều khiển từ backend. `telemetry.door_command` là trường điều khiển cửa do firmware/simulator báo trong telemetry, với giá trị `open` hoặc `closed`. Theo `backend/docs/API_MQTT.md`, ACK của lệnh cửa chỉ xác nhận lệnh đã được gửi cho servo. Schema và model hiện không có cột cảm biến vị trí cửa, công tắc hành trình hay cờ “đã mở/đóng vật lý”. Vì vậy không được diễn giải `door_command` hoặc command ACK thành xác nhận vị trí vật lý.

## 3. Bảng `events`

Nguồn ghi: `Service.on_event()` kiểm tra payload bằng `models.Event`, gắn `ts` từ đồng hồ backend rồi gọi `PostgresStorage.save_event()`.

| Cột | Kiểu PostgreSQL | Nullable | PK/constraint | Ý nghĩa theo source | Nguồn dữ liệu |
|---|---|---:|---|---|---|
| `id` | `BIGSERIAL` | Không | PK | Số thứ tự hàng do PostgreSQL cấp | PostgreSQL sequence |
| `ts` | `TIMESTAMPTZ` | Không | `NOT NULL` | Thời điểm backend nhận event | `Service.clock()` → `to_timestamp()` |
| `type` | `TEXT` | Không | `NOT NULL` | Loại event; gồm event từ thiết bị (`heat_alarm`, `smoke_alarm`, `pump`, `fan`, `door`, `led1`, `dht_error`) và event kết nối từ backend (`connection`) | Payload event hoặc `Service._set_online()` |
| `state` | `TEXT` | Không | `NOT NULL` | Pha event (`start`, `end`) hoặc trạng thái kết nối (`online`, `offline`) | Payload event hoặc `Service._set_online()` |
| `value` | `DOUBLE PRECISION` | Có | — | Giá trị tùy chọn đi kèm event; source không quy định một đơn vị chung | Payload event |
| `threshold` | `DOUBLE PRECISION` | Có | — | Ngưỡng tùy chọn đi kèm event; source không quy định một đơn vị chung | Payload event |
| `reason` | `TEXT` | Có | — | Lý do tùy chọn hoặc nguyên nhân thay đổi kết nối: `telemetry` (gói telemetry kích hoạt online), `status` (broker báo qua LWT hoặc topic status), `timeout` (quá thời hạn không nhận heartbeat), `mqtt_connect` (backend kết nối lại MQTT) | Payload event hoặc `Service._set_online()` |
| `uptime_ms` | `BIGINT` | Có | — | Uptime thiết bị tại event; model yêu cầu trường này | Payload event |

Chỉ mục tường minh:
- `events_ts_idx ON events (ts)`: Sắp xếp và lọc sự kiện theo thời gian.
- `events_type_ts_idx ON events (type, ts)`: Tối ưu hóa truy vấn lọc sự kiện kết nối (`type = 'connection'`) và sự kiện lỗi (`list_connection_events`, `list_error_events`).

DDL không có constraint kiểm tra miền `type`/`state` và không có khóa chống trùng. Miền giá trị nêu trên được bảo vệ ở đường ghi qua `Service`, không phải bởi PostgreSQL.

## 4. Bảng `commands`

Nguồn ghi: `Service.send_command()` tạo UUID dạng hex, ghi trạng thái `pending` qua `save_command()`, sau đó mới publish MQTT. `Service.on_cmd_ack()` hoặc timeout trong `Service._tick_commands()` cập nhật hàng bằng `update_command()`.

| Cột | Kiểu PostgreSQL | Nullable | PK/constraint | Ý nghĩa theo source | Nguồn dữ liệu |
|---|---|---:|---|---|---|
| `cmd_id` | `TEXT` | Không | PK | ID duy nhất của lệnh | `uuid.uuid4().hex` trong `Service.send_command()` |
| `device` | `TEXT` | Không | `NOT NULL` | Thiết bị đích; tầng ứng dụng hiện hỗ trợ `led1`, `fan`, `door` | REST path → `validate_command()` |
| `action` | `TEXT` | Không | `NOT NULL` | Hành động; miền phụ thuộc thiết bị | REST body → `validate_command()` |
| `source` | `TEXT` | Có | — | Nguồn phát lệnh; mặc định `web` trong Service | Tham số `source` của `send_command()` |
| `status` | `TEXT` | Không | `NOT NULL` | Vòng đời lệnh: code sử dụng `pending`, `ok`, `failed`, `timeout` | Service tạo/cập nhật |
| `sent_ts` | `TIMESTAMPTZ` | Không | `NOT NULL` | Thời điểm backend tạo/gửi lệnh | `Service.clock()` |
| `ack_ts` | `TIMESTAMPTZ` | Có | — | Thời điểm backend xử lý ACK; timeout giữ `NULL` | `Service._finish_command()` |
| `detail` | `TEXT` | Có | — | Chi tiết ACK lỗi hoặc lý do timeout | ACK hoặc Service |
| `ts` | `TIMESTAMPTZ` | Không | `NOT NULL` | Timestamp bản ghi lệnh lúc tạo; mặc định theo `sent_ts` nếu Storage không nhận `ts` | `Service.send_command()` / `save_command()` |

Chỉ mục tường minh:
- `commands_sent_idx ON commands (sent_ts)`: Sắp xếp lệnh gửi mới nhất trước.
- `commands_status_idx ON commands (status)`: Tối ưu hóa thống kê trạng thái lệnh (`command_stats`).

`save_command()` dùng `ON CONFLICT (cmd_id)` nhưng khi xung đột chỉ cập nhật `status`, `detail`, `ack_ts`; các trường nhận diện lệnh ban đầu không bị thay thế.

Command ACK không tạo bảng hay hàng ACK riêng. `Service.on_cmd_ack()` kiểm tra payload rồi dùng `update_command()` cập nhật hàng lệnh đang `pending`. ACK đến muộn sau timeout hoặc ACK lặp không làm thay đổi trạng thái cuối theo logic hiện tại của `Service._finish_command()`.

Miền lệnh ở tầng ứng dụng (`models.DEVICES`):

- `led1`: `on`, `off`, `auto`;
- `fan`: `on`, `off`, `auto`;
- `door`: `open`, `close`, `auto`.

## 5. Bảng `config`

Nguồn ghi: `Service.set_config()` nhận `models.Thresholds`, tạo `config_id`, gọi `save_config()` rồi publish MQTT retained. `PostgresStorage.save_config()` luôn upsert hàng `id = 1`.

| Cột | Kiểu PostgreSQL | Nullable | PK/constraint | Ý nghĩa theo source | Nguồn dữ liệu |
|---|---|---:|---|---|---|
| `id` | `INTEGER` | Không | PK, `CHECK id = 1` | Khóa cố định để bảng chỉ giữ cấu hình hiện hành | Hằng `1` trong `save_config()` |
| `config_id` | `TEXT` | Không | `NOT NULL` | ID của lần đặt cấu hình gần nhất | `uuid.uuid4().hex` trong `Service.set_config()` |
| `thresholds` | `JSONB` | Không | `NOT NULL` | Object chứa bộ ngưỡng hiện hành | `Thresholds.model_dump()` |
| `ts` | `TIMESTAMPTZ` | Không | `NOT NULL` | Thời điểm cấu hình được lưu | `Service.clock()`; Storage fallback `time.time()` |

Không có chỉ mục tường minh ngoài primary key.

Object `thresholds` hiện có sáu khóa theo `models.Thresholds`: `fan_on`, `fan_off`, `heat_alarm_on`, `heat_alarm_off`, `smoke_high`, `smoke_low`. Model chỉ ràng buộc quan hệ hysteresis `off < on` hoặc `low < high`; DDL không áp đặt các kiểm tra này và source không khai báo đơn vị chung trong schema.

Trạng thái runtime của việc áp dụng config (`pending`, `applied`, `rejected`, `timeout`) và `detail` nằm trong bộ nhớ `Service._config`, không có cột tương ứng trong bảng `config`. Sau restart, `Service._initial_config()` đọc `config_id` và `thresholds`, rồi dựng trạng thái `pending` để publish lại khi MQTT kết nối.

Trạng thái MQTT online/offline: hiện được lưu bền vững vào bảng `events` qua `save_connection_event()` (`type = 'connection'`), đồng thời `Service` giữ `_online`, `_last_seen`, `_offline_since` trong bộ nhớ và phát thay đổi qua WebSocket.

## 6. Từ điển các chỉ số thống kê & Reliability (Storage API)

### 6.1. Thống kê lệnh điều khiển (`command_stats`)

| Trường | Kiểu | Mô tả |
|---|---|---|
| `total` | `int` | Tổng số lệnh được gửi trong khoảng thời gian truy vấn |
| `ok` | `int` | Số lệnh thực thi thành công (nhận ACK `result = 'ok'`) |
| `failed` | `int` | Số lệnh thiết bị báo thất bại (nhận ACK `result = 'failed'`) |
| `timeout` | `int` | Số lệnh không nhận được ACK trong thời hạn quy định (mặc định 5.0s) |
| `pending` | `int` | Số lệnh đang chờ phản hồi từ thiết bị |
| `success_rate` | `float` hoặc `None` | Tỷ lệ thành công $N_{ok} / N_{total}$; `None` nếu $total = 0$ |
| `avg_duration_s` | `float` hoặc `None` | Thời gian phản hồi trung bình (giây) tính bằng $\text{ack\_ts} - \text{sent\_ts}$ |
| `min_duration_s` | `float` hoặc `None` | Thời gian phản hồi nhanh nhất (giây) |
| `max_duration_s` | `float` hoặc `None` | Thời gian phản hồi chậm nhất (giây) |

### 6.2. Thống kê độ tin cậy Telemetry (`reliability_stats`)

| Trường | Kiểu | Mô tả |
|---|---|---|
| `received_count` | `int` | Tổng số bản tin backend đã nhận từ MQTT |
| `stored_count` | `int` | Tổng số bản tin hợp lệ được lưu bền trong PostgreSQL |
| `duplicate_count` | `int` | Số bản tin trùng lặp phát hiện được theo bộ ba `(device_id, boot_id, seq)` |
| `out_of_order_count` | `int` | Số bản tin đến muộn / lệch thứ tự ($seq < max\_seq$) trong cùng phiên boot |
| `gaps_count` | `int` | Tổng số lần phát hiện đứt đoạn chuỗi tuần tự ($seq > max\_seq + 1$) tích lũy |
| `missing_packets_pending` | `int` | Số sequence gaps đang khuyết trong cửa sổ quan sát ($T_{\text{late}} = 10.0s$) |
| `unresolved_gaps_beyond_window` | `int` | Số sequence gaps chưa được giải quyết đã vượt quá cửa sổ trễ quan sát |
| `missing_packets_confirmed`| `int` | Alias tương thích ngược của `unresolved_gaps_beyond_window` |
| `boot_count` | `int` | Số lượng phiên khởi động khác nhau được ghi nhận |
| `late_window_s` | `float` | Độ dài cửa sổ thời gian chờ bản tin đến muộn (mặc định 10.0 giây) |
| `delivery_rate` | `None` | Tỷ lệ phân phối; luôn trả `None` do chưa có bộ đếm phát từ ESP32 firmware |
| `delivery_rate_note` | `str` | Chú thích rõ ràng nguyên nhân khoa học không công bố tỷ lệ phỏng đoán |

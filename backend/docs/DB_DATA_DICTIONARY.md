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

Chỉ mục tường minh: `telemetry_ts_idx ON telemetry (ts)`.

### Lưu ý riêng về cửa

`commands.device = 'door'` cùng `commands.action = 'open'|'close'|'auto'` biểu diễn yêu cầu điều khiển từ backend. `telemetry.door_command` là trường điều khiển cửa do firmware/simulator báo trong telemetry, với giá trị `open` hoặc `closed`. Theo `backend/docs/API_MQTT.md`, ACK của lệnh cửa chỉ xác nhận lệnh đã được gửi cho servo. Schema và model hiện không có cột cảm biến vị trí cửa, công tắc hành trình hay cờ “đã mở/đóng vật lý”. Vì vậy không được diễn giải `door_command` hoặc command ACK thành xác nhận vị trí vật lý.

## 3. Bảng `events`

Nguồn ghi: `Service.on_event()` kiểm tra payload bằng `models.Event`, gắn `ts` từ đồng hồ backend rồi gọi `PostgresStorage.save_event()`.

| Cột | Kiểu PostgreSQL | Nullable | PK/constraint | Ý nghĩa theo source | Nguồn dữ liệu |
|---|---|---:|---|---|---|
| `id` | `BIGSERIAL` | Không | PK | Số thứ tự hàng do PostgreSQL cấp | PostgreSQL sequence |
| `ts` | `TIMESTAMPTZ` | Không | `NOT NULL` | Thời điểm backend nhận event | `Service.clock()` → `to_timestamp()` |
| `type` | `TEXT` | Không | `NOT NULL` | Loại event; model cho phép `heat_alarm`, `smoke_alarm`, `pump`, `fan`, `door`, `led1`, `dht_error` | Payload event đã qua `Event` |
| `state` | `TEXT` | Không | `NOT NULL` | Pha event; model cho phép `start` hoặc `end` | Payload event đã qua `Event` |
| `value` | `DOUBLE PRECISION` | Có | — | Giá trị tùy chọn đi kèm event; source không quy định một đơn vị chung | Payload event |
| `threshold` | `DOUBLE PRECISION` | Có | — | Ngưỡng tùy chọn đi kèm event; source không quy định một đơn vị chung | Payload event |
| `reason` | `TEXT` | Có | — | Lý do tùy chọn | Payload event |
| `uptime_ms` | `BIGINT` | Có | — | Uptime thiết bị tại event; model yêu cầu trường này | Payload event |

Chỉ mục tường minh: `events_ts_idx ON events (ts)`.

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

Chỉ mục tường minh: `commands_sent_idx ON commands (sent_ts)`.

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
| `id` | `INTEGER` | Không | PK, `CHECK (id = 1)` | Khóa cố định để bảng chỉ giữ cấu hình hiện hành | Hằng `1` trong `save_config()` |
| `config_id` | `TEXT` | Không | `NOT NULL` | ID của lần đặt cấu hình gần nhất | `uuid.uuid4().hex` trong `Service.set_config()` |
| `thresholds` | `JSONB` | Không | `NOT NULL` | Object chứa bộ ngưỡng hiện hành | `Thresholds.model_dump()` |
| `ts` | `TIMESTAMPTZ` | Không | `NOT NULL` | Thời điểm cấu hình được lưu | `Service.clock()`; Storage fallback `time.time()` |

Không có chỉ mục tường minh ngoài primary key.

Object `thresholds` hiện có sáu khóa theo `models.Thresholds`: `fan_on`, `fan_off`, `heat_alarm_on`, `heat_alarm_off`, `smoke_high`, `smoke_low`. Model chỉ ràng buộc quan hệ hysteresis `off < on` hoặc `low < high`; DDL không áp đặt các kiểm tra này và source không khai báo đơn vị chung trong schema.

Trạng thái runtime của việc áp dụng config (`pending`, `applied`, `rejected`, `timeout`) và `detail` nằm trong bộ nhớ `Service._config`, không có cột tương ứng trong bảng `config`. Sau restart, `Service._initial_config()` đọc `config_id` và `thresholds`, rồi dựng trạng thái `pending` để publish lại khi MQTT kết nối.

Trạng thái MQTT online/offline cũng không nằm trong bốn bảng. `Service` chỉ giữ `_online`, `_last_seen`, `_offline_since` trong bộ nhớ và phát thay đổi qua WebSocket.

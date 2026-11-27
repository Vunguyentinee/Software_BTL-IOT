# API_MQTT v2 — Hợp đồng MQTT và REST (khớp firmware `ESP32_DigitalTwin_Gas34_Safety`)

> **Nguồn:** đọc từ mã nguồn firmware (`ESP32_DigitalTwin_Gas34_Safety.ino` và README/KIEM_THU_FIRMWARE.md đi kèm), không phải suy đoán.
> **Phạm vi kiểm chứng:** backend và simulator đã được kiểm thử theo hợp đồng này; **firmware chưa được nạp/kiểm thử trên board** cùng backend.
> Topic gốc `home/esp32-home/`. JSON UTF-8. Hợp đồng v1 (`API_MQTT.md`) vẫn còn hiệu lực cho phần không nêu lại ở đây.

## 0. Cảm biến gas và khói là MỘT cảm biến

Một module gas/khói (MQ-2) đọc ADC ở GPIO34, **được báo bằng tên `smoke_*`**: `smoke_raw` (ADC 0–4095, **không phải ppm**), `smoke_alarm`, sự kiện `smoke_alarm`, ngưỡng `smoke_high`/`smoke_low` (mặc định 2000/1500, hợp lệ `1 ≤ smoke_low < smoke_high ≤ 4094`).
Các trường `gas_raw`, `gas_alarm`, `gas_sensor_ok`, `safety_mode`, `safety_reason` (đề xuất trước đây, cột DB của Thái) **không được firmware gửi và không còn dùng**; để tương thích chúng vẫn được chấp nhận ở model nhưng luôn rỗng.

## 1. Topic

| Topic | Hướng | QoS / Retain | Ghi chú |
|---|---|---|---|
| `…/telemetry` | ESP32 → backend | 0 / không | Chu kỳ ~2 s; chỉ giữ bản mới nhất khi chờ phát |
| `…/event` | ESP32 → backend | 1 / không | Sự kiện đổi trạng thái và thông báo cảnh báo (`alarm_response`) |
| `…/event/ack` | backend → ESP32 | 1 / **không** | ACK ứng dụng cho cảnh báo (`source`: `backend` hoặc `operator`) |
| `…/cmd` | backend → ESP32 | 1 / **không** | Lệnh điều khiển, **bắt buộc mang phiên đích** |
| `…/cmd/ack` | ESP32 → backend | 1 / không | Kết quả xử lý lệnh |
| `…/config/set` | backend → ESP32 | 1 / **không** | Ngưỡng, **bắt buộc mang phiên đích** (thay đổi so với v1: không còn retained) |
| `…/config/ack` | ESP32 → backend | 1 / không | |
| `…/backend/heartbeat` | backend → ESP32 | 1 / không | Chỉ dùng khi `MONITOR_BACKEND_HEARTBEAT=true` |
| `…/status` | ESP32 → backend | 1 / retained | `online` / Last Will `offline` |

Broker có xác thực: ESP32 dùng tài khoản `esp32` (mật khẩu `MQTT_DEVICE_PASSWORD`). Tài khoản này được **đọc** `cmd`, `config/set`, `event/ack`, `backend/heartbeat` và **ghi** `telemetry`, `event`, `cmd/ack`, `config/ack`, `status`. Lưu ý: khi ACL từ chối **đọc**, Mosquitto vẫn trả SUBACK thành công và chỉ không giao tin, nên lỗi cấu hình ACL không làm firmware báo lỗi mà chỉ âm thầm không nhận được tin (đã kiểm chứng trên Docker thật).

## 2. Telemetry (ESP32 → backend)

Các trường backend dùng:

| Trường | Ý nghĩa |
|---|---|
| `device_id`, `boot_id`, `seq`, `tx_count` | Định danh, mã khởi động (mới mỗi lần boot), số thứ tự (bắt đầu 0, +1), tổng số đã phát (= `seq`+1) |
| `connection_id` | Phiên MQTT hiện tại, **đổi mỗi lần nối lại** |
| `control_mode` | `remote_available` (nhận lệnh từ xa) / `offline_grace` / `local_auto` |
| `backend_state` | `unmonitored` / `waiting` / `online` / `timeout` |
| `temperature_c`, `humidity_pct`, `dht_ok`, `pir_ready`, `motion_detected`, `is_dark` | Như v1 (`null` khi DHT lỗi) |
| `door_command`, `fan_on`, `led1_on`, `led2_on`, `led3_on`, `heat_alarm`, `pump_on`, `uptime_ms`, `modes` | Như v1 (`pump_on` luôn `false`: chưa có bơm) |
| `smoke_raw`, `smoke_alarm` | Cảm biến gas/khói (mục 0) |
| `door_safety_lock` | Cửa đang bị khóa mở theo bảo vệ gas/khói |
| `gas_sensor_fault` | ADC kẹt biên 0/4095 |
| `active_alarms[]` | Cảnh báo hiện hành: `{alarm, event_id, started_ms, backend_ack, backend_overdue, operator_ack, operator_overdue}` |
| `door_open_feedback`, `fan_rotation_feedback` | `disabled` / `waiting` / `confirmed` / `unconfirmed` (cần công tắc hành trình/tach) |

`seq` giúp phát hiện trùng/muộn/mất gói theo `(device_id, boot_id)`; `tx_count` cho phép tính tỷ lệ mất gói thật.

## 3. Phiên đích

Mọi lệnh, cấu hình và heartbeat phải mang `target_boot_id` và `target_connection_id` lấy từ **telemetry mới nhất có `control_mode=remote_available`**.

```json
{"cmd_id":"9f2c…","device":"door","action":"open","target_boot_id":"<boot_id>","target_connection_id":5}
```

Firmware từ chối (ACK `failed`) khi: thiếu phiên (`missing_target_session`), sai boot (`wrong_target_boot_id`), sai kết nối (`wrong_target_connection_id`), lệnh nằm trong hàng đợi thiết bị quá 1 giây hoặc thuộc kết nối cũ (`command_expired_on_device`), hoặc backend không khả dụng khi giám sát heartbeat (`backend_unavailable`). Phiên đích chặn lệnh thuộc **boot hoặc kết nối cũ** (kết nối mới có `connection_id` mới). Nó **không** chặn lệnh bị **trễ trên mạng** khi kết nối TCP vẫn sống: lệnh vẫn đúng phiên nên thiết bị thực thi muộn (xem mục 9, đã tái hiện).

Backend: lấy phiên từ telemetry; **từ chối ngay** (HTTP 409 `control_unavailable`, kèm `mode`) khi thiết bị đang `offline_grace`/`local_auto`; thiết bị cũ/simulator không báo phiên thì không gắn trường đích. Khi thiết bị khởi động lại hoặc nối lại (phiên mới) backend **tự gửi lại ngưỡng đang cấu hình**.

## 4. Lệnh và ACK

- `device` ∈ `led1`, `fan` (`on`/`off`/`auto`), `door` (`open`/`close`/`auto`).
- ACK: `{cmd_id, boot_id, connection_id, result: ok|failed, detail}`. `ok` = firmware **đã xử lý**; vị trí cửa/quạt quay thật chỉ được xác nhận khi bật phản hồi vật lý (công tắc hành trình GPIO23, tach GPIO19). Lệnh thành công có thể kèm `detail` thông tin (`servo_command_sent`, `auto_mode_applied`, `door_held_open`).
- Firmware lưu kết quả 32 `cmd_id` gần nhất: lệnh trùng trả lại kết quả đã lưu, không thực thi lại.
- Backend gắn **người gửi** vào lệnh (`source = web:<tên đăng nhập>`).
- Lệnh còn mang `issued_ts`, `expires_ts` (giây epoch, đồng hồ backend, `expires_ts = issued_ts + 5 s`). Firmware hiện tại **bỏ qua** hai trường này (không có đồng hồ). Thiết bị có đồng hồ đồng bộ (SNTP) nên từ chối lệnh quá hạn bằng ACK `failed`, `detail=command_expired_on_device`.

### Mã `detail` khi từ chối (firmware)

| `detail` | Khi nào |
|---|---|
| `safety_override_heat_alarm` | `fan off` khi đang cảnh báo nhiệt |
| `safety_override_gas_fan_hold` | `fan on/off` khi cửa đang bị khóa theo gas/khói |
| `safety_override_smoke_alarm` | `door close` khi đang cảnh báo gas/khói |
| `safety_door_hold_active` | `door close` khi cảnh báo đã hết nhưng còn giữ cửa (đếm 60 s) |
| `unsupported_device_or_action`, `invalid_command` | Sai thiết bị/hành động/định dạng |
| `missing_target_session`, `wrong_target_boot_id`, `wrong_target_connection_id`, `command_expired_on_device`, `backend_unavailable` | Mục 3 |

Backend kiểm tra trước các ràng buộc an toàn trên telemetry mới nhất (cùng quy tắc, cùng mã `detail`) và trả HTTP 409 `{"detail":"safety_override","reason":"heat_alarm|gas_fan_hold|smoke_alarm|door_hold_active"}`, **không gửi xuống thiết bị**. Thiết bị vẫn tự thi hành ràng buộc (kể cả khi mất mạng).

## 5. Quy tắc an toàn (firmware)

- **Cửa:** AUTO giữ mở 10 s sau lần cuối PIR HIGH. Khi gas/khói ≥ `smoke_high`: mở ngay, **kể cả chế độ thủ công**, từ chối đóng. Sau khi hết cảnh báo cửa vẫn giữ mở cho tới khi có **60 s mẫu thấp hợp lệ liên tục** (mẫu 1501–1999 hoặc cao thì đếm lại); khóa được lưu NVS và khôi phục sau reset. ADC kẹt biên 0/4095 trong 2 s → `gas_sensor_fault`, giữ cửa.
- **Quạt:** cảnh báo nhiệt (≥ `heat_alarm_on`) hoặc cảnh báo khói ép quạt chạy (kể cả thủ công); cảnh báo nhiệt thì từ chối `fan off`; khi cửa bị khóa theo gas thì từ chối mọi lệnh quạt tay, sau khi hết khói (còn giữ 60 s) quạt giữ nguyên đầu ra.
- **Mất mạng:** chế độ tay giữ 30 s (`ConnectionPolicy::fallbackMs`, bản Hoan_Thien) rồi về AUTO tại chỗ; cảnh báo và khóa vẫn chạy.

## 6. Sự kiện và xác nhận cảnh báo

`event.type` gồm `heat_alarm`, `smoke_alarm`, `fan`, `door`, `led1`, `dht_error`, `gas_sensor_fault`, `door_open_unconfirmed`, `fan_rotation_unconfirmed`, `local_control`, `remote_control`, `alarm_response`; `state` ∈ `start`, `end`, `retry`, `escalated`.

`alarm_response` (`event_id = <boot_id>-<hex8>`, `alarm`, `started_ms`, `backend_ack`, `backend_overdue`, `operator_ack`, `operator_overdue`):

| Mốc | Firmware | Backend |
|---|---|---|
| 0 s | gửi `start` | **tự gửi ACK** `{"event_id","source":"backend"}` lên `event/ack` (cả với `retry`, `escalated`) |
| 3 s chưa có ACK backend | gửi lại `retry` mỗi 3 s | — |
| 10 s chưa có ACK người dùng | LCD "CHUA XAC NHAN", gửi `escalated` | — |
| Người vận hành xác nhận | xóa nhắc quá hạn (không tắt báo động) | `POST /api/alarms/{event_id}/ack` (vai trò `operator`) → `{"event_id","source":"operator"}` |

Backend chỉ chấp nhận xác nhận cho `event_id` đang có trong `active_alarms` (ngược lại 404). Cảnh báo kết thúc gửi `end`; tái diễn dùng ID mới.

## 7. Heartbeat backend

Backend gửi `{"target_boot_id","target_connection_id"}` lên `backend/heartbeat` mỗi 2 s khi thiết bị online và có phiên. Chỉ có tác dụng khi firmware đặt `MONITOR_BACKEND_HEARTBEAT=true` (mặc định `false`): sau 8 s không có heartbeat hợp lệ firmware từ chối lệnh từ xa, sau 30 s chuyển AUTO tại chỗ.

## 8. REST (bổ sung so với v1)

| Endpoint | Quyền | Mô tả |
|---|---|---|
| `POST /api/auth/login` | công khai | `{username,password}` → JWT |
| `POST /api/devices/{device}/command` | operator | 409 `device_offline` / `control_unavailable` / `safety_override`; 503 `mqtt_publish_failed` |
| `POST /api/alarms/{event_id}/ack` | operator | Xác nhận cảnh báo; 404 `alarm_not_found` |
| `PUT /api/config` | admin | Ngưỡng; được gửi kèm phiên đích, tự gửi lại khi thiết bị đổi phiên |
| `GET /api/history/reliability`, `/commands/stats`, `/connections`, `/errors`, `/api/metrics/latency`, `/api/health` | đọc | Như bản trước |

## 9. Giới hạn đã biết (không che giấu)

- Chưa có kết quả kiểm thử với firmware/phần cứng thật; các số đo hiện tại lấy từ simulator.
- `smoke_raw` là ADC chưa hiệu chuẩn (không phải ppm). Hở dây hoặc cảm biến lệch vẫn có thể cho giá trị trong dải hợp lệ.
- `pump_on` luôn `false` (chưa có bơm); phản hồi cửa/quạt mặc định tắt (`disabled`), nên `confirmed_ts` của backend vẫn là suy luận từ telemetry.
- Hàng đợi sự kiện của firmware (24 chỗ, RAM) có thể thiếu/muộn khi offline dài; backend đối soát bằng `active_alarms` trong telemetry.
- Mất gói ở **cuối** luồng telemetry không phát hiện được bằng khoảng hở `seq`.
- **Lệnh bị trễ trên mạng vẫn có thể thực thi muộn (lỗ hổng đã tái hiện, chưa khắc phục ở firmware).** Kịch bản: cắt mạng giữa broker và thiết bị, gửi lệnh `fan on` lúc thiết bị còn online; backend đánh dấu `timeout` sau 5 s, nhưng sau khi mạng nối lại kết nối TCP cũ vẫn sống nên `connection_id` không đổi và thiết bị thực thi lệnh (`late_ack:ok`, `fan_on=true`). Firmware chỉ kiểm tra tuổi lệnh trong hàng đợi **của chính nó** (1 s), không kiểm tra độ trễ mạng. Khi simulator bật kiểm tra `expires_ts` (mô phỏng firmware có SNTP) lệnh bị từ chối và `fan_on=false`. Giảm thiểu hiện tại: backend ghi `late_ack:<kết quả>` vào lệnh `timeout` để người dùng biết kết quả thật không chắc chắn.

## 10. Điểm cần xác nhận

| # | Nội dung | Người |
|---|---|---|
| 1 | Bật `MONITOR_BACKEND_HEARTBEAT=true` khi tích hợp (backend đã gửi heartbeat) | Hiệu |
| 2 | Điền `MQTT_USER="esp32"` và mật khẩu qua file không commit (vd. `secrets.h`); firmware hiện để trống | Hiệu |
| 3 | `MQTT_CLIENT_ID` trùng `device_id` (`esp32-home`) và topic gốc; dừng simulator khi chạy thiết bị thật | Hiệu |
| 3b | **Thêm SNTP và từ chối lệnh quá `expires_ts`** (`command_expired_on_device`) để chặn lệnh bị trễ trên mạng; hoặc đề xuất cách khác ở firmware | Hiệu |
| 4 | Chạy 26 ca F01–F26 trên board và gửi bảng số liệu | Hiệu |
| 5 | Các cột `gas_raw`, `gas_alarm`, `gas_sensor_ok`, `safety_mode`, `safety_reason` không còn nguồn dữ liệu: dữ liệu gas nằm ở `smoke_raw`/`smoke_alarm` | Thái |
| 6 | Lưu `connection_id`, `control_mode`, `tx_count`, `door_safety_lock`; tính `delivery_rate` từ `tx_count`; bảng sự kiện cần chứa `retry`/`escalated`, `event_id` | Thái |
| 7 | Cột `confirmed_ts` trong bảng `commands` | Thái |

# API_MQTT v2 — Hợp đồng MQTT và REST

> **Trạng thái:** `PROPOSED` — bản đề xuất của Vũ (Backend), **chờ Hiệu (firmware) và Thái (database) xác nhận** từng mục ở phần 9.
> **Tương thích ngược:** v2 chỉ **thêm** trường và mã lý do. Mọi payload v1 (`API_MQTT.md`) vẫn hợp lệ; backend không làm hỏng khi thiếu trường mới.
> Topic gốc: `home/esp32-home/`. Mã hóa JSON UTF-8.

## 1. Danh sách topic

| Topic | Hướng | QoS / Retain | Ghi chú |
|---|---|---|---|
| `…/telemetry` | ESP32 → backend | 0 / không | Mỗi 2 giây và khi có thay đổi; cũng là heartbeat |
| `…/event` | ESP32 → backend | 1 / không | Sự kiện bắt đầu/kết thúc, edge-triggered |
| `…/cmd` | backend → ESP32 | 1 / không | Lệnh điều khiển |
| `…/cmd/ack` | ESP32 → backend | 1 / không | Kết quả xử lý lệnh |
| `…/config/set` | backend → ESP32 | 1 / retained | Ngưỡng mới |
| `…/config/ack` | ESP32 → backend | 1 / không | Xác nhận ngưỡng |
| `…/status` | ESP32 → backend | 1 / retained | `online` / `offline` (Last Will) |
| `…/sim/state`, `…/sim/scenario` | simulator ↔ backend | như v1 | Chỉ ESP32 giả lập |

## 2. Telemetry (ESP32 → backend)

```json
{
  "device_id": "esp32-home",
  "boot_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "seq": 105,
  "temperature_c": 28.5, "humidity_pct": 65.0, "dht_ok": true,
  "pir_ready": true, "motion_detected": false, "is_dark": false,
  "door_command": "closed", "fan_on": false,
  "led1_on": false, "led2_on": false, "led3_on": false,
  "heat_alarm": false, "uptime_ms": 360000,
  "smoke_raw": 180, "smoke_alarm": false, "pump_on": false,
  "gas_raw": 450, "gas_alarm": false, "gas_sensor_ok": true,
  "safety_mode": "normal", "safety_reason": null,
  "modes": {"led1": "auto", "fan": "auto", "door": "auto"}
}
```

| Trường | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `device_id` | string | khuyến nghị | Mã thiết bị, ổn định giữa các lần khởi động |
| `boot_id` | string | khuyến nghị | Mã **mỗi lần khởi động**, sinh mới (UUID/ngẫu nhiên). Đổi `boot_id` = `seq` bắt đầu lại |
| `seq` | int ≥ 0 | khuyến nghị | Tăng đúng **+1** mỗi bản tin **trong cùng `boot_id`**. Không tăng khi gửi lại cùng một bản tin (retransmit) |
| `gas_raw` | int 0–4095 hoặc `null` | không | ADC thô MQ-2. **Không phải ppm**, chưa hiệu chuẩn |
| `gas_alarm` | bool hoặc `null` | không | `null` = không có cảm biến gas |
| `gas_sensor_ok` | bool hoặc `null` | không | `false` khi đứt dây/đọc lỗi |
| `safety_mode` | `normal` \| `gas_alert` \| `fire_alert` | không | Chế độ an toàn hiện tại |
| `safety_reason` | string hoặc `null` | không | Lý do kích hoạt `safety_mode` |

Backend dùng `(device_id, boot_id, seq)` để phát hiện **trùng** (bỏ qua, không ghi đè trạng thái), **đến muộn/sai thứ tự** (lưu nhưng không ghi đè trạng thái mới) và **mất gói** (khoảng `seq` bị nhảy). Thiếu `boot_id` hoặc `seq` thì bản tin được coi là dữ liệu cũ (legacy), không phân tích thứ tự.

## 3. Event (ESP32 → backend)

`type` ∈ `heat_alarm`, `smoke_alarm`, `gas_alarm`, `gas_error`, `pump`, `fan`, `door`, `led1`, `dht_error`; `state` ∈ `start`, `end`.
**Edge-triggered:** chỉ gửi khi trạng thái đổi, không lặp theo chu kỳ telemetry.

## 4. Lệnh và ACK

```json
// backend -> ESP32
{"cmd_id": "9f2c…", "device": "fan", "action": "off",
 "issued_ts": 1795446000.12, "expires_ts": 1795446005.12}
// ESP32 -> backend
{"cmd_id": "9f2c…", "result": "failed", "detail": "safety_override:heat_alarm",
 "device_id": "esp32-home", "boot_id": "9b1deb4d-…"}
```

- `device` ∈ `led1`, `fan` (`on`/`off`/`auto`), `door` (`open`/`close`/`auto`).
- `result` ∈ `ok`, `failed`. ESP32 phải trả ACK trong **5 giây**; quá hạn backend đánh dấu `timeout`.
- `device_id`, `boot_id` trong ACK là tùy chọn (khuyến nghị).
- **Hạn dùng của lệnh:** `issued_ts` và `expires_ts` (giây epoch, đồng hồ backend; `expires_ts = issued_ts + 5 s`). Thiết bị **có đồng hồ đồng bộ (NTP)** phải **bỏ qua lệnh đã quá hạn** và trả ACK `failed` với `detail="expired"`, không thay đổi trạng thái. Lý do: lệnh QoS 1 có thể bị giữ lại khi mạng bán-mở và giao muộn sau khi nối lại (đã tái hiện trong kiểm thử F2h: lệnh đã `timeout` ở backend nhưng quạt vẫn bật muộn). Thiết bị không có đồng hồ thì không chống được; xem phần 8.
- **ACK nghĩa là gì:** `ok` = firmware **đã xử lý** lệnh (ghi trạng thái/cấp tín hiệu ra chân). **Không** có nghĩa cơ cấu vật lý (quạt quay, servo tới vị trí) đã hoàn thành.

### 4.1 Mã `detail` chuẩn

| `detail` | Ý nghĩa |
|---|---|
| `safety_override:<reason>` | Lệnh bị từ chối do ràng buộc an toàn. `<reason>` ∈ `heat_alarm`, `gas_alarm`, `smoke_alarm`. Ví dụ: đang `heat_alarm` thì không cho `fan off` |
| `expired` | Lệnh đã quá `expires_ts` (không thực thi) |
| `invalid_action` | Thiết bị/hành động không hợp lệ với firmware |
| `hardware_fault` | Cơ cấu chấp hành lỗi (relay/servo) |
| `busy` | Đang thực hiện lệnh khác |
| `mqtt_publish_failed` | **Backend** không publish được lệnh (không đến ESP32) |
| `no ack from device` | **Backend** ghi khi timeout |
| `late_ack:<ok\|failed>` | **Backend** ghi khi ACK đến sau timeout |

### 4.2 Vòng đời lệnh (backend)

`pending` → `ok` | `failed` | `timeout`. Trạng thái cuối **không đổi** nữa. ACK trùng bị bỏ qua. ACK muộn chỉ bổ sung `detail`, không đổi `timeout` thành `ok`. Lệnh trùng (cùng `device` + `action` đang `pending`) trả lại `cmd_id` đang chờ, không publish lần hai.

### 4.3 Ba mức xác nhận

| Mức | Trường | Nguồn |
|---|---|---|
| Đã gửi | `sent_ts` | backend lúc publish |
| Firmware đã xử lý | `ack_ts`, `status=ok` | ACK từ ESP32 |
| Cơ cấu thực sự phản hồi | `confirmed_ts` | Telemetry sau đó khớp trạng thái đích (`fan_on`, `led1_on`, `door_command`). Nếu phần cứng có cảm biến phản hồi thì chính cảm biến đó là nguồn |

`confirmed_ts` chỉ là **suy luận từ telemetry**, không phải đo trực tiếp vị trí vật lý (xem giới hạn ở phần 8).

## 5. Quy tắc cửa và an toàn (firmware phải khớp simulator)

- Auto bình thường: cửa giữ mở **10 giây** sau lần cuối PIR phát hiện chuyển động.
- `gas_alarm = true`: cửa **mở và giữ mở liên tục**.
- `gas_alarm` hết: giữ mở thêm **60 giây**. Nếu cảnh báo bật lại trong lúc đếm, hủy bộ đếm và **đếm lại 60 giây** từ lần hết cảnh báo kế tiếp.
- `heat_alarm = true`: quạt phải bật; lệnh thủ công `fan off` bị từ chối (`safety_override:heat_alarm`). Các ràng buộc này ESP32 tự thi hành tại chỗ, kể cả khi mất mạng.

## 6. Mốc thời gian

| Mốc | Đơn vị | Ai ghi | Dùng để |
|---|---|---|---|
| `ts` (bản ghi) | giây epoch (backend) | backend lúc **nhận** | Thứ tự, lưu trữ |
| `uptime_ms` | ms từ lúc khởi động | ESP32 | Chênh lệch trong cùng `boot_id`; **không** so sánh với đồng hồ backend |
| `sent_ts`, `ack_ts`, `confirmed_ts` | giây epoch (backend) | backend | Độ trễ gửi→ACK, gửi→xác nhận |

Đồng hồ ESP32 và backend **không đồng bộ**; độ trễ một chiều chỉ tính bằng đồng hồ backend.

## 7. REST API (v2 bổ sung)

| Endpoint | Quyền | Mô tả |
|---|---|---|
| `POST /api/auth/login` | công khai | `{username,password}` → JWT |
| `GET /api/history/reliability` | đọc | Thống kê nhận/lưu/trùng/mất/sai thứ tự |
| `GET /api/history/commands/stats` | đọc | Thống kê lệnh theo trạng thái |
| `GET /api/history/connections` | đọc | Lịch sử mất/khôi phục kết nối |
| `GET /api/history/errors` | đọc | Sự kiện lỗi (gas, DHT…) |
| `GET /api/metrics/latency` | đọc | avg/P95/max của gửi→ACK, gửi→xác nhận |
| `GET /api/health` | đọc | `mqtt.connected`, `storage.ok/errors/last_error_ts`, `device_online` — lỗi hạ tầng được công bố |
| Điều khiển (`POST /api/devices/*/command`, `POST /api/sim/scenario`) | `operator` | cần JWT |
| `PUT /api/config` | `admin` | cần JWT |

Mã lỗi mới: `401` chưa/ sai đăng nhập, `403` thiếu quyền, `409 safety_override` (kèm `reason`), `429` quá giới hạn, `503 mqtt_publish_failed` hoặc `503` khi lưu trữ không hoạt động. Endpoint v1 giữ nguyên.

## 8. Giới hạn đã biết (không che giấu)

- Chưa có cảm biến phản hồi quạt/cửa: `confirmed_ts` là suy luận từ telemetry.
- `gas_raw` chưa hiệu chuẩn sang ppm; chưa xác nhận gas và smoke là hai cảm biến độc lập.
- Firmware **chưa có NTP** thì không kiểm tra được `expires_ts`; lệnh giao muộn vẫn bị thực thi. Cần Hiệu bổ sung đồng bộ giờ (SNTP).
- Mất gói ở **cuối** luồng telemetry không phát hiện được bằng khoảng hở `seq` (cần có bản tin sau); chỉ phát hiện được khi bản tin kế tiếp đến.
- `delivery_rate` chỉ tính được khi firmware gửi bộ đếm phát `tx_count` (xem phần 9).

## 9. Điểm chờ xác nhận

| # | Nội dung | Người |
|---|---|---|
| 1 | `device_id`, `boot_id`, `seq` đúng quy tắc phần 2 (`boot_id` sinh mới mỗi lần khởi động, `seq` +1) | Hiệu |
| 2 | Có gửi `tx_count` (số bản tin đã phát) để tính tỷ lệ mất gói thật không | Hiệu |
| 3 | Mã `detail` ở 4.1 và quy tắc cửa/an toàn ở phần 5 | Hiệu |
| 3b | Firmware đồng bộ giờ (SNTP) và từ chối lệnh quá `expires_ts` với `detail=expired` | Hiệu |
| 4 | Tên trường gas/safety khớp schema DB (`gas_raw`, `gas_alarm`, `gas_sensor_ok`, `safety_mode`, `safety_reason`) | Thái |
| 5 | Cột `confirmed_ts` trong bảng `commands` và endpoint phần 7 | Thái |

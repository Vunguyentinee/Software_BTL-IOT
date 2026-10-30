# Tài liệu API và MQTT

Hệ thống có **một ESP32**, `device_id` = `esp32-home`. Mọi topic có tiền tố `home/esp32-home/` (viết tắt `…/` bên dưới). Tất cả payload là JSON UTF-8, trừ `status` (chuỗi thô).

## 1. MQTT

| Topic | Hướng | QoS / retained | Mục đích |
|---|---|---|---|
| `…/telemetry` | ESP32 → backend | 0 / không | Số đo và trạng thái, gửi **mỗi 2 giây** và khi có thay đổi. Cũng là heartbeat. |
| `…/event` | ESP32 → backend | 1 / không | Sự kiện bắt đầu/kết thúc (cảnh báo, bơm, quạt…) |
| `…/cmd` | backend → ESP32 | 1 / không | Lệnh điều khiển thủ công |
| `…/cmd/ack` | ESP32 → backend | 1 / không | Kết quả thực thi lệnh |
| `…/config/set` | backend → ESP32 | 1 / **retained** | Ngưỡng mới |
| `…/config/ack` | ESP32 → backend | 1 / không | Xác nhận áp dụng ngưỡng |
| `…/status` | ESP32 → backend | 1 / **retained** | Chuỗi `online` / `offline` |

### telemetry
```json
{
  "temperature_c": 36.0, "humidity_pct": 70.0, "dht_ok": true,
  "pir_ready": true, "motion_detected": true, "is_dark": true,
  "door_command": "open", "fan_on": true,
  "led1_on": true, "led2_on": true, "led3_on": false,
  "heat_alarm": false, "uptime_ms": 120000,
  "smoke_raw": 310, "smoke_alarm": false, "pump_on": false,
  "modes": {"led1": "auto", "fan": "manual", "door": "auto"}
}
```
- 13 trường đầu theo đặc tả ESP32 (bắt buộc). `door_command` ∈ `open` | `closed`.
- `temperature_c`, `humidity_pct` là `null` khi `dht_ok` = false.
- `smoke_raw` (analog 0–4095, có thể `null`), `smoke_alarm`, `pump_on`, `modes` là phần bổ sung; thiếu thì dùng giá trị mặc định (`null`, `false`, `false`, `{}`).
- `modes[...]` ∈ `auto` | `manual`.
- Bản tin sai/thiếu trường bị backend bỏ qua (ghi log).

### event
```json
{"type": "pump", "state": "start", "value": 2300, "threshold": 2000, "reason": "smoke", "uptime_ms": 5000}
```
`type` ∈ `heat_alarm`, `smoke_alarm`, `pump`, `fan`, `door`, `led1`, `dht_error`; `state` ∈ `start`, `end`; `value`, `threshold`, `reason` tùy chọn.

### cmd / cmd/ack
```json
{"cmd_id": "9f2c…", "device": "fan", "action": "on"}
{"cmd_id": "9f2c…", "result": "ok", "detail": null}
```
`device` ∈ `led1`, `fan` (action `on`/`off`/`auto`), `door` (action `open`/`close`/`auto`). `auto` đưa thiết bị về chế độ tự động; các action khác chuyển sang `manual` **cho đến khi nhận `auto`**. `result` ∈ `ok`, `failed`. ESP32 phải trả ack trong **5 giây**, nếu không lệnh bị đánh dấu `timeout`. Ack của `door` chỉ có nghĩa lệnh đã gửi cho servo.

### config/set / config/ack
```json
{"config_id": "1af9…", "thresholds": {"fan_on": 35, "fan_off": 34, "heat_alarm_on": 40, "heat_alarm_off": 37, "smoke_high": 2000, "smoke_low": 1500}}
{"config_id": "1af9…", "result": "ok", "detail": null}
```
`result` ∈ `ok`, `rejected`. Vì tin được giữ retained, ESP32 khởi động lại và subscribe sẽ nhận lại ngưỡng mới nhất ngay; nó nên áp dụng rồi ack lại.

### status
ESP32 đăng ký **Last Will** với topic `…/status`, payload `offline`, retained, QoS 1. Sau khi kết nối thì publish `online` (retained). Backend coi ESP32 mất kết nối khi nhận `offline` hoặc **quá 10 giây không có `telemetry`**.

## 2. REST API (cổng 8000)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/state` | `{online, last_seen, offline_since, telemetry}` (thời gian là epoch giây, giờ laptop) |
| GET | `/api/history?metric=&from=&to=` | `metric` là tên trường số của telemetry (ví dụ `temperature_c`, `humidity_pct`, `smoke_raw`); `from`/`to` là epoch giây hoặc ISO 8601. Trả `[{ts, value}]`. Metric lạ hoặc thời gian sai → 422. |
| GET | `/api/events?limit=` | Sự kiện mới nhất trước |
| GET | `/api/commands?limit=` | Lệnh mới nhất trước |
| GET | `/api/commands/{cmd_id}` | `status` ∈ `pending`, `ok`, `failed`, `timeout`; 404 nếu không có |
| POST | `/api/devices/{device}/command` | Body `{"action": "on"}`. 200 `{cmd_id, status}`; **409** `device_offline`; **422** thiết bị/hành động sai |
| GET | `/api/config` | `{config_id, thresholds, status, detail}`; `status` ∈ `none`, `pending`, `applied`, `rejected`, `timeout` |
| PUT | `/api/config` | Body là 6 ngưỡng (trường nào bỏ trống dùng mặc định). 200 trạng thái `pending`; **422** nếu `fan_off ≥ fan_on`, `heat_alarm_off ≥ heat_alarm_on` hoặc `smoke_low ≥ smoke_high` |

Web nên coi lệnh/ngưỡng là thành công **chỉ khi** `status` = `ok` / `applied`; nhận qua WebSocket hoặc hỏi lại `GET`.

## 3. WebSocket `/ws`

Sau khi kết nối nhận ngay `{"kind": "snapshot", "data": <như /api/state>}`, rồi các tin:

| kind | data |
|---|---|
| `telemetry` | bản telemetry kèm `ts` |
| `event` | sự kiện kèm `ts` |
| `connection` | `{online, since, …}` khi online/offline đổi |
| `command` | bản ghi lệnh mỗi khi đổi trạng thái |
| `config` | như `GET /api/config` |

## 4. Luồng dữ liệu

```
Gửi lệnh:  web --POST command--> backend --MQTT cmd--> ESP32
           web <--WS 'command'-- backend <--MQTT cmd/ack-- ESP32 (thực thi rồi ack)
Đổi ngưỡng: web --PUT config--> backend --MQTT config/set (retained)--> ESP32 (áp dụng)
           web <--WS 'config'-- backend <--MQTT config/ack-- ESP32
Dữ liệu:   ESP32 --telemetry/event--> backend --WS--> web ; backend --> lớp lưu trữ
```

## 5. Việc firmware (Người 2, 3) cần làm

1. Kết nối WiFi và MQTT tới IP laptop (cổng 1883), ví dụ thư viện `PubSubClient`.
2. Đăng ký Last Will `…/status` = `offline` (retained, QoS 1); sau khi kết nối publish `online`.
3. Publish `…/telemetry` mỗi 2 giây theo đúng cấu trúc ở trên, bổ sung `smoke_raw`, `smoke_alarm`, `pump_on`, `modes`.
4. Subscribe `…/cmd` và `…/config/set`; thực thi rồi publish ack (lệnh thủ công giữ đến khi nhận `auto`).
5. Cảnh báo khói được ưu tiên hơn chế độ thủ công; giới hạn thời gian chạy bơm trong firmware; publish `event` khi bật/tắt bơm và cảnh báo.
6. Cần cung cấp chân GPIO của cảm biến khói và bơm (đặc tả hiện chưa có).

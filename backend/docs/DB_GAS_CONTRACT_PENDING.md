# Chốt Hợp đồng Cảm biến Khói / Gas & Chế độ An toàn V2 (Gas/Smoke & Safety Contract V2)

Tài liệu này xác định thỏa thuận kỹ thuật cuối cùng về module cảm biến khí/khói và an toàn giữa các thành phần **Firmware ESP32 (Hiệu)**, **Backend/MQTT (Vũ)**, **Website (Đức)**, **Điều khiển (Kiên)** và **Database & History (Thái)**.

---

## 1. Kết luận Thống nhất Phần cứng & Cảm biến Khí / Khói (Hardware Single Sensor Contract)

1. **Phần cứng thực tế**: Hệ thống chỉ trang bị **duy nhất một module cảm biến khí MQ-2** kết nối tại chân analog **GPIO34** của ESP32.
2. **Không có hai cảm biến độc lập**: Cảm biến này đo nồng độ các loại khí dễ cháy và khói nói chung trong không khí. Trong đồ án mô hình Digital Twin Nhà thông minh, module này được quy ước kỹ thuật là **cảm biến khói chính (`smoke_*`)**.
3. **Giá trị đo thô (ADC Raw)**: Trường `smoke_raw` đọc giá trị ADC 12-bit từ 0 đến 4095. Đây là giá trị điện áp thô, **không phải nồng độ ppm** (chưa qua buồng hiệu chuẩn chuẩn độ khí và nhiệt độ/độ ẩm bù trừ).
4. **Trạng thái cảnh báo**: Cờ `smoke_alarm` kích hoạt khi giá trị `smoke_raw` vượt ngưỡng cấu hình `smoke_high` (hoặc do ESP32/Backend đánh giá).
5. **Quy ước cột `gas_*` cũ (Deprecated / Legacy Columns)**:
   - 5 cột đã tạo trong migration trước (`gas_raw`, `gas_alarm`, `gas_sensor_ok`, `safety_mode`, `safety_reason`) được **bảo toàn 100% trong schema PostgreSQL** để giữ khả năng đọc và tương thích ngược với dữ liệu cũ.
   - **Tuyệt đối không chạy DROP COLUMN**.
   - Với các bản tin Telemetry V2 mới, nếu firmware không gửi các trường này, database lưu giá trị `NULL`. Hệ thống không sao chép dữ liệu giả từ `smoke_*` sang `gas_*`.

---

## 2. Ma trận Trạng thái Kỹ thuật (Technical Status Matrix V2)

| Hạng mục | Trạng thái kỹ thuật | Thành phần phụ trách | Ghi chú kiểm chứng & Thực thi |
| :--- | :--- | :--- | :--- |
| **Cảm biến khói MQ-2 (GPIO34)** | `IMPLEMENTED & VERIFIED` | ESP32 (Hiệu) & DB (Thái) | Lưu trữ qua `smoke_raw` (ADC 0–4095) và `smoke_alarm`. Kiểm thử tự động 100% PASS. |
| **5 Cột Legacy Gas** | `DEPRECATED / COMPATIBLE`| Database (Thái) | Bảo tồn trong DDL, nullable, hỗ trợ đọc dữ liệu lịch sử cũ, không drop cột. |
| **Telemetry V2 Schema Extension** | `IMPLEMENTED & TESTED` | Database (Thái) | Idempotent migration 7 cột: `connection_id`, `control_mode`, `backend_state`, `tx_count`, `door_safety_lock`, `gas_sensor_fault`, `active_alarms`. |
| **Tỷ lệ Phân phối (Delivery Rate)** | `IMPLEMENTED & TESTED` | Database (Thái) | Công thức chuẩn xác: $delivery\_rate = received\_unique / tx\_attempted\_count$. Tính theo session `(device_id, boot_id)`, không cộng dồn sai lệch. |
| **Vòng đời Sự kiện (Event Lifecycle V2)**| `IMPLEMENTED & TESTED` | Database (Thái) | Bảng `events` lưu `event_id`, `alarm` với các pha `start`, `retry`, `escalated`, `end`. `event_id` không bị ràng buộc UNIQUE. |
| **Xác nhận Lệnh (Confirmed TS)** | `IMPLEMENTED & TESTED` | Database (Thái) | Bảng `commands` lưu `confirmed_ts` (thời điểm nhận telemetry khớp trạng thái đích). Thống kê `command_stats` đo lường `confirmed_count` và độ trễ xác nhận min/avg/max. |
| **Bộ lọc Sự kiện Lỗi Mở rộng** | `IMPLEMENTED & TESTED` | Database (Thái) | `list_error_events` lọc các lỗi V2: `gas_sensor_fault`, `door_open_unconfirmed`, `fan_rotation_unconfirmed`, `alarm_response`. |
| **REST APIs Mở rộng** | `VERIFIED ON MAIN` | Backend (Vũ) | Tất cả 7 endpoint REST đã được tích hợp đầy đủ trong `backend/app/api.py`. |
| **Giao diện Giám sát & Lịch sử** | `READY FOR UI` | Website (Đức) | Đức sử dụng các API `/api/history`, `/api/history/page`, `/api/history/stats`, `/api/history.csv`. |

---

## 3. Payload Contract Telemetry V2 Chuẩn Hóa

Payload telemetry chuẩn qua MQTT topic `home/esp32-home/telemetry`:

```json
{
  "device_id": "esp32-home",
  "boot_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "connection_id": 1,
  "seq": 105,
  "tx_count": 106,
  "control_mode": "auto",
  "backend_state": "nominal",
  "door_safety_lock": false,
  "gas_sensor_fault": false,
  "active_alarms": [],
  "temperature_c": 28.5,
  "humidity_pct": 65.0,
  "dht_ok": true,
  "pir_ready": true,
  "motion_detected": false,
  "is_dark": false,
  "door_command": "closed",
  "fan_on": false,
  "led1_on": false,
  "led2_on": false,
  "led3_on": false,
  "heat_alarm": false,
  "smoke_raw": 320,
  "smoke_alarm": false,
  "pump_on": false,
  "uptime_ms": 360000,
  "modes": {"fan": "auto"}
}
```

---

## 4. Chuẩn hóa Vòng đời Sự kiện (Event Lifecycle & Anti-Flooding)

Nhằm đảm bảo hiệu năng cơ sở dữ liệu và không làm quá tải bảng `events`:
- **Nguyên tắc Edge-Triggered**: Chỉ ghi nhận sự kiện khi có chuyển dịch trạng thái.
- **Vòng đời `alarm_response`**: Mỗi đợt cảnh báo khẩn cấp mang một `event_id` duy nhất và chuyển qua 4 pha:
  1. `state: "start"`: Kích hoạt cảnh báo ban đầu (t=0s), backend tự gửi ACK `{"event_id", "source": "backend"}` lên `event/ack`.
  2. `state: "retry"`: ESP32 gửi lại bản tin cảnh báo mỗi 3 giây nếu chưa nhận được ACK từ backend (đây là thử lại thông báo tầng mạng, KHÔNG phải thử lại cơ cấu chấp hành).
  3. `state: "escalated"`: Leo thang cảnh báo nếu sau 10–15 giây người vận hành chưa xác nhận trên giao diện Web (hiển thị "CHUA XAC NHAN" trên LCD).
  4. `state: "end"`: Cảnh báo kết thúc, nồng độ khói/khí giảm dưới ngưỡng và môi trường an toàn trở lại.
- **Sự kiện thông thường**: Các sự kiện cảnh báo thông thường (`smoke_alarm`, `heat_alarm`) từ firmware cũ có thể không mang `event_id` (trường `event_id` là nullable).
- **Ràng buộc Database**: `event_id` **không đặt UNIQUE** để một chuỗi sự kiện có thể ghi nhận đủ 4 trạng thái theo thời gian. Có chỉ mục `events_event_id_idx` để truy vấn vòng đời cực nhanh.

---

## 5. Ràng buộc An toàn Quạt & Cửa khi Cảnh báo Gas / Khói (Gas Safety & Fan Inhibit)

- **Nghiêm cấm bật/tắt quạt trong cảnh báo gas** (`safety_override_gas_fan_hold` / `fan_gas_inhibit`): Trong môi trường khí gas dễ cháy rò rỉ, việc bật hoặc tắt động cơ quạt có thể sinh ra tia lửa điện gây nổ. Do đó, firmware và backend giữ nguyên đầu ra quạt và từ chối mọi lệnh điều khiển tay (`HTTP 409 safety_override`), tuyệt đối không đề xuất bật quạt để hút khí gas.
- **Khóa an toàn cửa** (`door_safety_lock = true`): Cửa tự động mở hoặc giữ mở, từ chối lệnh đóng cửa (`safety_override_smoke_alarm`) để hỗ trợ thoát hiểm khẩn cấp.

# Tình trạng Tích hợp Cảm biến Gas & Chế độ An toàn (Gas & Safety Contract Status)

Tài liệu này xác định ranh giới trách nhiệm, những gì module **Database & History** đã hoàn thành độc lập và những nội dung đang chờ các thành viên khác hoàn thiện.

---

## 1. Phân định Trạng thái Chức năng (Status Matrix)

Theo quy chuẩn nghiệm thu kỹ thuật, các hạng mục được gắn nhãn minh bạch:

| Hạng mục | Trạng thái kỹ thuật | Thành phần phụ trách | Ghi chú kiểm chứng |
| :--- | :--- | :--- | :--- |
| **Schema & DDL Migration Gas/Safety** | `IMPLEMENTED & TESTED` | Database (Thái) | Idempotent migration 5 cột (`gas_raw`, `gas_alarm`, `gas_sensor_ok`, `safety_mode`, `safety_reason`). Integration test trên PostgreSQL testdb pass. |
| **Storage Stats & CSV Streaming Gas** | `IMPLEMENTED & TESTED` | Database (Thái) | Hỗ trợ phân trang, aggregate `count, avg, min, max`, CSV keyset streaming cho `gas_raw`. Bỏ qua `NULL` chính xác. |
| **Lọc Sự kiện Lỗi Gas** | `IMPLEMENTED & TESTED` | Database (Thái) | Bổ sung `'gas_alarm'`, `'gas_error'` vào `list_error_events()`. |
| **Bảo vệ API Metrics Allowlist** | `IMPLEMENTED & TESTED` | Database (Thái) | Loại trừ `safety_mode`, `safety_reason` khỏi `METRICS` trong `api.py` để không cho vào đồ thị số. |
| **Payload Telemetry Contract Gas** | `PENDING CONTRACT` | Backend (Vũ) & ESP32 (Hiệu) | Chờ nhóm thống nhất tên trường và kiểu dữ liệu chính thức qua MQTT. |
| **Đọc Cảm biến Gas Vật lý** | `PENDING HARDWARE VALIDATION` | ESP32 (Hiệu) | Chưa kiểm chứng phần cứng MQ-2 thật; chưa có code đọc ADC trên ESP32. |
| **Hiệu chuẩn Nồng độ Gas (PPM)** | `NOT YET VALIDATED` | Cả nhóm | `gas_raw` hiện tại là giá trị ADC 0–4095; chưa được hiệu chuẩn sang ppm. Không tự ý coi `gas_raw` tương đương ppm. |
| **Độc lập Cảm biến Gas & Khói** | `NOT YET VALIDATED` | ESP32 (Hiệu) | Chưa khẳng định gas và smoke là hai cảm biến độc lập (có thể dùng chung MQ-2 hoặc tách biệt). |
| **Quy tắc Điều khiển An toàn (Safety Rules)** | `PENDING RULES` | Điều khiển (Kiên) & Backend (Vũ) | Logic tự động kích hoạt quạt/cửa/còi khi có rò rỉ gas thuộc phần điều khiển. |
| **Phần cứng Ngắt An toàn (Safety Override)** | `PENDING HARDWARE VALIDATION` | ESP32 (Hiệu) | Chưa có mạch relay cơ học ngắt van gas thực tế; database chỉ lưu trữ cờ trạng thái. |
| **REST Endpoints Mở rộng** | `PENDING BACKEND INTEGRATION` | Backend (Vũ) | Các endpoint `reliability_stats`, `command_stats`, `error_events` đã có ở Storage, chờ Vũ expose lên REST API khi cần. |
| **Giao diện Giám sát Gas** | `PENDING FRONTEND` | Website (Đức) | Đức sử dụng các endpoint `/api/history?metric=gas_raw` và `/api/history/stats` để dựng UI. |

---

## 2. Phần Database & History đã triển khai thực tế (IMPLEMENTED & TESTED)

### 2.1. Cấu trúc Schema & Migration
Đã bổ sung 5 cột mới vào bảng `telemetry` của PostgreSQL thông qua migration an toàn, có khả năng chạy lại nhiều lần (idempotent):
- `gas_raw` (`INTEGER`): Giá trị nồng độ khí gas MQ-2 thô (0–4095).
- `gas_alarm` (`BOOLEAN`): Cờ cảnh báo rò rỉ khí gas.
- `gas_sensor_ok` (`BOOLEAN`): Trạng thái cảm biến gas hoạt động tốt (`NULL` nếu không có cảm biến).
- `safety_mode` (`TEXT`): Chế độ an toàn hệ thống (`normal`, `gas_alert`, `fire_alert`).
- `safety_reason` (`TEXT`): Nguyên nhân kích hoạt chế độ an toàn.

### 2.2. Tính tương thích ngược (Backward Compatibility)
- Bảo toàn dữ liệu khói cũ (`smoke_raw`, `smoke_alarm`), không làm thay đổi giá trị.
- Với các bản tin cũ không có gas, các cột trên nhận giá trị `NULL`. Hệ thống không tự suy diễn rằng thiếu gas đồng nghĩa cảm biến an toàn hay không có rò rỉ.
- Các API lịch sử (`history()`, `history_page()`, `history_stats()`, `history_csv()`) tiếp tục hoạt động bình thường, xử lý `NULL` chuẩn xác.

### 2.3. Hỗ trợ Thống kê & Phân tích
- Thêm `gas_raw` vào `HISTORY_METRICS` (hỗ trợ phân trang, xuất CSV).
- Thêm `gas_raw` vào `HISTORY_STATS_METRICS` (tính toán `count, avg, min, max` bằng SQL tối ưu).
- Thêm `gas_alarm` và `gas_error` vào bộ lọc sự kiện lỗi `list_error_events()`.
- Loại trừ `safety_mode` và `safety_reason` khỏi danh sách metric vẽ đồ thị số trong `api.py`.

---

## 3. Nội dung PENDING & Hướng dẫn Phối hợp Nhóm

### 3.1. Phối hợp với Hiệu (Firmware ESP32)
1. **Topic MQTT**: Xác nhận topic publish telemetry gas (mặc định hiện tại là `home/esp32-home/telemetry`).
2. **Payload Contract Đầy đủ**: Hiệu bổ sung các trường vào JSON payload hợp lệ với model `Telemetry`:
   ```json
   {
     "device_id": "esp32-home",
     "boot_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
     "seq": 105,
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
     "uptime_ms": 360000,
     "smoke_raw": 180,
     "smoke_alarm": false,
     "pump_on": false,
     "gas_raw": 450,
     "gas_alarm": false,
     "gas_sensor_ok": true,
     "safety_mode": "normal",
     "safety_reason": null,
     "modes": {"fan": "auto"}
   }
   ```
3. **Bộ đếm phát `tx_count`**: Nếu Hiệu gửi kèm `tx_count`, hệ thống sẽ tính được tỷ lệ phân phối thực tế $delivery\_rate = N_{\text{received}} / tx\_count$. Hiện tại khi chưa có, backend công bố `delivery_rate = None`.

### 3.2. Cơ chế Phát sinh Sự kiện Gas (Gas Event Contract)
Để tránh làm tràn ngập (flood) bảng `events` trong cơ sở dữ liệu:
- **Ai phát event?**: ESP32 (hoặc Service khi nhận telemetry) phát bản tin event lên MQTT topic `events`.
- **Nguyên tắc kích hoạt**: Phải tuân thủ cơ chế **Edge-triggered** (chỉ ghi nhận khi có chuyển đổi trạng thái):
  - Chuyển từ bình thường sang báo động (`gas_alarm: false -> true`): Ghi 1 event type `"gas_alarm"`, state `"start"`.
  - Chuyển từ báo động về bình thường (`gas_alarm: true -> false`): Ghi 1 event type `"gas_alarm"`, state `"end"`.
  - Nếu trạng thái `gas_alarm` không đổi giữa các chu kỳ telemetry (ví dụ vẫn giữ `true` liên tục trong 10 phút): **Không phát event lặp lại mỗi chu kỳ telemetry (2 giây/lần)**.
- Khi cảm biến gas bị lỗi phần cứng/đứt dây: Ghi 1 event type `"gas_error"`.

### 3.3. Phối hợp với Kiên (Điều khiển Tự động & Kịch bản)
1. **Quy tắc an toàn**: Khi `gas_alarm = true`, hệ thống có tự động bật quạt (`fan`), mở cửa (`door`) hay ngắt nguồn không? Logic này thuộc điều khiển của Kiên/Vũ, Database không can thiệp.
2. **Cập nhật Simulator**: Cập nhật kịch bản rò rỉ gas trong `fake_esp32.py` khi nhóm chốt hợp đồng.

### 3.4. Phối hợp với Vũ (Backend) & Đức (Frontend)
1. Expose các REST endpoint phân tích nếu cần:
   - `GET /api/history/reliability` (gọi `storage.reliability_stats`)
   - `GET /api/history/commands/stats` (gọi `storage.command_stats`)
   - `GET /api/history/connections` (gọi `storage.list_connection_events`)
   - `GET /api/history/errors` (gọi `storage.list_error_events`)
2. Frontend sử dụng các endpoint hiện có:
   - `GET /api/history?metric=gas_raw`
   - `GET /api/history/stats?metric=gas_raw`
   - `GET /api/history/page?metric=gas_raw`
   - `GET /api/history.csv?metric=gas_raw` (chú ý URL có `.csv`)

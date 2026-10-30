# Thiết kế: Backend và kết nối ESP32–Web (Người 4)

> **Trạng thái (cập nhật 2026-10-31):** đã triển khai xong trên nhánh `feature/backend`. Phần "Cập nhật sau thiết kế" ở cuối tài liệu ghi những điểm đã thay đổi so với bản thiết kế ban đầu.

Dự án: Digital Twin nhà thông minh (BTL IoT). Người phụ trách: Người 4. Người nhận bàn giao: Vũ.

## 1. Mục đích

Làm cầu nối giữa ESP32 (firmware C++ do Người 2, 3 viết) và website (Người 6, 7). Backend nhận dữ liệu cảm biến/trạng thái từ ESP32, kiểm tra định dạng, chuyển cho lớp lưu trữ, đẩy dữ liệu realtime lên web, nhận lệnh/ngưỡng từ web và gửi xuống ESP32, đồng thời phát hiện ESP32 mất kết nối.

## 2. Mục tiêu / Không phải mục tiêu / Điều cần tránh

**Mục tiêu**
- Luồng hai chiều hoàn chỉnh: ESP32 → backend → web (dữ liệu) và web → backend → ESP32 (lệnh, ngưỡng), có xác nhận kết quả.
- Backend chạy được độc lập với phần cứng thật nhờ script giả lập ESP32, để các thành viên khác làm song song.
- Tài liệu API và MQTT đủ rõ để Người 2, 3, 5, 6, 7 làm việc mà không phải hỏi lại.

**Không phải mục tiêu**
- Backend không tự quyết định bật/tắt thiết bị (không có rule engine ở backend).
- Chưa có đăng nhập/tài khoản trong bản đầu.
- Không triển khai cloud; không cần truy cập từ xa.
- Không thiết kế database đầy đủ (việc của Người 5); backend chỉ cung cấp bản bảng đầu tiên để chạy trọn vẹn.
- Không viết firmware hay giao diện web.

**Điều cần tránh (anti-goal)**
- Web báo "đã bật đèn" khi ESP32 chưa thực sự thực thi.
- Mất dữ liệu/ngưỡng khi ESP32 hoặc backend khởi động lại.

## 3. Ràng buộc

- Ngôn ngữ backend: **Python**. Firmware ESP32: C/C++ (thầy dạy C/C++).
- Chạy trên **một laptop của nhóm**, cùng mạng WiFi với ESP32. Broker MQTT (Mosquitto) và backend cùng chạy trên laptop đó.
- Hiện chỉ có ESP32 và mô hình nhà; chưa có broker, máy chủ hay phần mềm nào.

## 4. Các quyết định của người dùng

1. Backend viết bằng Python.
2. Mọi quy tắc tự động do **ESP32 tự xử lý tại chỗ** (Người 3). Backend chỉ ghi nhận, hiển thị, chuyển lệnh thủ công, báo cảnh báo và mất kết nối.
3. Web có cấu hình ngưỡng. Ngưỡng mới được **gửi xuống ESP32 và áp dụng ngay**.
4. Lệnh thủ công **giữ hiệu lực đến khi người dùng chuyển lại chế độ tự động** (không tự hết hạn).
5. Chưa cần đăng nhập.
6. Lưu trữ đặt sau một lớp trung gian (`Storage`). *Cập nhật:* nhóm đã chọn **PostgreSQL**, chạy bằng Docker Compose (xem cuối tài liệu).
7. Chỉ có **một ESP32** cho cả nhà (theo file đặc tả `Dac_ta_he_thong_nha_thong_minh_ESP32.docx`).
8. Web điều khiển thủ công đúng 3 thiết bị: **LED1, quạt, cửa**. LED2, LED3, còi chỉ hiển thị. **Bơm** chỉ do ESP32 tự kích hoạt khi có khói, không có nút thủ công trên web.
9. Có cảm biến khói/gas cho **giá trị analog** và có bơm (đặc tả ESP32 chưa liệt kê chân của hai thiết bị này). Ngưỡng khói chỉnh được trên web.
10. Ánh sáng chỉ là sáng/tối (đầu ra số), ngưỡng chỉnh bằng núm trên cảm biến, không chỉnh qua web.
11. Ngưỡng nhiệt độ mặc định theo đặc tả: bật quạt 35°C, tắt quạt 34°C, bật cảnh báo 40°C, tắt cảnh báo 37°C. Web chỉnh được bốn giá trị này.

## 5. Các quyết định do tôi (Claude) tự chọn — cần bạn kiểm tra

- **A.** Cảnh báo khói/gas luôn được ưu tiên hơn thao tác thủ công (theo gợi ý file tổng quan); ESP32 vẫn bật cảnh báo và bơm dù đang ở chế độ thủ công.
- **B.** Framework: FastAPI + paho-mqtt; web nhận realtime qua WebSocket, lịch sử/lệnh qua REST.
- **C.** Phát hiện mất kết nối: ESP32 publish `status` "online" (retained) khi kết nối và đăng ký MQTT Last Will "offline"; `telemetry` định kỳ làm heartbeat; backend coi là mất kết nối nếu quá 10 giây không có tin nào.
- **D.** Ngưỡng lưu ở backend và publish dạng **retained** để ESP32 khởi động lại vẫn nhận lại; ESP32 phản hồi xác nhận đã áp dụng. Web chỉ hiện "thành công" khi có xác nhận.
- **E.** Lệnh chờ xác nhận tối đa 5 giây; quá hạn đánh dấu `timeout`.
- **F.** Lớp lưu trữ là một interface `Storage`. Bản mặc định ban đầu lưu trong bộ nhớ (kèm ghi file JSON đơn giản) để chạy được ngay; Người 5 hoặc bạn thay bằng database thật sau.
- **G.** Mọi tin nhắn dùng JSON, thời gian dạng ISO 8601 UTC.
- **H.** Bản tin trạng thái dùng đúng 13 trường trong đặc tả ESP32, thêm các trường tôi bổ sung cho khói và bơm: `smoke_raw` (số hoặc null), `smoke_alarm` (boolean), `pump_on` (boolean), và `mode` của từng thiết bị điều khiển được.
- **I.** Ngưỡng khói gồm `smoke_high` (bật cảnh báo + bơm) và `smoke_low` (tắt), hai ngưỡng để tránh dao động như nhiệt độ. Giới hạn thời gian chạy bơm do firmware (Người 3) quyết định; backend chỉ ghi thời điểm bật/tắt bơm.
- **J.** Mosquitto cho kết nối ẩn danh trong mạng nội bộ; backend mở CORS cho LAN; danh sách thiết bị đọc từ file cấu hình.
- **K.** Vì firmware hiện chưa có WiFi/MQTT/nhận lệnh, đây là phần Người 2, 3 phải thêm; tài liệu MQTT ở mục 6 là hợp đồng để họ làm theo. Cửa chỉ là "lệnh đã gửi cho servo", `ack` của cửa có nghĩa là ESP32 đã gửi lệnh, không phải cửa đã mở thật.

## 6. Hợp đồng MQTT (đề xuất; thống nhất với Người 2, 3)

Chỉ có một ESP32, `device_id` = `esp32-home`. Tiền tố topic: `home/esp32-home/...`.

| Topic | Hướng | Nội dung chính |
|---|---|---|
| `.../telemetry` | ESP32 → backend | Gửi định kỳ (đề xuất 2 giây, theo chu kỳ DHT11) và ngay khi trạng thái đổi. Gồm 13 trường của đặc tả (`temperature_c`, `humidity_pct`, `dht_ok`, `pir_ready`, `motion_detected`, `is_dark`, `door_command`, `fan_on`, `led1_on`, `led2_on`, `led3_on`, `heat_alarm`, `uptime_ms`) cùng `smoke_raw`, `smoke_alarm`, `pump_on`, và `modes: {led1, fan, door}` mỗi giá trị `auto`/`manual`. |
| `.../event` | ESP32 → backend | Sự kiện: `{type, state: start/end, value, threshold, reason, uptime_ms}`; `type` ∈ heat_alarm, smoke_alarm, pump, fan, door, led1, dht_error. Dùng cho nhật ký và cảnh báo. |
| `.../cmd` | backend → ESP32 | `{cmd_id, device: led1/fan/door, action: on/off/open/close/auto}`; `auto` đưa thiết bị về chế độ tự động. |
| `.../cmd/ack` | ESP32 → backend | `{cmd_id, result: ok/failed, detail}` |
| `.../config/set` | backend → ESP32 | Retained. `{config_id, thresholds: {fan_on, fan_off, heat_alarm_on, heat_alarm_off, smoke_high, smoke_low}}` |
| `.../config/ack` | ESP32 → backend | `{config_id, result: ok/rejected, detail}` |
| `.../status` | ESP32 → backend | Retained `online`/`offline` (offline là MQTT Last Will); heartbeat bằng chính `telemetry`. |

Thời gian: ESP32 chỉ có `uptime_ms`; backend gắn thời điểm nhận (giờ laptop) vào mọi bản tin. Ngưỡng nằm trong khoảng hợp lệ (ví dụ `fan_off < fan_on`, `heat_alarm_off < heat_alarm_on`) do backend kiểm tra trước khi gửi; ESP32 cũng từ chối giá trị vô lý.

## 7. API cho web (đề xuất)

- `GET /api/state` — trạng thái hiện tại: giá trị cảm biến mới nhất, trạng thái thiết bị, trạng thái kết nối.
- `GET /api/history?metric=&from=&to=` — lịch sử (lấy từ lớp lưu trữ).
- `GET /api/alerts`
- `POST /api/devices/{device}/command` — `device` ∈ led1, fan, door; body `{action: on/off/open/close/auto}`; trả `cmd_id`.
- `GET /api/commands/{cmd_id}` — trạng thái lệnh: pending / ok / failed / timeout.
- `GET /api/config`, `PUT /api/config` — đọc/đổi ngưỡng; trả `config_id`, trạng thái chờ xác nhận.
- `WS /ws` — đẩy sự kiện realtime: cảm biến, trạng thái thiết bị, cảnh báo, kết nối, kết quả lệnh/ngưỡng.

Dữ liệu đầy đủ cần lưu theo file tổng quan: cảm biến, trạng thái thiết bị, cảnh báo, lệnh điều khiển (mã lệnh, thiết bị đích, hành động, nguồn, thời điểm gửi, kết quả, thời điểm xác nhận).

## 8. Hành vi quan trọng

- **Kiểm tra định dạng:** tin sai JSON hoặc thiếu trường bị bỏ, ghi log, không làm backend sập.
- **Mất kết nối:** quá hạn heartbeat → đánh dấu offline, ghi thời điểm mất và thời điểm dữ liệu cuối, đẩy sự kiện lên web. Kết nối lại → ghi thời điểm. Khi offline, lệnh từ web bị từ chối ngay với lý do rõ ràng.
- **Khởi động lại backend:** đọc lại ngưỡng từ lưu trữ và publish lại retained; trạng thái hiện tại lấy lại từ retained/state mới nhất của ESP32.
- **Dữ liệu trùng/thời gian:** lưu cả thời điểm đo (`ts` từ ESP32) và thời điểm server nhận; nếu ESP32 chưa có giờ chuẩn thì dùng giờ server và đánh dấu.

## 9. Việc giao lại cho người xây

- Chọn cấu trúc thư mục, cách cấu hình (broker host, port, timeout) bằng file cấu hình hoặc biến môi trường.
- Thiết kế chi tiết schema JSON (theo bảng ở mục 6) và mã lỗi API.
- Viết **script giả lập ESP32** (Python) phát dữ liệu, nhận lệnh, trả ack, giả lập mất kết nối.
- Viết test tự động cho: kiểm tra định dạng, vòng đời lệnh (gửi → ack/timeout), phát hiện mất kết nối, ngưỡng retained.
- Hướng dẫn cài đặt Mosquitto trên Windows và cách chạy backend.

## 10. Sản phẩm bàn giao

- Backend chạy được (Python), chạy cùng Mosquitto.
- Tài liệu API và MQTT (dựa trên mục 6, 7).
- Script giả lập ESP32 và bộ test.
- Sơ đồ luồng dữ liệu và lệnh.

## 11. Cập nhật sau thiết kế

Những thay đổi so với bản thiết kế ban đầu (ngày 2026-10-30):

- **Database:** nhóm chọn **PostgreSQL**. `PostgresStorage` (`backend/app/pg_storage.py`) có bốn bảng `telemetry`, `events`, `commands`, `config`, tự tạo khi khởi động. Backend dùng PostgreSQL khi có biến `BTL_DATABASE_URL`; không có thì dùng `InMemoryStorage` (quyết định F). Bảng do backend dựng tạm để hệ thống chạy trọn vẹn; Người 5 có thể chỉnh lại.
- **Cách chạy:** thay vì cài Mosquitto và Python tay, hệ thống chạy bằng **Docker Compose** (`docker-compose.yml`: `mosquitto`, `db`, `backend`, và `simulator` tùy chọn qua `--profile sim`). Hướng dẫn cho từng vai trò ở `README.md` gốc.
- **Ngưỡng:** `smoke_high` = 2000 và `smoke_low` = 1500 là giá trị tạm do kế hoạch đặt, cần đo lại với cảm biến thật.
- **Hành vi bổ sung:** ack ngưỡng đến muộn sau khi đã `timeout` vẫn được chấp nhận; thời gian chờ ack ngưỡng bắt đầu tính lại khi ESP32 online trở lại.
- **Chưa làm / chưa kiểm tra:** chưa thử với ESP32 thật (firmware chưa có WiFi/MQTT); chưa có đăng nhập; lịch sử lệnh chưa giới hạn kích thước; chưa có truy vấn trung bình/min/max và xuất CSV (thuộc phần của Người 5).

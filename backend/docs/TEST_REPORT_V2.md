# Báo cáo kiểm thử và review — Backend v2

> Người thực hiện: Vũ (Backend). Trạng thái: **đang cập nhật theo từng task**.
> Mục đánh dấu `CHƯA CHẠY` là việc cần Docker/ESP32 thật; không được coi là PASS.
> Phiên bản: xem `git log` (commit ghi ở cột Minh chứng). Cấu hình thử: `Settings()` mặc định (`cmd_timeout_s=5`, `offline_timeout_s=10`), InMemoryStorage trừ khi ghi khác.

## 1. Kết quả review PR #1 và #2 (Thái — Database Reliability / Gas)

**Phạm vi đọc:** `backend/app/reliability.py`, thay đổi trong `service.py`, `storage.py`, `pg_storage.py`, `models.py`, `docs/DB_GAS_CONTRACT_PENDING.md`.

| # | Mức | Phát hiện | Xử lý |
|---|---|---|---|
| 1 | Đúng | Phát hiện trùng/sai thứ tự/mất gói theo `(device_id, boot_id, seq)`; gap lưu dạng khoảng nên O(1) bộ nhớ; có trần bộ nhớ (cửa sổ trượt, LRU session). Telemetry cũ (`seq` nhỏ hơn) không ghi đè trạng thái mới | Giữ nguyên |
| 2 | Đúng | Hợp đồng gas khai rõ `gas_raw` là ADC, chưa hiệu chuẩn ppm; không tự suy diễn `delivery_rate` khi chưa có `tx_count` | Giữ nguyên, ghi vào `API_MQTT_v2.md` |
| 3 | **Lỗi che giấu** | `Service.on_telemetry` nuốt lỗi lưu trữ (chỉ `log.error`), API không cho biết DB đang hỏng — trái điều kiện nghiệm thu "lỗi MQTT/DB không bị che giấu" | **Đã sửa:** `Service.health()` + `GET /api/health` (`storage.ok/errors/last_error_ts`) |
| 4 | Thiếu | Các hàm `reliability_stats`, `command_stats`, `list_connection_events`, `list_error_events` chưa có REST | **Đã thêm** 4 endpoint `/api/history/...` (xem mục 2) |
| 5 | Rủi ro thấp | Bản tin trùng trả về sớm nên **không cập nhật `_last_seen`**: nếu thiết bị chỉ gửi lại bản tin trùng, backend vẫn có thể coi là offline | Ghi nhận, chưa sửa (cần quyết định với Thái: trùng có tính là heartbeat không) |
| 6 | Rủi ro thấp | Bộ đếm runtime (`received/duplicate/out_of_order`) về 0 khi restart backend; `stored_count` thì bền. Đã được Thái ghi trong `query_window/runtime_scope` | Giữ nguyên; báo cáo đo phải ghi rõ phạm vi |
| 7 | Rủi ro thấp | Thuộc tính tương thích `_pending_gaps` dựng tối đa ~500 phần tử mỗi khoảng khi truy cập; không nằm trên đường nóng | Chỉ dùng trong test |
| 8 | **Lỗi (phía backend, của Vũ)** | `MqttBridge.publish_cmd` không báo lỗi khi mất kết nối: paho xếp hàng QoS 1 rồi gửi lại sau khi nối lại → **lệnh cũ có thể bị thực thi muộn** | **Đã sửa:** từ chối khi `is_connected()` sai hoặc `rc != 0` (→ `PublishFailed` → 503) |

## 2. Test tự động (pytest, không cần Docker)

Chạy: `cd backend && .venv\Scripts\python -m pytest -q` → **231 passed, 47 skipped** (47 test PostgreSQL bị bỏ qua khi không đặt `BTL_TEST_DATABASE_URL`).

| ID | Nội dung | Đầu vào | Mong đợi | Thực tế | Kết quả | Minh chứng |
|---|---|---|---|---|---|---|
| ACK-01 | Lệnh trùng khi đang pending | `fan on` 2 lần | Cùng `cmd_id`, publish 1 lần | Đúng | PASS | `test_cmd_ack_v2.py::test_duplicate_pending_command_returns_existing_cmd_id` |
| ACK-02 | Lệnh giống nhau sau khi xong | `fan on`, ACK, `fan on` | `cmd_id` mới | Đúng | PASS | `test_same_command_allowed_again_after_it_finished` |
| ACK-03 | ACK trùng | ACK 2 lần | Lần 2 bị bỏ qua, trạng thái giữ | Đúng | PASS | `test_service_commands.py::test_duplicate_ack_and_unknown_cmd_id_ignored` |
| ACK-04 | ACK đến muộn | Timeout rồi ACK `ok` | Giữ `timeout`, `detail` có `late_ack:ok`, không publish lại | Đúng | PASS | `test_late_ack_keeps_timeout_and_records_detail`, `test_late_ack_does_not_publish_again` |
| ACK-05 | Lỗi publish MQTT | `publish_cmd` ném lỗi | Lệnh `failed`/`mqtt_publish_failed`, API 503 | Đúng | PASS | `test_publish_error_marks_command_failed`, `test_api_publish_failure_returns_503` |
| ACK-06 | MQTT mất kết nối | `is_connected()=False` | Từ chối, **không xếp hàng** | Đúng | PASS | `test_mqtt_bridge.py::test_publish_cmd_refused_when_mqtt_disconnected` |
| ACK-07 | Safety Override (nhiệt) | `heat_alarm=true`, `fan off` | Từ chối, lưu `failed`, không publish, API 409 + `reason` | Đúng | PASS | `test_safety_override_blocks_fan_off_during_heat_alarm`, `test_api_safety_override_returns_409_with_reason` |
| ACK-08 | Safety Override (gas) | `gas_alarm=true`, `door close` | Từ chối | Đúng | PASS | `test_door_close_blocked_during_gas_alarm` |
| ACK-09 | Xác nhận vật lý | ACK ok rồi telemetry khớp | Có `confirmed_ts`; telemetry trước ACK hoặc không khớp thì không | Đúng | PASS | `test_physical_confirmation_*`, `test_no_confirmation_*`, `test_telemetry_before_ack_*` |
| REL-01 | Lỗi DB không bị che | Storage ném lỗi khi lưu | `/api/health.storage.ok=false`, đếm lỗi, tự hồi phục | Đúng | PASS | `test_health.py` |
| REL-02 | DB ngừng | Storage ném `OperationalError` | History/commands/events trả **503** `storage_unavailable`; `/api/state` vẫn 200 | Đúng | PASS | `test_latency.py::test_history_reports_503_when_database_down` |
| LAT-01 | Thống kê độ trễ | 2 lệnh ack 0.2/0.4 s, confirm 1.0/2.0 s | avg/P95/max đúng; rỗng → `null` (không phải 0) | Đúng | PASS | `test_latency.py` |
| API-01 | API cũ không đổi | `/api/state`, `/api/history`, `/api/commands`, `/api/config` | Khóa/JSON như cũ | Đúng | PASS | `test_old_endpoints_unchanged` + 193 test cũ |
| PG-01 | Cột `confirmed_ts` trên PostgreSQL | — | Lưu/đọc đúng | `CHƯA CHẠY` (Docker tắt) | **CHƯA CHẠY** | `test_postgres_storage.py::test_command_confirmed_ts_and_safety_failure_on_postgres` |

## 3. Việc còn lại (chưa có kết quả)

- Bảo mật API/MQTT (Task 4), đồng bộ simulator (Task 5), kiểm thử lỗi và hiệu năng trên Docker + ESP32 thật (Task 6).
- Đo độ trễ: **chỉ số liệu từ ESP32 thật mới dùng cho bài báo**; chưa có firmware WiFi/MQTT.

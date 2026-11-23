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

Chạy: `cd backend && .venv\Scripts\python -m pytest -q` → **302 passed, 47 skipped** (47 test PostgreSQL bị bỏ qua khi không đặt `BTL_TEST_DATABASE_URL`).
Có PostgreSQL thật (`docker run … postgres:16 -p 55432:5432`, đặt `BTL_TEST_DATABASE_URL`) → **349 passed, 0 skipped**. Frontend: `npx vitest run` → **83 passed**.

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
| PG-01 | Cột `confirmed_ts` và lệnh bị Safety Override trên PostgreSQL | ACK ok → telemetry khớp; rồi `heat_alarm` + `fan off` | `confirmed_ts` lưu/đọc đúng; lệnh `failed` có `detail` `safety_override:heat_alarm` | Đúng | PASS (PostgreSQL 16 thật) | `test_postgres_storage.py::test_command_confirmed_ts_and_safety_failure_on_postgres` |

### 2.1 Bảo mật — test tự động (`tests/test_auth.py`, `tests/test_mqtt_bridge.py`, `frontend/tests/authService.test.ts`)

| ID | Nội dung | Mong đợi | Kết quả |
|---|---|---|---|
| SEC-01 | Lệnh không có token / token rác / sai scheme | 401, **không** publish MQTT, không ghi DB | PASS |
| SEC-02 | `viewer` điều khiển | 403, không publish | PASS |
| SEC-03 | `PUT /api/config` bởi operator | 403; chỉ admin được | PASS |
| SEC-04 | Body sai kiểu / quá dài / JSON hỏng | 422 (kiểm tra auth trước body: không token → 401) | PASS |
| SEC-05 | JWT hết hạn, bị sửa payload, ký khóa khác, `alg=none`, thiếu `exp`, user/role lạ | 401 | PASS |
| SEC-06 | Hạ quyền user trong cấu hình | Token cũ mang claim `admin` của `viewer1` vẫn chỉ có quyền viewer (403) | PASS |
| SEC-07 | Dò mật khẩu | 5 lần sai → 429 + Retry-After; hết 60 s thì đăng nhập lại được; user khác không bị ảnh hưởng; không lộ user nào tồn tại | PASS |
| SEC-08 | Quá nhiều yêu cầu điều khiển | 429 + `Retry-After`, tính theo từng người dùng | PASS |
| SEC-09 | Chưa cấu hình user / khóa JWT yếu | Điều khiển trả 503 `auth_not_configured`, không mở cửa; đọc vẫn dùng được | PASS |
| SEC-10 | Định dạng `BTL_USERS` | Mật khẩu ngắn, role lạ, trùng tên, sai số trường → `ValueError` | PASS |
| SEC-11 | `.env`, `docker/secrets/` nằm ngoài git | `git check-ignore` xác nhận | PASS |
| SEC-12 | Bridge đăng nhập MQTT bằng tài khoản cấu hình | `username_pw_set` được gọi đúng | PASS |
| SEC-13 | Frontend tự đăng nhập, gắn Bearer cho POST/PUT (GET không), gia hạn khi còn < 60 s, 401 thử lại đúng 1 lần, 403 báo nguyên văn | — | PASS |

### 2.2 Bảo mật — kiểm chứng trên Docker thật

Stack cô lập (`docker compose -p btlsec`, cổng 18831/18001/18301/18432, `.env` sinh bởi `make-env.ps1`, kèm simulator). Script: `backend/tools/live_security_check.py` → **25/25 PASS**.

| ID | Nội dung | Kết quả thực tế | Kết quả |
|---|---|---|---|
| MQTT-01 | Client MQTT ẩn danh | `rc=Not authorized` | PASS |
| MQTT-02 | Sai mật khẩu | `rc=Not authorized` | PASS |
| MQTT-03/03b | Backend đăng nhập đúng; **đối chứng dương**: lệnh backend publish đến được `esp32` | Nhận được `home/esp32-home/cmd` | PASS |
| MQTT-04 | `simulator` rồi `esp32` thử publish `cmd` và `config/set` giả (người chứng kiến có quyền đọc các topic này) | Không ai nhận được bản tin giả | PASS |
| MQTT-05 | `esp32` publish `event` của chính nó, backend nhận được | Nhận được | PASS |
| API-01..03 | Lệnh/đổi ngưỡng không token hoặc token rác | 401 | PASS |
| API-04..06 | Đăng nhập sai 401; `ui` (operator) 200 + JWT; operator đổi ngưỡng 403 | Đúng | PASS |
| API-07, 08 | Body sai kiểu / dài 10 000 ký tự | 422 | PASS |
| API-09, CMD-01/02 | Operator gửi lệnh `led1 on` qua API → MQTT → simulator → ACK → telemetry | `status=ok`, có `confirmed_ts`; ack 7.4 ms, confirm 9.9 ms (**chỉ là số của simulator trên localhost, không phải ESP32 thật**) | PASS |
| API-10 | `/api/health` | `mqtt.connected=true`, `storage.ok=true` | PASS |
| LAT-01, REL-0x | `/api/metrics/latency` và 4 endpoint reliability | 200, có số liệu | PASS |
| API-11 | 7 lần đăng nhập sai liên tiếp | `[401,401,401,401,401,429,429]` | PASS |
| NET-01 | PostgreSQL chỉ mở cho máy chủ | `docker compose ps`: `127.0.0.1:18432->5432` | PASS |
| WEB-01 | nginx sinh `config.js` và chuyển `/api/auth/login` | `uiUsername: "ui"`; đăng nhập sai qua nginx → 401 | PASS |

**Chưa kiểm chứng:** ESP32 thật kết nối với tài khoản `esp32` (chưa có firmware WiFi/MQTT); trình duyệt thật tự đăng nhập (chỉ kiểm tra qua unit test và `config.js`); TLS (không triển khai).

### 2.3 Đồng bộ simulator với firmware (`tests/test_simulator_v2.py`, 21 test)

Chạy lại **cùng kịch bản** trên simulator cũ (commit `351c755`) và mới để đối chiếu:

| Kịch bản | Trước | Sau | Kết quả |
|---|---|---|---|
| Có người về → PIR hết phát hiện, sau 1 s | Cửa `closed` (đóng ngay) | Cửa `open` | Đã sửa |
| Cùng kịch bản, sau 10 s (từ lần cuối PIR) | `closed` | `closed` | Đúng quy tắc |
| Quạt đang thủ công TẮT, nhiệt độ lên 41.5°C | `heat_alarm=true` nhưng `fan_on=false` | `fan_on=true` | Đã sửa |

Quy tắc đã khóa bằng test: PIR giữ 10 s và phát hiện mới thì đếm lại; gas: mở liên tục khi còn cảnh báo, giữ 60 s sau khi hết, bật lại thì hủy và đếm lại 60 s; `fan off` khi `heat_alarm` và `door close` khi `gas_alarm` bị ACK `failed` với `safety_override:<lý do>`; sự kiện gas edge-triggered; histeresis gas; `fire_alert` ưu tiên hơn `gas_alert`; `boot_id` mới mỗi lần khởi động, `seq` tăng +1; telemetry hợp lệ với model backend.

**Giả định cần Hiệu xác nhận:** ngưỡng gas 2000/1500; chế độ thủ công bị ghi đè bởi cảnh báo gas (cửa) và cảnh báo nhiệt (quạt); `smoke_alarm` cũng chặn `fan off`.

### 2.4 Kiểm thử lỗi và hiệu năng trên Docker thật

Công cụ: `backend/tools/fault_scenarios.py`, `backend/tools/load_telemetry.py`. Stack cô lập (`docker compose -p btlfault`, kèm simulator), kết quả thô: [`fault_results_v2.json`](fault_results_v2.json). Lượt cuối: **31/31 PASS**.

> **Cảnh báo về số đo:** mọi số độ trễ/tải dưới đây lấy từ **ESP32 giả lập chạy trên cùng máy (localhost)**. Chúng chứng minh cơ chế đo hoạt động, **không phải** độ trễ của ESP32 thật qua WiFi. Số liệu cho bài báo phải đo lại trên thiết bị thật.

#### Lỗi tìm thấy bằng kiểm thử và đã sửa

| # | Phát hiện (lượt chạy đầu) | Nguyên nhân gốc | Cách sửa | Kiểm chứng |
|---|---|---|---|---|
| 1 | **DB ngừng → toàn bộ API treo** (`/api/state`, `/api/health` quá 40 s) | `Service` giữ khóa trong lúc ghi PostgreSQL; pool chờ mặc định 30 s; `tick()` quét DB mỗi giây | Ghi telemetry/event **ngoài khóa**; lệnh đang chờ giữ trong RAM (`tick()` không còn truy vấn DB, nạp lại sau restart); pool `timeout=2 s`, kiểm tra kết nối trước khi giao | `test_db_outage.py` (8 test) + F3a–F3f |
| 2 | **Lệnh bị thực thi muộn sau khi mạng nối lại** (F2h-e: lệnh đã `timeout` nhưng quạt vẫn bật, `late_ack:ok`) | Lệnh QoS 1 gửi vào kết nối bán-mở được giao sau khi nối lại | Lệnh mang `issued_ts`, `expires_ts` (= +5 s); thiết bị từ chối lệnh quá hạn (`detail=expired`) | `test_simulator_v2.py` (4 test) + F2h-e: ACK trả về `late_ack:failed`, `fan_on=false` |
| 3 | `publish_cmd` không báo lỗi khi mất MQTT (xếp hàng ngầm) | Hành vi của paho với QoS 1 | Từ chối khi `is_connected()` sai hoặc `rc != 0` (xem mục 1, #8) | `test_mqtt_bridge.py`, F2b, F2g |

#### Bảng kết quả

| ID | Điều kiện / thao tác | Mong đợi | Thực tế | Kết quả |
|---|---|---|---|---|
| F1a/b | `docker compose restart backend` | API và ESP32 online lại < 30 s | API 1.1 s, ESP32 online 2.4 s | PASS |
| F1c/d | Restart backend | Lịch sử không mất; không ghi trùng | 4166 → 4166 điểm; duplicate 0 → 0 | PASS |
| F2a | Dừng Mosquitto | `/api/health` báo mất MQTT < 10 s | 0.0 s | PASS |
| F2b/d | Gửi lệnh khi MQTT ngừng | Từ chối rõ, không xếp hàng | 409 `device_offline` (broker dừng làm thiết bị gửi Last Will `offline` ngay) | PASS |
| F2c | — | Thiết bị bị coi offline | 0.6 s | PASS |
| F2e/f | Bật lại Mosquitto | Backend và ESP32 tự nối lại | 0.3 s và 0.6 s | PASS |
| F2g | Sau khi nối lại | Không có lệnh cũ nào được thực thi | Không có lệnh mới; `fan_on=false` | PASS |
| F2h-a..e | **Cắt mạng bán-mở** (`docker network disconnect` Mosquitto), gửi `fan on` lúc thiết bị còn online | Lệnh `timeout`, offline được phát hiện, tự phục hồi, **lệnh cũ không thực thi muộn** | `timeout`; offline sau 2.5 s; phục hồi 4.8 s; ACK muộn `failed`; `fan_on=false` | PASS (sau sửa #2) |
| F3a | Dừng PostgreSQL | `/api/health` `storage.ok=false` < 30 s | 1.9 s | PASS |
| F3b | — | Lịch sử báo lỗi rõ, không trả rỗng giả, < 10 s | 503 `storage_unavailable` sau 2.0 s | PASS |
| F3c | — | Trạng thái hiện tại vẫn trả được | 200, `online=true`, 0.01 s | PASS |
| F3d | Gửi lệnh khi DB ngừng | Báo lỗi rõ, không báo thành công giả | 503, 2.0 s | PASS |
| F3e/f | Bật lại PostgreSQL | Tự phục hồi, không restart backend | Lịch sử 200 sau 4.6 s; `storage.ok` ngay | PASS |
| F4a–c | Burst **198.5 bản tin/s**, 4000 seq, bỏ 39 gói, lặp 9 bản tin | Nhận đủ; lưu đúng; đếm đúng trùng | received +3970, stored +3961, duplicate +9 | PASS |
| F4d | — | Đếm đúng gói mất | +39 (tỷ lệ mất 0.97 %) | PASS |
| F4e | — | Tài nguyên backend | CPU tối đa 12.5 %, RAM 48.8 MiB | PASS |
| F4f | Sau burst | Hệ thống bình thường | mqtt/storage/device đều ok | PASS |
| F5a | 30 lệnh, tải bình thường | 100 % lệnh ok | ACK avg 35.9 / P95 49.6 / max 49.7 ms; xác nhận avg 39.0 / P95 53.4 / max 55.7 ms | PASS |
| F5b | 15 lệnh **khi đang burst 200 msg/s** | Lệnh vẫn ok | ACK avg 13.0 / P95 20.6 / max 20.6 ms; xác nhận avg 14.1 / P95 21.7 / max 21.7 ms | PASS |

Ghi chú: F5a chậm hơn F5b vì simulator làm nhiều việc hơn ở lượt đầu và mỗi lệnh cách nhau 0.5 s; chênh lệch này **không** chứng minh tải làm hệ thống nhanh hơn, chỉ cho thấy tải 200 msg/s không làm xấu độ trễ lệnh ở mức đo được. `confirmed_ts` là suy luận từ telemetry chứ không phải đo vị trí vật lý.

#### Giới hạn đã biết của phương pháp đo

1. **Mất gói ở cuối luồng không phát hiện được** bằng khoảng hở `seq` (cần bản tin sau). Công cụ tải không bỏ gói cuối, và bài báo nên ghi rõ giới hạn này.
2. Bộ đếm reliability (received/duplicate/out-of-order) là **bộ đếm trong RAM của tiến trình**, mất khi restart; `stored_count` thì bền.
3. `delivery_rate` vẫn `null` vì firmware chưa gửi `tx_count`.
4. Chưa thử: ESP32 thật, mất WiFi thật, tải đồng thời nhiều thiết bị, kiểm thử dài hạn (soak), PostgreSQL đầy đĩa.

## 3. Việc còn lại (chưa có kết quả)

- **Đo trên ESP32 thật** (độ trễ gửi→ACK→hoàn thành, mất gói qua WiFi): chờ firmware có WiFi + MQTT + NTP (Người 2/3).
- Hiệu xác nhận các điểm `PROPOSED` ở `API_MQTT_v2.md` phần 9 (đặc biệt: `expires_ts`, ngưỡng gas, quy tắc cửa).
- Thái xác nhận cột `confirmed_ts` và 4 endpoint reliability.

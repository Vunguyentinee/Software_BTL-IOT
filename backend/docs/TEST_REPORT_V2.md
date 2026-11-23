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

Chạy: `cd backend && .venv\Scripts\python -m pytest -q` → **365 passed, 47 skipped** (47 test PostgreSQL bị bỏ qua khi không đặt `BTL_TEST_DATABASE_URL`).
Có PostgreSQL thật (`docker run … postgres:16 -p 55432:5432`, đặt `BTL_TEST_DATABASE_URL`) → **412 passed, 0 skipped**. Frontend: `npx vitest run` → **83 passed**.

| ID | Nội dung | Đầu vào | Mong đợi | Thực tế | Kết quả | Minh chứng |
|---|---|---|---|---|---|---|
| ACK-01 | Lệnh trùng khi đang pending | `fan on` 2 lần | Cùng `cmd_id`, publish 1 lần | Đúng | PASS | `test_cmd_ack_v2.py::test_duplicate_pending_command_returns_existing_cmd_id` |
| ACK-02 | Lệnh giống nhau sau khi xong | `fan on`, ACK, `fan on` | `cmd_id` mới | Đúng | PASS | `test_same_command_allowed_again_after_it_finished` |
| ACK-03 | ACK trùng | ACK 2 lần | Lần 2 bị bỏ qua, trạng thái giữ | Đúng | PASS | `test_service_commands.py::test_duplicate_ack_and_unknown_cmd_id_ignored` |
| ACK-04 | ACK đến muộn | Timeout rồi ACK `ok` | Giữ `timeout`, `detail` có `late_ack:ok`, không publish lại | Đúng | PASS | `test_late_ack_keeps_timeout_and_records_detail`, `test_late_ack_does_not_publish_again` |
| ACK-05 | Lỗi publish MQTT | `publish_cmd` ném lỗi | Lệnh `failed`/`mqtt_publish_failed`, API 503 | Đúng | PASS | `test_publish_error_marks_command_failed`, `test_api_publish_failure_returns_503` |
| ACK-06 | MQTT mất kết nối | `is_connected()=False` | Từ chối, **không xếp hàng** | Đúng | PASS | `test_mqtt_bridge.py::test_publish_cmd_refused_when_mqtt_disconnected` |
| ACK-07 | Safety Override (nhiệt) | `heat_alarm=true`, `fan off` | Từ chối, lưu `failed`, không publish, API 409 + `reason` | Đúng | PASS | `test_safety_override_blocks_fan_off_during_heat_alarm`, `test_api_safety_override_returns_409_with_reason` |
| ACK-08 | Safety Override (khói/gas) | `smoke_alarm=true`, `door_safety_lock=true`, `door close` | Từ chối | Đúng | PASS | `test_door_close_blocked_during_smoke_gas_alarm` |
| ACK-09 | Xác nhận vật lý | ACK ok rồi telemetry khớp | Có `confirmed_ts`; telemetry trước ACK hoặc không khớp thì không | Đúng | PASS | `test_physical_confirmation_*`, `test_no_confirmation_*`, `test_telemetry_before_ack_*` |
| REL-01 | Lỗi DB không bị che | Storage ném lỗi khi lưu | `/api/health.storage.ok=false`, đếm lỗi, tự hồi phục | Đúng | PASS | `test_health.py` |
| REL-02 | DB ngừng | Storage ném `OperationalError` | History/commands/events trả **503** `storage_unavailable`; `/api/state` vẫn 200 | Đúng | PASS | `test_latency.py::test_history_reports_503_when_database_down` |
| LAT-01 | Thống kê độ trễ | 2 lệnh ack 0.2/0.4 s, confirm 1.0/2.0 s | avg/P95/max đúng; rỗng → `null` (không phải 0) | Đúng | PASS | `test_latency.py` |
| API-01 | API cũ không đổi | `/api/state`, `/api/history`, `/api/commands`, `/api/config` | Khóa/JSON như cũ | Đúng | PASS | `test_old_endpoints_unchanged` + 193 test cũ |
| PG-01 | Cột `confirmed_ts` và lệnh bị Safety Override trên PostgreSQL | ACK ok → telemetry khớp; rồi `heat_alarm` + `fan off` | `confirmed_ts` lưu/đọc đúng; lệnh `failed` có `detail` `safety_override_heat_alarm` (mã của firmware) | Đúng | PASS (PostgreSQL 16 thật) | `test_postgres_storage.py::test_command_confirmed_ts_and_safety_failure_on_postgres` |

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

### 2.3 Đồng bộ simulator với firmware

Chạy lại **cùng kịch bản** trên simulator cũ (commit `351c755`) và mới để đối chiếu:

| Kịch bản | Trước | Sau | Kết quả |
|---|---|---|---|
| Có người về → PIR hết phát hiện, sau 1 s | Cửa `closed` (đóng ngay) | Cửa `open` (giữ 10 s) | Đã sửa |
| Quạt đang thủ công TẮT, nhiệt độ lên 41.5°C | `heat_alarm=true` nhưng `fan_on=false` | `fan_on=true` | Đã sửa |

Sau khi đọc firmware thật, mô hình gas riêng (`gas_*`) bị bỏ: **gas và khói là một cảm biến** (`smoke_*`). Quy tắc khóa cửa của simulator theo firmware: khói ≥ ngưỡng thì mở và giữ mở kể cả thủ công; nhả khóa sau 60 s **mẫu thấp liên tục** (mẫu trung bình/cao đếm lại); `fan on/off` khi khóa bị ACK `failed` (`safety_override_gas_fan_hold`); `door close` khi khóa bị từ chối (`safety_override_smoke_alarm` hoặc `safety_door_hold_active`); `fan off` khi `heat_alarm` bị từ chối (`safety_override_heat_alarm`); cảnh báo nhiệt ép quạt chạy; simulator từ chối lệnh/cấu hình thiếu hoặc sai phiên đích.

### 2.4 Khớp hợp đồng firmware (cập nhật sau khi đọc firmware `ESP32_DigitalTwin_Gas34_Safety`)

Quyết định của nhóm: **gas và khói là một cảm biến** (`smoke_*`). Backend và simulator được sửa để khớp firmware (các trường `gas_*` và kịch bản `gas_leak` đã bỏ). Test: `test_firmware_contract.py` (52), `test_simulator_v2.py` (40), `test_db_outage.py` (8).

| Nội dung | Kết quả |
|---|---|
| Lệnh/cấu hình/heartbeat mang `target_boot_id`, `target_connection_id`; từ chối sớm (409 `control_unavailable`) khi `offline_grace`/`local_auto`; tự gửi lại ngưỡng khi thiết bị đổi phiên; cấu hình không còn retained | PASS (unit + Docker) |
| Ràng buộc an toàn của backend dùng đúng mã `detail` của firmware; 409 kèm `reason` | PASS |
| `alarm_response`: backend tự ACK (`start`/`retry`/`escalated`); operator xác nhận qua `POST /api/alarms/{id}/ack`, chỉ với `event_id` đang hiệu lực | PASS (unit + Docker) |
| Heartbeat 2 s; lỗi publish không làm hỏng tick | PASS |
| Nhật ký người gửi lệnh (`web:<user>`), kể cả lệnh bị chặn | PASS |
| Telemetry của `device_id` khác chỉ được lưu, **không** đổi trạng thái/online/phiên đích (phát hiện khi công cụ tải chiếm phiên đích) | PASS |
| ACL cho `event/ack`, `backend/heartbeat` (thiết bị đọc được, simulator không giả mạo được) | PASS (Docker; Mosquitto trả SUBACK thành công cả khi từ chối đọc nên kiểm bằng việc tin có được giao) |
| Luồng đầu-cuối với simulator (`backend/tools/live_flow_check.py`): phiên đích, nhật ký người gửi, đổi ngưỡng áp dụng, khói → khóa cửa + chặn đóng cửa + chặn lệnh quạt, xác nhận cảnh báo | **10/10 PASS** |

> Mọi kiểm chứng trên dùng **simulator mô phỏng hợp đồng firmware**, chưa phải firmware/phần cứng thật. Bộ test host của firmware (C++, `door_safety`, `safety_monitoring`, `connection_policy`) đã chạy lại trong container `gcc:13` và pass.

### 2.5 Kiểm thử lỗi và hiệu năng trên Docker thật

Công cụ: `backend/tools/fault_scenarios.py`, `backend/tools/load_telemetry.py`. Stack cô lập (`docker compose -p btlfault`, kèm simulator), kết quả thô: [`fault_results_v2.json`](fault_results_v2.json). **Lượt cuối: 32/33 PASS; 1 FAIL được giữ nguyên có chủ đích (F2h-e, lỗ hổng đã biết của firmware, xem bên dưới).**

> **Cảnh báo về số đo:** mọi số độ trễ/tải lấy từ **ESP32 giả lập trên localhost**. Chúng chứng minh cơ chế đo hoạt động, **không phải** độ trễ của ESP32 thật qua WiFi.

#### Lỗi tìm thấy bằng kiểm thử

| # | Phát hiện | Nguyên nhân gốc | Xử lý | Kiểm chứng |
|---|---|---|---|---|
| 1 | **DB ngừng → toàn bộ API treo** (`/api/state` quá 40 s) | `Service` giữ khóa lúc ghi PostgreSQL; pool chờ 30 s; `tick()` quét DB mỗi giây | Ghi telemetry/event ngoài khóa; lệnh đang chờ giữ trong RAM (nạp lại sau restart); pool `timeout=2 s` + kiểm tra kết nối | `test_db_outage.py`, F3a–F3f |
| 2 | `publish_cmd` không báo lỗi khi mất MQTT (paho xếp hàng QoS 1) | Hành vi paho | Từ chối khi `is_connected()` sai hoặc `rc != 0` | `test_mqtt_bridge.py`, F2b, F2g |
| 3 | Telemetry của thiết bị khác chiếm phiên đích (làm F5b hỏng) | Backend lấy telemetry bất kỳ làm trạng thái | Lọc theo `BTL_DEVICE_ID` | `test_firmware_contract.py`, F5b |
| 4 | **Lệnh bị trễ trên mạng vẫn thực thi muộn** (F2h-e) | Kết nối TCP sống qua lần cắt mạng nên `connection_id` không đổi; firmware không có đồng hồ để kiểm tra hạn | Backend gửi `expires_ts`; simulator có tùy chọn kiểm tra hạn. **Chưa khắc phục ở firmware** | F2h-e (xem dưới) |

> **Chỉnh lại nhận định trước:** bản báo cáo trước ghi F2h-e đã sửa bằng `expires_ts` và sau đó tôi từng cho rằng phiên đích (`target_connection_id`) là đủ. Cả hai đều chưa đúng với firmware thật: phiên đích chỉ chặn lệnh của boot/kết nối cũ, còn `expires_ts` chỉ có tác dụng khi thiết bị có đồng hồ.

| ID | Điều kiện / thao tác | Mong đợi | Thực tế | Kết quả |
|---|---|---|---|---|
| F1a/b | `docker compose restart backend` | API và ESP32 online lại < 30 s | API 1.1 s, ESP32 2.4 s | PASS |
| F1c/d | Restart backend | Lịch sử không mất, không ghi trùng | 4192 → 4192; duplicate 0 → 0 | PASS |
| F2a–g | Dừng/bật Mosquitto | Báo mất MQTT < 10 s; lệnh bị từ chối rõ (409 `device_offline`: Last Will làm thiết bị offline ngay); tự nối lại; không lệnh cũ nào thực thi | 0.0 s; 0.7 s; nối lại 0.3 s và 0.6 s; không lệnh mới, `fan_on=false` | PASS |
| F2h-a..d | **Cắt mạng bán-mở** Mosquitto, gửi `fan on` lúc thiết bị còn online | Lệnh `timeout` không kẹt; offline được phát hiện; tự phục hồi | `timeout`; offline sau ~3 s; phục hồi ~5 s | PASS |
| **F2h-e** | Sau khi nối lại, lệnh cũ **không** được thực thi muộn | `fan_on=false` | **Simulator giống firmware hiện tại (không kiểm tra hạn): `fan_on=true`, `late_ack:ok`** | **FAIL (lỗ hổng đã biết)** |
| F2h-e (bật `SIM_CHECK_EXPIRY=1`) | Như trên, simulator từ chối lệnh quá hạn | `fan_on=false` | `fan_on=false`, `late_ack:failed` | PASS (chứng minh cách khắc phục) |
| F3a–f | Dừng/bật PostgreSQL | `/api/health` báo lỗi < 30 s; lịch sử 503 < 10 s; `/api/state` vẫn 200; lệnh 503; tự phục hồi | 3.6 s; 503 sau 2.0 s; 200 sau 0.01 s; 503 sau 2.0 s; phục hồi 2.4 s | PASS |
| F4a–c | Burst 198.5 bản tin/s, bỏ 39 gói, lặp 9 bản tin | Nhận đủ; lưu đúng; đếm đúng trùng | received +3970, stored +3961, duplicate +9 | PASS |
| F4d | — | Đếm đúng gói mất | +39 (0.97 %) | PASS |
| F4e | — | Tài nguyên backend | CPU tối đa 11.8 %, RAM 49.2 MiB | PASS |
| F5a | 30 lệnh, tải bình thường (SIMULATOR) | 100 % ok | ACK avg 29.5 / P95 50.8 / max 52.5 ms; xác nhận avg 32.2 / P95 55.6 / max 56.3 ms | PASS |
| F5b | 15 lệnh khi đang burst 200 msg/s (SIMULATOR) | Lệnh vẫn ok | ACK avg 13.9 / P95 20.0 / max 20.0 ms; xác nhận avg 14.9 / P95 21.0 / max 21.0 ms | PASS |

Ghi chú: chênh lệch giữa F5a và F5b không chứng minh tải làm hệ thống nhanh hơn; chỉ cho thấy tải 200 msg/s không làm xấu độ trễ lệnh ở mức đo được. `confirmed_ts` là suy luận từ telemetry.

#### Giới hạn của phương pháp đo

1. Mất gói ở **cuối** luồng telemetry không phát hiện được bằng khoảng hở `seq` (công tắc tải không bỏ gói cuối).
2. Bộ đếm reliability là bộ đếm trong RAM của tiến trình (mất khi restart); `stored_count` thì bền.
3. `tx_count` đã có trong telemetry nhưng backend chưa dùng để tính `delivery_rate`.
4. Chưa thử: ESP32 thật, mất WiFi thật, nhiều thiết bị đồng thời, chạy dài hạn, PostgreSQL đầy đĩa.

## 3. Việc còn lại (chưa có kết quả)

- **Đo trên ESP32 thật** (độ trễ gửi→ACK→hoàn thành, mất gói qua WiFi): firmware đã có WiFi + MQTT nhưng chưa được nạp/đo cùng backend; chạy 26 ca F01–F26 và các kịch bản ở mục 2.5 trên board.
- Hiệu: SNTP + từ chối lệnh quá `expires_ts` (khắc phục F2h-e); bật `MONITOR_BACKEND_HEARTBEAT`; điền tài khoản MQTT `esp32`. Xem `API_MQTT_v2.md` mục 10.
- Thái: các cột `gas_*` không còn nguồn dữ liệu (gas nằm ở `smoke_*`); lưu `connection_id`, `control_mode`, `tx_count`, `door_safety_lock`; cột `confirmed_ts`.

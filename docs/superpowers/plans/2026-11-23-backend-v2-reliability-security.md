# Backend v2: Contract, ACK, Reliability, Security, Fault Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (người dùng đã chọn thực hiện "native") to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thành phần việc bổ sung của Vũ (Người 4): MQTT Contract v2, xử lý lệnh/ACK chặt chẽ, reliability + mốc đo độ trễ, bảo mật API và MQTT, kiểm thử lỗi/hiệu năng.

**Architecture:** Giữ nguyên lớp Service / Storage(Protocol) / MqttBridge / API. Thêm module `auth.py` (token + vai trò + giới hạn tốc độ) áp dụng bằng FastAPI dependency; thêm bảo vệ ở Mosquitto (password file + ACL). Lệnh có thêm giai đoạn xác nhận vật lý (suy ra từ telemetry kế tiếp). Mọi thay đổi theo TDD, API cũ giữ nguyên hình dạng.

**Tech Stack:** Python 3.13, FastAPI, paho-mqtt 2.x, pydantic v2, psycopg 3, pytest, Mosquitto 2, Docker Compose.

**Spec:** `Tài liệu cập nhật.docx` (mục 1–6 chung + "Phần nhiệm vụ bổ sung của riêng Vũ"), `backend/docs/DB_GAS_CONTRACT_PENDING.md`, `backend/docs/API_MQTT.md`.

## Global Constraints

- API cũ (`/api/state`, `/api/history*`, `/api/events`, `/api/commands*`, `/api/config`, `/api/sim*`, `/ws`) giữ nguyên tên và dạng JSON hiện có; chỉ được **thêm** trường.
- Topic gốc `home/esp32-home/`; ack lệnh: `cmd/ack` với `result` ∈ {`ok`,`failed`}; trạng thái lệnh: `pending|ok|failed|timeout`.
- `cmd_timeout_s = 5.0`, `offline_timeout_s = 10.0` (lấy từ `Settings`).
- Không commit mật khẩu/token: chỉ `.env.example` với giá trị mẫu; `.env`, file passwd/aclfile sinh ra nằm trong `.gitignore`.
- `gas_raw` là ADC 0–4095, **không** coi là ppm.
- Mỗi task kết thúc bằng `pytest backend/tests -q` xanh trước khi commit. Commit message tiếng Việt theo mẫu "Cập nhật phần mềm" nếu người dùng yêu cầu; mặc định mô tả ngắn.

## Review Focus

- Gửi lệnh khi `Authorization` thiếu/sai/hết quyền → 401/403, **không** publish MQTT, không ghi DB.
- Body lệnh sai kiểu (số, danh sách, chuỗi quá dài) → 422, không crash.
- ACK đến lần 2 (trùng) hoặc đến sau timeout → không đổi sai trạng thái, không phát lại lệnh.
- `publish_cmd` ném lỗi (MQTT đứt) → lệnh `failed`, API báo 503, không để `pending` mãi.
- PostgreSQL tạm ngừng → `/api/state` vẫn trả được, endpoint lịch sử báo 503 rõ ràng (không 200 rỗng).
- Telemetry burst/seq nhảy cực lớn → bộ nhớ có trần, không chặn luồng MQTT.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/docs/API_MQTT_v2.md` (mới) | Hợp đồng MQTT + REST phiên bản 2 |
| `backend/app/models.py` | Mở rộng `CmdAck` (`device_id`, `boot_id`), mã lý do `detail` |
| `backend/app/service.py` | Chống lệnh trùng, ACK muộn/trùng, lỗi publish, Safety Override, mốc thời gian |
| `backend/app/auth.py` (mới) | Đọc token từ env, vai trò, dependency `require_role`, rate limit |
| `backend/app/api.py` | Gắn auth, endpoint reliability/latency, xử lý lỗi 503 |
| `backend/app/mqtt_bridge.py`, `main.py`, `config.py` | Đăng nhập MQTT (user/pass từ env) |
| `docker/mosquitto.conf`, `docker/mosquitto.acl.example`, `docker/gen-mqtt-users.sh`/`.ps1` (mới) | Tài khoản + ACL |
| `docker-compose.yml`, `.env.example`, `.gitignore` | Biến môi trường, không lộ cổng DB ra ngoài |
| `backend/simulator/fake_esp32.py` | Giữ cửa mở sau PIR, bật quạt khi heat alarm, đăng nhập MQTT |
| `backend/tests/` (`test_auth.py`, `test_cmd_ack_v2.py`, `test_latency.py`, `fault/…`) | Kiểm thử |
| `backend/docs/TEST_REPORT_V2.md` (mới) | Bảng test case: điều kiện, đầu vào, mong đợi, thực tế, PASS/FAIL, minh chứng |

---

### Task 1: MQTT Contract v2 (`API_MQTT_v2.md`)

**Files:**
- Create: `backend/docs/API_MQTT_v2.md`
- Modify: `backend/app/models.py` (`CmdAck`)
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `CmdAck(cmd_id: str, result: Literal["ok","failed"], detail: Optional[str], device_id: Optional[str], boot_id: Optional[str])`; bảng mã `detail` chuẩn: `safety_override:<reason>`, `invalid_action`, `hardware_fault`, `busy`.

- [ ] **Step 1:** Viết test `test_cmd_ack_accepts_device_and_boot_id` (ack có `device_id`,`boot_id` parse được) và `test_cmd_ack_old_payload_still_valid` (ack cũ chỉ `cmd_id`,`result`).
- [ ] **Step 2:** `pytest backend/tests/test_models.py -q` → FAIL.
- [ ] **Step 3:** Thêm hai trường Optional vào `CmdAck` trong `models.py`.
- [ ] **Step 4:** Test PASS.
- [ ] **Step 5:** Viết `API_MQTT_v2.md` gồm: topic + payload telemetry (các trường `device_id, boot_id, seq, gas_raw, gas_alarm, gas_sensor_ok, safety_mode, safety_reason`), cmd/ack (`cmd_id, result, detail`), các mốc thời gian (`sent_ts, ack_ts, confirmed_ts` phía backend; `uptime_ms` phía ESP32), quy tắc `seq` tăng dần theo `boot_id`, mã `detail`, ghi rõ trường nào **chờ Hiệu/Thái xác nhận** (trạng thái `PROPOSED`). Dùng `DB_GAS_CONTRACT_PENDING.md` làm nền.
- [ ] **Step 6:** Commit.

### Task 2: Xử lý lệnh và ACK

**Files:**
- Modify: `backend/app/service.py`, `backend/app/api.py`, `backend/app/storage.py`/`pg_storage.py` (thêm cột/trường `confirmed_ts` nếu cần)
- Test: `backend/tests/test_cmd_ack_v2.py`

**Interfaces:**
- Produces: `class PublishFailed(Exception)`; `class SafetyOverride(Exception)` (thuộc tính `reason: str`); `Service.send_command` trả thêm `confirmed_ts: None`; API: `503 {"detail":"mqtt_publish_failed"}`, `409 {"detail":"safety_override","reason":"heat_alarm"}`.
- Consumes: `Service._finish_command`, `Storage.update_command`.

- [ ] **Step 1:** Viết các test (dùng `FakePublisher` trong conftest):
  - `test_duplicate_pending_command_returns_existing_cmd_id` (cùng device+action đang pending trong 5 s → cùng `cmd_id`, publish đúng 1 lần).
  - `test_duplicate_ack_ignored` (ack lần 2 trả `False`, trạng thái giữ nguyên).
  - `test_late_ack_after_timeout_does_not_flip_status` (sau `tick` timeout, ack `ok` đến → status vẫn `timeout`, `detail` chứa `late_ack:ok`).
  - `test_publish_error_marks_command_failed` (publisher ném lỗi → `PublishFailed`, lệnh `failed` detail `mqtt_publish_failed`).
  - `test_safety_override_blocks_fan_off_during_heat_alarm` (telemetry `heat_alarm=true`; `send_command("fan","off")` → `SafetyOverride("heat_alarm")`, lệnh lưu `failed` detail `safety_override:heat_alarm`, **không publish**; `fan on`/`auto` vẫn được).
  - `test_physical_confirmation_from_next_telemetry` (ack ok cho `fan on`, rồi telemetry `fan_on=true` → lệnh có `confirmed_ts`; telemetry không khớp → không có).
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Cài đặt trong `service.py`: kiểm tra trùng trong `send_command`; bọc `publisher.publish_cmd` bằng try/except → `PublishFailed`; kiểm tra Safety Override trước khi publish dựa trên `self._telemetry`; `on_cmd_ack` xử lý ack muộn; `on_telemetry` đối chiếu lệnh `ok` chưa có `confirmed_ts` (map: `fan→fan_on`, `led1→led1_on`, `door→door_command`). Lưu `confirmed_ts` qua `update_command`.
- [ ] **Step 4:** `api.py`: ánh xạ `PublishFailed→503`, `SafetyOverride→409` kèm `reason`.
- [ ] **Step 5:** `pytest backend/tests -q` xanh (cả test cũ).
- [ ] **Step 6:** Commit.

### Task 3: Reliability, mốc độ trễ, REST tích hợp phần của Thái

**Files:**
- Modify: `backend/app/service.py`, `backend/app/api.py`
- Test: `backend/tests/test_latency.py`, `backend/tests/test_api.py`

**Interfaces:**
- Produces (REST, đều GET): `/api/history/reliability`, `/api/history/commands/stats`, `/api/history/connections`, `/api/history/errors` (gọi `storage.reliability_stats / command_stats / list_connection_events / list_error_events`); `/api/metrics/latency` → `{"ack": {"count","avg","p95","max"}, "confirm": {...}, "telemetry_interval": {...}}` (giây), tính từ bản ghi lệnh (`ack_ts-sent_ts`, `confirmed_ts-sent_ts`) và khoảng cách `rx` telemetry.
- Consumes: các hàm Storage của Thái (xác minh chữ ký thực tế trong `storage.py` trước khi gọi).

- [ ] **Step 1:** Review `service.py`/`storage.py` sau PR #1, #2: ghi kết quả vào mục "Kết quả review PR" của `TEST_REPORT_V2.md` (điểm đúng, điểm rủi ro, việc cần Thái sửa).
- [ ] **Step 2:** Test: `test_reliability_endpoint_shape`, `test_command_stats_endpoint`, `test_connections_endpoint`, `test_errors_endpoint`, `test_latency_percentiles` (dữ liệu giả → p95 chính xác theo phương pháp nearest-rank), `test_old_endpoints_unchanged` (so sánh khóa JSON `/api/state`, `/api/history`).
- [ ] **Step 3:** Chạy → FAIL; cài đặt endpoint + hàm `Service.latency_stats()`; thêm `log` có cấu trúc (`logging.info("latency cmd_id=... ack_ms=... confirm_ms=...")`).
- [ ] **Step 4:** Xanh; kiểm tra thủ công với PostgreSQL thật (docker compose) rằng các endpoint trả dữ liệu.
- [ ] **Step 5:** Commit.

### Task 4: Bảo mật API + MQTT

**Files:**
- Create: `backend/app/auth.py`, `docker/mosquitto.acl.example`, `docker/gen-mqtt-users.ps1`, `docker/gen-mqtt-users.sh`
- Modify: `backend/app/api.py`, `backend/app/config.py`, `backend/app/main.py`, `backend/app/mqtt_bridge.py`, `backend/simulator/fake_esp32.py`, `docker/mosquitto.conf`, `docker-compose.yml`, `.env.example`, `.gitignore`, frontend `httpClient.ts` (tự đăng nhập, tự gia hạn JWT, đọc `config.js`)
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Produces: `Settings.users: dict[str, UserRecord]` (`BTL_USERS`, mật khẩu băm bcrypt), `Settings.jwt_secret`; `POST /api/auth/login {username,password} -> {access_token, token_type, expires_in, role}`; `create_token(user, role) / decode_token(token)`; `Settings.mqtt_username/mqtt_password`; `require_role(min_role: str) -> Depends`; `RateLimiter(max_requests: int, window_s: float)`.
- Quy tắc: GET lịch sử/state/WS để mở (chỉ đọc); `POST /api/devices/*/command`, `POST /api/sim/scenario` cần `operator`; `PUT /api/config` cần `admin`. Sai/thiếu/hết hạn JWT → 401, thiếu quyền → 403; đăng nhập sai nhiều lần → 429; vượt giới hạn → 429. Chưa cấu hình user hoặc `jwt_secret` → route điều khiển trả 503 `auth_not_configured` (an toàn mặc định). Thêm vào test: `test_login_wrong_password_401`, `test_expired_jwt_401`, `test_tampered_jwt_401`, `test_jwt_alg_none_rejected`.
- Thư viện: `PyJWT`, `bcrypt` (thêm vào `backend/requirements.txt`).

- [ ] **Step 1:** Viết test: `test_command_without_token_401`, `test_command_with_viewer_token_403`, `test_command_with_operator_ok`, `test_put_config_requires_admin`, `test_unauthorized_never_publishes` (FakePublisher không nhận gì), `test_malformed_body_422` (action là số/list/chuỗi 10 000 ký tự), `test_rate_limit_429`, `test_no_tokens_configured_blocks_control`, `test_tokens_not_in_repo` (quét `git ls-files` không chứa chuỗi token mẫu thật; chỉ cho phép trong `.env.example`).
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Cài `auth.py` + gắn dependency vào route; giới hạn kích thước `action` (max 32 ký tự) trong `CommandRequest`; rate limit theo token+IP cho route điều khiển (mặc định 30 yêu cầu/10 s).
- [ ] **Step 4:** Xanh toàn bộ test.
- [ ] **Step 5:** Mosquitto: `allow_anonymous false`, `password_file`, `acl_file`. ACL: `backend` đọc `telemetry,event,cmd/ack,config/ack,status,sim/state`, ghi `cmd,config/set,sim/scenario`; `esp32` ghi `telemetry,event,cmd/ack,config/ack,status`, đọc `cmd,config/set`; `simulator` như `esp32` + ghi `sim/state`, đọc `sim/scenario`. Script sinh passwd từ biến môi trường bằng `mosquitto_passwd` trong container; file sinh ra nằm ở `docker/secrets/` (gitignore).
- [ ] **Step 6:** Backend + simulator đăng nhập MQTT bằng biến môi trường; `docker-compose.yml`: PostgreSQL bind `127.0.0.1:${DB_PORT}:5432`; frontend nginx thêm token cho route điều khiển hoặc UI có ô nhập token (chọn cách đơn giản: ô nhập token lưu `sessionStorage`).
- [ ] **Step 7:** Kiểm thử thật bằng Docker: client MQTT không mật khẩu bị từ chối; client có tài khoản `simulator` publish vào `cmd` bị ACL chặn; lưu log vào `TEST_REPORT_V2.md`.
- [ ] **Step 8:** Cập nhật README (cách tạo token/mật khẩu), commit.

### Task 5: Đồng bộ simulator với firmware

**Files:**
- Modify: `backend/simulator/fake_esp32.py`
- Test: `backend/tests/test_simulator_scenarios.py`

**Interfaces:**
- Produces: hằng `DOOR_HOLD_PIR_S = 10.0`, `DOOR_HOLD_GAS_S = 60.0`; khi `heat_alarm=true` thì `fan_on=true` (trừ khi lệnh thủ công bị Safety Override chặn); kịch bản gas (`gas_leak`) có `gas_alarm`, `gas_raw`, `safety_mode`.

- [ ] **Step 1:** Test: `test_door_stays_open_10s_after_last_pir`, `test_door_open_while_gas_alarm`, `test_door_holds_60s_after_gas_clears`, `test_gas_realarm_restarts_60s_countdown`, `test_heat_alarm_forces_fan_on`, `test_manual_fan_off_ignored_during_heat_alarm` (ack `failed`, detail `safety_override:heat_alarm`).
- [ ] **Step 2:** FAIL → sửa simulator → PASS; chạy lại các kịch bản cũ để đối chiếu.
- [ ] **Step 3:** Commit.

### Task 6: Kiểm thử lỗi, hiệu năng và báo cáo

**Files:**
- Create: `backend/tests/fault/test_fault_scenarios.py`, `backend/tools/load_telemetry.py`, `backend/docs/TEST_REPORT_V2.md`

**Interfaces:**
- Produces: script `python -m tools.load_telemetry --rate 200 --duration 30 --host … --user … --password …` in ra: số gửi/nhận/lưu, tỷ lệ mất, CPU/RAM backend (`docker stats --no-stream`), thời gian khôi phục.

- [ ] **Step 1:** Test tự động (không cần Docker): burst 10 000 telemetry vào `Service` với `InMemoryStorage` (bộ nhớ có trần, không ngoại lệ); storage ném lỗi → `/api/state` vẫn 200, `/api/history` 503; ack timeout; seq nhảy 10⁸ không OOM.
- [ ] **Step 2:** Kịch bản có Docker (chạy tay, ghi log): restart backend; `docker compose stop mosquitto` rồi start lại; `docker compose stop db` rồi start lại; burst 200 msg/s; truy cập trái phép. Mỗi kịch bản ghi: điều kiện đầu, thao tác, mong đợi, thực tế, PASS/FAIL, log/SQL minh chứng.
- [ ] **Step 3:** Đo độ trễ (≥ 30 lần mỗi điều kiện, mạng thường vs có tải): avg/P95/max cho gửi→ack, gửi→telemetry xác nhận, telemetry→WS hiển thị; điền bảng.
- [ ] **Step 4:** Chạy lại toàn bộ `pytest` (hồi quy) + ghi commit hash, phiên bản cấu hình vào báo cáo.
- [ ] **Step 5:** Commit.

---

## Quyết định đã chốt (2026-11-23, người dùng)

1. **Xác thực:** username/password cấp **JWT** (`POST /api/auth/login`). User khai báo qua env `BTL_USERS` (mật khẩu băm bcrypt) + `BTL_JWT_SECRET`; JWT HS256 hạn 1 giờ, mang `sub` và `role`.
2. **Quy tắc cửa (firmware, simulator phải khớp):** auto bình thường: giữ mở **10 s** sau lần cuối PIR phát hiện chuyển động. Khi `gas_alarm=true`: cửa mở liên tục. Khi gas hết: giữ mở thêm **60 s**; cảnh báo bật lại thì hủy và đếm lại 60 s từ lần hết kế tiếp. (`DOOR_HOLD_PIR_S=10`, `DOOR_HOLD_GAS_S=60`.)
3. **Frontend:** tự động đăng nhập, không có ô nhập token; tài khoản UI cấp lúc chạy (env -> `config.js`), tự gia hạn JWT, dùng vai trò `operator` (không phải `admin`).
4. **Đo độ trễ:** trên **ESP32 thật** (cần firmware có WiFi + MQTT từ Người 2/3). Harness đo kiểm chứng trước bằng simulator; số liệu chính thức trong báo cáo chỉ lấy từ thiết bị thật.

## Self-review

- Phủ yêu cầu: Contract (T1), Bảo mật (T4), Lệnh/ACK (T2), Reliability + log mốc thời gian (T3), tích hợp Thái + review PR (T3), kiểm thử lỗi/hiệu năng (T6), đồng bộ simulator (T5).
- Rủi ro đã nêu: T4 làm thay đổi cách kết nối của simulator/frontend/ESP32 nên đặt sau T1–T3.

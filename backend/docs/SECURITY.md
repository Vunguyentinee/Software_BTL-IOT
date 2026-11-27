# Bảo mật hệ thống

## 1. Những gì được bảo vệ

| Lớp | Cơ chế | Kết quả khi vi phạm |
|---|---|---|
| Trang web | **Màn hình đăng nhập** (không tự đăng nhập, không có mật khẩu nào trong mã/cấu hình web); token giữ trong `sessionStorage` (mất khi đóng tab), tự đăng xuất khi hết hạn | Chưa đăng nhập chỉ thấy form đăng nhập |
| Mọi API (xem + điều khiển) | Đăng nhập username/password → **JWT** (HS256, hạn 1 giờ), phân quyền theo vai trò | 401 / 403, **không** publish MQTT, không ghi DB, không trả dữ liệu |
| WebSocket `/ws` | Tin đầu tiên phải là `{"kind":"auth","token":...}` trong 5 giây | Đóng mã `4401`, không gửi dữ liệu |
| Đăng nhập | Khóa tạm sau 5 lần sai trong 60 giây (theo tên đăng nhập) | 429 + `Retry-After` |
| Số lượng yêu cầu | Tối đa 30 yêu cầu điều khiển / 10 giây / người dùng (yêu cầu chỉ đọc không tính, để web poll trạng thái không bị chặn) | 429 + `Retry-After` |
| Dữ liệu đầu vào | Pydantic: kiểu, độ dài (`action` ≤ 32, mật khẩu ≤ 128), thiết bị/hành động hợp lệ | 422 |
| MQTT | `allow_anonymous false`, 3 tài khoản riêng, **ACL theo topic** | Kết nối bị từ chối / publish bị broker bỏ |
| Trình duyệt ↔ MQTT | Web **không** nối thẳng broker (đã bỏ `mqttService.ts`, broker chỉ nghe 1883, không có cổng WebSocket 9001); mọi lệnh đi qua backend | Không có đường gửi lệnh bỏ qua đăng nhập/ACK |
| PostgreSQL | Cổng chỉ bind `127.0.0.1` | Máy khác trong mạng không kết nối được |
| Bí mật | Chỉ nằm trong `.env` (gitignore), sinh ngẫu nhiên bằng `docker/make-env.*` | — |

## 2. Vai trò API

| Vai trò | Được làm |
|---|---|
| (không đăng nhập) | Chỉ `POST /api/auth/login` và `GET /api/health` (trạng thái MQTT/DB để giám sát, không chứa dữ liệu nhà) |
| `viewer` | Xem: `GET /api/state`, `/api/history*`, `/api/events`, `/api/commands`, `/api/config`, `/api/sim`, `/api/metrics/latency`, `/api/auth/me`, WebSocket `/ws` |
| `operator` | Thêm: `POST /api/devices/{device}/command`, `POST /api/sim/scenario`, `POST /api/alarms/{event_id}/ack` (chỉ `event_id` đang có trong `active_alarms`) |
| `admin` | Thêm: `PUT /api/config` (đổi ngưỡng) |

Quyền hiệu lực lấy từ cấu hình `BTL_USERS` hiện tại, không tin claim `role` trong token (hạ quyền người dùng có hiệu lực ngay cả với token cũ).

Đăng nhập: `POST /api/auth/login {"username","password"}` → `{access_token, token_type:"bearer", expires_in, role}`. Gửi `Authorization: Bearer <access_token>`.

**An toàn mặc định:** nếu chưa cấu hình người dùng hoặc `BTL_JWT_SECRET` ngắn hơn 32 ký tự thì mọi route (xem và điều khiển) trả `503 auth_not_configured`; không bao giờ tự mở.

Giao diện ẩn/khóa nút theo vai trò (viewer không bấm được điều khiển, chỉ admin lưu được ngưỡng) chỉ để dễ dùng; **quyết định cuối cùng luôn ở backend**.

## 3. Quyền MQTT (`docker/mosquitto.acl`)

| Tài khoản | Ghi (publish) | Đọc (subscribe) |
|---|---|---|
| `backend` | `cmd`, `config/set`, `sim/scenario`, `event/ack`, `backend/heartbeat` | `telemetry`, `event`, `cmd/ack`, `config/ack`, `status`, `sim/state` |
| `esp32` | `telemetry`, `event`, `cmd/ack`, `config/ack`, `status` | `cmd`, `config/set`, `event/ack`, `backend/heartbeat` |
| `simulator` | như `esp32` + `sim/state` | `cmd`, `config/set`, `sim/scenario`, `telemetry`, `event/ack`, `backend/heartbeat` |

Hệ quả: **chỉ `backend` được publish lệnh điều khiển, ACK cảnh báo và heartbeat**; thiết bị hoặc client lạ không thể giả lệnh. Tài khoản `esp32` bị lộ thì chỉ giả được dữ liệu cảm biến của chính thiết bị đó, không điều khiển được thiết bị khác.

**Lưu ý vận hành:** khi ACL từ chối *đọc* một topic, Mosquitto vẫn trả SUBACK thành công và chỉ không giao tin (đã kiểm chứng). Firmware vì vậy không báo lỗi mà âm thầm không nhận được tin; thêm topic mới vào firmware thì phải thêm vào `docker/mosquitto.acl`.

**Ràng buộc phiên đích (lớp bảo vệ thứ hai, ở firmware):** lệnh/cấu hình phải mang `target_boot_id`, `target_connection_id` khớp phiên hiện tại của thiết bị, nên lệnh cũ hoặc bản ghi lại (replay) bị từ chối. Backend chỉ lấy phiên đích từ telemetry của đúng `device_id` cấu hình (`BTL_DEVICE_ID`); telemetry của thiết bị khác chỉ được lưu, không đổi trạng thái hay phiên.

**Nhật ký:** mỗi lệnh lưu người gửi (`source = web:<tên đăng nhập>`), kể cả lệnh bị chặn an toàn; xác nhận cảnh báo ghi log kèm người xác nhận.

## 4. Cấu hình

`docker/make-env.ps1` (hoặc `.sh`) sinh `.env` với: `MQTT_BACKEND_PASSWORD`, `MQTT_DEVICE_PASSWORD`, `MQTT_SIM_PASSWORD`, `BTL_JWT_SECRET`, `ADMIN_PASSWORD`, `UI_USERNAME`, `UI_PASSWORD`, `BTL_USERS`. Chạy lại không ghi đè giá trị đã có.

**Mỗi thành viên một tài khoản** (nhật ký ghi đúng người gửi lệnh):

```powershell
powershell -ExecutionPolicy Bypass -File dockerdd-user.ps1 -Name vu -Role admin      # in mật khẩu ngẫu nhiên một lần
powershell -ExecutionPolicy Bypass -File dockerdd-user.ps1 -Name thai -Role operator
powershell -ExecutionPolicy Bypass -File dockerdd-user.ps1 -Name khach -Role viewer
powershell -ExecutionPolicy Bypass -File dockerdd-user.ps1 -Name khach -Remove
docker compose up -d backend                                                         # áp dụng
```

(Linux/macOS: `sh docker/add-user.sh <tên> <vai_trò> [mật_khẩu]`.) Không có chức năng tự đăng ký: người lạ trong mạng không tự tạo được tài khoản điều khiển.

`BTL_USERS="tên:mật_khẩu:vai_trò,..."`: mật khẩu 8–72 byte, không chứa `:` hoặc `,`. Backend băm bcrypt trong bộ nhớ khi khởi động. Sai định dạng → backend không dùng danh sách nào (ghi log lỗi) và các route điều khiển trả 503.

Firmware ESP32 thật dùng tài khoản `esp32` + `MQTT_DEVICE_PASSWORD`. **Mật khẩu này phải được nạp vào firmware**; đừng commit vào mã nguồn Arduino (dùng file `secrets.h` nằm trong `.gitignore`).

## 5. Giới hạn đã biết (không che giấu)

1. ~~Giao diện web tự đăng nhập~~ — **đã bỏ** (bản này): web bắt đăng nhập, không còn mật khẩu trong `config.js`. Tài khoản `ui` trong `.env` chỉ còn dùng cho công cụ kiểm thử (`backend/tools/live_*.py`).
2. **Không mã hóa đường truyền**: HTTP và MQTT không TLS (mạng WiFi nội bộ). Mật khẩu và JWT đi dạng rõ trong mạng nội bộ, người cùng WiFi có thể nghe lén. TLS cần chứng chỉ và firmware hỗ trợ; chưa làm.
3. **Khóa đăng nhập theo tên đăng nhập**: kẻ tấn công có thể cố ý khóa tài khoản người khác trong 60 giây. Đổi lại chặn dò mật khẩu.
4. **Giới hạn tốc độ và khóa đăng nhập nằm trong bộ nhớ**: mất khi backend khởi động lại; chỉ đúng với một tiến trình backend.
5. `GET /api/health` vẫn mở (chỉ báo MQTT/DB có hoạt động không, không có dữ liệu nhà) để giám sát. WebSocket đã mở trước khi token hết hạn vẫn nhận dữ liệu tới khi đóng (web tự đăng xuất đúng lúc hết hạn).
   Nhật ký ai gửi lệnh nằm trong bảng `commands` (cột `source`), chưa có màn hình hiển thị; việc xác nhận cảnh báo mới ghi vào log backend, chưa lưu DB.
6. **Cổng backend `8000` và MQTT `1883` vẫn mở ra mạng nội bộ** (cần cho ESP32 và demo). Tường lửa Windows là lớp bảo vệ ngoài.
7. PostgreSQL vẫn dùng mật khẩu mặc định `smarthome` vì đổi mật khẩu làm hỏng volume dữ liệu đã có; được bảo vệ bằng việc chỉ bind `127.0.0.1`.

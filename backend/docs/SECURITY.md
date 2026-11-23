# Bảo mật hệ thống

## 1. Những gì được bảo vệ

| Lớp | Cơ chế | Kết quả khi vi phạm |
|---|---|---|
| API điều khiển/cấu hình | Đăng nhập username/password → **JWT** (HS256, hạn 1 giờ), phân quyền theo vai trò | 401 / 403, **không** publish MQTT, không ghi DB |
| Đăng nhập | Khóa tạm sau 5 lần sai trong 60 giây (theo tên đăng nhập) | 429 + `Retry-After` |
| Số lượng yêu cầu | Tối đa 30 yêu cầu điều khiển / 10 giây / người dùng | 429 + `Retry-After` |
| Dữ liệu đầu vào | Pydantic: kiểu, độ dài (`action` ≤ 32, mật khẩu ≤ 128), thiết bị/hành động hợp lệ | 422 |
| MQTT | `allow_anonymous false`, 3 tài khoản riêng, **ACL theo topic** | Kết nối bị từ chối / publish bị broker bỏ |
| PostgreSQL | Cổng chỉ bind `127.0.0.1` | Máy khác trong mạng không kết nối được |
| Bí mật | Chỉ nằm trong `.env` (gitignore), sinh ngẫu nhiên bằng `docker/make-env.*` | — |

## 2. Vai trò API

| Vai trò | Được làm |
|---|---|
| (không đăng nhập) | Chỉ đọc: `GET /api/state`, `/api/history*`, `/api/events`, `/api/commands`, `/api/config`, `/api/health`, `/api/metrics/latency`, WebSocket `/ws` |
| `viewer` | Như trên (xác thực được nhưng không có thêm quyền) |
| `operator` | Thêm: `POST /api/devices/{device}/command`, `POST /api/sim/scenario` |
| `admin` | Thêm: `PUT /api/config` (đổi ngưỡng) |

Quyền hiệu lực lấy từ cấu hình `BTL_USERS` hiện tại, không tin claim `role` trong token (hạ quyền người dùng có hiệu lực ngay cả với token cũ).

Đăng nhập: `POST /api/auth/login {"username","password"}` → `{access_token, token_type:"bearer", expires_in, role}`. Gửi `Authorization: Bearer <access_token>`.

**An toàn mặc định:** nếu chưa cấu hình người dùng hoặc `BTL_JWT_SECRET` ngắn hơn 32 ký tự thì mọi route điều khiển trả `503 auth_not_configured`; không bao giờ tự mở.

## 3. Quyền MQTT (`docker/mosquitto.acl`)

| Tài khoản | Ghi (publish) | Đọc (subscribe) |
|---|---|---|
| `backend` | `cmd`, `config/set`, `sim/scenario` | `telemetry`, `event`, `cmd/ack`, `config/ack`, `status`, `sim/state` |
| `esp32` | `telemetry`, `event`, `cmd/ack`, `config/ack`, `status` | `cmd`, `config/set` |
| `simulator` | như `esp32` + `sim/state` | `cmd`, `config/set`, `sim/scenario`, `telemetry` |

Hệ quả: **chỉ `backend` được publish lệnh điều khiển**; thiết bị hoặc client lạ không thể giả lệnh. Tài khoản `esp32` bị lộ thì chỉ giả được dữ liệu cảm biến của chính thiết bị đó, không điều khiển được thiết bị khác.

## 4. Cấu hình

`docker/make-env.ps1` (hoặc `.sh`) sinh `.env` với: `MQTT_BACKEND_PASSWORD`, `MQTT_DEVICE_PASSWORD`, `MQTT_SIM_PASSWORD`, `BTL_JWT_SECRET`, `ADMIN_PASSWORD`, `UI_USERNAME`, `UI_PASSWORD`, `BTL_USERS`. Chạy lại không ghi đè giá trị đã có.

`BTL_USERS="tên:mật_khẩu:vai_trò,..."`: mật khẩu 8–72 byte, không chứa `:` hoặc `,`. Backend băm bcrypt trong bộ nhớ khi khởi động. Sai định dạng → backend không dùng danh sách nào (ghi log lỗi) và các route điều khiển trả 503.

Firmware ESP32 thật dùng tài khoản `esp32` + `MQTT_DEVICE_PASSWORD`. **Mật khẩu này phải được nạp vào firmware**; đừng commit vào mã nguồn Arduino (dùng file `secrets.h` nằm trong `.gitignore`).

## 5. Giới hạn đã biết (không che giấu)

1. **Giao diện web tự đăng nhập**: tài khoản `ui` (operator) được đưa vào `config.js` mà trình duyệt tải về. Vì vậy **bất kỳ ai mở được trang web đều điều khiển được thiết bị** (quyền operator). Chấp nhận được cho demo trong mạng nhóm; không dùng khi để ra Internet. Đổi ngưỡng (`PUT /api/config`) cần `admin`, nên giao diện sẽ báo `forbidden` khi sửa ngưỡng; dùng tài khoản `admin` qua API (`/docs`) để sửa.
2. **Không mã hóa đường truyền**: HTTP và MQTT không TLS (mạng WiFi nội bộ). Mật khẩu và JWT đi dạng rõ trong mạng nội bộ. TLS cần chứng chỉ và firmware hỗ trợ; chưa làm.
3. **Khóa đăng nhập theo tên đăng nhập**: kẻ tấn công có thể cố ý khóa tài khoản người khác trong 60 giây. Đổi lại chặn dò mật khẩu.
4. **Giới hạn tốc độ và khóa đăng nhập nằm trong bộ nhớ**: mất khi backend khởi động lại; chỉ đúng với một tiến trình backend.
5. **Dữ liệu đọc (lịch sử, trạng thái, WebSocket) không cần đăng nhập** theo thiết kế hiện tại.
6. **Cổng backend `8000` và MQTT `1883` vẫn mở ra mạng nội bộ** (cần cho ESP32 và demo). Tường lửa Windows là lớp bảo vệ ngoài.
7. PostgreSQL vẫn dùng mật khẩu mặc định `smarthome` vì đổi mật khẩu làm hỏng volume dữ liệu đã có; được bảo vệ bằng việc chỉ bind `127.0.0.1`.

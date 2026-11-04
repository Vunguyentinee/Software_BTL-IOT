# Digital Twin nhà thông minh — hướng dẫn chạy hệ thống

Hệ thống chạy trên **một laptop** (gọi là "máy chủ demo"). ESP32 và các máy khác trong nhóm kết nối vào máy đó qua cùng một mạng WiFi.

```
ESP32 --WiFi/MQTT--> [ Mosquitto ] --> [ Backend (Python) ] --> [ PostgreSQL ]
                                              |  REST + WebSocket
                                              v
                                  [ Website (nginx) ]  --> trình duyệt: http://<IP máy chủ>:3000
```

Cả bốn thành phần (Mosquitto, Backend, PostgreSQL, Website) chạy bằng **Docker Compose**: một lệnh, giống nhau trên mọi máy.

Cấu trúc thư mục: `backend/` (Python), `frontend/` (React), `docker/` (cấu hình Mosquitto), `docs/` (thiết kế và kế hoạch).

## 1. Cài đặt (làm một lần trên máy chủ demo)

1. Cài **Docker Desktop**: https://www.docker.com/products/docker-desktop/ rồi mở nó và đợi báo *Engine running*.
2. Lấy mã nguồn của nhóm về máy (git clone hoặc copy thư mục `BTL IOT`).

Không cần cài Python, PostgreSQL hay Mosquitto riêng.

## 2. Chạy hệ thống

Mở PowerShell trong thư mục gốc của dự án (nơi có `docker-compose.yml`):

```powershell
docker compose up -d --build        # chạy cả hệ thống (lần đầu mất vài phút để tải)
docker compose ps                   # kiểm tra: backend, db, mosquitto, frontend đều "Up"
```

Kiểm tra: mở **http://localhost:3000** (giao diện). API và tài liệu API: http://localhost:8000/docs.

Chưa có ESP32 hoặc muốn thử nhanh? Chạy kèm **ESP32 giả lập**:

```powershell
docker compose --profile sim up -d --build
```

Dừng và bật lại:

```powershell
docker compose stop        # dừng (dữ liệu vẫn còn)
docker compose start       # chạy lại
docker compose down        # tắt và xóa container (dữ liệu vẫn còn trong volume)
docker compose down -v     # CẢNH BÁO: xóa luôn toàn bộ dữ liệu database
docker compose logs -f backend   # xem log backend
```

Đổi mật khẩu hoặc cổng (không bắt buộc): sao chép `.env.example` thành `.env` rồi sửa.

## 3. Cho từng vai trò

### ESP32 (Người 2, 3)
- Kết nối cùng WiFi với máy chủ demo. Lấy IP máy chủ bằng `ipconfig` (dòng *IPv4 Address* của WiFi, ví dụ `192.168.1.20`).
- Firmware kết nối MQTT tới `<IP máy chủ>:1883`, không cần tài khoản. Topic và định dạng JSON ở [backend/docs/API_MQTT.md](backend/docs/API_MQTT.md).
- Nếu ESP32 không kết nối được, xem mục 5 (Tường lửa).

### Website và Digital Twin (Người 6, 7)
- Giao diện đã được đóng gói sẵn trong Docker Compose: mở `http://<IP máy chủ>:3000`. Nginx của nó tự chuyển `/api` và `/ws` tới backend nên không cần cấu hình gì thêm.
- API trực tiếp: `http://<IP máy chủ>:8000/api/...`; thời gian thực: `ws://<IP máy chủ>:8000/ws`.
- Danh sách endpoint, ví dụ và mã lỗi: [backend/docs/API_MQTT.md](backend/docs/API_MQTT.md). Xem thử trực tiếp tại `http://<IP máy chủ>:8000/docs`.
- Sửa giao diện: xem [frontend/README.md](frontend/README.md) (`npm install`, `npm run dev` để xem thay đổi ngay; sau đó `docker compose up -d --build frontend` để đóng gói lại).
- API lịch sử có thêm thống kê (`/api/history/stats`), phân trang (`/api/history/page`) và tải CSV (`/api/history.csv`).
- Chưa có phần cứng: chạy `docker compose --profile sim up -d` để có dữ liệu giả. Ô **Kịch bản** ở đầu trang khi đó điều khiển ESP32 giả lập (khói/cháy, nhiệt độ cao, mất kết nối...); danh sách kịch bản ở `backend/docs/API_MQTT.md` mục 6.

### Cơ sở dữ liệu (Người 5)
- PostgreSQL chạy ở `<IP máy chủ>:5432`, database `smarthome`, user `smarthome`, mật khẩu `smarthome` (mặc định, đổi trong `.env`).
- Kết nối bằng DBeaver, pgAdmin hoặc `docker compose exec db psql -U smarthome -d smarthome`.
- Bảng: `telemetry` (số đo), `events` (cảnh báo/sự kiện), `commands` (lệnh điều khiển), `config` (ngưỡng). Bảng tự tạo khi backend khởi động, định nghĩa ở `backend/app/pg_storage.py`.
- Muốn đổi cấu trúc bảng hay thêm truy vấn (trung bình/min/max, CSV): sửa `backend/app/pg_storage.py` (giao diện `Storage` ở `backend/app/storage.py`), rồi chạy lại `docker compose up -d --build backend`.

### Backend (Người 4)
- Chi tiết, cách chạy không dùng Docker và chạy test: [backend/README.md](backend/README.md).

## 4. Chuẩn bị demo ở máy khác

1. Cài Docker Desktop trên máy đó, lấy mã nguồn, chạy `docker compose up -d --build`.
2. **Dữ liệu cũ không tự đi theo** — database ở máy mới trống. Chọn một trong hai cách:
   - Để ESP32 (hoặc simulator) chạy vài phút trước giờ demo để có lịch sử.
   - Mang theo bản sao lưu từ máy cũ:

     ```powershell
     # Trên máy cũ: tạo file sao lưu backup.sql
     docker compose exec -T db pg_dump -U smarthome -d smarthome -c --if-exists -f /tmp/backup.sql
     docker compose cp db:/tmp/backup.sql ./backup.sql

     # Trên máy mới (sau khi docker compose up): nạp lại
     docker compose cp ./backup.sql db:/tmp/backup.sql
     docker compose exec -T db psql -U smarthome -d smarthome -f /tmp/backup.sql
     docker compose restart backend
     ```
3. Đảm bảo máy mới và ESP32 cùng WiFi, lấy IP máy mới bằng `ipconfig`, rồi **cập nhật IP trong firmware ESP32** (hoặc đặt IP tĩnh cho máy chủ demo trên router để khỏi phải sửa).
4. Danh sách kiểm tra trước demo: `docker compose ps` đều Up; `http://localhost:8000/api/state` có `"online": true` khi ESP32 bật; mở web và thử một lệnh.

## 5. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `docker compose` báo không kết nối được Docker | Mở Docker Desktop, đợi *Engine running*. |
| ESP32/máy khác không kết nối được tới máy chủ | Windows Firewall chặn. Mở PowerShell **quyền Administrator**: `New-NetFirewallRule -DisplayName "BTL IoT" -Direction Inbound -Protocol TCP -LocalPort 1883,3000,8000,5432 -Action Allow`. Kiểm tra cùng WiFi và đúng IP (`ipconfig`). |
| `port is already allocated` | Cổng 1883/5432/8000 đang bị chương trình khác dùng (ví dụ PostgreSQL hoặc Mosquitto cài sẵn). Đổi `MQTT_PORT`, `DB_PORT`, `API_PORT`, `WEB_PORT` trong `.env`, hoặc tắt chương trình đó. |
| `/api/state` có `"online": false` | ESP32 chưa gửi dữ liệu trong 10 giây gần nhất. Xem `docker compose logs -f backend` và log Serial của ESP32. |
| Lệnh từ web trả 409 `device_offline` | ESP32 đang mất kết nối; lệnh bị từ chối có chủ ý. |
| Muốn xóa sạch dữ liệu để thử lại | `docker compose down -v` rồi `docker compose up -d --build`. |
| Đổi code backend/frontend nhưng không thấy thay đổi | Chạy lại với `--build`: `docker compose up -d --build backend frontend`. |

> Mosquitto đang cho phép kết nối ẩn danh (không mật khẩu) vì chỉ dùng trong mạng WiFi nội bộ của nhóm. Không mở cổng này ra Internet.

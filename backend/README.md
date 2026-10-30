# Backend nhà thông minh (Python)

Nhận dữ liệu ESP32 qua MQTT, cung cấp REST/WebSocket cho web, gửi lệnh và ngưỡng xuống ESP32.
Chi tiết giao thức: [docs/API_MQTT.md](docs/API_MQTT.md).

> **Chạy cả hệ thống (khuyến nghị):** dùng Docker Compose theo [README gốc](../README.md). Tài liệu này dành cho người phát triển backend muốn chạy trực tiếp bằng Python (các mục 1–5), nên cần Mosquitto cài riêng hoặc chạy qua `docker compose up -d mosquitto`.

## 1. Cài đặt Python

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

## 2. Cài và chạy Mosquitto (Windows)

1. Tải bản cài đặt từ https://mosquitto.org/download/ rồi cài.
2. Tạo file `C:\Program Files\mosquitto\mosquitto.conf` (hoặc thêm vào file có sẵn):
   ```
   listener 1883
   allow_anonymous true
   ```
3. Mở cổng 1883 trong Windows Firewall (Inbound rule, TCP 1883) để ESP32 kết nối được.
4. Chạy: `"C:\Program Files\mosquitto\mosquitto.exe" -c "C:\Program Files\mosquitto\mosquitto.conf" -v`
   (hoặc khởi động service `Mosquitto Broker` trong `services.msc`).
5. Tìm IP laptop bằng `ipconfig` (mục IPv4 của WiFi). Đây là địa chỉ ESP32 dùng để kết nối MQTT.

> Chỉ dùng `allow_anonymous true` trong mạng WiFi nội bộ của nhóm.

## 3. Chạy backend

```powershell
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Biến môi trường tùy chọn: `BTL_MQTT_HOST` (mặc định `localhost`), `BTL_MQTT_PORT` (1883), `BTL_DEVICE_ID` (`esp32-home`), `BTL_DATA_FILE` (`data/store.json`).
Tài liệu API tự sinh: http://localhost:8000/docs

## 4. Chạy không cần phần cứng (simulator)

```powershell
.venv\Scripts\python -m simulator.fake_esp32 --host localhost
```
Tuỳ chọn: `--fail-door` (ack cửa luôn `failed`), `--silent-after 30` (ngừng gửi sau 30 giây để thử mất kết nối). Dừng bằng Ctrl+C: backend báo offline ngay nhờ Last Will.

Thử nhanh:
```powershell
curl http://localhost:8000/api/state
curl -X POST http://localhost:8000/api/devices/fan/command -H "content-type: application/json" -d "{\"action\":\"on\"}"
```

## 5. Test

```powershell
.venv\Scripts\python -m pytest -q
```

## 6. Lưu trữ

Backend chọn lớp lưu trữ theo biến môi trường `BTL_DATABASE_URL`:

- **Có đặt** (ví dụ `postgresql://smarthome:smarthome@localhost:5432/smarthome`): dùng `PostgresStorage` (`app/pg_storage.py`), dữ liệu bền. Đây là cách chạy trong Docker Compose, xem [README gốc](../README.md).
- **Không đặt**: dùng `InMemoryStorage` (`app/storage.py`): lịch sử cảm biến nằm trong bộ nhớ (mất khi tắt backend), còn ngưỡng, lệnh và sự kiện ghi ra `BTL_DATA_FILE`. Tiện để phát triển nhanh không cần database.

Muốn đổi sang database khác, viết một lớp cài đặt interface `Storage` rồi chọn nó trong `app/main.py`.

Test PostgreSQL chỉ chạy khi đặt `BTL_TEST_DATABASE_URL` trỏ tới một database dùng để thử (dữ liệu trong đó sẽ bị xóa), nếu không sẽ được bỏ qua:

```powershell
docker run -d --rm --name btl-testdb -e POSTGRES_PASSWORD=test -e POSTGRES_DB=smarthome_test -p 55432:5432 postgres:16
$env:BTL_TEST_DATABASE_URL = "postgresql://postgres:test@localhost:55432/smarthome_test"
.venv\Scripts\python -m pytest -q
```

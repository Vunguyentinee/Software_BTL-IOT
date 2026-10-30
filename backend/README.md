# Backend nhà thông minh (Python)

Nhận dữ liệu ESP32 qua MQTT, cung cấp REST/WebSocket cho web, gửi lệnh và ngưỡng xuống ESP32.
Chi tiết giao thức: [docs/API_MQTT.md](docs/API_MQTT.md).

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

Hiện dùng `InMemoryStorage` (`app/storage.py`): lịch sử cảm biến nằm trong bộ nhớ (mất khi tắt backend), còn ngưỡng, lệnh và sự kiện được ghi ra `BTL_DATA_FILE`. Khi chọn database thật, viết một lớp cài đặt interface `Storage` rồi thay trong `app/main.py`.

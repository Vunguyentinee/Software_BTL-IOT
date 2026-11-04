# Digital Twin Monitor (Frontend)

Dashboard giám sát và điều khiển nhà thông minh ESP32: số đo nhiệt độ, độ ẩm, khói; trạng thái đèn, quạt, cửa; cảnh báo; biểu đồ lịch sử; điều khiển thủ công và cấu hình ngưỡng.

Công nghệ: React 18, TypeScript, Vite, Tailwind CSS, Recharts. Test bằng Vitest.

Cách chạy cả hệ thống (Mosquitto, PostgreSQL, backend) nằm ở [README gốc](../README.md). Tài liệu này chỉ nói về frontend.

## 1. Chạy frontend

**Cùng cả hệ thống (khuyến nghị cho demo):** `docker compose up -d --build` ở thư mục gốc, rồi mở http://localhost:3000. Giao diện được build sẵn và phục vụ bằng nginx (`Dockerfile`, `nginx.conf` trong thư mục này), nginx chuyển `/api` và `/ws` tới backend.

**Khi đang sửa giao diện:** chạy bản phát triển để thấy thay đổi ngay. Cần Node.js 18 trở lên.

```powershell
cd FE-Digital-Twin-Monitor
npm install
npm run dev          # mở http://localhost:3000
```

Cho máy khác trong cùng WiFi mở dashboard: `npm run dev -- --host`, rồi vào `http://<IP máy chạy frontend>:3000`.

Lệnh khác: `npm run build` (đóng gói), `npm test` (27 test), `npm run preview`.

## 2. Kết nối backend

Frontend gọi backend qua **proxy của Vite**, nên trình duyệt chỉ nói chuyện với cổng 3000 và không gặp lỗi CORS:

| Đường dẫn | Chuyển tới |
|---|---|
| `/api/*` | `http://localhost:8000` |
| `/ws` | `ws://localhost:8000` |

Cổng 8000 là cổng mặc định của backend trong Docker Compose (`API_PORT`). Nếu backend chạy ở máy khác hoặc cổng khác, sửa `target` trong `vite.config.ts`, hoặc bỏ qua proxy bằng biến môi trường (tạo file `.env.local`):

```
VITE_API_BASE_URL=http://192.168.1.20:8000
VITE_WS_BASE_URL=ws://192.168.1.20:8000
```

Backend cho phép CORS từ mọi nguồn trong mạng nội bộ nên cách này hoạt động; phải khởi động lại `npm run dev` sau khi sửa `.env.local`.

Khởi động backend trước (xem README gốc), hoặc chạy kèm ESP32 giả lập để có dữ liệu: `docker compose --profile sim up -d --build`.

## 3. Dữ liệu thật và dữ liệu mô phỏng

- **Khi WebSocket tới backend kết nối được**, dashboard dùng dữ liệu thật. Thanh trạng thái hiển thị backend và ESP32 online hay offline.
- **Khi không kết nối được backend**, ứng dụng tự chuyển sang **dữ liệu mô phỏng** (`src/services/mockData.ts`) để vẫn xem được giao diện.
- **Biểu đồ lịch sử** (`src/services/historyData.ts`) cũng rơi về chuỗi mô phỏng nếu `/api/history` lỗi hoặc chưa có điểm nào. Vì vậy khi demo, hãy kiểm tra backend đang chạy thật và đã có dữ liệu (ESP32 hoặc simulator chạy vài phút), kẻo nhầm đồ thị mô phỏng với dữ liệu thật.

## 4. Backend cung cấp gì cho frontend

Danh sách đầy đủ, ví dụ và mã lỗi ở [API_MQTT.md](API_MQTT.md) (bản sao của `backend/docs/API_MQTT.md`; khi backend đổi API, chép lại file này).

| Chức năng trên giao diện | API |
|---|---|
| Trạng thái và số đo hiện tại | `GET /api/state` và WebSocket `/ws` |
| Biểu đồ lịch sử theo khoảng thời gian | `GET /api/history?metric=&from=&to=` |
| Thống kê trung bình, nhỏ nhất, lớn nhất | `GET /api/history/stats` (chưa dùng trong giao diện) |
| Phân trang lịch sử | `GET /api/history/page` (chưa dùng trong giao diện) |
| Tải CSV từ database | `GET /api/history.csv` (chưa dùng trong giao diện) |
| Điều khiển LED1, quạt, cửa | `POST /api/devices/{device}/command`, sau đó hỏi `GET /api/commands/{id}` |
| Cấu hình ngưỡng | `GET`/`PUT /api/config` |

Lưu ý khi làm việc với backend:
- Chỉ **LED1, quạt, cửa** điều khiển được từ web. LED2, LED3, còi và bơm do ESP32 tự xử lý.
- Lệnh gửi lúc ESP32 offline bị từ chối (409 `device_offline`).
- Ngưỡng khói trên giao diện đổi từ giá trị analog thô (0–4095) sang "ppm" bằng công thức ước lượng trong `src/services/api/mappers.ts`. Đây chỉ là số hiển thị, không phải đo ppm thật.
- Nút **Xuất CSV** hiện xuất từ dữ liệu đang hiển thị trên biểu đồ, chưa dùng endpoint `history.csv` của backend.

## 5. Cấu trúc thư mục

```
src/
  components/      dashboard, charts, control, config
  services/
    api/           httpClient (REST), websocketService (WS), mappers (backend <-> giao diện)
    backendService.ts   trạng thái kết nối và telemetry từ backend
    commandService.ts   gửi lệnh và chờ ack
    historyData.ts      lịch sử từ backend (có fallback mô phỏng)
    mockData.ts         dữ liệu mô phỏng
  types/           kiểu dữ liệu (api.ts khớp backend/app/models.py)
tests/             Vitest
```

`specification.md` là đặc tả phần cứng và logic của ESP32.

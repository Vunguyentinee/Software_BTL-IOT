# Tình trạng Tích hợp Cảm biến Gas & Chế độ An toàn (Gas & Safety Contract Status)

Tài liệu này xác định ranh giới trách nhiệm, những gì module **Database & History** đã hoàn thành độc lập và những nội dung đang chờ các thành viên khác hoàn thiện.

---

## 1. Trạng thái Tổng thể

```
[Database & History (Thái)]   ---> HOÀN TẤT 100% (SCHEMA, MIGRATION, STORAGE, STATS, TESTS)
[Firmware ESP32 (Hiệu)]        ---> PENDING HARDWARE VALIDATION (Chờ gắn sensor MQ-2 vật lý & publish MQTT)
[Điều khiển An toàn (Kiên)]   ---> PENDING SAFETY RULES (Chờ logic hysteresis / kích hoạt quạt/còi)
[Backend / REST API (Vũ)]      ---> PENDING REST ENDPOINTS (Chờ expose endpoint /api/history/reliability...)
[Frontend UI (Đức)]            ---> PENDING UI INTEGRATION (Chờ thiết kế widget hiển thị nồng độ gas)
```

---

## 2. Phần Database & History đã triển khai thực tế (DONE)

### 2.1. Cấu trúc Schema & Migration
Đã bổ sung 5 cột mới vào PostgreSQL thông qua migration an toàn, có khả năng chạy lại nhiều lần (idempotent):
- `gas_raw` (`INTEGER`): Giá trị nồng độ khí gas MQ-2 thô (0–4095).
- `gas_alarm` (`BOOLEAN`): Cờ cảnh báo rò rỉ khí gas.
- `gas_sensor_ok` (`BOOLEAN`): Trạng thái cảm biến gas hoạt động tốt (null nếu không có cảm biến).
- `safety_mode` (`TEXT`): Chế độ an toàn hệ thống (`normal`, `gas_alert`, `fire_alert`).
- `safety_reason` (`TEXT`): Nguyên nhân kích hoạt chế độ an toàn.

### 2.2. Tính tương thích ngược (Backward Compatibility)
- Tuyệt đối không xóa hoặc thay đổi dữ liệu khói (`smoke_raw`, `smoke_alarm`) cũ.
- Với các bản tin cũ không có gas, các cột trên nhận giá trị `NULL`. Hệ thống không tự suy diễn rằng thiếu gas đồng nghĩa cảm biến an toàn hay không có rò rỉ.
- Các API lịch sử cũ (`history()`, `history_page()`, `history_stats()`, `history_csv()`) tiếp tục hoạt động bình thường 100%.

### 2.3. Hỗ trợ Thống kê & Phân tích
- Thêm `gas_raw` vào `HISTORY_METRICS` (hỗ trợ phân trang, xuất CSV).
- Thêm `gas_raw` vào `HISTORY_STATS_METRICS` (tính toán `count, avg, min, max` bằng SQL tối ưu).
- Thêm `gas_alarm` và `gas_error` vào bộ lọc sự kiện lỗi `list_error_events()`.
- Loại trừ `safety_mode` và `safety_reason` khỏi danh sách metric vẽ đồ thị đơn trục trên `api.py`.

---

## 3. Nội dung PENDING / Cần nhóm thống nhất

### 3.1. Phối hợp với Hiệu (Firmware ESP32)
1. **Topic MQTT**: Xác nhận topic publish telemetry gas (mặc định hiện tại là `home/esp32-home/telemetry`).
2. **Payload Contract**: Hiệu bổ sung các trường vào JSON payload:
   ```json
   {
     "gas_raw": 450,
     "gas_alarm": false,
     "gas_sensor_ok": true,
     "safety_mode": "normal",
     "safety_reason": null
   }
   ```
3. **Bộ đếm phát `tx_count`**: Nếu Hiệu gửi kèm `tx_count`, hệ thống sẽ tính được tỷ lệ phân phối thực tế `delivery_rate = N_received / tx_count`. Hiện tại khi chưa có, backend công bố `delivery_rate = None`.

### 3.2. Phối hợp với Kiên (Điều khiển Tự động & Simulator)
1. **Quy tắc an toàn**: Khi `gas_alarm = true`, hệ thống có tự động bật quạt (`fan`), mở cửa (`door`) hay ngắt nguồn không? Logic này thuộc điều khiển của Kiên/Vũ, Database không tự ý can thiệp.
2. **Cập nhật Simulator**: Cập nhật kịch bản rò rỉ gas trong `fake_esp32.py` khi nhóm chốt hợp đồng.

### 3.3. Phối hợp với Vũ (Backend) & Đức (Frontend)
1. Expose các REST endpoint phân tích nếu cần:
   - `GET /api/history/reliability`
   - `GET /api/history/commands/stats`
   - `GET /api/history/connections`
   - `GET /api/history/errors`
2. Frontend bổ sung card hiển thị nồng độ khí gas trên giao diện Web Dashboard.

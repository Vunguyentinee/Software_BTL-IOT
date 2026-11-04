/**
 * Định nghĩa kiểu dữ liệu Telemetry từ ESP32 theo specification.md
 * kèm các trường mở rộng cho khói, chế độ vận hành và kết nối.
 */

export type SystemMode = 'auto' | 'manual';

export type DoorState = 'open' | 'closed';

export interface DeviceThresholds {
  fan_on_temp: number;      // Mặc định: 35.0 °C (bật quạt)
  fan_off_temp: number;     // Mặc định: 34.0 °C (tắt quạt)
  heat_alarm_on_temp: number;  // Mặc định: 40.0 °C (bật còi + LED3)
  heat_alarm_off_temp: number; // Mặc định: 37.0 °C (tắt còi + LED3)
  smoke_alarm_ppm: number;     // Mặc định: 300 PPM (cảnh báo cháy/khói)
}

export interface ESP32Telemetry {
  // 1. Dữ liệu cảm biến môi trường
  temperature_c: number | null; // Nhiệt độ °C; null nếu đọc lỗi
  humidity_pct: number | null;  // Độ ẩm %; null nếu đọc lỗi
  dht_ok: boolean;              // DHT11 có dữ liệu hợp lệ
  
  // 2. Cảm biến chuyển động và ánh sáng
  pir_ready: boolean;           // PIR đã hết thời gian khởi động (60s)
  pir_warmup_remaining_sec: number; // Số giây còn lại khi khởi động PIR
  motion_detected: boolean;     // PIR đang báo chuyển động
  is_dark: boolean;             // Cảm biến quang trở báo trời tối

  // 3. Cảm biến khói (Mở rộng theo yêu cầu đề bài)
  smoke_ppm: number;            // Nồng độ khói/khí ga (PPM)
  smoke_detected: boolean;      // Vượt ngưỡng khói
  smoke_alarm: boolean;         // Cảnh báo khói nguy cấp

  // 4. Trạng thái cơ cấu chấp hành (Actuators)
  door_command: DoorState;      // Lệnh vị trí cửa ("open" | "closed")
  fan_on: boolean;              // Quạt làm mát đang chạy
  led1_on: boolean;             // LED1 (Đèn chiếu sáng khi trời tối)
  led2_on: boolean;             // LED2 (Đèn báo có chuyển động)
  led3_on: boolean;             // LED3 (Đèn báo nhiệt độ cao)
  heat_alarm: boolean;          // Cảnh báo nhiệt đang hoạt động (còi + LED3)
  buzzer_on: boolean;           // Trạng thái còi kêu
  pump_on?: boolean;            // Bơm nước (chỉ có khi nhận dữ liệu từ backend)

  // 5. Quản trị hệ thống & Kết nối
  uptime_ms: number;            // Thời gian ESP32 chạy từ lần khởi động
  system_mode: SystemMode;      // Chế độ tự động / thủ công
  timestamp: number;            // Thời điểm nhận bản tin (ms)
  thresholds: DeviceThresholds; // Cấu hình ngưỡng vận hành hiện tại
}

export interface SystemStatus {
  isServerConnected: boolean;   // Kết nối WebSocket / Backend
  isESP32Online: boolean;       // ESP32 đang gửi dữ liệu (heartbeat < 10s)
  lastSeen: Date | null;
  latencyMs: number;
}

export type ScenarioType = 
  | 'normal'          // Điều kiện phòng bình thường (28°C, 65%, sáng)
  | 'cooling_fan'     // Nhiệt độ 36°C -> Quạt tự bật
  | 'heat_alarm'      // Nhiệt độ 41°C -> Bật LED3 + Còi kêu + Quạt chạy
  | 'smoke_danger'    // Khói 450 PPM -> Cảnh báo khói cháy
  | 'motion_door'     // Có người đến -> Mở cửa (90°) + Bật LED2
  | 'dark_light'      // Trời tối -> Bật LED1
  | 'dht_error'       // Lỗi cảm biến DHT11 (null)
  | 'pir_warming_up'  // PIR đang warm-up 60s
  | 'esp32_offline';  // Mất kết nối ESP32


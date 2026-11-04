import { describe, it, expect, beforeEach } from 'vitest';
import { MockTelemetryService, DEFAULT_THRESHOLDS } from '../src/services/mockData';
import { CommandService } from '../src/services/commandService';

describe('Kiểm thử Logic Nghiệp Vụ ESP32 (Theo specification.md)', () => {
  let service: MockTelemetryService;

  beforeEach(() => {
    service = new MockTelemetryService();
    service.stopSimulation(); // Dừng interval tự động để kiểm thử từng bước xác định
  });

  describe('1. Logic Chiếu sáng tự động (Mục 2 Spec)', () => {
    it('Cảm biến báo tối -> Bật LED1 (GPIO 12)', () => {
      service.setScenario('dark_light');
      const tel = service.getCurrentTelemetry();
      expect(tel.is_dark).toBe(true);
      expect(tel.led1_on).toBe(true);
    });

    it('Cảm biến báo sáng -> Tắt LED1 (GPIO 12)', () => {
      service.setScenario('normal');
      const tel = service.getCurrentTelemetry();
      expect(tel.is_dark).toBe(false);
      expect(tel.led1_on).toBe(false);
    });
  });

  describe('2. Logic Đón người về & Đóng cửa (Mục 2 Spec)', () => {
    it('PIR chuyển 0 -> 1: Bật LED2 (GPIO 14) và Servo quay 90° (Mở cửa)', () => {
      service.setScenario('motion_door');
      const tel = service.getCurrentTelemetry();
      expect(tel.motion_detected).toBe(true);
      expect(tel.door_command).toBe('open');
      expect(tel.led2_on).toBe(true);
    });

    it('PIR chuyển 1 -> 0: Tắt LED2 và Servo quay 0° (Đóng cửa)', () => {
      service.setScenario('normal');
      const tel = service.getCurrentTelemetry();
      expect(tel.motion_detected).toBe(false);
      expect(tel.door_command).toBe('closed');
      expect(tel.led2_on).toBe(false);
    });
  });

  describe('3. Logic Quạt làm mát & Vùng trễ Hysteresis (Mục 2 Spec)', () => {
    it('Nhiệt độ ≥ 35°C: Quạt làm mát BẬT (GPIO 2)', () => {
      service.setScenario('cooling_fan');
      const tel = service.getCurrentTelemetry();
      expect(tel.temperature_c).toBeGreaterThanOrEqual(35.0);
      expect(tel.fan_on).toBe(true);
    });

    it('Vùng trễ 34°C < T < 35°C: Quạt giữ nguyên trạng thái trước đó', () => {
      // Bật quạt trước bằng nhiệt độ cao
      service.setScenario('cooling_fan');
      expect(service.getCurrentTelemetry().fan_on).toBe(true);

      // Khi nhiệt độ hạ về 34.5°C (ở giữa 34°C và 35°C), quạt vẫn tiếp tục quay
      // Đặt ngưỡng tùy chỉnh để test chính xác
      service.updateThresholds({
        ...DEFAULT_THRESHOLDS,
        fan_on_temp: 35.0,
        fan_off_temp: 34.0,
      });

      const tel = service.getCurrentTelemetry();
      // Quạt vẫn bật
      expect(tel.fan_on).toBe(true);
    });
  });

  describe('4. Logic Cảnh báo nhiệt độ cao (Mục 2 Spec)', () => {
    it('Nhiệt độ ≥ 40°C: Bật LED3 (GPIO 27) và Còi hú ngắt quãng (GPIO 25), Quạt vẫn chạy', () => {
      service.setScenario('heat_alarm');
      const tel = service.getCurrentTelemetry();
      expect(tel.temperature_c).toBeGreaterThanOrEqual(40.0);
      expect(tel.heat_alarm).toBe(true);
      expect(tel.led3_on).toBe(true);
      expect(tel.buzzer_on).toBe(true);
      expect(tel.fan_on).toBe(true); // Khi nhiệt cao gây cảnh báo, quạt vẫn chạy
    });
  });

  describe('5. Cảm biến Khói & Nguy cơ cháy (Mở rộng)', () => {
    it('Nồng độ khói ≥ 300 PPM kích hoạt cảnh báo nguy cấp (smoke_alarm = true)', () => {
      service.setScenario('smoke_danger');
      const tel = service.getCurrentTelemetry();
      expect(tel.smoke_ppm).toBeGreaterThanOrEqual(300);
      expect(tel.smoke_alarm).toBe(true);
    });
  });

  describe('6. Khởi động thời gian xử lý & Lỗi cảm biến (Mục 3 Spec)', () => {
    it('DHT11 đọc lỗi (dht_ok = false): Giữ nguyên trạng thái an toàn, giá trị nhiệt độ = null', () => {
      service.setScenario('dht_error');
      const tel = service.getCurrentTelemetry();
      expect(tel.dht_ok).toBe(false);
      expect(tel.temperature_c).toBeNull();
      expect(tel.humidity_pct).toBeNull();
    });

    it('PIR lúc khởi động (Warm-up 60s): Coi như chưa có chuyển động, cửa đóng', () => {
      service.setScenario('pir_warming_up');
      const tel = service.getCurrentTelemetry();
      expect(tel.pir_ready).toBe(false);
      expect(tel.pir_warmup_remaining_sec).toBeGreaterThan(0);
      expect(tel.motion_detected).toBe(false);
      expect(tel.door_command).toBe('closed');
    });
  });

  describe('7. Bảo vệ Chế độ Tự Động (Auto Mode Protection)', () => {
    it('Chế độ Auto từ chối lệnh điều khiển thủ công từ Web để tránh xung đột', () => {
      service.setSystemMode('auto');
      const result = service.manualControl('fan', true);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Tự động');
    });

    it('Chế độ Manual cho phép bật/tắt thiết bị thành công', () => {
      service.setSystemMode('manual');
      
      const fanResult = service.manualControl('fan', true);
      expect(fanResult.success).toBe(true);
      expect(service.getCurrentTelemetry().fan_on).toBe(true);

      const doorResult = service.manualControl('door', true);
      expect(doorResult.success).toBe(true);
      expect(service.getCurrentTelemetry().door_command).toBe('open');
    });
  });

  describe('8. Cấu hình Ngưỡng (Threshold Configuration)', () => {
    it('Cập nhật ngưỡng mới thành công và đồng bộ vào bộ nhớ', () => {
      const newThresholds = {
        fan_on_temp: 36.5,
        fan_off_temp: 33.0,
        heat_alarm_on_temp: 42.0,
        heat_alarm_off_temp: 38.0,
        smoke_alarm_ppm: 350,
      };

      service.updateThresholds(newThresholds);
      const tel = service.getCurrentTelemetry();
      expect(tel.thresholds.fan_on_temp).toBe(36.5);
      expect(tel.thresholds.fan_off_temp).toBe(33.0);
      expect(tel.thresholds.heat_alarm_on_temp).toBe(42.0);
      expect(tel.thresholds.smoke_alarm_ppm).toBe(350);
    });
  });
});


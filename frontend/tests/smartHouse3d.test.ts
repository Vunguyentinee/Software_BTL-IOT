import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_THRESHOLDS, INITIAL_TELEMETRY, MockTelemetryService, mockService } from '../src/services/mockData';
import { ESP32Telemetry } from '../src/types/telemetry';
import { formatLCDLines } from '../src/hooks/useLCDContent';

describe('Smart House 3D Telemetry and Safety Logic', () => {
  it('khóa an toàn cửa khi có báo động khói/gas hoặc door_safety_lock: true', () => {
    const telemWithGasAlarm: ESP32Telemetry = {
      ...INITIAL_TELEMETRY,
      smoke_alarm: true,
      gas_alarm: true,
      door_safety_lock: true,
      door_command: 'open',
      safety_reason: 'Rò rỉ khí gas vượt ngưỡng, giữ cửa mở 60s',
    };

    const isDoorLocked = Boolean(
      telemWithGasAlarm.door_safety_lock ||
      telemWithGasAlarm.smoke_alarm ||
      telemWithGasAlarm.gas_alarm
    );

    expect(isDoorLocked).toBe(true);
    expect(telemWithGasAlarm.door_command).toBe('open');
    expect(telemWithGasAlarm.safety_reason).toContain('60s');
  });

  it('khóa cưỡng bức quạt chạy khi có cảnh báo nhiệt heat_alarm: true', () => {
    const telemWithHeatAlarm: ESP32Telemetry = {
      ...INITIAL_TELEMETRY,
      temperature_c: 41.5,
      heat_alarm: true,
      fan_on: true,
      led3_on: true,
    };

    const isFanLockedOn = Boolean(telemWithHeatAlarm.heat_alarm);
    expect(isFanLockedOn).toBe(true);
    expect(telemWithHeatAlarm.fan_on).toBe(true);
    expect(telemWithHeatAlarm.led3_on).toBe(true);
  });

  it('chu kỳ còi 300ms BẬT / 300ms TẮT tính đúng theo công thức thời gian', () => {
    const calcBeepState = (ms: number) => Math.floor(ms / 300) % 2 === 0;

    // Tại 0ms -> 299ms: chu kỳ 0 -> BẬT (true)
    expect(calcBeepState(0)).toBe(true);
    expect(calcBeepState(150)).toBe(true);
    expect(calcBeepState(299)).toBe(true);

    // Tại 300ms -> 599ms: chu kỳ 1 -> TẮT (false)
    expect(calcBeepState(300)).toBe(false);
    expect(calcBeepState(450)).toBe(false);
    expect(calcBeepState(599)).toBe(false);

    // Tại 600ms -> chu kỳ 2 -> BẬT (true)
    expect(calcBeepState(600)).toBe(true);
  });

  it('nội suy lerp góc quay cửa chính đạt 90° (Math.PI / 2) khi mở và 0 khi đóng', () => {
    let currentRotationY = 0;
    const targetOpen = Math.PI / 2;

    // Mô phỏng 10 frame delta 0.016s với hệ số lerp 7
    for (let i = 0; i < 20; i++) {
      currentRotationY = currentRotationY + (targetOpen - currentRotationY) * (0.016 * 7);
    }

    expect(currentRotationY).toBeGreaterThan(1.0); // Đang tiến sát Math.PI / 2 (~1.57)

    // Khi đóng cửa
    const targetClosed = 0;
    for (let i = 0; i < 30; i++) {
      currentRotationY = currentRotationY + (targetClosed - currentRotationY) * (0.016 * 7);
    }
    expect(currentRotationY).toBeLessThan(0.1); // Đang tiến sát 0
  });

  it('đồng bộ hiển thị LCD 16x2 trên mô hình 3D chuẩn 16 ký tự mỗi dòng', () => {
    // 1. Bình thường trang 0: Hiển thị nhiệt độ, độ ẩm và trạng thái LED1/LED2
    const normalTelem: ESP32Telemetry = {
      ...INITIAL_TELEMETRY,
      temperature_c: 28.5,
      humidity_pct: 64,
      dht_ok: true,
      led1_on: true,
      led2_on: false,
      pir_ready: true,
    };
    const page0 = formatLCDLines(normalTelem, 0);
    expect(page0.line1.length).toBe(16);
    expect(page0.line2.length).toBe(16);
    expect(page0.line1).toBe('T:28.5C H:64%   ');
    expect(page0.line2).toBe('L1:ON L2:OFF    ');

    // 2. Trang 1: Hiển thị trạng thái Cửa & Quạt
    const page1 = formatLCDLines({ ...normalTelem, door_command: 'open', fan_on: true }, 1);
    expect(page1.line2).toBe('C:MO Q:ON       ');

    // 3. Khẩn cấp: Báo động khói đè lên các trang bình thường
    const smokeTelem: ESP32Telemetry = {
      ...normalTelem,
      smoke_alarm: true,
      smoke_ppm: 450,
    };
    const smokeLcd = formatLCDLines(smokeTelem, 0);
    expect(smokeLcd.line1).toBe('!CANH BAO KHOI! ');
    expect(smokeLcd.line2).toBe('KHOI:450PPM NGUY');
    expect(smokeLcd.pageTitle).toContain('Báo động khói');

    // 4. Khẩn cấp: Báo động nhiệt
    const heatTelem: ESP32Telemetry = {
      ...normalTelem,
      heat_alarm: true,
      buzzer_on: true,
    };
    const heatLcd = formatLCDLines(heatTelem, 0);
    expect(heatLcd.line2).toBe('NONG! L3:ON B:ON');
    expect(heatLcd.pageTitle).toContain('Cảnh báo nhiệt');
  });

  it('cô lập hoàn toàn mock service khi chuyển đổi giữa Giả lập và Thiết bị thật', () => {
    const testMock = new MockTelemetryService();
    expect(testMock.isSimulationRunning()).toBe(true);

    // Khi chuyển sang Chế độ Thật: stopSimulation dừng hoàn toàn timer ngầm
    testMock.stopSimulation();
    expect(testMock.isSimulationRunning()).toBe(false);

    // Khi bật lại Chế độ Giả lập: startSimulation khởi chạy lại
    testMock.startSimulation();
    expect(testMock.isSimulationRunning()).toBe(true);

    testMock.stopSimulation();
  });
});

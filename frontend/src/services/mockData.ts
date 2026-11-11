import { ESP32Telemetry, DeviceThresholds, ScenarioType } from '../types/telemetry';

export const DEFAULT_THRESHOLDS: DeviceThresholds = {
  fan_on_temp: 30.0,
  fan_off_temp: 29.5,
  heat_alarm_on_temp: 31.0,
  heat_alarm_off_temp: 30.0,
  smoke_alarm_ppm: 300,
};

export const INITIAL_TELEMETRY: ESP32Telemetry = {
  temperature_c: 28.5,
  humidity_pct: 65.0,
  dht_ok: true,
  pir_ready: true,
  pir_warmup_remaining_sec: 0,
  motion_detected: false,
  is_dark: false,
  smoke_raw: 435,
  smoke_ppm: 85,
  smoke_detected: false,
  smoke_alarm: false,
  door_command: 'closed',
  fan_on: false,
  led1_on: false,
  led2_on: false,
  led3_on: false,
  heat_alarm: false,
  buzzer_on: false,
  uptime_ms: 124000,
  system_mode: 'auto',
  timestamp: Date.now(),
  thresholds: { ...DEFAULT_THRESHOLDS },
};

/**
 * Lớp giả lập dòng dữ liệu ESP32 theo logic nghiệp vụ trong specification.md
 */
export class MockTelemetryService {
  private currentTelemetry: ESP32Telemetry = { ...INITIAL_TELEMETRY };
  private thresholds: DeviceThresholds = { ...DEFAULT_THRESHOLDS };
  private listeners: ((telemetry: ESP32Telemetry) => void)[] = [];
  private intervalId: any = null;
  private currentScenario: ScenarioType = 'normal';
  private pirCountdown: number = 0;

  constructor() {
    this.startSimulation();
  }

  public subscribe(listener: (telemetry: ESP32Telemetry) => void): () => void {
    this.listeners.push(listener);
    listener(this.currentTelemetry);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public setScenario(scenario: ScenarioType) {
    this.currentScenario = scenario;
    if (scenario === 'pir_warming_up') {
      this.pirCountdown = 60;
    }
    this.stepSimulation();
  }

  public setSystemMode(mode: 'auto' | 'manual') {
    this.currentTelemetry.system_mode = mode;
    this.notify();
  }

  public updateThresholds(newThresholds: DeviceThresholds) {
    this.thresholds = { ...newThresholds };
    this.stepSimulation();
  }

  public manualControl(device: 'door' | 'fan' | 'led1' | 'led2' | 'led3' | 'buzzer', value: any) {
    if (this.currentTelemetry.system_mode !== 'manual') {
      return { success: false, message: 'Hệ thống đang ở chế độ Tự động (Auto)!' };
    }

    if (device === 'door') this.currentTelemetry.door_command = value ? 'open' : 'closed';
    if (device === 'fan') this.currentTelemetry.fan_on = Boolean(value);
    if (device === 'led1') this.currentTelemetry.led1_on = Boolean(value);
    if (device === 'led2') this.currentTelemetry.led2_on = Boolean(value);
    if (device === 'led3') this.currentTelemetry.led3_on = Boolean(value);
    if (device === 'buzzer') this.currentTelemetry.buzzer_on = Boolean(value);

    this.notify();
    return { success: true, message: `Đã cập nhật ${device} thành ${value}` };
  }

  private startSimulation() {
    // Đọc DHT11 mỗi 2 giây theo mục 3 trong specification.md
    this.intervalId = setInterval(() => {
      this.stepSimulation();
    }, 2000);
  }

  public stopSimulation() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private stepSimulation() {
    const prev = this.currentTelemetry;
    const now = Date.now();
    const uptime = prev.uptime_ms + 2000;

    let temp = prev.temperature_c;
    let hum = prev.humidity_pct;
    let dhtOk = true;
    let pirReady = true;
    let motion = prev.motion_detected;
    let isDark = prev.is_dark;
    let smokePpm = prev.smoke_ppm;
    let isOffline = false;

    // Giả lập theo Scenario
    switch (this.currentScenario) {
      case 'normal':
        temp = 29.0 + +(Math.random() * 1.5 - 0.75).toFixed(1);
        hum = 65.0 + +(Math.random() * 2 - 1).toFixed(1);
        smokePpm = Math.max(50, Math.min(120, smokePpm + Math.floor(Math.random() * 10 - 5)));
        isDark = false;
        motion = false;
        break;

      case 'cooling_fan': // Nhiệt độ >= 30.0°C
        temp = 30.5 + +(Math.random() * 0.4 - 0.2).toFixed(1);
        hum = 60.0;
        smokePpm = 90;
        break;

      case 'heat_alarm': // Nhiệt độ >= 31.0°C
        temp = 32.0 + +(Math.random() * 0.6 - 0.3).toFixed(1);
        hum = 55.0;
        smokePpm = 110;
        break;

      case 'smoke_danger': // Khói vượt ngưỡng 300 PPM
        smokePpm = 420 + Math.floor(Math.random() * 30);
        temp = 32.0;
        break;

      case 'motion_door': // Có người về: PIR chuyển 0 -> 1
        motion = true;
        break;

      case 'dark_light': // Trời tối
        isDark = true;
        break;

      case 'dht_error': // DHT11 đọc lỗi
        dhtOk = false;
        temp = null;
        hum = null;
        break;

      case 'pir_warming_up': // PIR khởi động 60s
        if (this.pirCountdown > 0) {
          this.pirCountdown -= 2;
          pirReady = false;
          motion = false;
        } else {
          pirReady = true;
        }
        break;

      case 'esp32_offline':
        isOffline = true;
        break;
    }

    // Nếu offline, không cập nhật timestamp và uptime
    if (isOffline) {
      this.notify();
      return;
    }

    // Xử lý Logic Nghiệp vụ ESP32 (Chỉ chạy khi system_mode === 'auto')
    let fanOn = prev.fan_on;
    let heatAlarm = prev.heat_alarm;
    let led1On = prev.led1_on;
    let led2On = prev.led2_on;
    let led3On = prev.led3_on;
    let buzzerOn = prev.buzzer_on;
    let doorCmd = prev.door_command;

    if (prev.system_mode === 'auto') {
      // 1. Chiếu sáng tự động (Firmware mới): Trời tối VÀ PIR có chuyển động -> Bật LED1
      led1On = isDark && motion;

      // 2. Đón người về: PIR 0 -> 1 -> Servo 90° (Mở cửa), LED2 = doorOpen
      //    Đóng cửa: PIR 1 -> 0 -> Servo 0° (Đóng cửa), LED2 = doorOpen
      if (pirReady) {
        if (motion) {
          doorCmd = 'open';
        } else {
          doorCmd = 'closed';
        }
      }
      led2On = (doorCmd === 'open');

      // 3. Quạt & Cảnh báo nhiệt với 2 vùng trễ (Hysteresis) theo specification.md
      if (dhtOk && temp !== null) {
        // Quạt làm mát: Temp >= 35 bật, Temp <= 34 tắt, ở giữa giữ nguyên
        if (temp >= this.thresholds.fan_on_temp) {
          fanOn = true;
        } else if (temp <= this.thresholds.fan_off_temp) {
          fanOn = false;
        }

        // Cảnh báo nhiệt: Temp >= 40 bật LED3 + Còi, Temp <= 37 tắt, ở giữa giữ nguyên
        if (temp >= this.thresholds.heat_alarm_on_temp) {
          heatAlarm = true;
          led3On = true;
          buzzerOn = true;
        } else if (temp <= this.thresholds.heat_alarm_off_temp) {
          heatAlarm = false;
          led3On = false;
          buzzerOn = false;
        }
      }
    }

    const smokeDetected = smokePpm > 150;
    const smokeAlarm = smokePpm >= this.thresholds.smoke_alarm_ppm;

    this.currentTelemetry = {
      temperature_c: temp,
      humidity_pct: hum,
      dht_ok: dhtOk,
      pir_ready: pirReady,
      pir_warmup_remaining_sec: Math.max(0, this.pirCountdown),
      motion_detected: motion,
      is_dark: isDark,
      smoke_ppm: smokePpm,
      smoke_detected: smokeDetected,
      smoke_alarm: smokeAlarm,
      door_command: doorCmd,
      fan_on: fanOn,
      led1_on: led1On,
      led2_on: led2On,
      led3_on: led3On,
      heat_alarm: heatAlarm,
      buzzer_on: buzzerOn,
      uptime_ms: uptime,
      system_mode: prev.system_mode,
      timestamp: now,
      thresholds: { ...this.thresholds },
    };

    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) {
      listener({ ...this.currentTelemetry });
    }
  }

  public getCurrentTelemetry(): ESP32Telemetry {
    return { ...this.currentTelemetry };
  }

  public getThresholds(): DeviceThresholds {
    return { ...this.thresholds };
  }
}

// Singleton instance
export const mockService = new MockTelemetryService();


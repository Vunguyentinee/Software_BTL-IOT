import { ESP32Telemetry, DeviceThresholds, ScenarioType } from '../types/telemetry';

export const DEFAULT_THRESHOLDS: DeviceThresholds = {
  fan_on_temp: 35.0,
  fan_off_temp: 34.0,
  heat_alarm_on_temp: 40.0,
  heat_alarm_off_temp: 37.0,
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
  boot_id: 'boot-e92a',
  connection_id: 1,
  control_mode: 'remote_available',
  device_id: 'esp32-home',
  gas_raw: 435,
  gas_sensor_ok: true,
  gas_alarm: false,
  door_safety_lock: false,
  safety_mode: 'normal',
  active_alarms: [],
  mqtt_connected: true,
  modes: { door: 'auto', fan: 'auto', led1: 'auto' },
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
    // Khi đổi kịch bản, cho phép cảm biến kịch bản mới điều khiển thiết bị
    if (!this.currentTelemetry.modes) {
      this.currentTelemetry.modes = { door: 'auto', fan: 'auto', led1: 'auto' };
    }
    if (scenario === 'cooling_fan' || scenario === 'heat_alarm') {
      this.currentTelemetry.modes.fan = 'auto';
    }
    if (scenario === 'motion_door' || scenario === 'smoke_danger') {
      this.currentTelemetry.modes.door = 'auto';
    }
    if (scenario === 'dark_light') {
      this.currentTelemetry.modes.led1 = 'auto';
    }
    if (scenario === 'normal') {
      this.currentTelemetry.modes = { door: 'auto', fan: 'auto', led1: 'auto' };
    }
    this.stepSimulation();
  }

  public setSystemMode(mode: 'auto' | 'manual') {
    this.currentTelemetry.system_mode = mode;
    if (mode === 'auto') {
      this.currentTelemetry.modes = { door: 'auto', fan: 'auto', led1: 'auto' };
    }
    this.stepSimulation();
  }

  public updateThresholds(newThresholds: DeviceThresholds) {
    this.thresholds = { ...newThresholds };
    this.currentTelemetry.thresholds = { ...newThresholds };
    this.stepSimulation();
  }

  public setDeviceState(device: 'door' | 'fan' | 'led1', action: 'auto' | 'on' | 'off' | 'open' | 'close') {
    if (!this.currentTelemetry.modes) {
      this.currentTelemetry.modes = { door: 'auto', fan: 'auto', led1: 'auto' };
    }

    if (action === 'auto') {
      this.currentTelemetry.modes[device] = 'auto';
    } else {
      this.currentTelemetry.modes[device] = 'manual';
      if (device === 'door') {
        const isOpen = action === 'open';
        this.currentTelemetry.door_command = isOpen ? 'open' : 'closed';
        this.currentTelemetry.led2_on = isOpen;
      } else if (device === 'fan') {
        this.currentTelemetry.fan_on = action === 'on';
      } else if (device === 'led1') {
        this.currentTelemetry.led1_on = action === 'on';
      }
    }
    this.stepSimulation();
  }

  public manualControl(device: 'door' | 'fan' | 'led1' | 'led2' | 'led3' | 'buzzer', value: any) {
    if (this.currentTelemetry.system_mode !== 'manual') {
      return { success: false, message: 'Hệ thống đang ở chế độ Tự động (Auto)!' };
    }

    if (!this.currentTelemetry.modes) {
      this.currentTelemetry.modes = { door: 'auto', fan: 'auto', led1: 'auto' };
    }

    if (device === 'door') {
      this.currentTelemetry.door_command = value ? 'open' : 'closed';
      this.currentTelemetry.led2_on = Boolean(value);
      this.currentTelemetry.modes.door = 'manual';
    }
    if (device === 'fan') {
      this.currentTelemetry.fan_on = Boolean(value);
      this.currentTelemetry.modes.fan = 'manual';
    }
    if (device === 'led1') {
      this.currentTelemetry.led1_on = Boolean(value);
      this.currentTelemetry.modes.led1 = 'manual';
    }
    if (device === 'led2') this.currentTelemetry.led2_on = Boolean(value);
    if (device === 'led3') this.currentTelemetry.led3_on = Boolean(value);
    if (device === 'buzzer') this.currentTelemetry.buzzer_on = Boolean(value);

    this.notify();
    return { success: true, message: `Đã cập nhật ${device} thành ${value}` };
  }

  public startSimulation() {
    if (this.intervalId) return;
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

  public isSimulationRunning(): boolean {
    return this.intervalId !== null;
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
    let gasRaw = prev.gas_raw ?? 435;
    let smokeRaw = prev.smoke_raw ?? 435;
    let gasAlarm = false;
    let smokeAlarm = false;
    let doorSafetyLock = false;
    let safetyReason: string | null = null;
    let isOffline = false;

    // Giả lập theo Scenario
    switch (this.currentScenario) {
      case 'normal':
        temp = 29.0 + +(Math.random() * 1.5 - 0.75).toFixed(1);
        hum = 65.0 + +(Math.random() * 2 - 1).toFixed(1);
        {
          const currentSmoke = smokePpm ?? 80;
          smokePpm = Math.max(50, Math.min(120, currentSmoke + Math.floor(Math.random() * 10 - 5)));
        }
        gasRaw = 430 + Math.floor(Math.random() * 20);
        smokeRaw = gasRaw;
        isDark = false;
        motion = false;
        break;

      case 'cooling_fan': // Nhiệt độ >= 35.0°C (Quạt tự bật)
        temp = 36.5;
        hum = 60.0;
        smokePpm = 90;
        gasRaw = 480;
        smokeRaw = 480;
        break;

      case 'heat_alarm': // Nhiệt độ >= 40.0°C (Cảnh báo nhiệt)
        temp = 41.5;
        hum = 55.0;
        smokePpm = 110;
        gasRaw = 520;
        smokeRaw = 520;
        break;

      case 'smoke_danger': // Khói vượt ngưỡng 300 PPM
        smokePpm = 450;
        gasRaw = 2450;
        smokeRaw = 2450;
        smokeAlarm = true;
        gasAlarm = true;
        doorSafetyLock = true;
        safetyReason = 'Cảnh báo rò rỉ gas/khói khẩn cấp! Khóa giữ cửa mở 60s an toàn.';
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

    const modes = prev.modes || { door: 'auto', fan: 'auto', led1: 'auto' };

    // Trạng thái cơ cấu chấp hành
    let fanOn = prev.fan_on;
    let heatAlarm = prev.heat_alarm;
    let led1On = prev.led1_on;
    let led2On = prev.led2_on;
    let led3On = prev.led3_on;
    let buzzerOn = prev.buzzer_on;
    let doorCmd = prev.door_command;

    // 1. Kiểm tra Cảnh báo nhiệt
    if (dhtOk && temp !== null) {
      if (temp >= this.thresholds.heat_alarm_on_temp) {
        heatAlarm = true;
        led3On = true;
        buzzerOn = true;
      } else if (temp <= this.thresholds.heat_alarm_off_temp) {
        heatAlarm = false;
        if (!smokeAlarm && !gasAlarm) {
          led3On = false;
          buzzerOn = false;
        }
      }
    }

    // 2. Kiểm tra Cảnh báo khói/gas
    const smokeDetected = (smokePpm !== null && smokePpm > 150) || gasRaw > 1500;
    if (smokeAlarm || gasAlarm) {
      led3On = true;
      buzzerOn = true;
      doorSafetyLock = true;
    }

    // 3. Logic điều khiển Đèn LED1:
    // Nếu modes.led1 === 'auto' -> theo LDR (isDark)
    // Nếu 'manual' -> giữ nguyên lựa chọn của người dùng
    if (modes.led1 === 'auto') {
      led1On = isDark;
    }

    // 4. Logic điều khiển Quạt:
    // Nếu heatAlarm -> khóa cưỡng bức BẬT
    // Nếu modes.fan === 'auto' -> theo ngưỡng nhiệt độ DHT11
    // Nếu 'manual' -> giữ nguyên lựa chọn của người dùng
    if (heatAlarm) {
      fanOn = true;
    } else if (modes.fan === 'auto') {
      if (dhtOk && temp !== null) {
        if (temp >= this.thresholds.fan_on_temp) {
          fanOn = true;
        } else if (temp <= this.thresholds.fan_off_temp) {
          fanOn = false;
        }
      }
    }

    // 5. Logic điều khiển Cửa chính:
    // Nếu có báo động gas/khói hoặc doorSafetyLock -> ưu tiên cao nhất, luôn giữ MỞ
    // Nếu modes.door === 'auto' -> theo PIR
    // Nếu 'manual' -> giữ nguyên lựa chọn của người dùng
    if (smokeAlarm || gasAlarm || doorSafetyLock) {
      doorCmd = 'open';
      led2On = true;
    } else if (modes.door === 'auto') {
      if (pirReady) {
        doorCmd = motion ? 'open' : 'closed';
      }
      led2On = doorCmd === 'open';
    } else {
      led2On = doorCmd === 'open';
    }

    this.currentTelemetry = {
      ...prev,
      temperature_c: temp,
      humidity_pct: hum,
      dht_ok: dhtOk,
      pir_ready: pirReady,
      pir_warmup_remaining_sec: Math.max(0, this.pirCountdown),
      motion_detected: motion,
      is_dark: isDark,
      smoke_ppm: smokePpm,
      smoke_raw: smokeRaw,
      gas_raw: gasRaw,
      gas_sensor_ok: true,
      smoke_detected: smokeDetected,
      smoke_alarm: smokeAlarm,
      gas_alarm: gasAlarm,
      door_safety_lock: doorSafetyLock,
      safety_reason: safetyReason,
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
      modes: { ...modes },
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


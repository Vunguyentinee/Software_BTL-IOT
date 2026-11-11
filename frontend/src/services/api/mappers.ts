import { BackendTelemetry, BackendConfig, BackendThresholds } from '../../types/api';
import { ESP32Telemetry, DeviceThresholds, SystemMode } from '../../types/telemetry';
import { DeviceTarget } from '../../types/command';
import { DEFAULT_THRESHOLDS } from '../mockData';

/**
 * Chuyển đổi dữ liệu Telemetry nhận từ Backend thành ESP32Telemetry giao diện đang dùng
 */
export function mapBackendTelemetryToFrontend(
  raw: BackendTelemetry,
  currentThresholds: DeviceThresholds = DEFAULT_THRESHOLDS
): ESP32Telemetry {
  // Xác định system_mode từ modes dictionary của backend
  let mode: SystemMode = 'auto';
  if (raw.modes) {
    const hasManual = Object.values(raw.modes).some((m) => m === 'manual');
    if (hasManual) {
      mode = 'manual';
    }
  }

  // Quy đổi smoke_raw (0 - 4095 ADC) sang PPM hiển thị
  let smokePpm = 80;
  if (typeof raw.smoke_raw === 'number') {
    // Ước tính PPM từ giá trị analog ADC (0-4095)
    smokePpm = Math.max(0, Math.round((raw.smoke_raw / 4095) * 800));
  }

  const smokeAlarm = Boolean(raw.smoke_alarm);
  const smokeDetected = smokeAlarm || (smokePpm >= currentThresholds.smoke_alarm_ppm);

  // ts từ backend là epoch seconds (float)
  const timestamp = raw.ts ? Math.round(raw.ts * 1000) : Date.now();

  return {
    temperature_c: raw.temperature_c ?? null,
    humidity_pct: raw.humidity_pct ?? null,
    dht_ok: raw.dht_ok ?? true,
    pir_ready: raw.pir_ready ?? true,
    pir_warmup_remaining_sec: raw.pir_ready ? 0 : 30,
    motion_detected: raw.motion_detected ?? false,
    is_dark: raw.is_dark ?? false,
    smoke_raw: raw.smoke_raw ?? null,
    smoke_ppm: smokePpm,
    smoke_detected: smokeDetected,
    smoke_alarm: smokeAlarm,
    door_command: raw.door_command ?? 'closed',
    fan_on: Boolean(raw.fan_on),
    led1_on: Boolean(raw.led1_on),
    led2_on: Boolean(raw.led2_on),
    led3_on: Boolean(raw.led3_on),
    heat_alarm: Boolean(raw.heat_alarm),
    buzzer_on: Boolean(raw.heat_alarm || smokeAlarm),
    pump_on: Boolean(raw.pump_on),
    uptime_ms: raw.uptime_ms ?? 0,
    system_mode: mode,
    timestamp,
    thresholds: currentThresholds,
  };
}

/**
 * Chuyển cấu hình từ Backend sang DeviceThresholds của Frontend
 */
export function mapBackendConfigToThresholds(
  config: BackendConfig | BackendThresholds
): DeviceThresholds {
  const t = 'thresholds' in config ? config.thresholds : config;
  return {
    fan_on_temp: t.fan_on ?? DEFAULT_THRESHOLDS.fan_on_temp,
    fan_off_temp: t.fan_off ?? DEFAULT_THRESHOLDS.fan_off_temp,
    heat_alarm_on_temp: t.heat_alarm_on ?? DEFAULT_THRESHOLDS.heat_alarm_on_temp,
    heat_alarm_off_temp: t.heat_alarm_off ?? DEFAULT_THRESHOLDS.heat_alarm_off_temp,
    // Quy đổi smoke_high sang PPM xấp xỉ
    smoke_alarm_ppm: t.smoke_high ? Math.round((t.smoke_high / 4095) * 800) : DEFAULT_THRESHOLDS.smoke_alarm_ppm,
  };
}

/**
 * Chuyển cấu hình từ Frontend sang BackendThresholds
 */
export function mapThresholdsToBackend(thresholds: DeviceThresholds): BackendThresholds {
  // Tính toán smoke_high và smoke_low phù hợp với validator backend: smoke_low < smoke_high
  const rawHigh = Math.min(4000, Math.max(500, Math.round((thresholds.smoke_alarm_ppm / 800) * 4095)));
  const rawLow = Math.max(200, Math.round(rawHigh * 0.75));

  return {
    fan_on: thresholds.fan_on_temp,
    fan_off: thresholds.fan_off_temp,
    heat_alarm_on: thresholds.heat_alarm_on_temp,
    heat_alarm_off: thresholds.heat_alarm_off_temp,
    smoke_high: rawHigh,
    smoke_low: rawLow,
  };
}

/**
 * Map DeviceTarget và boolean value sang device và action tương ứng của Backend
 * Backend hỗ trợ:
 * - fan: "on", "off", "auto"
 * - led1: "on", "off", "auto"
 * - door: "open", "close", "auto"
 */
export function mapTargetToBackendCommand(
  target: DeviceTarget,
  value: boolean
): { device: string; action: string } | null {
  switch (target) {
    case 'fan':
      return { device: 'fan', action: value ? 'on' : 'off' };
    case 'led1':
      return { device: 'led1', action: value ? 'on' : 'off' };
    case 'door':
      return { device: 'door', action: value ? 'open' : 'close' };
    default:
      return null;
  }
}


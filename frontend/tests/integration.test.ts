import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapBackendTelemetryToFrontend,
  mapBackendConfigToThresholds,
  mapThresholdsToBackend,
  mapTargetToBackendCommand,
} from '../src/services/api/mappers';
import { BackendTelemetry, BackendConfig } from '../src/types/api';
import { DEFAULT_THRESHOLDS } from '../src/services/mockData';
import { httpClient } from '../src/services/api/httpClient';
import { commandService } from '../src/services/commandService';
import { backendService } from '../src/services/backendService';
import { websocketService } from '../src/services/api/websocketService';
import { historyService } from '../src/services/historyData';

describe('Kiểm thử Tích hợp Backend ↔ Frontend (Integration Tests)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Kiểm thử Tầng Mappers (Chuyển đổi Schema)', () => {
    it('Chuyển đổi bản tin Telemetry từ Backend sang ESP32Telemetry chuẩn xác', () => {
      const backendTelemetry: BackendTelemetry = {
        temperature_c: 36.5,
        humidity_pct: 68.0,
        dht_ok: true,
        pir_ready: true,
        motion_detected: true,
        is_dark: true,
        door_command: 'open',
        fan_on: true,
        led1_on: true,
        led2_on: true,
        led3_on: false,
        heat_alarm: false,
        uptime_ms: 154000,
        smoke_raw: 1250,
        smoke_alarm: false,
        pump_on: false,
        modes: { fan: 'manual', led1: 'auto', door: 'auto' },
        ts: 1735000000.5,
      };

      const result = mapBackendTelemetryToFrontend(backendTelemetry, DEFAULT_THRESHOLDS);

      // Kiểm tra chuyển đổi epoch float seconds -> ms
      expect(result.timestamp).toBe(1735000000500);

      // Kiểm tra các trường cảm biến
      expect(result.temperature_c).toBe(36.5);
      expect(result.humidity_pct).toBe(68.0);
      expect(result.dht_ok).toBe(true);
      expect(result.motion_detected).toBe(true);
      expect(result.is_dark).toBe(true);

      // Kiểm tra quy đổi nồng độ khói từ ADC raw (0 - 4095)
      expect(result.smoke_ppm).toBe(Math.round((1250 / 4095) * 800));
      expect(result.smoke_alarm).toBe(false);

      // Kiểm tra thiết bị chấp hành
      expect(result.door_command).toBe('open');
      expect(result.fan_on).toBe(true);
      expect(result.led1_on).toBe(true);
      expect(result.led2_on).toBe(true);
      expect(result.led3_on).toBe(false);
      expect(result.buzzer_on).toBe(false);

      // Kiểm tra system_mode: do fan đang ở chế độ manual nên system_mode = manual
      expect(result.system_mode).toBe('manual');
    });

    it('Xử lý an toàn khi cảm biến DHT11 báo lỗi (dht_ok = false)', () => {
      const errorTelemetry: BackendTelemetry = {
        temperature_c: null,
        humidity_pct: null,
        dht_ok: false,
        pir_ready: true,
        motion_detected: false,
        is_dark: false,
        door_command: 'closed',
        fan_on: false,
        led1_on: false,
        led2_on: false,
        led3_on: false,
        heat_alarm: false,
        uptime_ms: 20000,
      };

      const result = mapBackendTelemetryToFrontend(errorTelemetry);
      expect(result.dht_ok).toBe(false);
      expect(result.temperature_c).toBeNull();
      expect(result.humidity_pct).toBeNull();
    });

    it('Chuyển đổi cấu hình ngưỡng Backend ↔ Frontend 2 chiều', () => {
      const backendConfig: BackendConfig = {
        config_id: 'cfg_12345',
        thresholds: {
          fan_on: 36.0,
          fan_off: 34.5,
          heat_alarm_on: 41.0,
          heat_alarm_off: 38.0,
          smoke_high: 2500,
          smoke_low: 1800,
        },
        status: 'applied',
      };

      // 1. Backend -> Frontend
      const feThresholds = mapBackendConfigToThresholds(backendConfig);
      expect(feThresholds.fan_on_temp).toBe(36.0);
      expect(feThresholds.fan_off_temp).toBe(34.5);
      expect(feThresholds.heat_alarm_on_temp).toBe(41.0);
      expect(feThresholds.heat_alarm_off_temp).toBe(38.0);
      expect(feThresholds.smoke_alarm_ppm).toBe(Math.round((2500 / 4095) * 800));

      // 2. Frontend -> Backend
      const bePayload = mapThresholdsToBackend(feThresholds);
      expect(bePayload.fan_on).toBe(36.0);
      expect(bePayload.fan_off).toBe(34.5);
      expect(bePayload.heat_alarm_on).toBe(41.0);
      expect(bePayload.heat_alarm_off).toBe(38.0);
      // Đảm bảo validator backend: smoke_low < smoke_high
      expect(bePayload.smoke_low).toBeLessThan(bePayload.smoke_high);
    });

    it('Map lệnh điều khiển chính xác thiết bị và hành động', () => {
      // Fan
      expect(mapTargetToBackendCommand('fan', true)).toEqual({ device: 'fan', action: 'on' });
      expect(mapTargetToBackendCommand('fan', false)).toEqual({ device: 'fan', action: 'off' });

      // Door
      expect(mapTargetToBackendCommand('door', true)).toEqual({ device: 'door', action: 'open' });
      expect(mapTargetToBackendCommand('door', false)).toEqual({ device: 'door', action: 'close' });

      // LED1
      expect(mapTargetToBackendCommand('led1', true)).toEqual({ device: 'led1', action: 'on' });
      expect(mapTargetToBackendCommand('led1', false)).toEqual({ device: 'led1', action: 'off' });

      // Thiết bị tự động không cho phép nhận lệnh trực tiếp từ API Web
      expect(mapTargetToBackendCommand('led2', true)).toBeNull();
      expect(mapTargetToBackendCommand('led3', true)).toBeNull();
      expect(mapTargetToBackendCommand('buzzer', true)).toBeNull();
    });
  });

  describe('2. Kiểm thử Tầng HTTP Client', () => {
    it('Gọi GET /api/state thành công và phân tích kết quả', async () => {
      const mockState = {
        online: true,
        last_seen: 1735000000.0,
        offline_since: null,
        telemetry: {
          temperature_c: 30.0,
          humidity_pct: 65.0,
          dht_ok: true,
          pir_ready: true,
          motion_detected: false,
          is_dark: false,
          door_command: 'closed',
          fan_on: false,
          led1_on: false,
          led2_on: false,
          led3_on: false,
          heat_alarm: false,
          uptime_ms: 10000,
        },
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockState,
      } as Response);

      const state = await httpClient.getState();
      expect(state.online).toBe(true);
      expect(state.telemetry?.temperature_c).toBe(30.0);
    });

    it('Ném lỗi HTTP khi gửi sai tham số lệnh (422)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({ detail: "invalid action 'fly' for fan" }),
      } as Response);

      await expect(httpClient.sendCommand('fan', 'fly')).rejects.toThrow("invalid action 'fly' for fan");
    });

    it('Ném lỗi khi thiết bị Offline (409 Conflict)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ detail: 'device_offline' }),
      } as Response);

      await expect(httpClient.sendCommand('fan', 'on')).rejects.toThrow('device_offline');
    });
  });

  describe('3. Kiểm thử Tầng Command Service & Backend Điều Khiển', () => {
    it('Từ chối gửi lệnh khi hệ thống đang ở chế độ TỰ ĐỘNG (Auto Mode)', async () => {
      vi.spyOn(backendService, 'getStatus').mockReturnValue({
        isServerConnected: true,
        isESP32Online: true,
        lastSeen: Date.now(),
      });
      vi.spyOn(backendService, 'getCurrentTelemetry').mockReturnValue({
        ...DEFAULT_THRESHOLDS,
        temperature_c: 28,
        humidity_pct: 60,
        dht_ok: true,
        pir_ready: true,
        pir_warmup_remaining_sec: 0,
        motion_detected: false,
        is_dark: false,
        smoke_ppm: 80,
        smoke_detected: false,
        smoke_alarm: false,
        door_command: 'closed',
        fan_on: false,
        led1_on: false,
        led2_on: false,
        led3_on: false,
        heat_alarm: false,
        buzzer_on: false,
        uptime_ms: 10000,
        system_mode: 'auto', // Đang ở chế độ AUTO
        timestamp: Date.now(),
        thresholds: DEFAULT_THRESHOLDS,
      });

      await expect(commandService.sendCommand('fan', true)).rejects.toThrow(
        /chế độ TỰ ĐỘNG/i
      );
    });

    it('Từ chối điều khiển thiết bị tự động (led2, led3, buzzer) khi kết nối Backend', async () => {
      vi.spyOn(backendService, 'getStatus').mockReturnValue({
        isServerConnected: true,
        isESP32Online: true,
        lastSeen: Date.now(),
      });
      vi.spyOn(backendService, 'getCurrentTelemetry').mockReturnValue({
        ...DEFAULT_THRESHOLDS,
        temperature_c: 28,
        humidity_pct: 60,
        dht_ok: true,
        pir_ready: true,
        pir_warmup_remaining_sec: 0,
        motion_detected: false,
        is_dark: false,
        smoke_ppm: 80,
        smoke_detected: false,
        smoke_alarm: false,
        door_command: 'closed',
        fan_on: false,
        led1_on: false,
        led2_on: false,
        led3_on: false,
        heat_alarm: false,
        buzzer_on: false,
        uptime_ms: 10000,
        system_mode: 'manual', // Đang ở chế độ MANUAL
        timestamp: Date.now(),
        thresholds: DEFAULT_THRESHOLDS,
      });

      await expect(commandService.sendCommand('buzzer', true)).rejects.toThrow(
        /điều khiển tự động theo cảm biến/i
      );
    });

    it('Gửi lệnh thành công qua Backend khi ESP32 Online và ở chế độ Manual', async () => {
      vi.spyOn(backendService, 'getStatus').mockReturnValue({
        isServerConnected: true,
        isESP32Online: true,
        lastSeen: Date.now(),
      });
      vi.spyOn(backendService, 'getCurrentTelemetry').mockReturnValue({
        ...DEFAULT_THRESHOLDS,
        temperature_c: 28,
        humidity_pct: 60,
        dht_ok: true,
        pir_ready: true,
        pir_warmup_remaining_sec: 0,
        motion_detected: false,
        is_dark: false,
        smoke_ppm: 80,
        smoke_detected: false,
        smoke_alarm: false,
        door_command: 'closed',
        fan_on: false,
        led1_on: false,
        led2_on: false,
        led3_on: false,
        heat_alarm: false,
        buzzer_on: false,
        uptime_ms: 10000,
        system_mode: 'manual',
        timestamp: Date.now(),
        thresholds: DEFAULT_THRESHOLDS,
      });

      vi.spyOn(httpClient, 'sendCommand').mockResolvedValueOnce({
        cmd_id: 'test_cmd_999',
        status: 'pending',
      });

      vi.spyOn(httpClient, 'getCommand').mockResolvedValueOnce({
        cmd_id: 'test_cmd_999',
        device: 'fan',
        action: 'on',
        source: 'web',
        status: 'ok',
        sent_ts: Date.now() / 1000,
        ack_ts: Date.now() / 1000 + 0.1,
        detail: null,
        ts: Date.now() / 1000,
      });

      const ack = await commandService.sendCommand('fan', true);
      expect(ack.status).toBe('success');
      expect(ack.target).toBe('fan');
      expect(ack.commandId).toBe('test_cmd_999');
      expect(ack.appliedValue).toBe(true);
    });
  });

  describe('4. Kiểm thử Tầng WebSocket Service & Realtime Stream', () => {
    it('Đăng ký và nhận tin nhắn từ WebSocket', () => {
      let receivedMsg: any = null;
      const unsubscribe = websocketService.onMessage((msg) => {
        receivedMsg = msg;
      });

      // Giả lập push tin nhắn
      (websocketService as any).notifyMessage({
        kind: 'connection',
        data: { online: true, since: 1735000000 },
      });

      expect(receivedMsg).toEqual({
        kind: 'connection',
        data: { online: true, since: 1735000000 },
      });

      unsubscribe();
    });

    it('Xử lý tin nhắn telemetry push từ WebSocket vào BackendService', () => {
      let currentTel: any = null;
      const unsub = backendService.subscribe((tel) => {
        currentTel = tel;
      });

      // Giả lập nhận bản tin telemetry qua WebSocket
      (backendService as any).handleWsMessage({
        kind: 'telemetry',
        data: {
          temperature_c: 38.2,
          humidity_pct: 55.0,
          dht_ok: true,
          pir_ready: true,
          motion_detected: false,
          is_dark: false,
          door_command: 'closed',
          fan_on: true,
          led1_on: false,
          led2_on: false,
          led3_on: false,
          heat_alarm: false,
          uptime_ms: 180000,
          smoke_raw: 200,
          ts: 1735000010.0,
        },
      });

      expect(currentTel.temperature_c).toBe(38.2);
      expect(currentTel.fan_on).toBe(true);
      expect(backendService.getStatus().isESP32Online).toBe(true);

      unsub();
    });
  });

  describe('5. Kiểm thử Tầng Dữ liệu Lịch sử (History Data Service)', () => {
    it('fetchHistory gom và chuyển đổi chuỗi thời gian từ Backend (/api/history)', async () => {
      vi.spyOn(httpClient, 'getHistory').mockImplementation(async (metric) => {
        if (metric === 'temperature_c') {
          return [
            { ts: 1735000000, value: 31.0 },
            { ts: 1735000060, value: 31.5 },
          ];
        }
        if (metric === 'humidity_pct') {
          return [
            { ts: 1735000000, value: 65.0 },
            { ts: 1735000060, value: 64.0 },
          ];
        }
        if (metric === 'smoke_raw') {
          return [
            { ts: 1735000000, value: 400 },
            { ts: 1735000060, value: 420 },
          ];
        }
        return [];
      });

      const historyPoints = await historyService.fetchHistory('1h');
      expect(historyPoints.length).toBe(2);
      expect(historyPoints[0].temperature_c).toBe(31.0);
      expect(historyPoints[0].humidity_pct).toBe(65.0);
      expect(historyPoints[1].temperature_c).toBe(31.5);
    });

    it('Tự động fallback sang simulated data khi Backend không có dữ liệu', async () => {
      vi.spyOn(httpClient, 'getHistory').mockRejectedValueOnce(new Error('Network offline'));

      const fallbackPoints = await historyService.fetchHistory('6h');
      expect(fallbackPoints.length).toBeGreaterThan(0);
      expect(fallbackPoints[0]).toHaveProperty('temperature_c');
    });
  });
});

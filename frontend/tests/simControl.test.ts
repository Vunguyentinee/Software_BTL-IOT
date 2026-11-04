import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpClient } from '../src/services/api/httpClient';
import { backendService } from '../src/services/backendService';
import { mapBackendTelemetryToFrontend } from '../src/services/api/mappers';
import { BackendSim, BackendTelemetry } from '../src/types/api';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fail = (status: number, detail: unknown) =>
  ({ ok: false, status, statusText: 'x', json: async () => ({ detail }) }) as Response;

const SIM: BackendSim = {
  active: true,
  scenario: 'normal',
  scenarios: [
    { id: 'normal', label: 'Bình thường' },
    { id: 'smoke_danger', label: 'Khói/cháy' },
  ],
};
const INACTIVE: BackendSim = { active: false, scenario: null, scenarios: [] };

afterEach(() => {
  vi.restoreAllMocks();
  (backendService as any).handleWsMessage({ kind: 'sim', data: INACTIVE });
});

describe('httpClient mô phỏng', () => {
  it('getSim gọi /api/sim', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(ok(SIM));
    expect(await httpClient.getSim()).toEqual(SIM);
    expect(spy.mock.calls[0][0]).toBe('/api/sim');
  });

  it('setSimScenario gửi POST với tên kịch bản', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(ok({ requested: 'smoke_danger', ...SIM }));
    await httpClient.setSimScenario('smoke_danger');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sim/scenario');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ scenario: 'smoke_danger' });
  });

  it('409 khi chưa có ESP32 giả lập được ném ra với nội dung lỗi', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(fail(409, 'simulator_not_active'));
    await expect(httpClient.setSimScenario('normal')).rejects.toThrow('simulator_not_active');
  });
});

describe('backendService mô phỏng', () => {
  it('mặc định chưa có ESP32 giả lập', () => {
    expect(backendService.getSim().active).toBe(false);
  });

  it('tin WebSocket "sim" cập nhật trạng thái và báo cho người đăng ký', () => {
    const listener = vi.fn();
    const unsubscribe = backendService.subscribeSim(listener);
    expect(listener).toHaveBeenLastCalledWith(INACTIVE); // gọi ngay khi đăng ký

    (backendService as any).handleWsMessage({ kind: 'sim', data: SIM });
    expect(backendService.getSim()).toEqual(SIM);
    expect(listener).toHaveBeenLastCalledWith(SIM);

    unsubscribe();
    listener.mockClear();
    (backendService as any).handleWsMessage({ kind: 'sim', data: INACTIVE });
    expect(listener).not.toHaveBeenCalled();
  });

  it('mất kết nối WebSocket thì coi như không còn ESP32 giả lập', () => {
    (backendService as any).handleWsMessage({ kind: 'sim', data: SIM });
    (backendService as any).handleServerDisconnected();
    expect(backendService.getSim().active).toBe(false);
  });

  it('setSimScenario chuyển yêu cầu tới backend', async () => {
    const spy = vi.spyOn(httpClient, 'setSimScenario').mockResolvedValue({ requested: 'smoke_danger', ...SIM });
    await backendService.setSimScenario('smoke_danger');
    expect(spy).toHaveBeenCalledWith('smoke_danger');
  });
});

describe('telemetry có trạng thái bơm', () => {
  const raw: BackendTelemetry = {
    temperature_c: 30, humidity_pct: 60, dht_ok: true, pir_ready: true, motion_detected: false,
    is_dark: false, door_command: 'closed', fan_on: false, led1_on: false, led2_on: false,
    led3_on: false, heat_alarm: false, uptime_ms: 1, smoke_raw: 3000, smoke_alarm: true, pump_on: true,
  };

  it('giữ pump_on từ backend', () => {
    expect(mapBackendTelemetryToFrontend(raw).pump_on).toBe(true);
    expect(mapBackendTelemetryToFrontend({ ...raw, pump_on: undefined }).pump_on).toBe(false);
  });
});

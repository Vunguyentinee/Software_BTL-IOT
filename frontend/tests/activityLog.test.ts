import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityLogService } from '../src/services/activityLog';
import { INITIAL_TELEMETRY } from '../src/services/mockData';
import { BackendCommand, BackendConfig, BackendEvent } from '../src/types/api';
import { ESP32Telemetry } from '../src/types/telemetry';

const T0 = 1_800_000_000_000;
const tel = (over: Partial<ESP32Telemetry> = {}, ts = T0): ESP32Telemetry => ({
  ...INITIAL_TELEMETRY,
  fan_on: false, led1_on: false, led2_on: false, led3_on: false, heat_alarm: false,
  smoke_alarm: false, pump_on: false, dht_ok: true, door_command: 'closed',
  motion_detected: false, is_dark: false, system_mode: 'auto', temperature_c: 28,
  ...over, timestamp: ts,
});

let log: ActivityLogService;
beforeEach(() => {
  log = new ActivityLogService();
});

describe('thay đổi trạng thái từ telemetry', () => {
  it('lần đầu chỉ ghi nhận trạng thái gốc, chưa tạo dòng nào', () => {
    log.observeTelemetry(tel({ fan_on: true }));
    expect(log.getItems()).toEqual([]);
  });

  it('không đổi thì không thêm dòng', () => {
    log.observeTelemetry(tel());
    log.observeTelemetry(tel(), );
    log.observeTelemetry(tel({}, T0 + 2000));
    expect(log.getItems()).toHaveLength(0);
  });

  it('quạt bật: một dòng kèm nhiệt độ lúc đó', () => {
    log.observeTelemetry(tel());
    log.observeTelemetry(tel({ fan_on: true, temperature_c: 36.2 }, T0 + 2000));
    const [item] = log.getItems();
    expect(item.text).toContain('Quạt');
    expect(item.text).toContain('BẬT');
    expect(item.detail).toContain('36.2');
    expect(item.ts).toBe(T0 + 2000);
    expect(item.level).toBe('info');
  });

  it('cảnh báo nhiệt: bắt đầu là nguy hiểm, kết thúc là bình thường', () => {
    log.observeTelemetry(tel());
    log.observeTelemetry(tel({ heat_alarm: true, temperature_c: 41.5 }, T0 + 1000));
    log.observeTelemetry(tel({ heat_alarm: false, temperature_c: 30 }, T0 + 2000));
    const [end, start] = log.getItems();
    expect(start.level).toBe('danger');
    expect(start.text).toContain('nhiệt');
    expect(end.level).toBe('ok');
  });

  it('khói và bơm', () => {
    log.observeTelemetry(tel());
    log.observeTelemetry(tel({ smoke_alarm: true, pump_on: true }, T0 + 1000));
    const texts = log.getItems().map((i) => i.text).join(' | ');
    expect(texts).toContain('khói');
    expect(texts).toContain('Bơm');
    expect(log.getItems().some((i) => i.level === 'danger')).toBe(true);
  });

  it('nhiều thay đổi cùng lúc: mỗi thay đổi một dòng, mới nhất ở trên', () => {
    log.observeTelemetry(tel());
    log.observeTelemetry(tel({ door_command: 'open', led2_on: true }, T0 + 1000));
    log.observeTelemetry(tel({ door_command: 'open', led2_on: true, is_dark: true, led1_on: true }, T0 + 3000));
    const items = log.getItems();
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items[0].ts).toBe(T0 + 3000);
    expect(items.map((i) => i.ts)).toEqual([...items.map((i) => i.ts)].sort((a, b) => b - a));
    expect(items.some((i) => i.text.includes('Cửa') && i.text.includes('MỞ'))).toBe(true);
  });

  it('DHT11 lỗi và phục hồi', () => {
    log.observeTelemetry(tel());
    log.observeTelemetry(tel({ dht_ok: false, temperature_c: null }, T0 + 1000));
    log.observeTelemetry(tel({ dht_ok: true }, T0 + 2000));
    const [back, broken] = log.getItems();
    expect(broken.level).toBe('warn');
    expect(broken.text).toContain('DHT11');
    expect(back.level).toBe('ok');
  });

  it('đổi chế độ tự động / thủ công', () => {
    log.observeTelemetry(tel());
    log.observeTelemetry(tel({ system_mode: 'manual' }, T0 + 1000));
    expect(log.getItems()[0].text).toContain('THỦ CÔNG');
  });

  it('resetBaseline: đổi nguồn dữ liệu không bị tính là thay đổi', () => {
    log.observeTelemetry(tel());
    log.resetBaseline();
    log.observeTelemetry(tel({ fan_on: true, heat_alarm: true }, T0 + 1000));
    expect(log.getItems()).toHaveLength(0);
  });

  it('chỉ giữ 100 dòng gần nhất', () => {
    log.observeTelemetry(tel());
    for (let i = 1; i <= 150; i++) {
      log.observeTelemetry(tel({ fan_on: i % 2 === 1 }, T0 + i * 1000));
    }
    expect(log.getItems()).toHaveLength(100);
    expect(log.getItems()[0].ts).toBe(T0 + 150 * 1000);
  });
});

describe('kết nối ESP32', () => {
  it('chỉ ghi khi trạng thái online đổi', () => {
    log.observeConnection(true, T0);
    log.observeConnection(true, T0 + 1000);
    expect(log.getItems()).toHaveLength(0);
    log.observeConnection(false, T0 + 2000);
    log.observeConnection(true, T0 + 9000);
    const [back, lost] = log.getItems();
    expect(lost.text).toContain('mất kết nối');
    expect(lost.level).toBe('warn');
    expect(back.text).toContain('kết nối lại');
    expect(back.level).toBe('ok');
  });
});

const cmd = (over: Partial<BackendCommand> = {}): BackendCommand => ({
  cmd_id: 'c1', device: 'fan', action: 'on', source: 'web', status: 'pending',
  sent_ts: T0 / 1000, ack_ts: null, detail: null, ts: T0 / 1000, ...over,
});

describe('lệnh điều khiển', () => {
  it('một lệnh chỉ có một dòng, cập nhật theo trạng thái', () => {
    log.ingestCommand(cmd());
    expect(log.getItems()).toHaveLength(1);
    expect(log.getItems()[0].text).toContain('Quạt');
    expect(log.getItems()[0].level).toBe('info');

    log.ingestCommand(cmd({ status: 'ok', ack_ts: T0 / 1000 + 0.2 }));
    expect(log.getItems()).toHaveLength(1);
    expect(log.getItems()[0].level).toBe('ok');
    expect(log.getItems()[0].text).toContain('thành công');
  });

  it('thất bại và quá thời gian', () => {
    log.ingestCommand(cmd({ cmd_id: 'a', status: 'failed', detail: 'relay lỗi' }));
    log.ingestCommand(cmd({ cmd_id: 'b', status: 'timeout' }));
    const byId = Object.fromEntries(log.getItems().map((i) => [i.id, i]));
    expect(byId['cmd:a'].level).toBe('danger');
    expect(byId['cmd:a'].detail).toContain('relay lỗi');
    expect(byId['cmd:b'].level).toBe('warn');
  });

  it('mô tả hành động của cửa và chế độ tự động', () => {
    log.ingestCommand(cmd({ cmd_id: 'd', device: 'door', action: 'open' }));
    log.ingestCommand(cmd({ cmd_id: 'e', device: 'led1', action: 'auto' }));
    const texts = log.getItems().map((i) => i.text).join(' | ');
    expect(texts).toContain('mở');
    expect(texts).toContain('tự động');
  });
});

describe('cấu hình ngưỡng', () => {
  const cfg = (status: BackendConfig['status']): BackendConfig => ({
    config_id: 'k1', status, detail: null,
    thresholds: { fan_on: 35, fan_off: 34, heat_alarm_on: 40, heat_alarm_off: 37, smoke_high: 2000, smoke_low: 1500 },
  });

  it('pending -> applied là một dòng duy nhất', () => {
    log.ingestConfig(cfg('pending'), T0);
    log.ingestConfig(cfg('applied'), T0 + 500);
    expect(log.getItems()).toHaveLength(1);
    expect(log.getItems()[0].level).toBe('ok');
  });

  it('bỏ qua trạng thái none (chưa cấu hình gì)', () => {
    log.ingestConfig(cfg('none'), T0);
    expect(log.getItems()).toHaveLength(0);
  });

  it('bị từ chối là cảnh báo', () => {
    log.ingestConfig(cfg('rejected'), T0);
    expect(log.getItems()[0].level).toBe('warn');
  });
});

describe('nạp lịch sử từ backend', () => {
  const ev = (over: Partial<BackendEvent> = {}): BackendEvent => ({
    type: 'smoke_alarm', state: 'start', value: 3000, threshold: 2000, reason: 'smoke',
    uptime_ms: 5000, ts: T0 / 1000 + 10, ...over,
  });

  it('gộp sự kiện và lệnh, mới nhất trước', () => {
    log.loadHistory(
      [ev(), ev({ type: 'pump', state: 'start', value: null, threshold: null, ts: T0 / 1000 + 11 })],
      [cmd({ cmd_id: 'x', status: 'ok', sent_ts: T0 / 1000 + 20 })]
    );
    const items = log.getItems();
    expect(items).toHaveLength(3);
    expect(items[0].id).toBe('cmd:x');
    expect(items[1].text).toContain('Bơm');
    expect(items[2].text).toContain('khói');
    expect(items[2].level).toBe('danger');
  });

  it('nạp hai lần không bị trùng dòng', () => {
    log.loadHistory([ev()], [cmd()]);
    log.loadHistory([ev()], [cmd()]);
    expect(log.getItems()).toHaveLength(2);
  });
});

describe('đăng ký nhận thay đổi', () => {
  it('gọi ngay khi đăng ký và mỗi khi có dòng mới', () => {
    const fn = vi.fn();
    const off = log.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    log.observeConnection(true, T0);
    log.observeConnection(false, T0 + 1);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    log.observeConnection(true, T0 + 2);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

import { BackendCommand, BackendConfig, BackendEvent } from '../types/api';
import { ESP32Telemetry } from '../types/telemetry';

export type ActivityLevel = 'info' | 'ok' | 'warn' | 'danger';
export type ActivityKind = 'device' | 'alarm' | 'sensor' | 'mode' | 'connection' | 'command' | 'config';

export interface ActivityItem {
  id: string;
  /** Thời điểm xảy ra (epoch mili giây) */
  ts: number;
  kind: ActivityKind;
  text: string;
  detail?: string;
  level: ActivityLevel;
}

const MAX_ITEMS = 100;

const DEVICE_NAMES: Record<string, string> = { fan: 'Quạt', led1: 'Đèn LED1', door: 'Cửa' };
const ACTION_TEXT: Record<string, string> = {
  on: 'bật',
  off: 'tắt',
  open: 'mở',
  close: 'đóng',
  auto: 'chuyển về tự động',
};

const onOff = (on: boolean) => (on ? 'BẬT' : 'TẮT');
const fmtTemp = (t: number | null) => (t === null ? undefined : `Nhiệt độ ${t.toFixed(1)}°C`);

/**
 * Nhật ký thay đổi gần nhất: gom các thay đổi trạng thái (so sánh các bản telemetry liên tiếp),
 * kết nối ESP32, lệnh điều khiển và cấu hình ngưỡng vào một danh sách, mới nhất ở trên.
 */
export class ActivityLogService {
  private items: ActivityItem[] = [];
  private seq = new Map<string, number>();
  private counter = 0;
  private prev: ESP32Telemetry | null = null;
  private prevOnline: boolean | null = null;
  private listeners = new Set<(items: ActivityItem[]) => void>();

  // ---- đọc ---------------------------------------------------------------
  public getItems(): ActivityItem[] {
    return this.items;
  }

  public subscribe(listener: (items: ActivityItem[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.items);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Đổi nguồn dữ liệu (thật <-> mô phỏng): bản telemetry kế tiếp chỉ làm mốc, không tính là thay đổi. */
  public resetBaseline(): void {
    this.prev = null;
    this.prevOnline = null;
  }

  // ---- thay đổi trạng thái từ telemetry ------------------------------------
  public observeTelemetry(t: ESP32Telemetry): void {
    const p = this.prev;
    this.prev = t;
    if (!p) return;
    const ts = t.timestamp || Date.now();
    const out: Omit<ActivityItem, 'id' | 'ts'>[] = [];

    const device = (name: string, was: boolean, now: boolean, detail?: string) => {
      if (was !== now) out.push({ kind: 'device', level: 'info', text: `${name}: ${onOff(now)}`, detail });
    };
    device('Quạt làm mát', p.fan_on, t.fan_on, fmtTemp(t.temperature_c));
    device('Đèn chiếu sáng (LED1)', p.led1_on, t.led1_on);
    device('Đèn đón khách (LED2)', p.led2_on, t.led2_on);
    device('Đèn báo nhiệt (LED3)', p.led3_on, t.led3_on);

    if (p.door_command !== t.door_command) {
      out.push({
        kind: 'device', level: 'info',
        text: t.door_command === 'open' ? 'Cửa: MỞ (90°)' : 'Cửa: ĐÓNG (0°)',
      });
    }
    if (p.heat_alarm !== t.heat_alarm) {
      out.push({
        kind: 'alarm', level: t.heat_alarm ? 'danger' : 'ok',
        text: `Cảnh báo nhiệt độ cao ${t.heat_alarm ? 'BẮT ĐẦU' : 'KẾT THÚC'}`,
        detail: fmtTemp(t.temperature_c),
      });
    }
    if (p.smoke_alarm !== t.smoke_alarm) {
      out.push({
        kind: 'alarm', level: t.smoke_alarm ? 'danger' : 'ok',
        text: `Cảnh báo khói/cháy ${t.smoke_alarm ? 'BẮT ĐẦU' : 'KẾT THÚC'}`,
        detail: `Khói ${t.smoke_ppm} PPM`,
      });
    }
    if (!!p.pump_on !== !!t.pump_on) {
      out.push({ kind: 'device', level: t.pump_on ? 'danger' : 'ok', text: `Bơm nước: ${onOff(!!t.pump_on)}` });
    }
    if (p.dht_ok !== t.dht_ok) {
      out.push(
        t.dht_ok
          ? { kind: 'sensor', level: 'ok', text: 'Cảm biến DHT11 hoạt động trở lại' }
          : { kind: 'sensor', level: 'warn', text: 'Lỗi cảm biến DHT11', detail: 'Không đọc được nhiệt độ, độ ẩm' }
      );
    }
    if (p.motion_detected !== t.motion_detected) {
      out.push({
        kind: 'sensor', level: 'info',
        text: t.motion_detected ? 'Phát hiện chuyển động' : 'Hết chuyển động',
      });
    }
    if (p.is_dark !== t.is_dark) {
      out.push({ kind: 'sensor', level: 'info', text: t.is_dark ? 'Trời tối' : 'Trời sáng' });
    }
    if (p.system_mode !== t.system_mode) {
      out.push({
        kind: 'mode', level: 'info',
        text: `Chế độ vận hành: ${t.system_mode === 'manual' ? 'THỦ CÔNG' : 'TỰ ĐỘNG'}`,
      });
    }

    out.forEach((item, i) => this.upsert({ ...item, id: `tel:${ts}:${i}:${item.text}`, ts }, false));
    if (out.length) this.notify();
  }

  // ---- kết nối -----------------------------------------------------------
  public observeConnection(online: boolean, ts: number = Date.now()): void {
    const was = this.prevOnline;
    this.prevOnline = online;
    if (was === null || was === online) return;
    this.upsert({
      id: `conn:${ts}:${online}`, ts, kind: 'connection',
      level: online ? 'ok' : 'warn',
      text: online ? 'ESP32 kết nối lại' : 'ESP32 mất kết nối',
    });
  }

  // ---- lệnh điều khiển -----------------------------------------------------
  public ingestCommand(cmd: BackendCommand): void {
    this.upsert(this.commandItem(cmd));
  }

  private commandItem(cmd: BackendCommand): ActivityItem {
    const name = DEVICE_NAMES[cmd.device] ?? cmd.device;
    const action = ACTION_TEXT[cmd.action] ?? cmd.action;
    const status: Record<BackendCommand['status'], { text: string; level: ActivityLevel }> = {
      pending: { text: 'đang chờ ESP32 xác nhận', level: 'info' },
      ok: { text: 'thành công', level: 'ok' },
      failed: { text: 'thất bại', level: 'danger' },
      timeout: { text: 'quá thời gian chờ', level: 'warn' },
    };
    const s = status[cmd.status];
    return {
      id: `cmd:${cmd.cmd_id}`,
      ts: Math.round(cmd.sent_ts * 1000),
      kind: 'command',
      level: s.level,
      text: `Lệnh: ${name} ${action} — ${s.text}`,
      detail: cmd.detail ?? undefined,
    };
  }

  // ---- cấu hình ngưỡng -----------------------------------------------------
  public ingestConfig(cfg: BackendConfig, ts: number = Date.now()): void {
    if (cfg.status === 'none' || !cfg.config_id) return;
    const status: Record<string, { text: string; level: ActivityLevel }> = {
      pending: { text: 'đang gửi xuống ESP32', level: 'info' },
      applied: { text: 'ESP32 đã áp dụng', level: 'ok' },
      rejected: { text: 'ESP32 từ chối', level: 'warn' },
      timeout: { text: 'quá thời gian chờ ESP32', level: 'warn' },
    };
    const s = status[cfg.status];
    if (!s) return;
    const existing = this.items.find((i) => i.id === `cfg:${cfg.config_id}`);
    this.upsert({
      id: `cfg:${cfg.config_id}`, ts: existing?.ts ?? ts, kind: 'config', level: s.level,
      text: `Cấu hình ngưỡng: ${s.text}`, detail: cfg.detail ?? undefined,
    });
  }

  // ---- lịch sử từ backend ----------------------------------------------------
  public loadHistory(events: BackendEvent[], commands: BackendCommand[]): void {
    for (const e of events) this.upsert(this.eventItem(e), false);
    for (const c of commands) this.upsert(this.commandItem(c), false);
    this.notify();
  }

  private eventItem(e: BackendEvent): ActivityItem {
    const start = e.state === 'start';
    const ts = Math.round((e.ts ?? Date.now() / 1000) * 1000);
    const detail = [
      e.value != null ? `giá trị ${e.value}` : null,
      e.threshold != null ? `ngưỡng ${e.threshold}` : null,
      e.reason ? `lý do: ${e.reason}` : null,
    ].filter(Boolean).join(', ') || undefined;
    const alarm = (name: string): Omit<ActivityItem, 'id' | 'ts'> => ({
      kind: 'alarm', level: start ? 'danger' : 'ok', text: `${name} ${start ? 'bắt đầu' : 'kết thúc'}`, detail,
    });
    const dev = (name: string, level: ActivityLevel = 'info'): Omit<ActivityItem, 'id' | 'ts'> => ({
      kind: 'device', level, text: `${name}: ${onOff(start)}`, detail,
    });
    const base: Record<BackendEvent['type'], Omit<ActivityItem, 'id' | 'ts'>> = {
      heat_alarm: alarm('Cảnh báo nhiệt độ cao'),
      smoke_alarm: alarm('Cảnh báo khói/cháy'),
      pump: dev('Bơm nước', start ? 'danger' : 'ok'),
      fan: dev('Quạt làm mát'),
      door: dev('Cửa'),
      led1: dev('Đèn LED1'),
      dht_error: {
        kind: 'sensor', level: start ? 'warn' : 'ok',
        text: start ? 'Lỗi cảm biến DHT11' : 'Cảm biến DHT11 hoạt động trở lại', detail,
      },
    };
    return { id: `evt:${ts}:${e.type}:${e.state}`, ts, ...base[e.type] };
  }

  // ---- nội bộ ---------------------------------------------------------------
  private upsert(item: ActivityItem, notify = true): void {
    const i = this.items.findIndex((x) => x.id === item.id);
    if (i >= 0) this.items.splice(i, 1);
    this.seq.set(item.id, ++this.counter);
    this.items.push(item);
    this.items.sort((a, b) => b.ts - a.ts || (this.seq.get(b.id) ?? 0) - (this.seq.get(a.id) ?? 0));
    if (this.items.length > MAX_ITEMS) {
      for (const dropped of this.items.splice(MAX_ITEMS)) this.seq.delete(dropped.id);
    }
    this.items = [...this.items];
    if (notify) this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l(this.items);
      } catch (e) {
        console.error('[ActivityLog] Lỗi listener:', e);
      }
    }
  }
}

export const activityLog = new ActivityLogService();

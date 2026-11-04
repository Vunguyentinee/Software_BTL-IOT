import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveRange, HISTORY_METRICS } from '../src/services/historyQuery';
import { httpClient } from '../src/services/api/httpClient';

const NOW = 1_800_000_000_000; // ms
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fail = (status: number, detail: unknown) =>
  ({ ok: false, status, statusText: 'x', json: async () => ({ detail }) }) as Response;

afterEach(() => vi.restoreAllMocks());

describe('resolveRange', () => {
  it('các khoảng nhanh tính lùi từ bây giờ (giây)', () => {
    const nowSec = NOW / 1000;
    expect(resolveRange('1h', '', '', NOW)).toEqual({ fromSec: nowSec - 3600, toSec: nowSec });
    expect(resolveRange('6h', '', '', NOW)!.fromSec).toBe(nowSec - 6 * 3600);
    expect(resolveRange('24h', '', '', NOW)!.fromSec).toBe(nowSec - 86400);
    expect(resolveRange('7d', '', '', NOW)!.fromSec).toBe(nowSec - 7 * 86400);
  });

  it('tùy chọn: dùng ngày giờ người dùng nhập', () => {
    const w = resolveRange('custom', '2026-01-01T00:00', '2026-01-01T01:00', NOW)!;
    expect(w.toSec - w.fromSec).toBe(3600);
  });

  it('tùy chọn: thiếu đầu mút thì mặc định 12 giờ trước và bây giờ', () => {
    const w = resolveRange('custom', '', '', NOW)!;
    expect(w).toEqual({ fromSec: NOW / 1000 - 12 * 3600, toSec: NOW / 1000 });
  });

  it('tùy chọn không hợp lệ (sai định dạng hoặc Từ > Đến) -> null', () => {
    expect(resolveRange('custom', 'khong-phai-ngay', '', NOW)).toBeNull();
    expect(resolveRange('custom', '2026-01-02T00:00', '2026-01-01T00:00', NOW)).toBeNull();
  });
});

describe('HISTORY_METRICS', () => {
  it('chỉ gồm 3 metric backend hỗ trợ thống kê', () => {
    expect(HISTORY_METRICS.map((m) => m.id)).toEqual(['temperature_c', 'humidity_pct', 'smoke_raw']);
  });
});

describe('httpClient lịch sử', () => {
  it('getHistoryStats gọi đúng đường dẫn và trả về thống kê', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(ok({ count: 3, avg: 32, min: 30, max: 34 }));
    const r = await httpClient.getHistoryStats('temperature_c', 100, 200);
    expect(spy.mock.calls[0][0]).toBe('/api/history/stats?metric=temperature_c&from=100&to=200');
    expect(r).toEqual({ count: 3, avg: 32, min: 30, max: 34 });
  });

  it('getHistoryStats giữ nguyên null khi không có dữ liệu (không đổi thành 0)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(ok({ count: 0, avg: null, min: null, max: null }));
    const r = await httpClient.getHistoryStats('humidity_pct', 1, 2);
    expect(r.count).toBe(0);
    expect(r.avg).toBeNull();
  });

  it('getHistoryPage truyền limit và offset', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(ok([{ ts: 1, value: 2 }]));
    const r = await httpClient.getHistoryPage('smoke_raw', 10, 20, 11, 30);
    expect(spy.mock.calls[0][0]).toBe('/api/history/page?metric=smoke_raw&from=10&to=20&limit=11&offset=30');
    expect(r).toEqual([{ ts: 1, value: 2 }]);
  });

  it('lỗi 422 của backend được ném ra với nội dung detail', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(fail(422, 'start must be <= end'));
    await expect(httpClient.getHistoryStats('temperature_c', 5, 1)).rejects.toThrow('start must be <= end');
  });

  it('getHistoryCsvUrl dựng đường dẫn tải CSV', () => {
    expect(httpClient.getHistoryCsvUrl('temperature_c', 100, 200)).toBe(
      '/api/history.csv?metric=temperature_c&from=100&to=200'
    );
  });
});

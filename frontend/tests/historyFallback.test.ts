import { describe, it, expect, vi, afterEach } from 'vitest';
import { historyService } from '../src/services/historyData';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

afterEach(() => vi.restoreAllMocks());

describe('fetchHistory', () => {
  it('trả về dữ liệu thật của backend', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url).includes('temperature_c') ? ok([{ ts: 1000, value: 30.5 }]) : ok([])
    );
    const data = await historyService.fetchHistory('1h');
    expect(data).toHaveLength(1);
    expect(data[0].temperature_c).toBe(30.5);
  });

  it('backend chạy nhưng chưa có điểm nào -> danh sách rỗng, KHÔNG dùng dữ liệu mô phỏng', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(ok([]));
    expect(await historyService.fetchHistory('1h')).toEqual([]);
  });

  it('không kết nối được backend -> dùng dữ liệu mô phỏng', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('network'));
    const data = await historyService.fetchHistory('1h');
    expect(data.length).toBeGreaterThan(0);
  });
});

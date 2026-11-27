import { describe, it, expect, vi, afterEach } from 'vitest';
import { pendingAckEventIds } from '../src/types/telemetry';
import { backendService } from '../src/services/backendService';
import { httpClient } from '../src/services/api/httpClient';

afterEach(() => {
  vi.restoreAllMocks();
  (backendService as any).isServerConnected = false;
});

describe('Operator ACK dùng event_id thật', () => {
  it('chỉ lấy event_id đang chờ xác nhận', () => {
    expect(
      pendingAckEventIds([
        { alarm: 'gas', event_id: 'b1-0000000a', operator_ack: false },
        { alarm: 'heat', event_id: 'b1-0000000b', operator_ack: true },
        { alarm: 'x' },
        { alarm: 'y', event_id: '' },
      ])
    ).toEqual(['b1-0000000a']);
    expect(pendingAckEventIds(undefined)).toEqual([]);
  });

  it('gửi đúng từng event_id tới backend', async () => {
    (backendService as any).isServerConnected = true;
    const spy = vi.spyOn(httpClient, 'acknowledgeAlarm').mockResolvedValue({ event_id: 'x', source: 'operator' });
    await expect(backendService.acknowledgeAlarms(['b1-1', 'b1-2'])).resolves.toEqual(['b1-1', 'b1-2']);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['b1-1', 'b1-2']);
  });

  it('không có cảnh báo chờ -> báo lỗi, không gửi mã bịa', async () => {
    (backendService as any).isServerConnected = true;
    const spy = vi.spyOn(httpClient, 'acknowledgeAlarm');
    await expect(backendService.acknowledgeAlarms([])).rejects.toThrow('Không có cảnh báo');
    expect(spy).not.toHaveBeenCalled();
  });

  it('backend từ chối (404/403/503) -> lỗi được báo ra, không giả vờ thành công', async () => {
    (backendService as any).isServerConnected = true;
    vi.spyOn(httpClient, 'acknowledgeAlarm').mockRejectedValue(new Error('alarm_not_found'));
    await expect(backendService.acknowledgeAlarms(['b1-1'])).rejects.toThrow('alarm_not_found');
  });

  it('mất kết nối backend -> báo lỗi', async () => {
    await expect(backendService.acknowledgeAlarms(['b1-1'])).rejects.toThrow('Mất kết nối backend');
  });
});

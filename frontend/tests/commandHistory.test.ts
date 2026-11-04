import { describe, it, expect, vi, afterEach } from 'vitest';
import { commandService } from '../src/services/commandService';
import { httpClient } from '../src/services/api/httpClient';
import { BackendCommand, BackendEvent } from '../src/types/api';
import { CommandLogEntry } from '../src/types/command';

const cmd = (over: Partial<BackendCommand>): BackendCommand => ({
  cmd_id: 'c1', device: 'fan', action: 'on', source: 'web', status: 'ok',
  sent_ts: 1_800_000_000, ack_ts: 1_800_000_000.25, detail: null, ts: 1_800_000_000, ...over,
});

const logs = (): CommandLogEntry[] => {
  let current: CommandLogEntry[] = [];
  commandService.subscribe((l) => (current = l))();
  return current;
};

afterEach(() => vi.restoreAllMocks());

describe('commandService.loadHistory', () => {
  it('nạp lệnh thật từ backend, bỏ hai dòng mẫu, mới nhất ở trên', async () => {
    vi.spyOn(httpClient, 'getCommands').mockResolvedValue([
      cmd({ cmd_id: 'old', device: 'door', action: 'open', sent_ts: 1_800_000_000 }),
      cmd({ cmd_id: 'new', device: 'fan', action: 'off', status: 'failed', detail: 'relay', sent_ts: 1_800_000_100 }),
    ]);
    await commandService.loadHistory();
    const l = logs();
    expect(l.some((e) => e.id.startsWith('cmd_init_'))).toBe(false);
    expect(l.map((e) => e.id).slice(0, 2)).toEqual(['new', 'old']);

    const failed = l.find((e) => e.id === 'new')!;
    expect(failed.status).toBe('error');
    expect(failed.message).toContain('relay');
    expect(failed.target).toBe('fan');

    const opened = l.find((e) => e.id === 'old')!;
    expect(opened.status).toBe('success');
    expect(opened.actionText).toContain('Mở cửa');
    expect(opened.latencyMs).toBe(250);
  });

  it('nạp lại không tạo dòng trùng', async () => {
    vi.spyOn(httpClient, 'getCommands').mockResolvedValue([cmd({ cmd_id: 'dup' })]);
    await commandService.loadHistory();
    await commandService.loadHistory();
    expect(logs().filter((e) => e.id === 'dup')).toHaveLength(1);
  });

  it('backend lỗi thì giữ nguyên danh sách, không ném lỗi', async () => {
    vi.spyOn(httpClient, 'getCommands').mockRejectedValue(new Error('down'));
    await expect(commandService.loadHistory()).resolves.toBeUndefined();
  });

  it('lệnh "auto" hiển thị là chuyển về tự động', async () => {
    vi.spyOn(httpClient, 'getCommands').mockResolvedValue([cmd({ cmd_id: 'au', action: 'auto', device: 'led1' })]);
    await commandService.loadHistory();
    expect(logs().find((e) => e.id === 'au')!.actionText).toContain('tự động');
  });
});

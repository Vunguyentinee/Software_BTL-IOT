import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { authService } from '../src/services/api/authService';
import { websocketService, WS_UNAUTHORIZED } from '../src/services/api/websocketService';

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = FakeWS.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status < 300, status, statusText: 'x', headers: { get: () => null }, json: async () => body }) as unknown as Response;

beforeEach(() => {
  FakeWS.instances = [];
  (globalThis as any).WebSocket = FakeWS;
  vi.useFakeTimers();
});

afterEach(() => {
  websocketService.disconnect();
  authService.logout();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as any).WebSocket;
});

describe('WebSocket + đăng nhập', () => {
  it('chưa đăng nhập thì không mở WebSocket', () => {
    websocketService.connect('ws://test/ws');
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('gửi token làm tin đầu tiên; token không nằm trong URL', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonRes(200, { access_token: 'tok-WS', expires_in: 3600, role: 'viewer' })
    );
    await authService.login('vu', 'mat-khau-123');
    websocketService.connect('ws://test/ws');
    const ws = FakeWS.instances[0];
    expect(ws.url).not.toContain('tok-WS');
    ws.onopen?.();
    expect(JSON.parse(ws.sent[0])).toEqual({ kind: 'auth', token: 'tok-WS' });
  });

  it('bị đóng mã 4401 -> đăng xuất và KHÔNG kết nối lại', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonRes(200, { access_token: 'tok-WS', expires_in: 3600, role: 'viewer' })
    );
    await authService.login('vu', 'mat-khau-123');
    websocketService.connect('ws://test/ws');
    const ws = FakeWS.instances[0];
    ws.onopen?.();
    ws.onclose?.({ code: WS_UNAUTHORIZED });
    expect(authService.getSession()).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('mất kết nối thường (mã khác) thì vẫn tự kết nối lại', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonRes(200, { access_token: 'tok-WS', expires_in: 3600, role: 'viewer' })
    );
    await authService.login('vu', 'mat-khau-123');
    websocketService.connect('ws://test/ws');
    FakeWS.instances[0].onclose?.({ code: 1006 });
    vi.advanceTimersByTime(3000);
    expect(FakeWS.instances).toHaveLength(2);
  });
});

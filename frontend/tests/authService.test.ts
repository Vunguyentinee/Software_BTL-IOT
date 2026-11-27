import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthService, StorageLike, authService } from '../src/services/api/authService';
import { httpClient } from '../src/services/api/httpClient';

const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: { get: (k: string) => headers[k] ?? null },
    json: async () => body,
  }) as unknown as Response;

const loginOk = (token: string, role = 'operator', expiresIn = 3600) =>
  jsonRes(200, { access_token: token, token_type: 'bearer', expires_in: expiresIn, role });

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  authService.logout();
});

describe('AuthService (đăng nhập thủ công, không tự đăng nhập)', () => {
  it('chưa đăng nhập thì không có token và không tự gọi /login', () => {
    const spy = vi.spyOn(global, 'fetch');
    const svc = new AuthService(new MemStorage());
    expect(svc.getSession()).toBeNull();
    expect(svc.getToken()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('đăng nhập gửi đúng tài khoản người dùng nhập và lưu phiên', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok-1', 'viewer'));
    const store = new MemStorage();
    const svc = new AuthService(store, () => 1_000_000);
    const s = await svc.login('vu', 'mat-khau-123');
    expect(s).toMatchObject({ username: 'vu', role: 'viewer', token: 'tok-1', expiresAt: 1_000_000 + 3_600_000 });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'vu', password: 'mat-khau-123' });
    // phiên lưu trong sessionStorage KHÔNG chứa mật khẩu
    expect(store.getItem('btl_session')).not.toContain('mat-khau-123');
  });

  it('khôi phục phiên sau khi tải lại trang (cùng tab), bỏ phiên đã hết hạn', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok-1'));
    const store = new MemStorage();
    let now = 1_000_000;
    await new AuthService(store, () => now).login('vu', 'mat-khau-123');
    expect(new AuthService(store, () => now).getToken()).toBe('tok-1');
    now += 3_600_000 + 1;
    expect(new AuthService(store, () => now).getToken()).toBeNull();
  });

  it('dữ liệu phiên hỏng / vai trò lạ thì coi như chưa đăng nhập', () => {
    const store = new MemStorage();
    store.setItem('btl_session', '{rac');
    expect(new AuthService(store).getSession()).toBeNull();
    store.setItem('btl_session', JSON.stringify({ username: 'x', role: 'root', token: 't', expiresAt: 9e15 }));
    expect(new AuthService(store).getSession()).toBeNull();
  });

  it('sai mật khẩu -> thông báo dễ hiểu, không tạo phiên', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(401, { detail: 'invalid_credentials' }));
    const svc = new AuthService(new MemStorage());
    await expect(svc.login('vu', 'sai-mat-khau')).rejects.toThrow('Sai tên đăng nhập hoặc mật khẩu');
    expect(svc.getSession()).toBeNull();
  });

  it('bị khóa do sai nhiều lần -> báo số giây chờ', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(429, { detail: 'too_many_login_attempts' }, { 'Retry-After': '42' }));
    await expect(new AuthService(new MemStorage()).login('vu', 'x'.repeat(10))).rejects.toThrow('42 giây');
  });

  it('không kết nối được backend -> báo rõ', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(new AuthService(new MemStorage()).login('vu', 'x'.repeat(10))).rejects.toThrow('Không kết nối được');
  });

  it('đăng xuất xóa phiên và báo cho listener; hết hạn thì ghi lý do', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok-1'));
    const store = new MemStorage();
    const svc = new AuthService(store);
    const seen: Array<unknown> = [];
    svc.subscribe((s) => seen.push(s));
    await svc.login('vu', 'mat-khau-123');
    svc.logout('expired');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeNull();
    expect(store.getItem('btl_session')).toBeNull();
    expect(svc.consumeLogoutReason()).toBe('expired');
    expect(svc.consumeLogoutReason()).toBeNull();
  });

  it('hasRole theo thứ bậc viewer < operator < admin', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok', 'operator'));
    const svc = new AuthService(new MemStorage());
    expect(svc.hasRole('viewer')).toBe(false);
    await svc.login('op', 'mat-khau-123');
    expect(svc.hasRole('viewer')).toBe(true);
    expect(svc.hasRole('operator')).toBe(true);
    expect(svc.hasRole('admin')).toBe(false);
  });
});

describe('httpClient + JWT', () => {
  const loginAs = async (role = 'operator') => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(loginOk('tok-A', role));
    await authService.login('vu', 'mat-khau-123');
    vi.restoreAllMocks(); // chỉ đếm các lời gọi sau khi đăng nhập
  };

  it('GET (xem dữ liệu) cũng gắn Bearer', async () => {
    await loginAs('viewer');
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(200, { online: true }));
    await httpClient.getState();
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-A');
  });

  it('POST điều khiển gắn Bearer, không tự đăng nhập', async () => {
    await loginAs();
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(200, { cmd_id: 'c1', status: 'pending' }));
    await httpClient.sendCommand('fan', 'on');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(((spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer tok-A');
  });

  it('401 -> đăng xuất (về trang đăng nhập), không thử lại', async () => {
    await loginAs();
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(401, { detail: 'not_authenticated' }));
    await expect(httpClient.sendCommand('fan', 'on')).rejects.toThrow('not_authenticated');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(authService.getSession()).toBeNull();
  });

  it('403 (thiếu quyền) báo rõ, vẫn giữ phiên, không thử lại', async () => {
    await loginAs('viewer');
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(403, { detail: 'forbidden' }));
    await expect(httpClient.putConfig({} as any)).rejects.toThrow('forbidden');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(authService.getSession()).not.toBeNull();
  });
});

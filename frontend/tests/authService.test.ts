import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthService, authService } from '../src/services/api/authService';
import { httpClient } from '../src/services/api/httpClient';

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body }) as Response;

const loginOk = (token: string, expiresIn = 3600) =>
  jsonRes(200, { access_token: token, token_type: 'bearer', expires_in: expiresIn, role: 'operator' });

const CREDS = { username: 'ui', password: 'secret-pass' };

afterEach(() => {
  vi.restoreAllMocks();
  authService.invalidate();
  delete (globalThis as any).__APP_CONFIG__;
});

describe('AuthService', () => {
  it('không có tài khoản được cấu hình thì không đăng nhập và trả null', async () => {
    const spy = vi.spyOn(global, 'fetch');
    const svc = new AuthService(() => ({}));
    expect(await svc.getToken()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('đăng nhập một lần và dùng lại token', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok-1'));
    const svc = new AuthService(() => CREDS);
    expect(await svc.getToken()).toBe('tok-1');
    expect(await svc.getToken()).toBe('tok-1');
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'ui', password: 'secret-pass' });
  });

  it('nhiều lời gọi đồng thời chỉ đăng nhập một lần', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok-1'));
    const svc = new AuthService(() => CREDS);
    const tokens = await Promise.all([svc.getToken(), svc.getToken(), svc.getToken()]);
    expect(tokens).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('tự đăng nhập lại khi token sắp hết hạn (còn dưới 60 giây)', async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(loginOk('tok-1', 3600))
      .mockResolvedValueOnce(loginOk('tok-2', 3600));
    const svc = new AuthService(() => CREDS, () => now);
    expect(await svc.getToken()).toBe('tok-1');
    now += (3600 - 30) * 1000;
    expect(await svc.getToken()).toBe('tok-2');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('đăng nhập sai ném lỗi, không giữ token hỏng', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(401, { detail: 'invalid_credentials' }));
    const svc = new AuthService(() => CREDS);
    await expect(svc.getToken()).rejects.toThrow('invalid_credentials');
    vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok-ok'));
    expect(await svc.getToken()).toBe('tok-ok');
  });

  it('đọc tài khoản từ window.__APP_CONFIG__ do container cấp lúc chạy', async () => {
    (globalThis as any).__APP_CONFIG__ = { uiUsername: 'ui', uiPassword: 'from-config' };
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(loginOk('tok-cfg'));
    expect(await authService.getToken()).toBe('tok-cfg');
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).password).toBe('from-config');
  });
});

describe('httpClient + JWT', () => {
  it('GET không gắn token và không đăng nhập', async () => {
    (globalThis as any).__APP_CONFIG__ = { uiUsername: 'ui', uiPassword: 'pw-123456' };
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes(200, { online: true }));
    await httpClient.getState();
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)?.Authorization).toBeUndefined();
  });

  it('POST điều khiển tự đăng nhập và gắn Bearer', async () => {
    (globalThis as any).__APP_CONFIG__ = { uiUsername: 'ui', uiPassword: 'pw-123456' };
    const spy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) =>
      String(url).endsWith('/api/auth/login') ? loginOk('tok-A') : jsonRes(200, { cmd_id: 'c1', status: 'pending' }));
    await httpClient.sendCommand('fan', 'on');
    const cmdCall = spy.mock.calls.find((c) => String(c[0]).includes('/command'))!;
    expect(((cmdCall[1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer tok-A');
  });

  it('401 thì đăng nhập lại và thử lại đúng một lần', async () => {
    (globalThis as any).__APP_CONFIG__ = { uiUsername: 'ui', uiPassword: 'pw-123456' };
    let logins = 0;
    let commands = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).endsWith('/api/auth/login')) return loginOk(`tok-${++logins}`);
      commands += 1;
      return commands === 1 ? jsonRes(401, { detail: 'not_authenticated' }) : jsonRes(200, { cmd_id: 'c1', status: 'pending' });
    });
    const res = await httpClient.sendCommand('fan', 'on');
    expect(res.cmd_id).toBe('c1');
    expect(logins).toBe(2);
    expect(commands).toBe(2);
  });

  it('401 lặp lại thì báo lỗi, không lặp vô hạn', async () => {
    (globalThis as any).__APP_CONFIG__ = { uiUsername: 'ui', uiPassword: 'pw-123456' };
    let commands = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).endsWith('/api/auth/login')) return loginOk('tok');
      commands += 1;
      return jsonRes(401, { detail: 'not_authenticated' });
    });
    await expect(httpClient.sendCommand('fan', 'on')).rejects.toThrow('not_authenticated');
    expect(commands).toBe(2);
  });

  it('403 (thiếu quyền) được báo nguyên văn, không thử lại', async () => {
    (globalThis as any).__APP_CONFIG__ = { uiUsername: 'ui', uiPassword: 'pw-123456' };
    let calls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).endsWith('/api/auth/login')) return loginOk('tok');
      calls += 1;
      return jsonRes(403, { detail: 'forbidden' });
    });
    await expect(httpClient.putConfig({} as any)).rejects.toThrow('forbidden');
    expect(calls).toBe(1);
  });
});

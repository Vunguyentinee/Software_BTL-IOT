const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/** Hết hạn trước ngần này thì coi như hết (đăng nhập lại sớm, tránh gửi token sắp chết). */
const REFRESH_MARGIN_MS = 60_000;

export interface UiCredentials {
  username?: string;
  password?: string;
}

type AppConfig = { uiUsername?: string; uiPassword?: string };

/** Do container frontend sinh ra lúc chạy (/config.js, gán vào window) từ UI_USERNAME / UI_PASSWORD. */
function runtimeConfig(): AppConfig | undefined {
  return (globalThis as { __APP_CONFIG__?: AppConfig }).__APP_CONFIG__;
}

function defaultCredentials(): UiCredentials {
  const cfg = runtimeConfig();
  return {
    username: cfg?.uiUsername || import.meta.env.VITE_UI_USERNAME,
    password: cfg?.uiPassword || import.meta.env.VITE_UI_PASSWORD,
  };
}

/**
 * Tự đăng nhập bằng tài khoản giao diện (vai trò operator) để lấy JWT, giữ trong bộ nhớ,
 * tự gia hạn khi sắp hết hạn. Không có tài khoản được cấu hình thì không đăng nhập (trả null).
 */
export class AuthService {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readCredentials: () => UiCredentials = defaultCredentials,
    private now: () => number = Date.now
  ) {}

  public invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  public async getToken(force = false): Promise<string | null> {
    if (!force && this.token && this.now() < this.expiresAt - REFRESH_MARGIN_MS) return this.token;
    if (this.inflight) return this.inflight;
    const { username, password } = this.readCredentials();
    if (!username || !password) return null;

    this.inflight = this.login(username, password).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async login(username: string, password: string): Promise<string> {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      this.invalidate();
      let msg = `HTTP Error ${res.status}: ${res.statusText}`;
      try {
        const data = await res.json();
        if (typeof data.detail === 'string') msg = data.detail;
      } catch {
        // không phải JSON
      }
      throw new Error(msg);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = data.access_token;
    this.expiresAt = this.now() + data.expires_in * 1000;
    return this.token;
  }
}

export const authService = new AuthService();

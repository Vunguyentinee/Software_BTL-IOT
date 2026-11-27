const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export type Role = 'viewer' | 'operator' | 'admin';

const ROLE_LEVEL: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Chỉ xem',
  operator: 'Điều khiển',
  admin: 'Quản trị',
};

export interface Session {
  username: string;
  role: Role;
  token: string;
  /** Thời điểm hết hạn (ms, đồng hồ trình duyệt). */
  expiresAt: number;
}

export type LogoutReason = 'manual' | 'expired';

/** Tối thiểu của Storage mà AuthService cần (sessionStorage trên trình duyệt; giả lập khi test). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_KEY = 'btl_session';
const REASON_KEY = 'btl_logout_reason';

function browserSessionStorage(): StorageLike | null {
  try {
    return (globalThis as { sessionStorage?: StorageLike }).sessionStorage ?? null;
  } catch {
    return null; // trình duyệt chặn lưu trữ: phiên chỉ sống trong bộ nhớ
  }
}

function isRole(v: unknown): v is Role {
  return v === 'viewer' || v === 'operator' || v === 'admin';
}

/** Đổi mã lỗi của backend thành câu dễ hiểu cho người dùng. */
function loginErrorMessage(status: number, detail: unknown, retryAfter: string | null): string {
  if (status === 401) return 'Sai tên đăng nhập hoặc mật khẩu.';
  if (status === 429) {
    const s = retryAfter ? ` Thử lại sau ${retryAfter} giây.` : '';
    return `Đăng nhập sai quá nhiều lần, tài khoản tạm khóa.${s}`;
  }
  if (status === 503 && detail === 'auth_not_configured') {
    return 'Máy chủ chưa cấu hình tài khoản (BTL_USERS / BTL_JWT_SECRET).';
  }
  if (status === 422) return 'Tên đăng nhập hoặc mật khẩu không hợp lệ.';
  return typeof detail === 'string' ? detail : `Lỗi máy chủ (${status}).`;
}

/**
 * Đăng nhập bằng username/password do người dùng nhập. Token JWT được giữ trong sessionStorage
 * (mất khi đóng tab) và KHÔNG có mật khẩu nào nằm trong mã nguồn hay file cấu hình của trang web.
 */
export class AuthService {
  private session: Session | null = null;
  private listeners = new Set<(s: Session | null) => void>();

  constructor(
    private storage: StorageLike | null = browserSessionStorage(),
    private now: () => number = Date.now
  ) {
    this.session = this.restore();
  }

  private restore(): Session | null {
    try {
      const raw = this.storage?.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<Session>;
      if (typeof s.token === 'string' && typeof s.username === 'string' && isRole(s.role)
          && typeof s.expiresAt === 'number' && s.expiresAt > this.now()) {
        return s as Session;
      }
      this.storage?.removeItem(SESSION_KEY);
    } catch {
      // dữ liệu hỏng hoặc không đọc được: coi như chưa đăng nhập
    }
    return null;
  }

  public async login(username: string, password: string): Promise<Session> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error('Không kết nối được máy chủ backend.');
    }
    if (!res.ok) {
      let detail: unknown = null;
      try {
        detail = (await res.json())?.detail;
      } catch {
        // không phải JSON
      }
      throw new Error(loginErrorMessage(res.status, detail, res.headers?.get?.('Retry-After') ?? null));
    }
    const data = (await res.json()) as { access_token: string; expires_in: number; role: string };
    if (!isRole(data.role)) throw new Error('Máy chủ trả về vai trò không hợp lệ.');
    const session: Session = {
      username,
      role: data.role,
      token: data.access_token,
      expiresAt: this.now() + data.expires_in * 1000,
    };
    this.session = session;
    try {
      this.storage?.setItem(SESSION_KEY, JSON.stringify(session));
      this.storage?.removeItem(REASON_KEY);
    } catch {
      // không lưu được: phiên vẫn dùng được tới khi tải lại trang
    }
    this.notify();
    return session;
  }

  public logout(reason: LogoutReason = 'manual'): void {
    const had = this.session !== null;
    this.session = null;
    try {
      this.storage?.removeItem(SESSION_KEY);
      if (reason === 'expired') this.storage?.setItem(REASON_KEY, reason);
    } catch {
      // bỏ qua
    }
    if (had) this.notify();
  }

  /** Lý do lần đăng xuất trước (để trang đăng nhập báo "phiên đã hết hạn"); đọc xong thì xóa. */
  public consumeLogoutReason(): LogoutReason | null {
    try {
      const r = this.storage?.getItem(REASON_KEY);
      this.storage?.removeItem(REASON_KEY);
      return r === 'expired' ? 'expired' : null;
    } catch {
      return null;
    }
  }

  public getSession(): Session | null {
    if (this.session && this.session.expiresAt <= this.now()) this.logout('expired');
    return this.session;
  }

  public getToken(): string | null {
    return this.getSession()?.token ?? null;
  }

  public hasRole(min: Role): boolean {
    const s = this.getSession();
    return s !== null && ROLE_LEVEL[s.role] >= ROLE_LEVEL[min];
  }

  public subscribe(listener: (s: Session | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l(this.session);
      } catch (e) {
        console.error('[AuthService] listener lỗi:', e);
      }
    }
  }
}

export const authService = new AuthService();

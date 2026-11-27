import React, { useState } from 'react';
import { Cpu, Lock, User, AlertCircle, Loader2, Info } from 'lucide-react';
import { authService } from '../../services/api/authService';

interface LoginPageProps {
  /** Lần trước bị đăng xuất vì token hết hạn / không hợp lệ. */
  expired?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({ expired = false }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Nhập tên đăng nhập và mật khẩu.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authService.login(username.trim(), password);
      // Root nhận phiên mới qua subscribe và hiển thị bảng điều khiển
    } catch (err: any) {
      setError(err?.message || 'Đăng nhập thất bại.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4 font-sans antialiased">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-md shadow-blue-200">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Nhà thông minh ESP32</h1>
            <p className="text-xs text-slate-500">Digital Twin · Đăng nhập để tiếp tục</p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4"
          aria-label="Đăng nhập"
        >
          {expired && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.</span>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Tên đăng nhập</span>
            <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
              <User className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                name="username"
                autoComplete="username"
                autoFocus
                maxLength={64}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Mật khẩu</span>
            <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
              <Lock className="w-4 h-4 text-slate-400" />
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
          </label>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold shadow-md shadow-blue-200 transition-all active:scale-[0.99]"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Đăng nhập
          </button>
        </form>

        <p className="text-[11px] text-slate-500 text-center mt-4">
          Tài khoản do quản trị nhóm cấp. Không có chức năng tự đăng ký.
        </p>
      </div>
    </div>
  );
};

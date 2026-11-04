import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { activityLog, ActivityItem, ActivityLevel } from '../../services/activityLog';

const DOT: Record<ActivityLevel, string> = {
  info: 'bg-blue-500',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-rose-500',
};

const ROW: Record<ActivityLevel, string> = {
  info: '',
  ok: '',
  warn: 'bg-amber-50/60',
  danger: 'bg-rose-50/70',
};

const timeLabel = (ts: number): string => {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('vi-VN');
  return d.toDateString() === new Date().toDateString() ? time : `${time} ${d.toLocaleDateString('vi-VN')}`;
};

interface ActivityLogProps {
  /** Đang nhận dữ liệu thời gian thực từ backend */
  live: boolean;
}

export const ActivityLog: React.FC<ActivityLogProps> = ({ live }) => {
  const [items, setItems] = useState<ActivityItem[]>(activityLog.getItems());
  useEffect(() => activityLog.subscribe(setItems), []);

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-blue-50 text-blue-700 rounded-xl border border-blue-200">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Nhật ký thay đổi gần nhất
            </h3>
            <p className="text-xs text-slate-500">
              Thiết bị bật/tắt, cảnh báo, mất/khôi phục kết nối, lệnh và cấu hình. Mới nhất ở trên.
            </p>
          </div>
        </div>
        <span
          className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
            live
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
          {live ? 'Thời gian thực' : 'Chế độ mô phỏng'}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-4 text-center">
          Chưa có thay đổi nào. Khi thiết bị đổi trạng thái hoặc có cảnh báo, dòng mới sẽ hiện ở đây ngay lập tức.
        </p>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {items.slice(0, 30).map((it) => (
            <li key={it.id} className={`flex items-start gap-3 px-3 py-2 text-xs ${ROW[it.level]}`}>
              <span className="mt-1.5 flex-none">
                <span className={`block w-2 h-2 rounded-full ${DOT[it.level]}`} />
              </span>
              <span className="flex-none w-28 font-mono text-[11px] text-slate-500 pt-0.5">{timeLabel(it.ts)}</span>
              <span className="min-w-0">
                <span className="font-semibold text-slate-800">{it.text}</span>
                {it.detail && <span className="block text-[11px] text-slate-500">{it.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

import React from 'react';
import { BarChart3 } from 'lucide-react';
import { BackendHistoryStats } from '../../types/api';
import { HISTORY_METRICS, HistoryMetricId } from '../../services/historyQuery';

interface HistoryStatsProps {
  stats: Record<HistoryMetricId, BackendHistoryStats> | null;
  loading: boolean;
  error: string | null;
}

const fmt = (value: number | null, decimals: number) =>
  value === null ? '—' : value.toFixed(decimals);

export const HistoryStats: React.FC<HistoryStatsProps> = ({ stats, loading, error }) => {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-blue-600" />
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Thống kê trong khoảng thời gian đã chọn
        </h4>
        {loading && <span className="text-[11px] text-slate-400">Đang tải…</span>}
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Không tải được thống kê: {error}
        </div>
      )}

      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {HISTORY_METRICS.map((m) => {
            const s = stats?.[m.id];
            const empty = s !== undefined && s.count === 0;
            return (
              <div key={m.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">{m.label}</span>
                  <span className="text-[11px] text-slate-500">
                    {s ? `${s.count} mẫu` : '—'}
                  </span>
                </div>
                {empty ? (
                  <p className="text-xs text-slate-500">Chưa có dữ liệu trong khoảng này</p>
                ) : (
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Trung bình', s?.avg ?? null],
                      ['Nhỏ nhất', s?.min ?? null],
                      ['Lớn nhất', s?.max ?? null],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <dt className="text-[10px] text-slate-500">{label}</dt>
                        <dd className="text-sm font-bold text-slate-900">
                          {fmt(value as number | null, m.decimals)}
                          {value !== null && m.unit && (
                            <span className="text-[10px] font-normal text-slate-500 ml-0.5">{m.unit}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

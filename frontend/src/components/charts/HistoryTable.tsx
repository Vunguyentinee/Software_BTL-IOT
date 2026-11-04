import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsRight, Table2 } from 'lucide-react';
import { httpClient } from '../../services/api/httpClient';
import { HISTORY_METRICS, HistoryMetricId, TimeWindow } from '../../services/historyQuery';

const PAGE_SIZE = 10;

interface HistoryTableProps {
  metric: HistoryMetricId;
  onMetricChange: (metric: HistoryMetricId) => void;
  window: TimeWindow | null;
  reloadKey: number;
  /** Tổng số mẫu của metric đang chọn (từ thống kê), dùng để hiện "Trang x/y" và nhảy tới trang cuối. */
  totalCount: number | undefined;
}

export const HistoryTable: React.FC<HistoryTableProps> = ({
  metric,
  onMetricChange,
  window: range,
  reloadKey,
  totalCount,
}) => {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Array<{ ts: number; value: number }>>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = HISTORY_METRICS.find((m) => m.id === metric)!;
  const fromSec = range?.fromSec;
  const toSec = range?.toSec;

  // Đổi metric, khoảng thời gian hoặc làm mới: quay về trang đầu.
  useEffect(() => {
    setPage(0);
  }, [metric, fromSec, toSec, reloadKey]);

  useEffect(() => {
    if (!range) {
      setRows([]);
      setHasNext(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Xin dư 1 dòng để biết còn trang sau hay không.
    httpClient
      .getHistoryPage(metric, range.fromSec, range.toSec, PAGE_SIZE + 1, page * PAGE_SIZE)
      .then((data) => {
        if (cancelled) return;
        setHasNext(data.length > PAGE_SIZE);
        setRows(data.slice(0, PAGE_SIZE));
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setRows([]);
        setHasNext(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, fromSec, toSec, page, reloadKey]);

  const totalPages = totalCount && totalCount > 0 ? Math.ceil(totalCount / PAGE_SIZE) : undefined;
  const lastPage = totalPages ? totalPages - 1 : undefined;

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Table2 className="w-4 h-4 text-blue-600" />
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Bảng dữ liệu (cũ → mới)
          </h4>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          Đại lượng:
          <select
            value={metric}
            onChange={(e) => onMetricChange(e.target.value as HistoryMetricId)}
            className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 shadow-xs"
          >
            {HISTORY_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Không tải được bảng dữ liệu: {error}
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Thời điểm</th>
                <th className="text-right font-semibold px-3 py-2">
                  {meta.label}
                  {meta.unit ? ` (${meta.unit})` : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-4 text-center text-slate-500">
                    {loading ? 'Đang tải…' : 'Chưa có dữ liệu trong khoảng thời gian này'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.ts}-${r.value}`} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 text-slate-700">
                      {new Date(r.ts * 1000).toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold text-slate-900">
                      {Number(r.value).toFixed(meta.decimals)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 text-xs text-slate-600">
        <span>
          Trang {page + 1}
          {totalPages ? ` / ${totalPages}` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="p-1.5 rounded-lg bg-white border border-slate-200 shadow-xs disabled:opacity-40"
            title="Trang trước"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!hasNext || loading}
            onClick={() => setPage((p) => p + 1)}
            className="p-1.5 rounded-lg bg-white border border-slate-200 shadow-xs disabled:opacity-40"
            title="Trang sau"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={lastPage === undefined || page >= lastPage || loading}
            onClick={() => lastPage !== undefined && setPage(lastPage)}
            className="p-1.5 rounded-lg bg-white border border-slate-200 shadow-xs disabled:opacity-40"
            title="Trang cuối (dữ liệu mới nhất)"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

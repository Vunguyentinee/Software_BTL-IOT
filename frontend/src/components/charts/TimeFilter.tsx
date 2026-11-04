import React from 'react';
import { Clock, Calendar, Download, RefreshCw } from 'lucide-react';
import { TimeFilterRange } from '../../types/history';

interface TimeFilterProps {
  currentRange: TimeFilterRange;
  onRangeChange: (range: TimeFilterRange) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (val: string) => void;
  onEndDateChange: (val: string) => void;
  onRefresh: () => void;
  onExport: () => void;
}

export const TimeFilter: React.FC<TimeFilterProps> = ({
  currentRange,
  onRangeChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onRefresh,
  onExport,
}) => {
  const ranges: { id: TimeFilterRange; label: string }[] = [
    { id: '1h', label: '1 Giờ' },
    { id: '6h', label: '6 Giờ' },
    { id: '24h', label: '24 Giờ' },
    { id: '7d', label: '7 Ngày' },
    { id: 'custom', label: 'Tùy chọn' },
  ];

  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 mb-4">
      
      {/* NÚT CHỌN NHANH DẢI THỜI GIAN */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500 flex items-center gap-1 mr-1">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden sm:inline">Khung giờ:</span>
        </span>

        {ranges.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onRangeChange(r.id)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              currentRange === r.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 shadow-xs'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* DẢI TÙY CHỌN NGÀY GIỜ */}
      {currentRange === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
          <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-slate-500">Từ:</span>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="bg-transparent text-xs text-slate-800 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs">
            <span className="text-[11px] text-slate-500">Đến:</span>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="bg-transparent text-xs text-slate-800 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* NÚT REFRESH & EXPORT CSV */}
      <div className="flex items-center gap-2 self-end lg:self-auto">
        <button
          type="button"
          onClick={onRefresh}
          className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-xs transition-colors"
          title="Làm mới dữ liệu biểu đồ"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold shadow-xs transition-all active:scale-95"
        >
          <Download className="w-3.5 h-3.5 text-emerald-600" />
          <span>Xuất CSV</span>
        </button>
      </div>

    </div>
  );
};

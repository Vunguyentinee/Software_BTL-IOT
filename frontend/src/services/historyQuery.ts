import { TimeFilterRange } from '../types/history';

export type HistoryMetricId = 'temperature_c' | 'humidity_pct' | 'smoke_raw';

/** Ba metric mà backend hỗ trợ thống kê (`/api/history/stats`). */
export const HISTORY_METRICS: { id: HistoryMetricId; label: string; unit: string; decimals: number }[] = [
  { id: 'temperature_c', label: 'Nhiệt độ', unit: '°C', decimals: 1 },
  { id: 'humidity_pct', label: 'Độ ẩm', unit: '%', decimals: 1 },
  { id: 'smoke_raw', label: 'Khói/gas (ADC thô)', unit: '', decimals: 0 },
];

export interface TimeWindow {
  fromSec: number;
  toSec: number;
}

const QUICK_RANGE_SEC: Record<Exclude<TimeFilterRange, 'custom'>, number> = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
};

/**
 * Đổi bộ lọc thời gian của giao diện thành khoảng [từ, đến] tính bằng epoch giây.
 * Trả về null nếu khoảng tùy chọn không hợp lệ (sai định dạng hoặc Từ > Đến).
 */
export function resolveRange(
  range: TimeFilterRange,
  customStart?: string,
  customEnd?: string,
  nowMs: number = Date.now()
): TimeWindow | null {
  const nowSec = Math.floor(nowMs / 1000);
  if (range !== 'custom') {
    return { fromSec: nowSec - QUICK_RANGE_SEC[range], toSec: nowSec };
  }
  const fromSec = customStart ? Math.floor(new Date(customStart).getTime() / 1000) : nowSec - 12 * 3600;
  const toSec = customEnd ? Math.floor(new Date(customEnd).getTime() / 1000) : nowSec;
  if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || fromSec > toSec) return null;
  return { fromSec, toSec };
}

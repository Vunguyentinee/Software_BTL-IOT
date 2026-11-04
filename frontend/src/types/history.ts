export type TimeFilterRange = '1h' | '6h' | '24h' | '7d' | 'custom';

export interface HistoryDataPoint {
  timestamp: number;
  timeLabel: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  smoke_ppm: number;
  is_dark: boolean;
  motion_detected: boolean;
  fan_on: boolean;
  door_open: boolean;
  heat_alarm: boolean;
}

export interface CustomDateRange {
  startDate: string;
  endDate: string;
}


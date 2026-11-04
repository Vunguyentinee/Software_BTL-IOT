import { TimeFilterRange, HistoryDataPoint } from '../types/history';
import { ESP32Telemetry } from '../types/telemetry';
import { httpClient } from './api/httpClient';
import { resolveRange } from './historyQuery';

export class HistoryDataService {
  private liveBuffer: HistoryDataPoint[] = [];

  constructor() {
    this.initRecentBuffer();
  }

  private initRecentBuffer() {
    const now = Date.now();
    for (let i = 20; i >= 0; i--) {
      const time = now - i * 2000;
      const date = new Date(time);
      const timeLabel = date.toTimeString().split(' ')[0];
      this.liveBuffer.push({
        timestamp: time,
        timeLabel,
        temperature_c: +(29.0 + Math.sin(i / 3) * 1.5).toFixed(1),
        humidity_pct: +(65.0 + Math.cos(i / 3) * 3).toFixed(1),
        smoke_ppm: Math.floor(80 + Math.sin(i / 2) * 20),
        is_dark: false,
        motion_detected: i % 7 === 0,
        fan_on: false,
        door_open: i % 7 === 0,
        heat_alarm: false,
      });
    }
  }

  public appendLivePoint(telemetry: ESP32Telemetry) {
    const now = telemetry.timestamp || Date.now();
    const timeLabel = new Date(now).toTimeString().split(' ')[0];

    const point: HistoryDataPoint = {
      timestamp: now,
      timeLabel,
      temperature_c: telemetry.temperature_c,
      humidity_pct: telemetry.humidity_pct,
      smoke_ppm: telemetry.smoke_ppm,
      is_dark: telemetry.is_dark,
      motion_detected: telemetry.motion_detected,
      fan_on: telemetry.fan_on,
      door_open: telemetry.door_command === 'open',
      heat_alarm: telemetry.heat_alarm,
    };

    this.liveBuffer.push(point);
    if (this.liveBuffer.length > 120) {
      this.liveBuffer.shift();
    }
  }

  /**
   * Lấy dữ liệu lịch sử từ Backend FastAPI (/api/history)
   * Tự động fallback sang simulated data nếu backend không có dữ liệu hoặc offline
   */
  public async fetchHistory(
    range: TimeFilterRange,
    customStart?: string,
    customEnd?: string
  ): Promise<HistoryDataPoint[]> {
    const span = resolveRange(range, customStart, customEnd);
    if (!span) return [];
    const { fromSec, toSec } = span;

    try {
      // Fetch các metrics từ Backend
      const [tempRes, humRes, smokeRes] = await Promise.allSettled([
        httpClient.getHistory('temperature_c', fromSec, toSec),
        httpClient.getHistory('humidity_pct', fromSec, toSec),
        httpClient.getHistory('smoke_raw', fromSec, toSec),
      ]);

      const tempData = tempRes.status === 'fulfilled' ? tempRes.value : [];
      const humData = humRes.status === 'fulfilled' ? humRes.value : [];
      const smokeData = smokeRes.status === 'fulfilled' ? smokeRes.value : [];

      // Backend phản hồi được nhưng chưa có điểm nào: hiển thị rỗng, không thay bằng số liệu mô phỏng
      if (tempRes.status === 'fulfilled' && tempData.length === 0) {
        return [];
      }

      if (tempData.length > 0) {
        // Gom các điểm theo timestamp
        const timeMap = new Map<number, Partial<HistoryDataPoint>>();

        for (const item of tempData) {
          const tMs = Math.round(item.ts * 1000);
          timeMap.set(tMs, {
            timestamp: tMs,
            timeLabel: new Date(tMs).toLocaleTimeString('vi-VN'),
            temperature_c: item.value,
          });
        }

        for (const item of humData) {
          const tMs = Math.round(item.ts * 1000);
          const current = timeMap.get(tMs) || {
            timestamp: tMs,
            timeLabel: new Date(tMs).toLocaleTimeString('vi-VN'),
          };
          current.humidity_pct = item.value;
          timeMap.set(tMs, current);
        }

        for (const item of smokeData) {
          const tMs = Math.round(item.ts * 1000);
          const current = timeMap.get(tMs) || {
            timestamp: tMs,
            timeLabel: new Date(tMs).toLocaleTimeString('vi-VN'),
          };
          current.smoke_ppm = Math.round((item.value / 4095) * 800);
          timeMap.set(tMs, current);
        }

        const sortedPoints: HistoryDataPoint[] = Array.from(timeMap.values())
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          .map((p) => ({
            timestamp: p.timestamp || Date.now(),
            timeLabel: p.timeLabel || '',
            temperature_c: p.temperature_c ?? null,
            humidity_pct: p.humidity_pct ?? null,
            smoke_ppm: p.smoke_ppm ?? 80,
            is_dark: false,
            motion_detected: false,
            fan_on: (p.temperature_c ?? 0) >= 35,
            door_open: false,
            heat_alarm: (p.temperature_c ?? 0) >= 40,
          }));

        if (sortedPoints.length > 0) {
          return sortedPoints;
        }
      }
    } catch {
      // Backend offline hoặc gặp lỗi mạng -> dùng fallback bên dưới
    }

    return this.getHistoryData(range, customStart, customEnd);
  }

  public getHistoryData(range: TimeFilterRange, customStart?: string, customEnd?: string): HistoryDataPoint[] {
    const now = Date.now();

    if (range === '1h') {
      return this.generateSeries(30, 2 * 60 * 1000, now);
    } else if (range === '6h') {
      return this.generateSeries(36, 10 * 60 * 1000, now);
    } else if (range === '24h') {
      return this.generateSeries(48, 30 * 60 * 1000, now);
    } else if (range === '7d') {
      return this.generateSeries(56, 3 * 3600 * 1000, now);
    } else if (range === 'custom') {
      const startMs = customStart ? new Date(customStart).getTime() : now - 12 * 3600 * 1000;
      const endMs = customEnd ? new Date(customEnd).getTime() : now;
      const count = 40;
      const interval = Math.max(60000, (endMs - startMs) / count);
      return this.generateSeries(count, interval, endMs);
    }

    return this.liveBuffer;
  }

  private generateSeries(count: number, intervalMs: number, endMs: number): HistoryDataPoint[] {
    const points: HistoryDataPoint[] = [];

    for (let i = count - 1; i >= 0; i--) {
      const timestamp = endMs - i * intervalMs;
      const date = new Date(timestamp);

      let timeLabel = '';
      if (intervalMs >= 86400000 || intervalMs >= 3600000) {
        timeLabel = `${date.getDate()}/${date.getMonth() + 1} ${date.getHours()}:00`;
      } else {
        timeLabel = date.toTimeString().split(' ')[0].substring(0, 5);
      }

      const hour = date.getHours();
      const baseTemp = 27 + Math.sin(((hour - 8) / 24) * 2 * Math.PI) * 7;
      const noise = Math.sin(i * 1.7) * 1.2;
      const temp = +(baseTemp + noise).toFixed(1);
      const hum = +(85 - (temp - 24) * 3 + Math.cos(i) * 2).toFixed(1);
      const smoke = Math.floor(70 + Math.abs(Math.sin(i / 4)) * 90 + (i === 15 ? 180 : 0));
      const isDark = hour < 6 || hour > 18;
      const fanOn = temp >= 35.0;
      const heatAlarm = temp >= 40.0;
      const motion = Math.sin(i * 3) > 0.6;
      const doorOpen = motion && !heatAlarm;

      points.push({
        timestamp,
        timeLabel,
        temperature_c: temp,
        humidity_pct: Math.min(95, Math.max(30, hum)),
        smoke_ppm: smoke,
        is_dark: isDark,
        motion_detected: motion,
        fan_on: fanOn,
        door_open: doorOpen,
        heat_alarm: heatAlarm,
      });
    }

    return points;
  }

  public exportToCSV(data: HistoryDataPoint[]) {
    const headers = [
      'Thoi_Gian',
      'Nhiet_Do_C',
      'Do_Am_Pct',
      'Khoi_PPM',
      'Troi_Toi',
      'PIR_Chuyen_Dong',
      'Quat_Bat',
      'Cua_Mo',
      'Canh_Bao_Nhiet',
    ];

    const rows = data.map((d) => [
      new Date(d.timestamp).toLocaleString('vi-VN'),
      d.temperature_c ?? 'ERR',
      d.humidity_pct ?? 'ERR',
      d.smoke_ppm,
      d.is_dark ? 'CO' : 'KHONG',
      d.motion_detected ? '1' : '0',
      d.fan_on ? 'ON' : 'OFF',
      d.door_open ? 'MO' : 'DONG',
      d.heat_alarm ? 'BAO_DONG' : 'BINH_THUONG',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ESP32_Lich_Su_Cam_Bien_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const historyService = new HistoryDataService();

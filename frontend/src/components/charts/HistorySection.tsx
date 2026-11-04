import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LineChart as ChartIcon } from 'lucide-react';
import { TimeFilter } from './TimeFilter';
import { HistoryCharts } from './HistoryCharts';
import { TimeFilterRange, HistoryDataPoint } from '../../types/history';
import { historyService } from '../../services/historyData';
import { ESP32Telemetry } from '../../types/telemetry';
import { BackendHistoryStats } from '../../types/api';
import { backendService } from '../../services/backendService';
import { httpClient } from '../../services/api/httpClient';
import { HISTORY_METRICS, HistoryMetricId, resolveRange } from '../../services/historyQuery';
import { HistoryStats } from './HistoryStats';
import { HistoryTable } from './HistoryTable';

interface HistorySectionProps {
  telemetry: ESP32Telemetry;
}

export const HistorySection: React.FC<HistorySectionProps> = ({ telemetry }) => {
  const [currentRange, setCurrentRange] = useState<TimeFilterRange>('1h');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [chartData, setChartData] = useState<HistoryDataPoint[]>([]);
  const [connected, setConnected] = useState<boolean>(backendService.getStatus().isServerConnected);
  const [metric, setMetric] = useState<HistoryMetricId>('temperature_c');
  const [reloadKey, setReloadKey] = useState(0);
  const [stats, setStats] = useState<Record<HistoryMetricId, BackendHistoryStats> | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => backendService.subscribeStatus((s) => setConnected(s.isServerConnected)), []);

  // Khoảng thời gian dùng chung cho thống kê, bảng dữ liệu và xuất CSV (tính lại khi đổi bộ lọc hoặc làm mới)
  const timeWindow = useMemo(
    () => resolveRange(currentRange, startDate, endDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRange, startDate, endDate, reloadKey]
  );

  useEffect(() => {
    if (!connected || !timeWindow) {
      setStats(null);
      setStatsError(null);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    setStatsError(null);
    Promise.all(HISTORY_METRICS.map((m) => httpClient.getHistoryStats(m.id, timeWindow.fromSec, timeWindow.toSec)))
      .then((results) => {
        if (cancelled) return;
        setStats({
          temperature_c: results[0],
          humidity_pct: results[1],
          smoke_raw: results[2],
        });
      })
      .catch((e: Error) => {
        if (!cancelled) setStatsError(e.message);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, timeWindow]);

  // Tải dữ liệu theo dải thời gian (ưu tiên từ Backend qua /api/history)
  const loadData = useCallback(async () => {
    const data = await historyService.fetchHistory(currentRange, startDate, endDate);
    setChartData(data);
  }, [currentRange, startDate, endDate]);

  // Cập nhật khi đổi bộ lọc
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Nhận dữ liệu stream thời gian thực
  useEffect(() => {
    historyService.appendLivePoint(telemetry);
    // Nếu đang ở khung xem 1h, thêm điểm mới vào cuối biểu đồ
    if (currentRange === '1h') {
      setChartData((prev) => {
        const now = telemetry.timestamp || Date.now();
        const timeLabel = new Date(now).toTimeString().split(' ')[0];
        const newPoint: HistoryDataPoint = {
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
        const updated = [...prev, newPoint];
        if (updated.length > 40) updated.shift();
        return updated;
      });
    }
  }, [telemetry, currentRange]);

  const handleRefresh = () => {
    loadData();
    setReloadKey((k) => k + 1);
  };

  const metricLabel = HISTORY_METRICS.find((m) => m.id === metric)!.label;

  const handleExport = () => {
    if (connected && timeWindow) {
      // Tải trực tiếp từ database qua backend: file CSV (ts,value) của đại lượng đang chọn
      const link = document.createElement('a');
      link.href = httpClient.getHistoryCsvUrl(metric, timeWindow.fromSec, timeWindow.toSec);
      link.download = `${metric}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    // Chưa có backend (chế độ mô phỏng): xuất từ dữ liệu đang hiển thị trên biểu đồ
    historyService.exportToCSV(chartData);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
      {/* HEADER */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200">
          <ChartIcon className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Biểu Đồ Lịch Sử Môi Trường & Sự Kiện (Time-Series Monitoring)
          </h3>
          <p className="text-xs text-slate-500">
            Theo dõi xu hướng nhiệt độ, độ ẩm, nồng độ khói và tương quan đóng/mở quạt, cửa theo thời gian
          </p>
        </div>
      </div>

      {/* BỘ LỌC THỜI GIAN (TIME FILTER) */}
      <TimeFilter
        currentRange={currentRange}
        onRangeChange={setCurrentRange}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onRefresh={handleRefresh}
        onExport={handleExport}
        exportLabel={connected ? metricLabel : undefined}
      />

      {/* BIỂU ĐỒ RECHARTS */}
      <HistoryCharts data={chartData} thresholds={telemetry.thresholds} />

      {/* THỐNG KÊ VÀ BẢNG DỮ LIỆU TỪ DATABASE (chỉ khi đã kết nối backend) */}
      {connected ? (
        timeWindow ? (
          <>
            <HistoryStats stats={stats} loading={statsLoading} error={statsError} />
            <HistoryTable
              metric={metric}
              onMetricChange={setMetric}
              window={timeWindow}
              reloadKey={reloadKey}
              totalCount={stats?.[metric]?.count}
            />
          </>
        ) : (
          <p className="mt-5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Khoảng thời gian không hợp lệ: ngày bắt đầu phải trước ngày kết thúc.
          </p>
        )
      ) : (
        <p className="mt-5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Chưa kết nối backend: thống kê và bảng dữ liệu từ database chỉ hiển thị khi hệ thống đang chạy.
        </p>
      )}
    </div>
  );
};

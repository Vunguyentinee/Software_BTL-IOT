import React, { useState, useEffect, useCallback } from 'react';
import { LineChart as ChartIcon } from 'lucide-react';
import { TimeFilter } from './TimeFilter';
import { HistoryCharts } from './HistoryCharts';
import { TimeFilterRange, HistoryDataPoint } from '../../types/history';
import { historyService } from '../../services/historyData';
import { ESP32Telemetry } from '../../types/telemetry';

interface HistorySectionProps {
  telemetry: ESP32Telemetry;
}

export const HistorySection: React.FC<HistorySectionProps> = ({ telemetry }) => {
  const [currentRange, setCurrentRange] = useState<TimeFilterRange>('1h');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [chartData, setChartData] = useState<HistoryDataPoint[]>([]);

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

  const handleExport = () => {
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
        onRefresh={loadData}
        onExport={handleExport}
      />

      {/* BIỂU ĐỒ RECHARTS */}
      <HistoryCharts data={chartData} thresholds={telemetry.thresholds} />
    </div>
  );
};

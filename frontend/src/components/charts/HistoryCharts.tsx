import React, { useState } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine,
  Legend 
} from 'recharts';
import { HistoryDataPoint } from '../../types/history';
import { DeviceThresholds } from '../../types/telemetry';
import { Thermometer, Flame, BarChart2 } from 'lucide-react';

interface HistoryChartsProps {
  data: HistoryDataPoint[];
  thresholds?: DeviceThresholds;
}

export const HistoryCharts: React.FC<HistoryChartsProps> = ({ data, thresholds }) => {
  const fanOnTemp = thresholds?.fan_on_temp ?? 35;
  const heatAlarmTemp = thresholds?.heat_alarm_on_temp ?? 40;
  const smokeAlarmPpm = thresholds?.smoke_alarm_ppm ?? 300;

  const [activeTab, setActiveTab] = useState<'temp_hum' | 'smoke_motion'>('temp_hum');

  // Custom Tooltip cho Biểu đồ Nhiệt độ & Độ ẩm
  const CustomTempHumTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const p = payload[0].payload as HistoryDataPoint;
      return (
        <div className="bg-white/95 border border-slate-200 p-3 rounded-xl shadow-lg text-xs backdrop-blur-md text-slate-800">
          <div className="font-semibold text-slate-700 border-b border-slate-100 pb-1 mb-2">
            Thời điểm: <span className="font-mono text-blue-600 font-bold">{label}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-orange-600 font-medium flex items-center gap-1">
                ● Nhiệt độ:
              </span>
              <span className="font-bold text-orange-700 font-mono">
                {p.temperature_c !== null ? `${p.temperature_c.toFixed(1)} °C` : 'Lỗi'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-cyan-600 font-medium flex items-center gap-1">
                ● Độ ẩm:
              </span>
              <span className="font-bold text-cyan-700 font-mono">
                {p.humidity_pct !== null ? `${p.humidity_pct.toFixed(1)} %` : 'Lỗi'}
              </span>
            </div>
            <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>Trạng thái Quạt:</span>
              <span className={`font-semibold ${p.fan_on ? 'text-blue-600' : 'text-slate-400'}`}>
                {p.fan_on ? 'BẬT (Làm mát)' : 'TẮT'}
              </span>
            </div>
            {p.heat_alarm && (
              <div className="text-[10px] text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200 text-center">
                🚨 ĐANG CẢNH BÁO NHIỆT ĐỘ CAO
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  // Custom Tooltip cho Biểu đồ Khói & Chuyển động
  const CustomSmokeTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const p = payload[0].payload as HistoryDataPoint;
      return (
        <div className="bg-white/95 border border-slate-200 p-3 rounded-xl shadow-lg text-xs backdrop-blur-md text-slate-800">
          <div className="font-semibold text-slate-700 border-b border-slate-100 pb-1 mb-2">
            Thời điểm: <span className="font-mono text-purple-600 font-bold">{label}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-purple-600 font-medium flex items-center gap-1">
                ● Nồng độ Khói:
              </span>
              <span className="font-bold text-purple-700 font-mono">
                {p.smoke_ppm} PPM
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-emerald-600 font-medium flex items-center gap-1">
                ● Cảm biến PIR:
              </span>
              <span className="font-bold text-emerald-700">
                {p.motion_detected ? 'Có người' : 'Không có'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-blue-600 font-medium flex items-center gap-1">
                ● Cửa Servo:
              </span>
              <span className="font-bold text-blue-700">
                {p.door_open ? 'Mở (90°)' : 'Đóng (0°)'}
              </span>
            </div>
            {p.smoke_ppm >= 300 && (
              <div className="text-[10px] text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200 text-center">
                🔥 VƯỢT NGƯỠNG NGUY HIỂM 300 PPM
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="mt-4">
      
      {/* TABS SELECTOR */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3 mb-4">
        <div className="flex items-center p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setActiveTab('temp_hum')}
            className={`flex items-center gap-2 py-1.5 px-3 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'temp_hum'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Thermometer className="w-4 h-4 text-orange-500" />
            <span>Nhiệt độ & Độ ẩm (2 Trục Y)</span>
          </button>

          <button
            onClick={() => setActiveTab('smoke_motion')}
            className={`flex items-center gap-2 py-1.5 px-3 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'smoke_motion'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Flame className="w-4 h-4 text-purple-500" />
            <span>Nồng độ Khói & PIR</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-orange-500 rounded-full"></span> Ngưỡng Quạt ({fanOnTemp}°C)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-rose-500 rounded-full"></span> Báo Động ({heatAlarmTemp}°C)
          </span>
        </div>
      </div>

      {/* BIỂU ĐỒ 1: NHIỆT ĐỘ & ĐỘ ẨM */}
      {activeTab === 'temp_hum' && (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis 
                dataKey="timeLabel" 
                stroke="#94a3b8" 
                fontSize={11} 
                tickLine={false}
              />
              {/* Trục Y trái: Nhiệt độ */}
              <YAxis 
                yAxisId="left" 
                domain={[20, Math.max(50, heatAlarmTemp + 5)]} 
                stroke="#ea580c" 
                fontSize={11} 
                tickLine={false}
                unit="°C"
              />
              {/* Trục Y phải: Độ ẩm */}
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                domain={[20, 100]} 
                stroke="#0284c7" 
                fontSize={11} 
                tickLine={false}
                unit="%"
              />
              <Tooltip content={<CustomTempHumTooltip />} />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />

              {/* Ngưỡng tham chiếu bật quạt */}
              <ReferenceLine 
                yAxisId="left" 
                y={fanOnTemp} 
                stroke="#f97316" 
                strokeDasharray="4 4" 
                label={{ value: `Bật Quạt (${fanOnTemp}°C)`, fill: '#c2410c', fontSize: 10, position: 'insideTopLeft' }} 
              />

              {/* Ngưỡng tham chiếu báo động nhiệt */}
              <ReferenceLine 
                yAxisId="left" 
                y={heatAlarmTemp} 
                stroke="#ef4444" 
                strokeDasharray="4 4" 
                label={{ value: `Báo Động (${heatAlarmTemp}°C)`, fill: '#b91c1c', fontSize: 10, position: 'insideTopLeft' }} 
              />

              {/* Đường Nhiệt độ */}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="temperature_c"
                name="Nhiệt độ (°C)"
                stroke="#ea580c"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#ea580c' }}
              />

              {/* Đường Độ ẩm */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="humidity_pct"
                name="Độ ẩm (%)"
                stroke="#0284c7"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: '#0284c7' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* BIỂU ĐỒ 2: NỒNG ĐỘ KHÓI */}
      {activeTab === 'smoke_motion' && (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="smokeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis 
                dataKey="timeLabel" 
                stroke="#94a3b8" 
                fontSize={11} 
                tickLine={false}
              />
              <YAxis 
                domain={[0, 500]} 
                stroke="#7c3aed" 
                fontSize={11} 
                tickLine={false}
                unit=" PPM"
              />
              <Tooltip content={<CustomSmokeTooltip />} />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />

              {/* Ngưỡng tham chiếu báo khói */}
              <ReferenceLine 
                y={smokeAlarmPpm} 
                stroke="#ef4444" 
                strokeDasharray="4 4" 
                label={{ value: `Nguy cơ Cháy (${smokeAlarmPpm} PPM)`, fill: '#b91c1c', fontSize: 10, position: 'insideTopLeft' }} 
              />

              <Area 
                type="monotone" 
                dataKey="smoke_ppm" 
                name="Nồng độ Khói (PPM)" 
                stroke="#7c3aed" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#smokeGradient)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 px-1">
        <span className="flex items-center gap-1">
          <BarChart2 className="w-3.5 h-3.5 text-slate-400" />
          <span>Biểu đồ tự động cập nhật luồng thời gian thực từ ESP32</span>
        </span>
        <span className="font-medium">Khoảng thời gian: {data.length} mẫu đo</span>
      </div>

    </div>
  );
};

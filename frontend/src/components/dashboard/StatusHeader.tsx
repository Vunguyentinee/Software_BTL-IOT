import React from 'react';
import { 
  Wifi, 
  WifiOff, 
  Cpu, 
  Clock, 
  Server,
  RefreshCw,
  Settings2
} from 'lucide-react';
import { SystemMode, ScenarioType } from '../../types/telemetry';
import { BackendSim } from '../../types/api';

interface StatusHeaderProps {
  systemMode: SystemMode;
  onModeChange: (mode: SystemMode) => void;
  uptimeMs: number;
  isOnline: boolean;
  lastUpdated: number;
  currentScenario: ScenarioType;
  onScenarioChange: (scenario: ScenarioType) => void;
  onOpenConfig: () => void;
  isServerConnected?: boolean;
  /** ESP32 giả lập đang chạy qua backend: ô Kịch bản điều khiển nó thay vì mô phỏng trong trình duyệt */
  sim?: BackendSim;
  onSimScenarioChange?: (scenarioId: string) => void;
}

export const StatusHeader: React.FC<StatusHeaderProps> = ({
  systemMode,
  onModeChange,
  uptimeMs,
  isOnline,
  lastUpdated,
  currentScenario,
  onScenarioChange,
  onOpenConfig,
  isServerConnected = false,
  sim,
  onSimScenarioChange,
}) => {
  // Chuyển đổi uptime_ms sang chuỗi dễ đọc
  const formatUptime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    return `${minutes}m ${seconds}s`;
  };

  return (
    <header className="bg-white/95 border-b border-slate-200 sticky top-0 z-40 backdrop-blur-md shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Logo & Device Name */}
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-600 rounded-lg shadow-xs text-white">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                  ESP32 Smart Home Monitor
                </h1>
              </div>
            </div>
          </div>

          {/* Quick Metrics & Controls */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            
            {/* Backend Server Status Badge */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                isServerConnected
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-slate-100 border-slate-200 text-slate-600'
              }`}
              title={isServerConnected ? 'Đã kết nối Backend FastAPI qua WebSocket' : 'Backend offline - Chạy chế độ mô phỏng Mock'}
            >
              <Server className="w-3.5 h-3.5" />
              <span>{isServerConnected ? 'Backend Online' : 'Backend Offline'}</span>
            </div>

            {/* ESP32 Connection Status Badge */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              isOnline 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}>
              {isOnline ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <Wifi className="w-3.5 h-3.5 ml-0.5 text-emerald-600" />
                  <span>ESP32 Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                  <span>ESP32 Offline</span>
                </>
              )}
            </div>

            {/* Uptime & Last Updated */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100/90 border border-slate-200 text-xs text-slate-700">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-500">Uptime:</span>
              <span className="font-mono font-medium text-slate-800">
                {isOnline ? formatUptime(uptimeMs) : '--:--'}
              </span>
              <span className="text-slate-300 mx-0.5">•</span>
              <span className="text-slate-500 font-mono text-[11px]">
                {new Date(lastUpdated).toLocaleTimeString('vi-VN')}
              </span>
            </div>

            {/* Mode Switcher (Auto / Manual) */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => onModeChange('auto')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  systemMode === 'auto'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Hệ thống tự động vận hành theo logic cảm biến tại ESP32"
              >
                <span>Tự động (Auto)</span>
              </button>
              <button
                type="button"
                onClick={() => onModeChange('manual')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  systemMode === 'manual'
                    ? 'bg-white text-amber-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Cho phép người dùng trực tiếp bật/tắt thiết bị từ giao diện web"
              >
                <span>Thủ công (Manual)</span>
              </button>
            </div>

            {/* Configuration Button */}
            <button
              type="button"
              onClick={onOpenConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 text-xs font-semibold transition-all active:scale-95 shadow-xs cursor-pointer"
              title="Cài đặt ngưỡng nhiệt độ & khói"
            >
              <Settings2 className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Cấu hình ngưỡng</span>
            </button>

            {/* Scenario Demo Dropdown (Mô phỏng kiểm thử) */}
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
              <RefreshCw className="w-3 h-3 text-slate-500" />
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                {sim?.active ? 'Kịch bản ESP32 giả lập:' : 'Kịch bản:'}
              </span>
              {sim?.active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="ESP32 giả lập đang chạy" />}
              {sim?.active ? (
                <select
                  value={sim.scenario ?? ''}
                  onChange={(e) => onSimScenarioChange?.(e.target.value)}
                  className="bg-transparent text-xs text-blue-700 font-medium focus:outline-none cursor-pointer"
                >
                  {sim.scenarios.map((sc, i) => (
                    <option key={sc.id} value={sc.id} className="bg-white text-slate-800">
                      {i + 1}. {sc.label}
                    </option>
                  ))}
                </select>
              ) : (
              <select
                value={currentScenario}
                onChange={(e) => onScenarioChange(e.target.value as ScenarioType)}
                className="bg-transparent text-xs text-blue-700 font-medium focus:outline-none cursor-pointer"
              >
                <option value="normal" className="bg-white text-slate-800">1. Bình thường (29°C)</option>
                <option value="cooling_fan" className="bg-white text-slate-800">2. Nóng ≥35°C (Bật quạt)</option>
                <option value="heat_alarm" className="bg-white text-slate-800">3. Báo động ≥40°C (Còi+LED3)</option>
                <option value="smoke_danger" className="bg-white text-slate-800">4. Báo cháy khói (&gt;300PPM)</option>
                <option value="motion_door" className="bg-white text-slate-800">5. Người về (Mở cửa+LED2)</option>
                <option value="dark_light" className="bg-white text-slate-800">6. Trời tối (Bật LED1)</option>
                <option value="pir_warming_up" className="bg-white text-slate-800">7. PIR warm-up 60s</option>
                <option value="dht_error" className="bg-white text-slate-800">8. Lỗi cảm biến DHT11</option>
                <option value="esp32_offline" className="bg-white text-slate-800">9. Mất kết nối (Offline)</option>
              </select>
              )}
            </div>

          </div>

        </div>
      </div>
    </header>
  );
};

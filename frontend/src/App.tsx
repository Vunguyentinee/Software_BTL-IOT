import React, { useState, useEffect } from 'react';
import { StatusHeader } from './components/dashboard/StatusHeader';
import { AlertBanner } from './components/dashboard/AlertBanner';
import { MetricCardsGrid } from './components/dashboard/MetricCard';
import { LCDSimulator } from './components/dashboard/LCDSimulator';
import { JsonTelemetryViewer } from './components/dashboard/JsonTelemetryViewer';
import { ControlPanel } from './components/control/ControlPanel';
import { CommandLogTable } from './components/control/CommandLogTable';
import { ActivityLog } from './components/dashboard/ActivityLog';
import { activityLog } from './services/activityLog';
import { HistorySection } from './components/charts/HistorySection';
import { ThresholdModal } from './components/config/ThresholdModal';
import { backendService, BackendConnectionStatus } from './services/backendService';
import { mockService } from './services/mockData';
import { ESP32Telemetry, SystemMode, ScenarioType, DeviceThresholds } from './types/telemetry';
import { BackendSim } from './types/api';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const App: React.FC = () => {
  const [telemetry, setTelemetry] = useState<ESP32Telemetry>(backendService.getCurrentTelemetry());
  const [currentScenario, setCurrentScenario] = useState<ScenarioType>('normal');
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [appToast, setAppToast] = useState<{ message: string; isError?: boolean } | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendConnectionStatus>(backendService.getStatus());
  const [sim, setSim] = useState<BackendSim>(backendService.getSim());

  useEffect(() => backendService.subscribeSim(setSim), []);

  // 1. Khởi tạo BackendService (WebSocket & HTTP state)
  useEffect(() => {
    backendService.init();

    const unsubscribeStatus = backendService.subscribeStatus((status) => {
      setBackendStatus(status);
    });

    return () => {
      unsubscribeStatus();
    };
  }, []);

  // 2. Đăng ký luồng Telemetry: Ưu tiên Backend nếu online, fallback sang mockService
  useEffect(() => {
    activityLog.resetBaseline(); // đổi nguồn dữ liệu: bản telemetry kế tiếp chỉ làm mốc so sánh
    if (backendStatus.isServerConnected) {
      const unsubscribe = backendService.subscribe((newTelemetry) => {
        setTelemetry(newTelemetry);
        // Chưa có dữ liệu thật từ ESP32 thì chưa ghi nhật ký (tránh coi giá trị khởi tạo là thay đổi)
        if (backendService.getStatus().isESP32Online) activityLog.observeTelemetry(newTelemetry);
      });
      return () => unsubscribe();
    } else {
      const unsubscribe = mockService.subscribe((newTelemetry) => {
        setTelemetry(newTelemetry);
        activityLog.observeTelemetry(newTelemetry);
      });
      return () => unsubscribe();
    }
  }, [backendStatus.isServerConnected]);

  // Mất / khôi phục kết nối ESP32 (chỉ sau khi đã nhận trạng thái đầu tiên từ backend)
  useEffect(() => {
    if (backendStatus.isServerConnected && backendStatus.lastSeen !== null) {
      activityLog.observeConnection(backendStatus.isESP32Online);
    }
  }, [backendStatus]);

  const handleModeChange = async (newMode: SystemMode) => {
    try {
      if (backendStatus.isServerConnected) {
        await backendService.setSystemMode(newMode);
        setAppToast({
          message: `Đã chuyển hệ thống sang chế độ ${newMode === 'auto' ? 'TỰ ĐỘNG' : 'THỦ CÔNG'} trên Backend!`,
        });
      } else {
        mockService.setSystemMode(newMode);
      }
    } catch (err: any) {
      setAppToast({
        message: err?.message || 'Không thể chuyển chế độ vận hành',
        isError: true,
      });
    }
  };

  // Có ESP32 giả lập đang chạy: đổi kịch bản của nó (qua backend), trạng thái mới về qua WebSocket
  const handleSimScenarioChange = async (scenarioId: string) => {
    const label = sim.scenarios.find((s) => s.id === scenarioId)?.label ?? scenarioId;
    try {
      await backendService.setSimScenario(scenarioId);
      setAppToast({ message: `Đã gửi kịch bản "${label}" tới ESP32 giả lập.` });
    } catch (err: any) {
      setAppToast({
        message: err?.message === 'simulator_not_active'
          ? 'ESP32 giả lập không còn chạy. Bật bằng: docker compose --profile sim up -d'
          : err?.message || 'Không đổi được kịch bản',
        isError: true,
      });
    }
  };

  const handleScenarioChange = (scenario: ScenarioType) => {
    setCurrentScenario(scenario);
    mockService.setScenario(scenario);
    if (backendStatus.isServerConnected) {
      setAppToast({
        message: 'Lưu ý: Bạn đang kết nối Backend thực tế. Kịch bản mô phỏng chỉ tác động khi Backend ngắt kết nối.',
      });
    }
  };

  const handleSaveThresholds = async (newThresholds: DeviceThresholds) => {
    try {
      if (backendStatus.isServerConnected) {
        await backendService.updateThresholds(newThresholds);
        setAppToast({
          message: 'Đã lưu và đồng bộ ngưỡng vận hành xuống Backend FastAPI & ESP32 MQTT!',
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
        mockService.updateThresholds(newThresholds);
        setAppToast({
          message: '[Mô phỏng] Đã lưu và đồng bộ cấu hình ngưỡng mới!',
        });
      }
    } catch (err: any) {
      setAppToast({
        message: err?.message || 'Lỗi khi lưu cấu hình ngưỡng',
        isError: true,
      });
      throw err;
    } finally {
      setTimeout(() => setAppToast(null), 4500);
    }
  };

  // Xác định trạng thái online:
  // Nếu server connected: dùng trạng thái ESP32 online từ backend
  // Nếu server offline: dùng logic theo scenario của mock simulator
  const isOnline = backendStatus.isServerConnected
    ? backendStatus.isESP32Online
    : currentScenario !== 'esp32_offline';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans antialiased">
      {/* 1. STATUS HEADER */}
      <StatusHeader
        systemMode={telemetry.system_mode}
        onModeChange={handleModeChange}
        uptimeMs={telemetry.uptime_ms}
        isOnline={isOnline}
        isServerConnected={backendStatus.isServerConnected}
        lastUpdated={telemetry.timestamp}
        currentScenario={currentScenario}
        onScenarioChange={handleScenarioChange}
        sim={sim}
        onSimScenarioChange={handleSimScenarioChange}
        onOpenConfig={() => setIsConfigOpen(true)}
      />

      {/* TOAST SYSTEM NOTIFICATION */}
      {appToast && (
        <div
          className={`fixed top-16 right-4 z-50 p-4 rounded-xl border text-xs shadow-xl flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 ${
            appToast.isError
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-white border-emerald-200 text-emerald-800'
          }`}
        >
          {appToast.isError ? (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          <span className="font-medium">{appToast.message}</span>
          <button
            onClick={() => setAppToast(null)}
            className="ml-2 text-slate-400 hover:text-slate-600 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 2. CẢNH BÁO KHẨN CẤP & LỖI CẢM BIẾN */}
        <AlertBanner telemetry={telemetry} />

        {/* 3. 4 CARD CHỈ SỐ MÔI TRƯỜNG CHÍNH */}
        <MetricCardsGrid telemetry={telemetry} />

        {/* 4. GIAI ĐOẠN 3: BẢNG ĐIỀU KHIỂN THIẾT BỊ CHẤP HÀNH (CONTROL PANEL) */}
        <ControlPanel
          telemetry={telemetry}
          onSwitchToManual={() => handleModeChange('manual')}
        />

        {/* 5. GIAI ĐOẠN 4: BIỂU ĐỒ LỊCH SỬ & BỘ LỌC THỜI GIAN (HISTORY CHARTS & TIME FILTER) */}
        <HistorySection telemetry={telemetry} />

        {/* 6. MÔ PHỎNG LCD 16X2 & TỔNG QUAN NGOẠI VI VẬT LÝ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LCDSimulator telemetry={telemetry} />
          <JsonTelemetryViewer telemetry={telemetry} />
        </div>

        {/* 7. NHẬT KÝ THỰC THI LỆNH (COMMAND ACK LOG) */}
        <ActivityLog live={backendStatus.isServerConnected} />
        <CommandLogTable />
      </main>

      {/* MODAL CẤU HÌNH NGƯỠNG */}
      <ThresholdModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        currentThresholds={telemetry.thresholds}
        onSave={handleSaveThresholds}
      />
    </div>
  );
};

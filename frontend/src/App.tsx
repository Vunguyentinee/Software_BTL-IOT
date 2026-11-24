import React, { useState, useEffect, useCallback } from 'react';
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
import { SmartHouseScene } from './components/SmartHouseScene';
import { ControlDashboard } from './components/ControlDashboard';
import { backendService, BackendConnectionStatus } from './services/backendService';
import { mockService } from './services/mockData';
import { mqttService, MqttConnectionStatus } from './services/mqttService';
import { ESP32Telemetry, SystemMode, ScenarioType, DeviceThresholds } from './types/telemetry';
import { BackendSim } from './types/api';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { httpClient } from './services/api/httpClient';

type AppTab = '3d' | 'dashboard';

export const App: React.FC = () => {
  const [telemetry, setTelemetry] = useState<ESP32Telemetry>(mockService.getCurrentTelemetry());
  const [currentScenario, setCurrentScenario] = useState<ScenarioType>('normal');
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<AppTab>('3d');
  const [appToast, setAppToast] = useState<{ message: string; isError?: boolean } | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendConnectionStatus>(backendService.getStatus());
  const [sim, setSim] = useState<BackendSim>(backendService.getSim());

  // Trạng thái 3D Scene Toggles
  const [isCutaway, setIsCutaway] = useState<boolean>(false);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showPirCone, setShowPirCone] = useState<boolean>(false);

  // Trạng thái Chế độ Giả lập (Mock Telemetry Mode)
  const [isMockMode, setIsMockMode] = useState<boolean>(true);

  // Trạng thái kết nối MQTT
  const [mqttStatus, setMqttStatus] = useState<MqttConnectionStatus>('disconnected');

  useEffect(() => backendService.subscribeSim(setSim), []);

  // Quản lý vòng đời Mock Timer: Chỉ chạy khi isMockMode = true
  useEffect(() => {
    if (isMockMode) {
      mockService.startSimulation();
    } else {
      mockService.stopSimulation();
    }
  }, [isMockMode]);

  // 1. Khởi tạo BackendService & MQTT Service
  useEffect(() => {
    backendService.init();

    const unsubscribeBackendStatus = backendService.subscribeStatus((status) => {
      setBackendStatus(status);
      // Tự động chuyển sang Chế độ Giám sát Thiết bị thật khi phát hiện ESP32 thật online
      if (status.isESP32Online) {
        setIsMockMode(false);
      }
    });

    // Thử kết nối MQTT Service
    mqttService.connect();
    const unsubscribeMqttStatus = mqttService.subscribeStatus((status) => {
      setMqttStatus(status);
    });

    const unsubscribeMqttTelemetry = mqttService.subscribeTelemetry((mqttTelem) => {
      if (!isMockMode) {
        setTelemetry((prev) => ({
          ...prev,
          ...mqttTelem,
          timestamp: Date.now(),
        }));
      }
    });

    return () => {
      unsubscribeBackendStatus();
      unsubscribeMqttStatus();
      unsubscribeMqttTelemetry();
      mqttService.disconnect();
    };
  }, [isMockMode]);

  // 2. Đăng ký luồng Telemetry:
  // - Nếu ở chế độ Mock hoặc backend không có ESP32 online: mockService là nguồn chính
  // - Khi ESP32 thực tế online và không bật Mock: backendService cập nhật
  useEffect(() => {
    activityLog.resetBaseline();

    const unsubscribeMock = mockService.subscribe((mockTelem) => {
      if (isMockMode || !backendStatus.isESP32Online) {
        setTelemetry(mockTelem);
        activityLog.observeTelemetry(mockTelem);
      }
    });

    let unsubscribeBackend = () => {};
    if (backendStatus.isServerConnected) {
      unsubscribeBackend = backendService.subscribe((backendTelem) => {
        if (backendStatus.isESP32Online && !isMockMode) {
          setTelemetry(backendTelem);
          activityLog.observeTelemetry(backendTelem);
        }
      });
    }

    return () => {
      unsubscribeMock();
      unsubscribeBackend();
    };
  }, [isMockMode, backendStatus.isServerConnected, backendStatus.isESP32Online]);

  // Thông báo thay đổi kết nối
  useEffect(() => {
    if (backendStatus.isServerConnected && backendStatus.lastSeen !== null) {
      activityLog.observeConnection(backendStatus.isESP32Online);
    }
  }, [backendStatus]);

  const showToast = useCallback((message: string, isError = false) => {
    setAppToast({ message, isError });
    setTimeout(() => {
      setAppToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }, []);

  // Chuyển đổi kịch bản kiểm thử (Header & ControlDashboard)
  const handleScenarioChange = (scenario: ScenarioType) => {
    setCurrentScenario(scenario);
    // Bật chế độ giả lập nếu đang ở chế độ thật
    setIsMockMode(true);
    mockService.startSimulation();
    mockService.setScenario(scenario);
    setTelemetry({ ...mockService.getCurrentTelemetry() });

    if (backendStatus.isServerConnected) {
      backendService.setSimScenario(scenario).catch(() => {});
    }
    showToast(`Đã kích hoạt kịch bản giả lập: "${scenario}"`);
  };

  // Điều khiển thiết bị từ ControlDashboard & ControlPanel
  const handleDeviceCommand = async (
    device: 'door' | 'fan' | 'led1',
    action: 'auto' | 'on' | 'off' | 'open' | 'close'
  ) => {
    // 1. Kiểm tra ràng buộc khóa an toàn (Safety Interlocks)
    if (device === 'door' && action === 'close') {
      if (telemetry.door_safety_lock || telemetry.smoke_alarm || telemetry.gas_alarm) {
        showToast(telemetry.safety_reason || 'Không thể đóng cửa! Khóa an toàn 60s đang kích hoạt.', true);
        return;
      }
    }

    if (device === 'fan' && action === 'off') {
      if (telemetry.heat_alarm) {
        showToast('Không thể tắt quạt! Nhiệt độ đang vượt ngưỡng báo động (>= 40°C).', true);
        return;
      }
    }

    // 2. Tách biệt hoàn toàn luồng Giả lập và Thiết bị thật:
    if (isMockMode) {
      // 2a. Chế độ Giả lập: Cập nhật mockService
      mockService.setDeviceState(device, action);
      setTelemetry({ ...mockService.getCurrentTelemetry() });
      showToast(`[Giả lập] Đã áp dụng ${action.toUpperCase()} cho ${device.toUpperCase()}!`);
    } else {
      // 2b. Chế độ Thiết bị thật: Optimistic update trạng thái hiển thị
      setTelemetry((prev) => {
        const next = { ...prev };
        if (!next.modes) next.modes = { door: 'auto', fan: 'auto', led1: 'auto' };
        if (action === 'auto') {
          next.modes[device] = 'auto';
        } else {
          next.modes[device] = 'manual';
          if (device === 'door') {
            const isOpen = action === 'open';
            next.door_command = isOpen ? 'open' : 'closed';
            next.led2_on = isOpen;
          } else if (device === 'fan') {
            next.fan_on = action === 'on';
          } else if (device === 'led1') {
            next.led1_on = action === 'on';
          }
        }
        return next;
      });

      // Gửi lệnh xuống phần cứng qua Backend FastAPI hoặc MQTT
      if (backendStatus.isServerConnected) {
        try {
          await httpClient.sendCommand(device, action);
          showToast(`Đã gửi lệnh ${action.toUpperCase()} tới ${device.toUpperCase()} qua Backend!`);
        } catch (err: any) {
          showToast(err?.message || `Lỗi gửi lệnh tới ${device}`, true);
        }
      } else if (mqttStatus === 'connected') {
        try {
          const ok = await mqttService.publishCommand(device, action);
          if (ok) {
            showToast(`Đã publish lệnh ${action.toUpperCase()} tới topic MQTT!`);
          } else {
            showToast(`Không thể gửi lệnh MQTT tới ${device}`, true);
          }
        } catch (err: any) {
          showToast(`Lỗi publish MQTT tới ${device}`, true);
        }
      } else {
        showToast(`Không có kết nối phần cứng thật (Backend/MQTT Offline)!`, true);
      }
    }
  };

  // Xác nhận sự cố (Operator ACK)
  const handleAckAlarm = async () => {
    try {
      if (backendStatus.isServerConnected) {
        const res = await backendService.acknowledgeAlarm();
        showToast(res.message);
      } else {
        // Trong chế độ giả lập offline: Tắt các cờ báo động trên mock
        mockService.setDeviceState('door', 'auto');
        mockService.setDeviceState('fan', 'auto');
        setTelemetry((prev) => ({
          ...prev,
          smoke_alarm: false,
          gas_alarm: false,
          heat_alarm: false,
          led3_on: false,
          buzzer_on: false,
          door_safety_lock: false,
          safety_reason: null,
          active_alarms: [],
        }));
        showToast('Đã xác nhận sự cố (Operator ACK trên Giả lập)!');
      }
    } catch (err: any) {
      showToast(err?.message || 'Không thể xác nhận sự cố', true);
    }
  };

  const handleModeChange = async (newMode: SystemMode) => {
    try {
      mockService.setSystemMode(newMode);
      setTelemetry({ ...mockService.getCurrentTelemetry() });

      if (backendStatus.isServerConnected) {
        await backendService.setSystemMode(newMode);
        showToast(`Đã chuyển sang chế độ ${newMode === 'auto' ? 'TỰ ĐỘNG' : 'THỦ CÔNG'}!`);
      } else {
        showToast(`Chế độ ${newMode === 'auto' ? 'TỰ ĐỘNG' : 'THỦ CÔNG'}`);
      }
    } catch (err: any) {
      showToast(err?.message || 'Không thể chuyển chế độ vận hành', true);
    }
  };

  const handleSaveThresholds = async (newThresholds: DeviceThresholds) => {
    try {
      mockService.updateThresholds(newThresholds);
      setTelemetry({ ...mockService.getCurrentTelemetry() });

      if (backendStatus.isServerConnected) {
        await backendService.updateThresholds(newThresholds);
        showToast('Đã lưu và đồng bộ cấu hình ngưỡng xuống Backend & MQTT!');
      } else {
        showToast('Đã cập nhật cấu hình ngưỡng mới!');
      }
    } catch (err: any) {
      showToast(err?.message || 'Lỗi khi lưu ngưỡng', true);
      throw err;
    }
  };

  const isOnline = isMockMode
    ? true
    : backendStatus.isServerConnected
    ? backendStatus.isESP32Online
    : mqttStatus === 'connected'
    ? true
    : currentScenario !== 'esp32_offline';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans antialiased selection:bg-blue-500 selection:text-white">
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
        onSimScenarioChange={async (scId) => {
          handleScenarioChange(scId as ScenarioType);
          try {
            await backendService.setSimScenario(scId);
          } catch {
            // ignore
          }
        }}
        onOpenConfig={() => setIsConfigOpen(true)}
      />

      {/* TOAST SYSTEM NOTIFICATION */}
      {appToast && (
        <div
          className={`fixed top-16 right-4 z-50 p-4 rounded-xl border text-xs shadow-xl flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 backdrop-blur-md ${
            appToast.isError
              ? 'bg-rose-50 border-rose-300 text-rose-800'
              : 'bg-white border-emerald-300 text-emerald-800'
          }`}
        >
          {appToast.isError ? (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          <span className="font-medium">{appToast.message}</span>
          <button
            type="button"
            onClick={() => setAppToast(null)}
            className="ml-2 text-slate-400 hover:text-slate-600 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-5">
        {/* TAB SWITCHER */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('3d')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === '3d'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>🏠 Bản Sao Số 3D (Digital Twin)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>📊 Giám Sát Chi Tiết & Biểu Đồ</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-slate-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Mô hình nhà cấp 4 (+Y Up, mét)</span>
          </div>
        </div>

        {activeTab === '3d' ? (
          /* ===== TAB 1: 3D DIGITAL TWIN + HUD SIDEBAR ===== */
          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* Cột Trái: Canvas 3D Nhà Cấp 4 */}
            <div className="flex-1 w-full h-[620px] rounded-2xl overflow-hidden shadow-sm border border-slate-200/90 bg-slate-900">
              <SmartHouseScene
                telemetry={telemetry}
                isCutaway={isCutaway}
                showLabels={showLabels}
                showPirCone={showPirCone}
                onToggleCutaway={() => setIsCutaway(!isCutaway)}
                onToggleLabels={() => setShowLabels(!showLabels)}
                onTogglePirCone={() => setShowPirCone(!showPirCone)}
              />
            </div>

            {/* Cột Phải: Bảng Điều Khiển & Giám Sát HUD Sidebar */}
            <ControlDashboard
              telemetry={telemetry}
              mqttStatus={mqttStatus}
              isMockMode={isMockMode}
              onToggleMockMode={(val) => setIsMockMode(val)}
              onDeviceCommand={handleDeviceCommand}
              onAckAlarm={handleAckAlarm}
              onSelectMockScenario={(scId) => handleScenarioChange(scId as ScenarioType)}
              isBackendConnected={backendStatus.isServerConnected}
            />
          </div>
        ) : (
          /* ===== TAB 2: DASHBOARD CHI TIẾT & BIỂU ĐỒ LỊCH SỬ ===== */
          <div className="flex flex-col gap-6">
            {/* Banner Cảnh báo */}
            <AlertBanner
              telemetry={telemetry}
              onAckAlarm={() => showToast('Đã gửi xác nhận Operator ACK!')}
            />

            {/* 4 Chỉ số môi trường */}
            <MetricCardsGrid telemetry={telemetry} />

            {/* Bảng điều khiển */}
            <ControlPanel
              telemetry={telemetry}
              onSwitchToManual={() => handleModeChange('manual')}
              onSwitchToAuto={() => handleModeChange('auto')}
            />

            {/* Biểu đồ lịch sử */}
            <HistorySection telemetry={telemetry} />

            {/* Mô phỏng LCD & JSON Telemetry */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LCDSimulator telemetry={telemetry} />
              <JsonTelemetryViewer telemetry={telemetry} />
            </div>

            {/* Nhật ký & Bảng lệnh */}
            <ActivityLog live={backendStatus.isServerConnected} />
            <CommandLogTable />
          </div>
        )}
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

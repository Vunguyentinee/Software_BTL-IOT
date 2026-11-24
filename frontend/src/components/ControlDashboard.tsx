import React, { useState } from 'react';
import {
  ShieldAlert,
  Flame,
  ThermometerSnowflake,
  DoorOpen,
  DoorClosed,
  Fan,
  Lightbulb,
  Radio,
  Lock,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Cpu,
  Layers,
  Wrench,
  Zap,
} from 'lucide-react';
import { ESP32Telemetry } from '../types/telemetry';
import { MqttConnectionStatus } from '../services/mqttService';

export interface ControlDashboardProps {
  telemetry: ESP32Telemetry;
  mqttStatus: MqttConnectionStatus;
  isMockMode: boolean;
  onToggleMockMode: (mock: boolean) => void;
  onDeviceCommand: (device: 'door' | 'fan' | 'led1', action: 'auto' | 'on' | 'off' | 'open' | 'close') => Promise<void>;
  onAckAlarm: () => Promise<void>;
  onSelectMockScenario?: (scenarioId: string) => void;
  isBackendConnected?: boolean;
}

export const ControlDashboard: React.FC<ControlDashboardProps> = ({
  telemetry,
  mqttStatus,
  isMockMode,
  onToggleMockMode,
  onDeviceCommand,
  onAckAlarm,
  onSelectMockScenario,
  isBackendConnected = false,
}) => {
  const [loadingDevice, setLoadingDevice] = useState<string | null>(null);
  const [ackLoading, setAckLoading] = useState(false);
  const [ackSuccess, setAckSuccess] = useState(false);

  // Xác định các điều kiện khóa an toàn (Safety Interlocks)
  const isDoorLocked = Boolean(telemetry.door_safety_lock || telemetry.smoke_alarm || telemetry.gas_alarm);
  const doorLockReason = telemetry.safety_reason || 'Đang khóa giữ cửa mở 60s an toàn do rò rỉ khí gas/khói';

  const isFanLockedOn = Boolean(telemetry.heat_alarm);
  const fanLockReason = 'Quạt bị khóa cưỡng bức BẬT do nhiệt độ vượt ngưỡng báo động (>= 40°C)';

  // Danh sách các cảnh báo hiện hành
  const activeAlarmsList: Array<{ title: string; desc: string; type: 'smoke' | 'heat' | 'sensor' | 'lock' }> = [];
  if (telemetry.smoke_alarm || telemetry.gas_alarm) {
    activeAlarmsList.push({
      title: 'CẢNH BÁO RÒ RỈ GAS / KHÓI',
      desc: `Chỉ số đo: ${telemetry.gas_raw ?? telemetry.smoke_raw ?? 0} ADC (Đầu dò đỏ cam, còi hú 300ms, cửa tự động mở)`,
      type: 'smoke',
    });
  }
  if (telemetry.heat_alarm) {
    activeAlarmsList.push({
      title: 'CẢNH BÁO QUÁ NHIỆT MÔI TRƯỜNG',
      desc: `Nhiệt độ hiện tại: ${(telemetry.temperature_c ?? 0).toFixed(1)}°C (Vượt ngưỡng an toàn >= 40°C, quạt khóa bật)`,
      type: 'heat',
    });
  }
  if (telemetry.gas_sensor_fault) {
    activeAlarmsList.push({
      title: 'LỖI CẢM BIẾN GAS MQ-2',
      desc: 'Tín hiệu điện áp ADC kẹt biên liên tục trên 2 giây.',
      type: 'sensor',
    });
  }
  if (telemetry.door_safety_lock && !telemetry.smoke_alarm && !telemetry.gas_alarm) {
    activeAlarmsList.push({
      title: 'ĐANG GIỮ CỬA AN TOÀN 60S',
      desc: 'Hệ thống tiếp tục thông gió sau khi nồng độ gas giảm về mức an toàn.',
      type: 'lock',
    });
  }

  const handleCommand = async (
    device: 'door' | 'fan' | 'led1',
    action: 'auto' | 'on' | 'off' | 'open' | 'close'
  ) => {
    setLoadingDevice(`${device}_${action}`);
    try {
      await onDeviceCommand(device, action);
    } finally {
      setLoadingDevice(null);
    }
  };

  const handleOperatorAck = async () => {
    setAckLoading(true);
    try {
      await onAckAlarm();
      setAckSuccess(true);
      setTimeout(() => setAckSuccess(false), 5000);
    } finally {
      setAckLoading(false);
    }
  };

  // Xác định trạng thái của từng thiết bị (để highlight nút)
  const isDoorOpen = telemetry.door_command === 'open';
  const isDoorAuto = telemetry.modes?.door === 'auto';

  const isFanOn = telemetry.fan_on;
  const isFanAuto = telemetry.modes?.fan === 'auto';

  const isLed1On = telemetry.led1_on;
  const isLed1Auto = telemetry.modes?.led1 === 'auto';

  return (
    <aside className="w-full lg:w-96 flex flex-col gap-4 font-sans text-slate-800">
      {/* 1. KHỐI TRẠNG THÁI KẾT NỐI & HỆ THỐNG */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Giám Sát Kết Nối (Telemetry HUD)
            </h3>
          </div>
          {/* Toggle Chế độ Giả lập */}
          <button
            type="button"
            onClick={() => onToggleMockMode(!isMockMode)}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all border flex items-center gap-1.5 cursor-pointer ${
              isMockMode
                ? 'bg-amber-50 border-amber-300 text-amber-800 shadow-xs'
                : 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-xs'
            }`}
          >
            <Zap className={`w-3.5 h-3.5 ${isMockMode ? 'text-amber-500 fill-amber-500' : 'text-emerald-500 fill-emerald-500'}`} />
            <span>{isMockMode ? 'MÔ PHỎNG: BẬT' : 'THIẾT BỊ THẬT'}</span>
          </button>
        </div>

        {/* Thanh trạng thái môi trường vận hành */}
        <div
          className={`text-[10px] rounded-lg px-2.5 py-1 mb-3 flex items-center justify-between border ${
            isMockMode
              ? 'text-amber-800 bg-amber-50/90 border-amber-200'
              : 'text-emerald-800 bg-emerald-50/90 border-emerald-200'
          }`}
        >
          <span className="flex items-center gap-1.5 font-medium">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isMockMode ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'
              }`}
            />
            {isMockMode
              ? 'Mô phỏng độc lập (Cách ly hoàn toàn với phần cứng)'
              : 'Đang kết nối phần cứng thực (Lệnh gửi trực tiếp ESP32)'}
          </span>
          <span className="font-mono text-[9px] font-bold uppercase">
            {isMockMode ? 'Offline Sandbox' : 'Hardware Live'}
          </span>
        </div>

        {/* Các chỉ số kết nối */}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5">
            <span className="text-slate-500 block text-[10px] uppercase font-sans">Giao thức MQTT</span>
            <div className="flex items-center gap-1.5 mt-1 font-bold">
              <span
                className={`w-2 h-2 rounded-full ${
                  isMockMode
                    ? 'bg-amber-500'
                    : mqttStatus === 'connected' || isBackendConnected
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span
                className={
                  isMockMode
                    ? 'text-amber-700'
                    : mqttStatus === 'connected' || isBackendConnected
                    ? 'text-emerald-700'
                    : 'text-rose-700'
                }
              >
                {isMockMode
                  ? 'SIMULATED'
                  : mqttStatus === 'connected'
                  ? 'CONNECTED'
                  : isBackendConnected
                  ? 'VIA BACKEND'
                  : 'DISCONNECTED'}
              </span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5">
            <span className="text-slate-500 block text-[10px] uppercase font-sans">Control Mode</span>
            <div className="flex items-center gap-1 mt-1 font-bold text-blue-700 truncate">
              <Layers className="w-3 h-3 text-blue-600 shrink-0" />
              <span>{telemetry.control_mode || (telemetry.system_mode === 'auto' ? 'local_auto' : 'remote_available')}</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5">
            <span className="text-slate-500 block text-[10px] uppercase font-sans">Boot ID</span>
            <div className="flex items-center gap-1 mt-1 font-bold text-slate-700 truncate">
              <Cpu className="w-3 h-3 text-indigo-500 shrink-0" />
              <span>{telemetry.boot_id || 'boot-e92a'}</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5">
            <span className="text-slate-500 block text-[10px] uppercase font-sans">Connection ID</span>
            <div className="flex items-center gap-1 mt-1 font-bold text-slate-700">
              <span className="text-slate-400">#</span>
              <span>{telemetry.connection_id ?? 1}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. KHỐI CẢNH BÁO NỔI BẬT & OPERATOR ACK */}
      {activeAlarmsList.length > 0 && (
        <div className="bg-rose-50 border border-rose-300 rounded-2xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-rose-800 font-bold text-xs uppercase tracking-wider">
              <ShieldAlert className="w-4 h-4 animate-bounce text-rose-600" />
              <span>Cảnh Báo Sự Cố Khẩn Cấp ({activeAlarmsList.length})</span>
            </div>
          </div>

          <div className="space-y-2 mb-3">
            {activeAlarmsList.map((alarm, idx) => (
              <div
                key={idx}
                className="bg-white border border-rose-200 rounded-xl p-2.5 text-xs shadow-xs"
              >
                <div className="flex items-center gap-1.5 font-bold text-rose-900">
                  {alarm.type === 'smoke' ? (
                    <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0 animate-pulse" />
                  ) : alarm.type === 'heat' ? (
                    <ThermometerSnowflake className="w-3.5 h-3.5 text-rose-600 shrink-0 animate-pulse" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                  <span>{alarm.title}</span>
                </div>
                <p className="text-[11px] text-rose-700 mt-0.5 font-mono">{alarm.desc}</p>
              </div>
            ))}
          </div>

          {/* Nút Xác nhận sự cố (Operator ACK) */}
          <button
            type="button"
            disabled={ackLoading}
            onClick={handleOperatorAck}
            className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs active:scale-95 cursor-pointer ${
              ackSuccess
                ? 'bg-emerald-600 text-white border border-emerald-500'
                : 'bg-rose-600 hover:bg-rose-700 text-white border border-rose-600 shadow-rose-200'
            }`}
          >
            {ackLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : ackSuccess ? (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-200" />
            ) : (
              <Wrench className="w-3.5 h-3.5" />
            )}
            <span>
              {ackLoading
                ? 'Đang gửi ACK...'
                : ackSuccess
                ? 'ĐÃ XÁC NHẬN SỰ CỐ (ACK THÀNH CÔNG)'
                : 'Xác nhận sự cố (Operator ACK)'}
            </span>
          </button>
        </div>
      )}

      {/* 3. BẢNG ĐIỀU KHIỂN 3 THIẾT BỊ CHẤP HÀNH (CỬA, QUẠT, ĐÈN LED1) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Điều Khiển Thiết Bị (Actuators)
          </h3>
          <span className="text-[10px] font-mono text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full font-semibold">
            3 Cơ Cấu
          </span>
        </div>

        {/* THIẾT BỊ 1: CỬA CHÍNH (VÒM LỆCH PHẢI) */}
        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-100/70 text-blue-700 border border-blue-200">
                {isDoorOpen ? <DoorOpen className="w-4 h-4 text-emerald-600" /> : <DoorClosed className="w-4 h-4 text-slate-500" />}
              </div>
              <div>
                <span className="text-xs font-bold text-slate-800 block">Cửa Chính (Vòm Phải)</span>
                <span className="text-[10px] font-mono text-slate-500">GPIO 18 • Servo 90°</span>
              </div>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                isDoorOpen
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-slate-200/70 text-slate-600 border border-slate-300'
              }`}
            >
              {isDoorOpen ? 'MỞ (90°)' : 'ĐÓNG (0°)'}
            </span>
          </div>

          {/* Cảnh báo khóa an toàn cửa nếu có */}
          {isDoorLocked && (
            <div className="p-2 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-900 flex items-start gap-1.5">
              <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>{doorLockReason}</span>
            </div>
          )}

          {/* Nhóm 3 nút AUTO / MỞ (OPEN) / ĐÓNG (CLOSE) */}
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            <button
              type="button"
              disabled={loadingDevice === 'door_auto'}
              onClick={() => handleCommand('door', 'auto')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
                isDoorAuto
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              AUTO
            </button>

            <button
              type="button"
              disabled={loadingDevice === 'door_open'}
              onClick={() => handleCommand('door', 'open')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
                isDoorOpen && !isDoorAuto
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              MỞ (OPEN)
            </button>

            <button
              type="button"
              disabled={isDoorLocked || loadingDevice === 'door_close'}
              onClick={() => handleCommand('door', 'close')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border flex items-center justify-center gap-1 ${
                isDoorLocked
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                  : !isDoorOpen && !isDoorAuto
                  ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer'
              }`}
              title={isDoorLocked ? doorLockReason : 'Đóng cửa'}
            >
              {isDoorLocked && <Lock className="w-3 h-3 text-amber-500" />}
              <span>ĐÓNG</span>
            </button>
          </div>
        </div>

        {/* THIẾT BỊ 2: QUẠT THÔNG GIÓ 7 CÁNH */}
        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-cyan-100/70 text-cyan-700 border border-cyan-200">
                <Fan className={`w-4 h-4 ${isFanOn ? 'text-cyan-600 animate-spin' : 'text-slate-500'}`} />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-800 block">Quạt Thông Gió (Tường Phải)</span>
                <span className="text-[10px] font-mono text-slate-500">GPIO 2 • 7 Cánh (22 rad/s)</span>
              </div>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                isFanOn
                  ? 'bg-cyan-100 text-cyan-800 border border-cyan-200'
                  : 'bg-slate-200/70 text-slate-600 border border-slate-300'
              }`}
            >
              {isFanOn ? 'QUAY (ON)' : 'TẮT'}
            </span>
          </div>

          {/* Cảnh báo khóa quạt nếu quá nhiệt */}
          {isFanLockedOn && (
            <div className="p-2 rounded-lg bg-rose-50 border border-rose-300 text-[11px] text-rose-900 flex items-start gap-1.5">
              <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
              <span>{fanLockReason}</span>
            </div>
          )}

          {/* Nhóm 3 nút AUTO / BẬT (ON) / TẮT (OFF) */}
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            <button
              type="button"
              disabled={loadingDevice === 'fan_auto'}
              onClick={() => handleCommand('fan', 'auto')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
                isFanAuto
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              AUTO
            </button>

            <button
              type="button"
              disabled={loadingDevice === 'fan_on'}
              onClick={() => handleCommand('fan', 'on')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
                isFanOn && !isFanAuto
                  ? 'bg-cyan-600 text-white border-cyan-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              BẬT (ON)
            </button>

            <button
              type="button"
              disabled={isFanLockedOn || loadingDevice === 'fan_off'}
              onClick={() => handleCommand('fan', 'off')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border flex items-center justify-center gap-1 ${
                isFanLockedOn
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                  : !isFanOn && !isFanAuto
                  ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer'
              }`}
              title={isFanLockedOn ? fanLockReason : 'Tắt quạt'}
            >
              {isFanLockedOn && <Lock className="w-3 h-3 text-rose-500" />}
              <span>TẮT</span>
            </button>
          </div>
        </div>

        {/* THIẾT BỊ 3: ĐÈN TRẦN LED1 */}
        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-amber-100/70 text-amber-700 border border-amber-200">
                <Lightbulb className={`w-4 h-4 ${isLed1On ? 'text-amber-500 fill-amber-500' : 'text-slate-500'}`} />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-800 block">Đèn Trần LED1</span>
                <span className="text-[10px] font-mono text-slate-500">GPIO 12 • Vàng ấm (#ffdd55)</span>
              </div>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                isLed1On
                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                  : 'bg-slate-200/70 text-slate-600 border border-slate-300'
              }`}
            >
              {isLed1On ? 'SÁNG (ON)' : 'TẮT'}
            </span>
          </div>

          {/* Nhóm 3 nút AUTO / BẬT (ON) / TẮT (OFF) */}
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            <button
              type="button"
              disabled={loadingDevice === 'led1_auto'}
              onClick={() => handleCommand('led1', 'auto')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
                isLed1Auto
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              AUTO
            </button>

            <button
              type="button"
              disabled={loadingDevice === 'led1_on'}
              onClick={() => handleCommand('led1', 'on')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
                isLed1On && !isLed1Auto
                  ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              BẬT (ON)
            </button>

            <button
              type="button"
              disabled={loadingDevice === 'led1_off'}
              onClick={() => handleCommand('led1', 'off')}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
                !isLed1On && !isLed1Auto
                  ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              TẮT
            </button>
          </div>
        </div>
      </div>

      {/* 4. THANH TEST NHANH KỊCH BẢN GIẢ LẬP (KHI MOCK MODE BẬT) */}
      {isMockMode && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-amber-200/80">
            <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold">
              <Zap className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
              <span>Thử Nghiệm Kịch Bản Mô Phỏng 3D</span>
            </div>
            <span className="text-[10px] text-amber-700 font-mono font-semibold">Mock Suite</span>
          </div>
          <p className="text-[11px] text-amber-800/90 mb-2.5">
            Chọn kịch bản để quan sát trực tiếp hiệu ứng chuyển động, đổi màu và còi 300ms:
          </p>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => onSelectMockScenario?.('smoke_danger')}
              className="px-2 py-2 rounded-lg bg-white hover:bg-rose-50 text-rose-800 border border-rose-200 font-semibold transition-all text-left flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              <span>Báo Gas + Còi 300ms</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectMockScenario?.('heat_alarm')}
              className="px-2 py-2 rounded-lg bg-white hover:bg-red-50 text-red-800 border border-red-200 font-semibold transition-all text-left flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <ThermometerSnowflake className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span>Báo Nhiệt (41°C)</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectMockScenario?.('motion_door')}
              className="px-2 py-2 rounded-lg bg-white hover:bg-blue-50 text-blue-800 border border-blue-200 font-semibold transition-all text-left flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <DoorOpen className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Mở Cửa 90° + LED2</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectMockScenario?.('cooling_fan')}
              className="px-2 py-2 rounded-lg bg-white hover:bg-cyan-50 text-cyan-800 border border-cyan-200 font-semibold transition-all text-left flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Fan className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
              <span>Quạt Quay 22 rad/s</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectMockScenario?.('dark_light')}
              className="px-2 py-2 rounded-lg bg-white hover:bg-amber-50 text-amber-800 border border-amber-200 font-semibold transition-all text-left flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>Trời Tối + Đèn LED1</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectMockScenario?.('normal')}
              className="px-2 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold transition-all text-left flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Bình Thường (Reset)</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};

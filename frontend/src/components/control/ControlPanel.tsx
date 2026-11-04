import React, { useState } from 'react';
import { 
  Fan, 
  DoorOpen, 
  DoorClosed, 
  Lightbulb, 
  ShieldAlert, 
  Volume2, 
  Loader2, 
  Lock, 
  CheckCircle, 
  AlertCircle,
  Sliders
} from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';
import { DeviceTarget } from '../../types/command';
import { commandService } from '../../services/commandService';

interface ControlPanelProps {
  telemetry: ESP32Telemetry;
  onSwitchToManual: () => void;
}

interface ToastNotification {
  id: string;
  type: 'success' | 'error';
  message: string;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ telemetry, onSwitchToManual }) => {
  const {
    fan_on,
    door_command,
    led1_on,
    led2_on,
    led3_on,
    buzzer_on,
    system_mode
  } = telemetry;

  const isAuto = system_mode === 'auto';
  const [loadingDevice, setLoadingDevice] = useState<DeviceTarget | null>(null);
  const [toast, setToast] = useState<ToastNotification | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    const id = Date.now().toString();
    setToast({ id, type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4000);
  };

  const handleExecute = async (target: DeviceTarget, newValue: boolean) => {
    if (isAuto) {
      showToast('error', 'Hệ thống đang ở chế độ Tự động! Hãy chuyển sang Thủ công để điều khiển.');
      return;
    }

    setLoadingDevice(target);
    try {
      const ack = await commandService.sendCommand(target, newValue);
      showToast('success', `${ack.message} (${ack.latencyMs}ms)`);
    } catch (err: any) {
      showToast('error', err.message || 'Gửi lệnh thất bại');
    } finally {
      setLoadingDevice(null);
    }
  };

  const devices = [
    {
      target: 'door' as DeviceTarget,
      name: 'Cửa Servo',
      pin: 'GPIO 18',
      desc: 'Điều khiển góc quay Servo 90° / 0°',
      currentState: door_command === 'open',
      activeText: 'ĐANG MỞ (90°)',
      inactiveText: 'ĐANG ĐÓNG (0°)',
      buttonAction: door_command === 'open' ? 'Đóng cửa' : 'Mở cửa',
      nextValue: door_command !== 'open',
      icon: door_command === 'open' ? <DoorOpen className="w-5 h-5 text-emerald-600" /> : <DoorClosed className="w-5 h-5 text-slate-400" />,
      activeColorClass: 'border-emerald-300 bg-emerald-50/50'
    },
    {
      target: 'fan' as DeviceTarget,
      name: 'Quạt Làm Mát',
      pin: 'GPIO 2',
      desc: 'Module MOSFET / Relay điều khiển quạt',
      currentState: fan_on,
      activeText: 'ĐANG QUAY (BẬT)',
      inactiveText: 'TẮT',
      buttonAction: fan_on ? 'Tắt quạt' : 'Bật quạt',
      nextValue: !fan_on,
      icon: <Fan className={`w-5 h-5 ${fan_on ? 'text-blue-600 animate-spin' : 'text-slate-400'}`} />,
      activeColorClass: 'border-blue-300 bg-blue-50/50'
    },
    {
      target: 'led1' as DeviceTarget,
      name: 'Đèn Chiếu Sáng (LED1)',
      pin: 'GPIO 12',
      desc: 'Chiếu sáng sinh hoạt khi trời tối',
      currentState: led1_on,
      activeText: 'ĐANG SÁNG',
      inactiveText: 'TẮT',
      buttonAction: led1_on ? 'Tắt LED1' : 'Bật LED1',
      nextValue: !led1_on,
      icon: <Lightbulb className={`w-5 h-5 ${led1_on ? 'text-amber-500 fill-amber-500/20' : 'text-slate-400'}`} />,
      activeColorClass: 'border-amber-300 bg-amber-50/50'
    },
    {
      target: 'led2' as DeviceTarget,
      name: 'Đèn Đón Khách (LED2)',
      pin: 'GPIO 14',
      desc: 'Báo hiệu khi có người (PIR)',
      currentState: led2_on,
      activeText: 'ĐANG SÁNG',
      inactiveText: 'TẮT',
      buttonAction: led2_on ? 'Tắt LED2' : 'Bật LED2',
      nextValue: !led2_on,
      icon: <Lightbulb className={`w-5 h-5 ${led2_on ? 'text-cyan-600 fill-cyan-600/20' : 'text-slate-400'}`} />,
      activeColorClass: 'border-cyan-300 bg-cyan-50/50'
    },
    {
      target: 'led3' as DeviceTarget,
      name: 'Đèn Báo Nhiệt (LED3)',
      pin: 'GPIO 27',
      desc: 'Đèn đỏ cảnh báo nhiệt độ cao',
      currentState: led3_on,
      activeText: 'ĐANG BÁO ĐỘNG',
      inactiveText: 'TẮT',
      buttonAction: led3_on ? 'Tắt LED3' : 'Bật LED3',
      nextValue: !led3_on,
      icon: <ShieldAlert className={`w-5 h-5 ${led3_on ? 'text-rose-600 animate-pulse' : 'text-slate-400'}`} />,
      activeColorClass: 'border-rose-300 bg-rose-50/50'
    },
    {
      target: 'buzzer' as DeviceTarget,
      name: 'Còi Cảnh Báo (Buzzer)',
      pin: 'GPIO 25',
      desc: 'Còi hú xung ngắt quãng 300ms/300ms',
      currentState: buzzer_on,
      activeText: 'ĐANG HÚ CÒI',
      inactiveText: 'YÊN LẶNG',
      buttonAction: buzzer_on ? 'Tắt còi' : 'Hú còi test',
      nextValue: !buzzer_on,
      icon: <Volume2 className={`w-5 h-5 ${buzzer_on ? 'text-rose-600 animate-bounce' : 'text-slate-400'}`} />,
      activeColorClass: 'border-rose-300 bg-rose-50/50'
    }
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
      
      {/* HEADER & TOAST NOTIFICATION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-blue-50 text-blue-700 rounded-xl border border-blue-200">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Bảng Điều Khiển Thiết Bị Chấp Hành (Manual Controls)
            </h3>
            <p className="text-xs text-slate-500">
              Gửi lệnh điều khiển trực tiếp tới ESP32 kèm cơ chế phản hồi xác nhận (Ack) & Timeout
            </p>
          </div>
        </div>

        {/* Trạng thái chế độ */}
        <div className="flex items-center gap-2">
          {isAuto ? (
            <button
              onClick={onSwitchToManual}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-all cursor-pointer shadow-xs"
            >
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>Chế độ Auto (Bấm để đổi sang Manual)</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Chế độ Manual: Sẵn sàng nhận lệnh</span>
            </span>
          )}
        </div>
      </div>

      {/* TOAST MESSAGE */}
      {toast && (
        <div className={`mb-4 px-4 py-2.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-2 ${
          toast.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{toast.message}</span>
          </div>
          <button 
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-slate-700 text-xs ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* THÔNG BÁO KHÓA CHẾ ĐỘ AUTO */}
      {isAuto && (
        <div className="mb-4 p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 flex items-center justify-between text-xs text-amber-900 shadow-xs">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Bảo vệ an toàn logic:</strong> Hệ thống đang ở chế độ <strong>Tự động</strong>. Các thiết bị đang vận hành tự động theo cảm biến tại ESP32. Hãy chuyển sang <strong>Thủ công (Manual)</strong> để mở khóa các nút bấm điều khiển.
            </span>
          </div>
          <button
            onClick={onSwitchToManual}
            className="shrink-0 ml-3 px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs transition-colors"
          >
            Chuyển ngay
          </button>
        </div>
      )}

      {/* DANH SÁCH 6 THIẾT BỊ ĐIỀU KHIỂN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((device) => {
          const isLoading = loadingDevice === device.target;

          return (
            <div 
              key={device.target}
              className={`p-4 rounded-xl border transition-all duration-200 flex flex-col justify-between ${
                isAuto 
                  ? 'bg-slate-50/60 border-slate-200 opacity-80' 
                  : device.currentState 
                  ? device.activeColorClass 
                  : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-white border border-slate-200 shadow-xs">
                      {device.icon}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">{device.name}</h4>
                      <span className="text-[11px] font-mono text-slate-500">{device.pin}</span>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    device.currentState 
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}>
                    {device.currentState ? device.activeText : device.inactiveText}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-3">{device.desc}</p>
              </div>

              {/* ACTION BUTTON */}
              <button
                type="button"
                disabled={isAuto || isLoading}
                onClick={() => handleExecute(device.target, device.nextValue)}
                className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  isAuto
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                    : isLoading
                    ? 'bg-blue-600/70 text-white cursor-wait'
                    : device.currentState
                    ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-xs'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs active:scale-[0.98]'
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Đang gửi lệnh...</span>
                  </>
                ) : isAuto ? (
                  <>
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Khóa (Chế độ Auto)</span>
                  </>
                ) : (
                  <span>{device.buttonAction}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

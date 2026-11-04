import React from 'react';
import { 
  Fan, 
  DoorOpen, 
  DoorClosed, 
  Lightbulb, 
  ShieldAlert, 
  Volume2, 
  Cpu
} from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';

interface DeviceQuickOverviewProps {
  telemetry: ESP32Telemetry;
}

export const DeviceQuickOverview: React.FC<DeviceQuickOverviewProps> = ({ telemetry }) => {
  const {
    fan_on,
    door_command,
    led1_on,
    led2_on,
    led3_on,
    buzzer_on,
    system_mode
  } = telemetry;

  const devices = [
    {
      name: 'Quạt làm mát',
      gpio: 'GPIO 2',
      driver: 'MOSFET / Relay',
      status: fan_on,
      statusText: fan_on ? 'Đang quay' : 'Đang tắt',
      icon: <Fan className={`w-5 h-5 ${fan_on ? 'text-blue-600 animate-spin' : 'text-slate-400'}`} />,
      activeColor: 'border-blue-300 bg-blue-50/70 text-blue-800'
    },
    {
      name: 'Servo Cửa',
      gpio: 'GPIO 18',
      driver: 'PWM 50Hz',
      status: door_command === 'open',
      statusText: door_command === 'open' ? 'Mở (90°)' : 'Đóng (0°)',
      icon: door_command === 'open' 
        ? <DoorOpen className="w-5 h-5 text-emerald-600" /> 
        : <DoorClosed className="w-5 h-5 text-slate-400" />,
      activeColor: 'border-emerald-300 bg-emerald-50/70 text-emerald-800'
    },
    {
      name: 'LED 1 (Chiếu sáng)',
      gpio: 'GPIO 12',
      driver: 'Digital Out',
      status: led1_on,
      statusText: led1_on ? 'Sáng (Trời tối)' : 'Tắt (Trời sáng)',
      icon: <Lightbulb className={`w-5 h-5 ${led1_on ? 'text-amber-500 fill-amber-500/20' : 'text-slate-400'}`} />,
      activeColor: 'border-amber-300 bg-amber-50/70 text-amber-800'
    },
    {
      name: 'LED 2 (Người về)',
      gpio: 'GPIO 14',
      driver: 'Digital Out',
      status: led2_on,
      statusText: led2_on ? 'Sáng (PIR = 1)' : 'Tắt (PIR = 0)',
      icon: <Lightbulb className={`w-5 h-5 ${led2_on ? 'text-cyan-600 fill-cyan-600/20' : 'text-slate-400'}`} />,
      activeColor: 'border-cyan-300 bg-cyan-50/70 text-cyan-800'
    },
    {
      name: 'LED 3 (Báo nhiệt)',
      gpio: 'GPIO 27',
      driver: 'Digital Out',
      status: led3_on,
      statusText: led3_on ? 'Sáng (T ≥ 40°C)' : 'Tắt (T ≤ 37°C)',
      icon: <ShieldAlert className={`w-5 h-5 ${led3_on ? 'text-rose-600 animate-pulse' : 'text-slate-400'}`} />,
      activeColor: 'border-rose-300 bg-rose-50/70 text-rose-800'
    },
    {
      name: 'Còi Buzzer',
      gpio: 'GPIO 25',
      driver: 'Xung 300ms/300ms',
      status: buzzer_on,
      statusText: buzzer_on ? 'Kêu ngắt quãng' : 'Yên lặng',
      icon: <Volume2 className={`w-5 h-5 ${buzzer_on ? 'text-rose-600 animate-bounce' : 'text-slate-400'}`} />,
      activeColor: 'border-rose-300 bg-rose-50/70 text-rose-800'
    }
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
            <Cpu className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Trạng thái Chấp hành Vật lý (Actuators - Mục 1 & 2 Spec)
          </h3>
        </div>
        <span className="text-xs text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200 font-medium">
          Chế độ: <strong className="text-blue-700 uppercase font-bold">{system_mode}</strong>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {devices.map((device, idx) => (
          <div 
            key={idx}
            className={`p-3 rounded-xl border transition-all ${
              device.status 
                ? device.activeColor 
                : 'border-slate-200 bg-slate-50/70 text-slate-600'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-slate-400">{device.gpio}</span>
              {device.icon}
            </div>
            <h4 className="text-xs font-bold text-slate-800 truncate">{device.name}</h4>
            <div className="text-[11px] font-semibold mt-1">
              {device.statusText}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {device.driver}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

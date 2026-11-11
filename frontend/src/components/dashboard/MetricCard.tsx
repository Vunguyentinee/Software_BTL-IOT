import React from 'react';
import { 
  Thermometer, 
  Droplets, 
  Flame, 
  Sun, 
  Moon, 
  UserCheck, 
  UserX, 
  AlertCircle,
  Fan,
  ShieldAlert,
  DoorOpen,
  DoorClosed,
  Lightbulb
} from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';

interface MetricCardsGridProps {
  telemetry: ESP32Telemetry;
}

export const MetricCardsGrid: React.FC<MetricCardsGridProps> = ({ telemetry }) => {
  const {
    temperature_c,
    humidity_pct,
    dht_ok,
    smoke_ppm,
    smoke_alarm,
    is_dark,
    motion_detected,
    pir_ready,
    pir_warmup_remaining_sec,
    fan_on,
    led1_on,
    led2_on,
    led3_on,
    heat_alarm,
    door_command
  } = telemetry;

  // 1. Phân loại mức nhiệt độ
  const getTempStatus = () => {
    if (!dht_ok || temperature_c === null) {
      return { 
        valColor: 'text-amber-700', 
        cardBg: 'bg-white border-amber-300 shadow-xs', 
        badge: 'Lỗi cảm biến', 
        badgeColor: 'bg-amber-50 text-amber-800 border-amber-200',
        desc: 'Không có dữ liệu DHT11' 
      };
    }
    const heatLimit = telemetry.thresholds?.heat_alarm_on_temp ?? 31.0;
    const fanLimit = telemetry.thresholds?.fan_on_temp ?? 30.0;

    if (temperature_c >= heatLimit) {
      return { 
        valColor: 'text-rose-600', 
        cardBg: 'bg-rose-50/50 border-rose-300 shadow-xs animate-pulse-fast', 
        badge: 'Cảnh báo nguy cấp', 
        badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
        desc: 'Còi hú + LED3 sáng' 
      };
    }
    if (temperature_c >= fanLimit) {
      return { 
        valColor: 'text-orange-600', 
        cardBg: 'bg-orange-50/40 border-orange-200 shadow-xs', 
        badge: 'Đang làm mát', 
        badgeColor: 'bg-orange-100 text-orange-800 border-orange-200',
        desc: 'Quạt đang quay tự động' 
      };
    }
    return { 
      valColor: 'text-slate-900', 
      cardBg: 'bg-white border-slate-200 hover:border-slate-300 shadow-xs', 
      badge: 'Bình thường', 
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      desc: 'Môi trường mát mẻ' 
    };
  };

  // 2. Phân loại độ ẩm
  const getHumidityStatus = () => {
    if (!dht_ok || humidity_pct === null) {
      return { badge: 'Lỗi', badgeColor: 'bg-amber-50 text-amber-800 border-amber-200', desc: 'DHT11 mất kết nối' };
    }
    if (humidity_pct < 40) {
      return { badge: 'Không khí khô', badgeColor: 'bg-amber-50 text-amber-700 border-amber-200', desc: 'Độ ẩm thấp (<40%)' };
    }
    if (humidity_pct <= 70) {
      return { badge: 'Lý tưởng', badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200', desc: 'Độ ẩm thoải mái' };
    }
    return { badge: 'Độ ẩm cao', badgeColor: 'bg-blue-50 text-blue-700 border-blue-200', desc: 'Không khí ẩm (>70%)' };
  };

  // 3. Phân loại mức khói
  const getSmokeStatus = () => {
    if (smoke_alarm || smoke_ppm >= telemetry.thresholds.smoke_alarm_ppm) {
      return { 
        valColor: 'text-rose-600', 
        cardBg: 'bg-rose-50/50 border-rose-300 shadow-xs animate-pulse', 
        badge: 'Cảnh báo cháy', 
        badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
        desc: `Vượt ngưỡng an toàn ${telemetry.thresholds.smoke_alarm_ppm} PPM`
      };
    }
    if (smoke_ppm > 150) {
      return { 
        valColor: 'text-amber-700', 
        cardBg: 'bg-amber-50/40 border-amber-200 shadow-xs', 
        badge: 'Khói nhẹ', 
        badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
        desc: 'Nồng độ tăng cao' 
      };
    }
    return { 
      valColor: 'text-slate-900', 
      cardBg: 'bg-white border-slate-200 hover:border-slate-300 shadow-xs', 
      badge: 'An toàn', 
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      desc: 'Không khí sạch sẽ' 
    };
  };

  const tempStatus = getTempStatus();
  const humStatus = getHumidityStatus();
  const smokeStatus = getSmokeStatus();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

      {/* CARD 1: NHIỆT ĐỘ */}
      <div className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between ${tempStatus.cardBg}`}>
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-orange-50 text-orange-600">
                <Thermometer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Nhiệt độ</h3>
                <span className="text-[11px] text-slate-500">DHT11 • Chân 5</span>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${tempStatus.badgeColor}`}>
              {tempStatus.badge}
            </span>
          </div>

          <div className="my-2">
            {dht_ok && temperature_c !== null ? (
              <div className="flex items-baseline gap-1">
                <span className={`text-3xl sm:text-4xl font-extrabold tracking-tight ${tempStatus.valColor}`}>
                  {temperature_c.toFixed(1)}
                </span>
                <span className="text-lg font-semibold text-slate-400">°C</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-700 py-1">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <span className="text-lg font-bold">Lỗi đọc DHT11</span>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1">{tempStatus.desc}</p>
          </div>
        </div>

        {/* Thông tin ngưỡng & Thiết bị liên đới */}
        <div className="pt-3 border-t border-slate-100 mt-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <Fan className={`w-3.5 h-3.5 ${fan_on ? 'text-blue-600 animate-spin' : 'text-slate-400'}`} />
            <span className={fan_on ? 'text-blue-700 font-semibold' : 'text-slate-500'}>
              Quạt: {fan_on ? 'BẬT' : 'TẮT'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldAlert className={`w-3.5 h-3.5 ${heat_alarm ? 'text-rose-600 animate-bounce' : 'text-slate-400'}`} />
            <span className={heat_alarm ? 'text-rose-700 font-bold' : 'text-slate-500'}>
              LED3: {led3_on ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
      </div>

      {/* CARD 2: ĐỘ ẨM */}
      <div className="p-5 rounded-2xl border border-slate-200 hover:border-slate-300 bg-white shadow-xs transition-all duration-300 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-cyan-50 text-cyan-600">
                <Droplets className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Độ ẩm</h3>
                <span className="text-[11px] text-slate-500">DHT11 • Chân 5</span>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${humStatus.badgeColor}`}>
              {humStatus.badge}
            </span>
          </div>

          <div className="my-2">
            {dht_ok && humidity_pct !== null ? (
              <div className="flex items-baseline gap-1">
                <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                  {humidity_pct.toFixed(1)}
                </span>
                <span className="text-lg font-semibold text-slate-400">%</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-700 py-1">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <span className="text-lg font-bold">Lỗi đọc DHT11</span>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1">{humStatus.desc}</p>
          </div>
        </div>

        {/* Thanh mức độ ẩm */}
        <div className="pt-3 border-t border-slate-100 mt-2">
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-cyan-500 h-full rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(100, Math.max(0, humidity_pct || 0))}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-1 font-medium">
            <span>0%</span>
            <span className="text-cyan-700">Chuẩn 40-70%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* CARD 3: CẢM BIẾN KHÓI */}
      <div className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between ${smokeStatus.cardBg}`}>
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Khói / Khí Ga</h3>
                <span className="text-[11px] text-slate-500">Gas AO • GPIO 34</span>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${smokeStatus.badgeColor}`}>
              {smokeStatus.badge}
            </span>
          </div>

          <div className="my-2">
            <div className="flex items-baseline gap-1">
              <span className={`text-3xl sm:text-4xl font-extrabold tracking-tight ${smokeStatus.valColor}`}>
                {smoke_ppm}
              </span>
              <span className="text-lg font-semibold text-slate-400">PPM</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{smokeStatus.desc}</p>
          </div>
        </div>

        {/* Thước đo khói trực quan */}
        <div className="pt-3 border-t border-slate-100 mt-2">
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                smoke_ppm >= 300 ? 'bg-rose-500' : smoke_ppm > 150 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, (smoke_ppm / 500) * 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-1 font-medium">
            <span>0 PPM</span>
            <span className="text-amber-700">Ngưỡng: {telemetry.thresholds?.smoke_alarm_ppm ?? 300} PPM</span>
            <span>500+</span>
          </div>
        </div>
      </div>

      {/* CARD 4: ÁNH SÁNG & CHUYỂN ĐỘNG */}
      <div className="p-5 rounded-2xl border border-slate-200 hover:border-slate-300 bg-white shadow-xs transition-all duration-300 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
                {is_dark ? <Moon className="w-5 h-5 text-indigo-600" /> : <Sun className="w-5 h-5 text-amber-500" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Ánh sáng & PIR</h3>
                <span className="text-[11px] text-slate-500">DO (33) • PIR (32)</span>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${
              is_dark 
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {is_dark ? 'Trời Tối' : 'Trời Sáng'}
            </span>
          </div>

          <div className="space-y-2 my-2">
            {/* Trạng thái PIR */}
            <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/80">
              <div className="flex items-center gap-2">
                {pir_ready ? (
                  motion_detected ? (
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <UserX className="w-4 h-4 text-slate-400" />
                  )
                ) : (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                )}
                <span className="text-xs font-medium text-slate-700">
                  {pir_ready 
                    ? (motion_detected ? 'Phát hiện có người' : 'Không có chuyển động')
                    : `PIR khởi động (${pir_warmup_remaining_sec}s)`}
                </span>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                motion_detected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
              }`}>
                PIR: {motion_detected ? '1' : '0'}
              </span>
            </div>

            {/* Trạng thái Chiếu sáng tự động */}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="flex items-center gap-1.5 text-slate-500">
                <Lightbulb className={`w-3.5 h-3.5 ${led1_on ? 'text-amber-500' : 'text-slate-400'}`} />
                Đèn tối & có người (LED1):
              </span>
              <span className={`font-semibold ${led1_on ? 'text-amber-700' : 'text-slate-500'}`}>
                {led1_on ? 'BẬT' : 'TẮT'}
              </span>
            </div>
          </div>
        </div>

        {/* Thông tin Cửa servo */}
        <div className="pt-3 border-t border-slate-100 mt-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            {door_command === 'open' ? (
              <DoorOpen className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <DoorClosed className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span className={door_command === 'open' ? 'text-emerald-700 font-bold' : 'text-slate-500'}>
              Cửa: {door_command === 'open' ? 'MỞ (90°)' : 'ĐÓNG (0°)'}
            </span>
          </div>
          <span className="text-slate-500 font-medium">
            LED2: {led2_on ? 'BẬT' : 'TẮT'}
          </span>
        </div>
      </div>

    </div>
  );
};

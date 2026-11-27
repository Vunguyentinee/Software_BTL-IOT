import React, { useState } from 'react';
import { 
  AlertTriangle, 
  Flame, 
  AlertCircle, 
  Hourglass, 
  Volume2, 
  Fan, 
  ShieldAlert,
  CheckCircle2,
  Lock,
  Check
} from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';

interface AlertBannerProps {
  telemetry: ESP32Telemetry;
  /** Gửi Operator ACK thật; trả về true khi backend đã nhận. */
  onAckAlarm?: () => Promise<boolean>;
  readOnly?: boolean;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ telemetry, onAckAlarm, readOnly = false }) => {
  const { 
    heat_alarm, 
    smoke_alarm, 
    smoke_ppm, 
    pump_on,
    thresholds,
    temperature_c, 
    dht_ok, 
    pir_ready, 
    pir_warmup_remaining_sec,
    gas_raw,
    gas_alarm,
    door_safety_lock
  } = telemetry;

  const [acked, setAcked] = useState<boolean>(false);
  const [acking, setAcking] = useState<boolean>(false);

  const hasHighPriorityAlert = heat_alarm || smoke_alarm || gas_alarm || door_safety_lock;

  const handleOperatorAck = async () => {
    setAcking(true);
    try {
      // Kết quả (thành công / lỗi) do App báo bằng thông báo; chỉ hiện "đã xác nhận" khi thật sự thành công
      if (onAckAlarm && (await onAckAlarm())) {
        setAcked(true);
        setTimeout(() => setAcked(false), 8000);
      }
    } finally {
      setAcking(false);
    }
  };

  return (
    <div className="space-y-3 mb-6">
      
      {/* 1. CẢNH BÁO NHIỆT ĐỘ CAO KHẨN CẤP (Ưu tiên số 1 theo specification.md) */}
      {heat_alarm && (
        <div className="relative overflow-hidden rounded-2xl border border-rose-300 bg-rose-50/90 p-4 shadow-sm animate-pulse">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-600 text-white shrink-0 mt-0.5 shadow-xs">
                <AlertTriangle className="w-5 h-5 animate-bounce" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-rose-900 uppercase tracking-wide">
                    Cảnh báo nhiệt độ cao: {temperature_c !== null ? `${temperature_c}°C` : `≥ ${thresholds.heat_alarm_on_temp ?? 31.0}°C`}
                  </h3>
                  <span className="px-2.5 py-0.5 text-[10px] font-extrabold uppercase bg-rose-600 text-white rounded-full">
                    Nguy hiểm
                  </span>
                </div>
                <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                  Nhiệt độ phòng vượt ngưỡng cảnh báo ({thresholds.heat_alarm_on_temp ?? 31.0}°C)! Hệ thống duy trì quạt làm mát tối đa.
                </p>
                <div className="flex flex-wrap items-center gap-4 mt-2.5 text-xs font-semibold text-rose-900">
                  <span className="flex items-center gap-1.5 bg-rose-100/80 px-2.5 py-1 rounded-lg">
                    <Volume2 className="w-4 h-4 text-rose-700" /> Còi Buzzer (GPIO 25): BẬT
                  </span>
                  <span className="flex items-center gap-1.5 bg-rose-100/80 px-2.5 py-1 rounded-lg">
                    <ShieldAlert className="w-4 h-4 text-rose-700" /> LED3 (GPIO 27): BẬT
                  </span>
                  <span className="flex items-center gap-1.5 bg-blue-100/80 text-blue-900 px-2.5 py-1 rounded-lg">
                    <Fan className="w-4 h-4 text-blue-700 animate-spin" /> Quạt làm mát (GPIO 2): BẬT
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. CẢNH BÁO KHÓI / KHÍ CHÁY */}
      {smoke_alarm && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/90 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500 text-white shrink-0 mt-0.5 shadow-xs">
              <Flame className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wide">
                  Cảnh báo nồng độ khói / khí Gas cao: {smoke_ppm !== null ? `${smoke_ppm} PPM` : (gas_raw !== undefined && gas_raw !== null ? `ADC ${gas_raw}` : 'Vượt ngưỡng')}
                </h3>
                <span className="px-2.5 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-900 rounded-full border border-amber-300">
                  Vượt ngưỡng an toàn
                </span>
              </div>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Mật độ khói/khí gas tăng đột biến trong khu vực giám sát (GPIO 34). Theo luật an toàn, cửa servo được cưỡng chế mở 90° để thoát hiểm.
              </p>
              {pump_on && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-100/80 text-blue-900 px-2.5 py-1 rounded-lg">
                  Bơm nước chữa cháy: ĐANG CHẠY
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2b. CHẾ ĐỘ AN TOÀN GAS / KHÓA MỞ CỬA 60S */}
      {door_safety_lock && !smoke_alarm && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/90 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-600 text-white shrink-0 mt-0.5 shadow-xs">
                <Lock className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wide">
                    Chế độ an toàn: Cửa giữ mở thông gió (Hold 60 giây)
                  </h3>
                  <span className="px-2.5 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-900 rounded-full border border-amber-300">
                    Khóa an toàn
                  </span>
                </div>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  Cảm biến gas vừa phát hiện rò rỉ. Theo luật an toàn, cửa servo được cưỡng chế mở 90° và duy trì trong 60 giây sau khi nồng độ gas hạ thấp để xả sạch khí độc.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* THANH XÁC NHẬN NGƯỜI VẬN HÀNH (OPERATOR ACK) */}
      {hasHighPriorityAlert && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900 text-white rounded-xl shadow-md border border-slate-800">
          <div className="flex items-center gap-2 text-xs">
            <Volume2 className="w-4 h-4 text-amber-400 animate-bounce" />
            <span className="text-slate-300">
              {acked ? (
                <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> Đã xác nhận hiện trường. Đang gửi tín hiệu giải phóng LCD tới ESP32...
                </span>
              ) : (
                'Đang có cảnh báo an toàn! Nhấn xác nhận để gửi Operator ACK giải phóng cảnh báo trên LCD ESP32.'
              )}
            </span>
          </div>
          {!acked && (
            <button
              onClick={handleOperatorAck}
              disabled={acking || readOnly || !onAckAlarm}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-xs font-bold rounded-lg shadow transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {acking ? 'Đang gửi xác nhận...' : 'Xác nhận đã kiểm tra (Operator ACK)'}
            </button>
          )}
        </div>
      )}

      {/* 3. CẢNH BÁO LỖI CẢM BIẾN DHT11 (Mục 3 & 4 specification.md) */}
      {!dht_ok && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <div className="flex-1">
              <strong className="font-semibold text-amber-900">Lỗi cảm biến DHT11 (GPIO 5): </strong>
              <span>Không nhận được dữ liệu nhiệt độ/độ ẩm hợp lệ. Hệ thống đang giữ nguyên trạng thái quạt và cảnh báo trước đó để đảm bảo an toàn.</span>
            </div>
          </div>
        </div>
      )}

      {/* 4. TRẠNG THÁI KHỞI ĐỘNG CẢM BIẾN PIR (Mục 3 specification.md: 60s warm-up) */}
      {!pir_ready && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-900 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Hourglass className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />
              <div>
                <strong className="font-semibold text-blue-900">PIR đang khởi động (Warm-up 60s): </strong>
                <span>Cảm biến chuyển động đang ổn định buồng đo, tạm thời xem như chưa có chuyển động (Cửa đóng, LED2 tắt).</span>
              </div>
            </div>
            {pir_warmup_remaining_sec > 0 && (
              <span className="px-2.5 py-1 font-mono text-xs font-bold bg-blue-100 text-blue-800 rounded-md border border-blue-200">
                {pir_warmup_remaining_sec}s
              </span>
            )}
          </div>
        </div>
      )}

      {/* Trạng thái bình thường */}
      {!hasHighPriorityAlert && dht_ok && pir_ready && (
        <div className="hidden sm:flex items-center justify-between px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-medium text-slate-700">Hệ thống giám sát vận hành bình thường. Không có cảnh báo nguy hại.</span>
          </div>
          <span className="text-slate-500 font-mono text-[11px]">
            Chu kỳ quét: 2.0s • Hysteresis Fan: {telemetry.thresholds?.fan_off_temp ?? 34}°C - {telemetry.thresholds?.fan_on_temp ?? 35}°C
          </span>
        </div>
      )}

    </div>
  );
};

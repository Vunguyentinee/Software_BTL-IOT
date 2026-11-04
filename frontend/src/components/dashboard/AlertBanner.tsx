import React from 'react';
import { 
  AlertTriangle, 
  Flame, 
  AlertCircle, 
  Hourglass, 
  Volume2, 
  Fan, 
  ShieldAlert,
  CheckCircle2
} from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';

interface AlertBannerProps {
  telemetry: ESP32Telemetry;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ telemetry }) => {
  const { 
    heat_alarm, 
    smoke_alarm, 
    smoke_ppm, 
    pump_on,
    thresholds,
    temperature_c, 
    dht_ok, 
    pir_ready, 
    pir_warmup_remaining_sec 
  } = telemetry;

  const hasHighPriorityAlert = heat_alarm || smoke_alarm;

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
                    Cảnh báo nhiệt độ khẩn cấp: {temperature_c !== null ? `${temperature_c}°C` : '≥ 40°C'}
                  </h3>
                  <span className="px-2.5 py-0.5 text-[10px] font-extrabold uppercase bg-rose-600 text-white rounded-full">
                    Nguy hiểm
                  </span>
                </div>
                <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                  Nhiệt độ phòng đã vượt ngưỡng 40.0°C! Đèn LED3 cảnh báo đang bật, còi báo động kêu ngắt quãng (300ms bật / 300ms tắt). Hệ thống duy trì quạt làm mát tối đa cho đến khi nhiệt độ hạ xuống dưới 37.0°C.
                </p>
                <div className="flex flex-wrap items-center gap-4 mt-2.5 text-xs font-semibold text-rose-900">
                  <span className="flex items-center gap-1.5 bg-rose-100/80 px-2.5 py-1 rounded-lg">
                    <Volume2 className="w-4 h-4 text-rose-700" /> Còi Buzzer (GPIO 25): Đang kêu
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
                  Cảnh báo nồng độ khói cao: {smoke_ppm} PPM
                </h3>
                <span className="px-2.5 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-900 rounded-full border border-amber-300">
                  Vượt ngưỡng {thresholds.smoke_alarm_ppm} PPM
                </span>
              </div>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Phát hiện mật độ khói/khí độc tăng đột biến trong khu vực giám sát. Hãy kiểm tra ngay nguồn nhiệt và thông gió!
              </p>
              {pump_on && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-100/80 text-blue-900 px-2.5 py-1 rounded-lg">
                  Bơm nước: ĐANG CHẠY
                </p>
              )}
            </div>
          </div>
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

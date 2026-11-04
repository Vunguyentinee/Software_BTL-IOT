import React, { useState, useEffect } from 'react';
import { Monitor } from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';

interface LCDSimulatorProps {
  telemetry: ESP32Telemetry;
}

/**
 * Mô phỏng chính xác màn hình LCD 16x2 I2C theo mục 4 trong specification.md:
 * - Luân phiên 3 trang, mỗi trang 3 giây.
 * - Ưu tiên hiển thị cảnh báo nhiệt khi heat_alarm = true.
 * - Hiển thị thông báo lỗi khi DHT11 lỗi.
 */
export const LCDSimulator: React.FC<LCDSimulatorProps> = ({ telemetry }) => {
  const [currentPage, setCurrentPage] = useState<number>(1);

  const {
    temperature_c,
    humidity_pct,
    dht_ok,
    fan_on,
    is_dark,
    pir_ready,
    pir_warmup_remaining_sec,
    motion_detected,
    door_command,
    heat_alarm,
    smoke_alarm
  } = telemetry;

  // Luân phiên 3 trang, mỗi trang 3 giây
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentPage((prev) => (prev % 3) + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Tạo 2 dòng văn bản 16 ký tự của LCD 16x2
  let line1 = '';
  let line2 = '';

  if (heat_alarm) {
    // Khi cảnh báo nhiệt đang bật, LCD ưu tiên hiển thị cảnh báo nhiệt
    line1 = '!CANH BAO NHIET!';
    line2 = `T:${temperature_c !== null ? temperature_c.toFixed(1) : '--'}C COI+LED3`;
  } else if (smoke_alarm) {
    line1 = '!CANH BAO KHOI!';
    line2 = `KHOI:${telemetry.smoke_ppm}PPM NGUY`;
  } else {
    switch (currentPage) {
      case 1:
        // Trang 1: Nhiệt độ, độ ẩm và trạng thái quạt
        if (!dht_ok || temperature_c === null || humidity_pct === null) {
          line1 = 'DHT11 DOC LOI!';
          line2 = `QUAT: ${fan_on ? 'BAT' : 'TAT'}`;
        } else {
          line1 = `T:${temperature_c.toFixed(1)}C H:${humidity_pct.toFixed(0)}%`;
          line2 = `QUAT: ${fan_on ? 'BAT ' : 'TAT '} (AUTO)`;
        }
        break;

      case 2:
        // Trang 2: Sáng/tối, trạng thái PIR hoặc thời gian chờ khởi động
        line1 = `AS: ${is_dark ? 'TOI (LED1 ON)' : 'SANG (LED1 OFF)'}`;
        if (!pir_ready) {
          line2 = `PIR KHOI DONG:${pir_warmup_remaining_sec}s`;
        } else {
          line2 = `PIR: ${motion_detected ? 'CO NGUOI' : 'KHONG NGUOI'}`;
        }
        break;

      case 3:
        // Trang 3: Lệnh cửa mở/đóng, trạng thái cảnh báo
        line1 = `CUA: ${door_command === 'open' ? 'MO (90 DEG)' : 'DONG (0 DEG)'}`;
        line2 = `ALARM: ${heat_alarm ? 'ACTIVE' : 'BINH THUONG'}`;
        break;
    }
  }

  // Căn chỉnh độ dài đúng 16 ký tự để mô phỏng chuẩn LCD 16x2
  const pad16 = (str: string) => str.padEnd(16, ' ').slice(0, 16);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Monitor className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Mô phỏng LCD I2C 16×2 (0x27 / 0x3F)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-500">
              {heat_alarm ? '🚨 Ưu tiên cảnh báo' : `Trang ${currentPage}/3 (Đổi mỗi 3s)`}
            </span>
            <div className="flex gap-1">
              <span className={`w-2 h-2 rounded-full transition-colors ${currentPage === 1 && !heat_alarm ? 'bg-blue-600' : 'bg-slate-200'}`}></span>
              <span className={`w-2 h-2 rounded-full transition-colors ${currentPage === 2 && !heat_alarm ? 'bg-blue-600' : 'bg-slate-200'}`}></span>
              <span className={`w-2 h-2 rounded-full transition-colors ${currentPage === 3 && !heat_alarm ? 'bg-blue-600' : 'bg-slate-200'}`}></span>
            </div>
          </div>
        </div>

        {/* Khung LCD phần cứng chân thực */}
        <div className="bg-slate-900 p-3 sm:p-4 rounded-xl border-4 border-slate-300 shadow-inner">
          <div className="bg-[#0b2b4d] px-3.5 py-2.5 rounded shadow-inner border border-blue-900/60 font-mono text-cyan-300 font-bold tracking-widest text-sm sm:text-base">
            <div className="whitespace-pre overflow-hidden leading-snug drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">
              {pad16(line1)}
            </div>
            <div className="whitespace-pre overflow-hidden leading-snug mt-1 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">
              {pad16(line2)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-100">
        <span>Giao tiếp: I2C (SDA: GPIO 21, SCL: GPIO 22)</span>
      </div>
    </div>
  );
};

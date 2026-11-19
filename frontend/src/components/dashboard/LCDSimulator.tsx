import React from 'react';
import { Monitor } from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';
import { useLCDContent } from '../../hooks/useLCDContent';

interface LCDSimulatorProps {
  telemetry: ESP32Telemetry;
}

/**
 * Mô phỏng chính xác màn hình LCD 16x2 I2C theo hàm updateLCD() trong ESP32_DigitalTwin_BanGiao.ino:
 * - Chu kỳ lật trang: 4 giây (LCD_PAGE_MS = 4000).
 * - Dòng 1: Luôn hiển thị nhiệt độ/độ ẩm hoặc báo lỗi DHT11.
 * - Dòng 2: Ưu tiên cảnh báo nhiệt (heat_alarm) -> PIR warm-up -> Luân phiên 3 trang:
 *     Trang 0: L1:[ON|OFF] L2:[ON|OFF]
 *     Trang 1: C:[MO|DONG] Q:[ON|OFF]
 *     Trang 2: Trạng thái PIR & giữ/đóng cửa
 */
export const LCDSimulator: React.FC<LCDSimulatorProps> = ({ telemetry }) => {
  const { line1, line2, currentPage, pageTitle } = useLCDContent(telemetry);
  const { heat_alarm, smoke_alarm, pir_ready } = telemetry;

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
              {pageTitle}
            </span>
            <div className="flex gap-1">
              {[0, 1, 2].map((p) => (
                <span
                  key={p}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    currentPage === p && !heat_alarm && !smoke_alarm && pir_ready ? 'bg-blue-600' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Khung LCD phần cứng chân thực */}
        <div className="bg-slate-900 p-3 sm:p-4 rounded-xl border-4 border-slate-300 shadow-inner">
          <div className="bg-[#0b2b4d] px-3.5 py-2.5 rounded shadow-inner border border-blue-900/60 font-mono text-cyan-300 font-bold tracking-widest text-sm sm:text-base">
            <div className="whitespace-pre overflow-hidden leading-snug drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">
              {line1}
            </div>
            <div className="whitespace-pre overflow-hidden leading-snug mt-1 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">
              {line2}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-100">
        <span>Giao tiếp: I2C (SDA: GPIO 21, SCL: GPIO 22)</span>
        <span className="font-mono text-[10px] text-slate-400">Khớp firmware updateLCD()</span>
      </div>
    </div>
  );
};

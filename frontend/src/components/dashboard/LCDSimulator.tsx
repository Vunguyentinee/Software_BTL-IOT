import React, { useState, useEffect } from 'react';
import { Monitor } from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';

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
  const [currentPage, setCurrentPage] = useState<number>(0);

  const {
    temperature_c,
    humidity_pct,
    dht_ok,
    fan_on,
    led1_on,
    led2_on,
    pir_ready,
    pir_warmup_remaining_sec,
    motion_detected,
    door_command,
    heat_alarm,
    buzzer_on,
    smoke_alarm,
    smoke_ppm,
  } = telemetry;

  // Luân phiên 3 trang (0, 1, 2) mỗi 4 giây khớp với LCD_PAGE_MS = 4000UL trên bo ESP32 thật
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentPage((prev) => (prev + 1) % 3);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // 1. DÒNG 1: Cố định thông số DHT11 ở các trang thông thường, hoặc hiển thị cảnh báo khẩn cấp
  let line1 = '';
  if (smoke_alarm) {
    line1 = '!CANH BAO KHOI!';
  } else if (dht_ok && temperature_c !== null && humidity_pct !== null) {
    line1 = `T:${temperature_c.toFixed(1)}C H:${humidity_pct.toFixed(0)}%`;
  } else {
    line1 = 'DHT11: LOI/CHO';
  }

  // 2. DÒNG 2: Xử lý theo thứ tự ưu tiên (Khói -> Nhiệt -> PIR warm-up -> Luân phiên 3 trang)
  let line2 = '';
  if (smoke_alarm) {
    // Ưu tiên cao nhất: Báo động khói / khí độc
    line2 = `KHOI:${smoke_ppm}PPM NGUY`;
  } else if (heat_alarm) {
    // Ưu tiên cảnh báo nhiệt độ cao
    line2 = buzzer_on ? 'NONG! L3:ON B:ON' : 'NONG! L3:ON B:OFF';
  } else if (!pir_ready) {
    // Ưu tiên khi PIR đang warm-up 60s
    line2 = `PIR:${pir_warmup_remaining_sec}s L1:${led1_on ? 'ON' : 'OFF'}`;
  } else {
    // Luân phiên 3 trang bình thường (4 giây/trang)
    switch (currentPage) {
      case 0:
        line2 = `L1:${led1_on ? 'ON' : 'OFF'} L2:${led2_on ? 'ON' : 'OFF'}`;
        break;
      case 1:
        line2 = `C:${door_command === 'open' ? 'MO' : 'DONG'} Q:${fan_on ? 'ON' : 'OFF'}`;
        break;
      case 2:
        if (motion_detected) {
          line2 = 'PIR:1 GIU CUA MO';
        } else if (door_command === 'open') {
          line2 = 'Dong cua sau 10s';
        } else {
          line2 = 'PIR:0 CUA DONG';
        }
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
              {smoke_alarm
                ? '🔥 Báo động khói'
                : heat_alarm
                ? '🚨 Ưu tiên cảnh báo nhiệt'
                : !pir_ready
                ? '⏳ PIR Khởi động'
                : `Trang ${currentPage + 1}/3 (Đổi mỗi 4s)`}
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
        <span className="font-mono text-[10px] text-slate-400">Khớp firmware updateLCD()</span>
      </div>
    </div>
  );
};

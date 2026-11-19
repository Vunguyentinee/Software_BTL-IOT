import { useState, useEffect } from 'react';
import { ESP32Telemetry } from '../types/telemetry';

export interface LCDContentResult {
  line1: string;
  line2: string;
  currentPage: number;
  pageTitle: string;
}

const pad16 = (str: string) => str.padEnd(16, ' ').slice(0, 16);

/**
 * Hook dùng chung tạo nội dung LCD 16x2 chuẩn theo firmware ESP32_DigitalTwin_BanGiao.ino:
 * - Chu kỳ lật trang: 4s
 * - Dòng 1: Cố định thông số DHT11 hoặc báo khói/lỗi
 * - Dòng 2: Ưu tiên Khói -> Nhiệt -> PIR warm-up -> Luân phiên 3 trang
 */
export function useLCDContent(telemetry: ESP32Telemetry): LCDContentResult {
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

  // Luân phiên 3 trang mỗi 4s
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentPage((prev) => (prev + 1) % 3);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // 1. DÒNG 1
  let line1 = '';
  if (smoke_alarm) {
    line1 = '!CANH BAO KHOI!';
  } else if (dht_ok && temperature_c !== null && humidity_pct !== null) {
    line1 = `T:${temperature_c.toFixed(1)}C H:${humidity_pct.toFixed(0)}%`;
  } else {
    line1 = 'DHT11: LOI/CHO';
  }

  // 2. DÒNG 2
  let line2 = '';
  if (smoke_alarm) {
    line2 = `KHOI:${smoke_ppm ?? 0}PPM NGUY`;
  } else if (heat_alarm) {
    line2 = buzzer_on ? 'NONG! L3:ON B:ON' : 'NONG! L3:ON B:OFF';
  } else if (!pir_ready) {
    line2 = `PIR:${pir_warmup_remaining_sec ?? 60}s L1:${led1_on ? 'ON' : 'OFF'}`;
  } else {
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

  let pageTitle = `Trang ${currentPage + 1}/3`;
  if (smoke_alarm) pageTitle = '🔥 Báo động khói';
  else if (heat_alarm) pageTitle = '🚨 Cảnh báo nhiệt';
  else if (!pir_ready) pageTitle = '⏳ PIR Khởi động';

  return {
    line1: pad16(line1),
    line2: pad16(line2),
    currentPage,
    pageTitle,
  };
}

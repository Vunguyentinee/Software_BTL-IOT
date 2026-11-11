import React, { useState } from 'react';
import { Code, Copy, Check } from 'lucide-react';
import { ESP32Telemetry } from '../../types/telemetry';

interface JsonTelemetryViewerProps {
  telemetry: ESP32Telemetry;
}

export const JsonTelemetryViewer: React.FC<JsonTelemetryViewerProps> = ({ telemetry }) => {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Lọc định dạng gói tin JSON chuẩn mục 5 trong specification.md
  const specJson = {
    temperature_c: telemetry.temperature_c,
    humidity_pct: telemetry.humidity_pct,
    dht_ok: telemetry.dht_ok,
    pir_ready: telemetry.pir_ready,
    motion_detected: telemetry.motion_detected,
    is_dark: telemetry.is_dark,
    door_command: telemetry.door_command,
    fan_on: telemetry.fan_on,
    led1_on: telemetry.led1_on,
    led2_on: telemetry.led2_on,
    led3_on: telemetry.led3_on,
    heat_alarm: telemetry.heat_alarm,
    uptime_ms: telemetry.uptime_ms,
    // Các trường đo Gas & mở rộng
    smoke_raw: telemetry.smoke_raw ?? null,
    smoke_ppm: telemetry.smoke_ppm,
    smoke_alarm: telemetry.smoke_alarm,
    system_mode: telemetry.system_mode,
  };

  const jsonString = JSON.stringify(specJson, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
      <div className="flex items-center justify-between">
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-xs font-bold text-slate-800 hover:text-blue-600 uppercase tracking-wider transition-colors"
        >
          <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
            <Code className="w-4 h-4" />
          </div>
          <span>Bản tin JSON Telemetry Serial / MQTT</span>
          <span className="text-[10px] text-slate-400 lowercase font-normal">({isOpen ? 'thu gọn' : 'bấm để xem'})</span>
        </button>

        <div className="flex items-center gap-2">
          {isOpen && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-xs transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">Đã sao chép</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Sao chép JSON</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="mt-4">
          <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 text-xs font-mono text-emerald-400 overflow-x-auto max-h-64 shadow-inner selection:bg-emerald-900">
            <pre>{jsonString}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

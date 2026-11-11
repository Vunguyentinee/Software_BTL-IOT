import React, { useState, useEffect } from 'react';
import { 
  SlidersHorizontal, 
  X, 
  RotateCcw, 
  Check, 
  AlertCircle, 
  Fan, 
  ShieldAlert, 
  Flame, 
  Loader2,
  Info
} from 'lucide-react';
import { DeviceThresholds } from '../../types/telemetry';
import { DEFAULT_THRESHOLDS } from '../../services/mockData';

interface ThresholdModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentThresholds: DeviceThresholds;
  onSave: (newThresholds: DeviceThresholds) => Promise<void>;
}

export const ThresholdModal: React.FC<ThresholdModalProps> = ({
  isOpen,
  onClose,
  currentThresholds,
  onSave,
}) => {
  const [formData, setFormData] = useState<DeviceThresholds>({ ...currentThresholds });
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Đồng bộ formData với currentThresholds mới nhất khi modal mở ra hoặc thresholds thay đổi
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...currentThresholds });
      setErrorMsg(null);
    }
  }, [isOpen, currentThresholds]);

  if (!isOpen) return null;

  const handleChange = (field: keyof DeviceThresholds, value: string) => {
    const num = parseFloat(value);
    setFormData((prev) => ({
      ...prev,
      [field]: isNaN(num) ? 0 : num,
    }));
    setErrorMsg(null);
  };

  const handleResetDefault = () => {
    setFormData({ ...DEFAULT_THRESHOLDS });
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Kiểm tra logic Hysteresis cho Quạt
    if (formData.fan_off_temp >= formData.fan_on_temp) {
      setErrorMsg('Lỗi Quạt: Ngưỡng tắt quạt phải nhỏ hơn ngưỡng bật để tạo vùng trễ Hysteresis tránh dao động liên tục!');
      return;
    }

    // 2. Kiểm tra logic Hysteresis cho Cảnh báo nhiệt
    if (formData.heat_alarm_off_temp >= formData.heat_alarm_on_temp) {
      setErrorMsg('Lỗi Báo Nhiệt: Ngưỡng tắt cảnh báo phải nhỏ hơn ngưỡng bật cảnh báo!');
      return;
    }

    // 3. Kiểm tra tương quan giữa Quạt và Cảnh báo nhiệt
    if (formData.fan_on_temp > formData.heat_alarm_on_temp) {
      setErrorMsg('Ngưỡng bật quạt làm mát phải nhỏ hơn hoặc bằng ngưỡng báo động nhiệt!');
      return;
    }

    // 4. Kiểm tra giới hạn vật lý
    if (formData.fan_off_temp < 15 || formData.heat_alarm_on_temp > 70) {
      setErrorMsg('Nhiệt độ cài đặt ngoài khoảng hợp lý (15°C - 70°C)!');
      return;
    }

    if (formData.smoke_alarm_ppm < 50 || formData.smoke_alarm_ppm > 1000) {
      setErrorMsg('Ngưỡng nồng độ khói phải nằm trong khoảng 50 - 1000 PPM!');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi khi lưu cấu hình');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white border border-slate-200 w-full max-w-xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-50 text-amber-700 rounded-xl border border-amber-200">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Cấu Hình Ngưỡng Vận Hành ESP32
              </h3>
              <p className="text-xs text-slate-500">
                Điều chỉnh vùng trễ (Hysteresis) quạt làm mát, còi báo nhiệt và ngưỡng khói
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-xs">
          
          {/* LỖI VALIDATION */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="font-medium">{errorMsg}</span>
            </div>
          )}

          {/* SECTION 1: QUẠT LÀM MÁT (HYSTERESIS) */}
          <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Fan className="w-4 h-4 text-blue-600" />
                <h4 className="text-xs font-bold text-slate-800 uppercase">
                  1. Ngưỡng Quạt Làm Mát (GPIO 2)
                </h4>
              </div>
              <span className="text-[11px] text-blue-700 font-mono font-medium">
                Mặc định firmware: 29.5°C – 30.0°C
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 mb-1 font-medium">
                  Nhiệt độ BẬT quạt (≥ °C):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    value={formData.fan_on_temp}
                    onChange={(e) => handleChange('fan_on_temp', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-xs"
                    required
                  />
                  <span className="absolute right-3 top-2.5 text-slate-400 font-semibold">°C</span>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-medium">
                  Nhiệt độ TẮT quạt (≤ °C):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    value={formData.fan_off_temp}
                    onChange={(e) => handleChange('fan_off_temp', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-xs"
                    required
                  />
                  <span className="absolute right-3 top-2.5 text-slate-400 font-semibold">°C</span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-1.5 text-[11px] text-slate-600 bg-white/80 p-2.5 rounded-lg border border-slate-200">
              <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
              <span>
                Khi nhiệt độ ở khoảng giữa <strong>{formData.fan_off_temp}°C &lt; T &lt; {formData.fan_on_temp}°C</strong>, quạt giữ nguyên trạng thái trước đó để tránh dao động đóng ngắt liên tục.
              </span>
            </div>
          </div>

          {/* SECTION 2: CẢNH BÁO NHIỆT ĐỘ CAO (HYSTERESIS) */}
          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                <h4 className="text-xs font-bold text-slate-800 uppercase">
                  2. Ngưỡng Cảnh Báo Nhiệt Độ (LED3 & Còi)
                </h4>
              </div>
              <span className="text-[11px] text-rose-700 font-mono font-medium">
                Mặc định firmware: 30.0°C – 31.0°C
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 mb-1 font-medium">
                  Nhiệt độ KÍCH HOẠT còi + LED3 (≥ °C):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    value={formData.heat_alarm_on_temp}
                    onChange={(e) => handleChange('heat_alarm_on_temp', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 shadow-xs"
                    required
                  />
                  <span className="absolute right-3 top-2.5 text-slate-400 font-semibold">°C</span>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-medium">
                  Nhiệt độ HẾT cảnh báo (≤ °C):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    value={formData.heat_alarm_off_temp}
                    onChange={(e) => handleChange('heat_alarm_off_temp', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 shadow-xs"
                    required
                  />
                  <span className="absolute right-3 top-2.5 text-slate-400 font-semibold">°C</span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-1.5 text-[11px] text-slate-600 bg-white/80 p-2.5 rounded-lg border border-slate-200">
              <Info className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
              <span>
                Khi nhiệt độ ở giữa <strong>{formData.heat_alarm_off_temp}°C &lt; T &lt; {formData.heat_alarm_on_temp}°C</strong>, cảnh báo nhiệt giữ trạng thái trước đó. Khi cảnh báo nhiệt bật, quạt vẫn chạy.
              </span>
            </div>
          </div>

          {/* SECTION 3: CẢNH BÁO NỒNG ĐỘ KHÓI */}
          <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-purple-600" />
                <h4 className="text-xs font-bold text-slate-800 uppercase">
                  3. Ngưỡng Cảnh Báo Khói (Gas AO GPIO 34)
                </h4>
              </div>
              <span className="text-[11px] text-purple-700 font-mono font-medium">
                Mặc định: 300 PPM
              </span>
            </div>

            <div>
              <label className="block text-slate-600 mb-1 font-medium">
                Nồng độ khói báo động nguy cơ cháy (≥ PPM):
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="10"
                  value={formData.smoke_alarm_ppm}
                  onChange={(e) => handleChange('smoke_alarm_ppm', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 shadow-xs"
                  required
                />
                <span className="absolute right-3 top-2.5 text-slate-400 font-semibold">PPM</span>
              </div>
            </div>
          </div>

          {/* MODAL FOOTER */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleResetDefault}
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Khôi phục chuẩn Spec</span>
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 font-semibold border border-slate-300 shadow-xs transition-colors"
              >
                Hủy
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs transition-all active:scale-95 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Lưu & Đồng bộ ESP32</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};

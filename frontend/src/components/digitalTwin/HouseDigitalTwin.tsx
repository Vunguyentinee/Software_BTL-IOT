import React, { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ESP32Telemetry } from '../../types/telemetry';
import { HouseGeometry } from './HouseGeometry';
import { HouseLights } from './HouseLights';
import { HouseSensors } from './HouseSensors';

interface HouseDigitalTwinProps {
  telemetry: ESP32Telemetry;
}

/** Fallback khi đang tải 3D scene */
function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#94a3b8" wireframe />
    </mesh>
  );
}

/** Thông tin overlay góc dưới trái */
function StatusOverlay({ telemetry }: { telemetry: ESP32Telemetry }) {
  const { temperature_c, humidity_pct, fan_on, door_command, heat_alarm, smoke_alarm, motion_detected, is_dark } = telemetry;

  const badges = [
    fan_on && { label: '🔄 Quạt ON', color: 'bg-green-500' },
    door_command === 'open' && { label: '🚪 Cửa Mở', color: 'bg-blue-500' },
    heat_alarm && { label: '🌡️ Báo Nhiệt!', color: 'bg-red-500' },
    smoke_alarm && { label: '💨 Báo Khói!', color: 'bg-orange-500' },
    motion_detected && { label: '🏃 Chuyển Động', color: 'bg-yellow-500' },
    is_dark && { label: '🌙 Trời Tối', color: 'bg-purple-500' },
  ].filter(Boolean) as { label: string; color: string }[];

  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 pointer-events-none">
      {/* Nhiệt độ & Độ ẩm */}
      <div className="bg-slate-900/80 text-white text-xs rounded-lg px-3 py-1.5 font-mono flex gap-3">
        <span>🌡️ {(temperature_c ?? 0).toFixed(1)}°C</span>
        <span>💧 {(humidity_pct ?? 0).toFixed(0)}%</span>
      </div>
      {/* Badge trạng thái */}
      {badges.map((b) => (
        <span
          key={b.label}
          className={`${b.color} text-white text-xs font-medium rounded-lg px-2.5 py-0.5 w-fit animate-pulse`}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

export const HouseDigitalTwin: React.FC<HouseDigitalTwinProps> = ({ telemetry }) => {
  const [showHelp, setShowHelp] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  return (
    <div className="relative w-full" style={{ height: '480px' }}>
      {/* Header controls */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <span className="bg-slate-900/80 text-white text-xs font-semibold rounded-lg px-3 py-1.5 shadow">
          🏠 Bản sao số — Mô hình nhà IoT
        </span>
        <button
          onClick={() => setShowLabels(!showLabels)}
          className={`text-xs rounded-lg px-2.5 py-1.5 transition-colors font-medium shadow ${
            showLabels ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-slate-900/70 text-slate-300 hover:text-white'
          }`}
          title="Bật/Tắt nhãn cảm biến"
        >
          🏷️ Nhãn: {showLabels ? 'BẬT' : 'TẮT'}
        </button>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="bg-slate-900/70 text-slate-300 hover:text-white text-xs rounded-lg px-2.5 py-1.5 transition-colors shadow"
          title="Hướng dẫn điều khiển 3D"
        >
          {showHelp ? '✕ Đóng' : '? Trợ giúp'}
        </button>
      </div>

      {/* Hướng dẫn tương tác */}
      {showHelp && (
        <div className="absolute top-12 left-3 z-10 bg-slate-900/90 text-slate-200 text-xs rounded-xl px-4 py-3 max-w-xs">
          <p className="font-semibold mb-1 text-white">Điều hướng 3D:</p>
          <ul className="space-y-0.5 text-slate-300">
            <li>🖱️ <strong>Kéo trái</strong> — Xoay mô hình</li>
            <li>🖱️ <strong>Cuộn</strong> — Phóng to / thu nhỏ</li>
            <li>🖱️ <strong>Kéo phải</strong> — Di chuyển camera</li>
          </ul>
          <p className="mt-2 font-semibold text-white">Phần tử phản ứng thời gian thực:</p>
          <ul className="space-y-0.5 text-slate-300">
            <li>🔄 Cánh quạt quay khi Fan ON</li>
            <li>🚪 Cửa xoay khi Servo mở/đóng</li>
            <li>💡 Đèn vàng khi LED1 sáng</li>
            <li>🌡️ Màu tường thay đổi theo nhiệt độ</li>
            <li>🏃 PIR dome đổi màu khi có chuyển động</li>
          </ul>
        </div>
      )}

      {/* Status overlay */}
      <StatusOverlay telemetry={telemetry} />

      {/* Canvas 3D */}
      <Canvas
        className="w-full h-full rounded-2xl"
        style={{ background: 'linear-gradient(to bottom, #e8f4fd 0%, #c5ddf4 40%, #d4c9b8 100%)' }}
        camera={{ position: [32, 28, 38], fov: 48 }}
        shadows
      >
        <Suspense fallback={<LoadingFallback />}>
          {/* Ánh sáng */}
          <HouseLights telemetry={telemetry} />

          {/* Geometry nhà (tường, mái, cửa sổ, LCD, PIR) */}
          <HouseGeometry telemetry={telemetry} />

          {/* Sensor động: quạt, cửa servo, labels */}
          <HouseSensors telemetry={telemetry} showLabels={showLabels} />

          {/* Điều khiển xoay/zoom */}
          <OrbitControls
            target={[0, 9.5, 0]}
            minDistance={15}
            maxDistance={85}
            maxPolarAngle={Math.PI / 2.05}
            enablePan={true}
            enableDamping
            dampingFactor={0.08}
          />
        </Suspense>
      </Canvas>
    </div>
  );
};

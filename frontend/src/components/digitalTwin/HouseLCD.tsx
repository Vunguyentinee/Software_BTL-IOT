import React from 'react';
import { Html } from '@react-three/drei';
import { ESP32Telemetry } from '../../types/telemetry';
import { useLCDContent } from '../../hooks/useLCDContent';

interface HouseLCDProps {
  telemetry: ESP32Telemetry;
}

/**
 * Màn hình LCD 1602 I2C chân thực gắn trên mặt trước mô hình 3D:
 * - Đồng bộ 1:1 thời gian thực với LCDSimulator và firmware ESP32
 * - Chu kỳ lật 3 trang mỗi 4s, hiển thị cảnh báo khói / nhiệt độ / PIR
 * - Hiệu ứng đèn nền xanh (Blue Backlight) với chữ dot-matrix phát sáng
 */
export const HouseLCD: React.FC<HouseLCDProps> = ({ telemetry }) => {
  const { line1, line2 } = useLCDContent(telemetry);

  return (
    <group position={[-4, 7.5, -7.8]}>
      {/* 1. Bo mạch PCB nền xanh lá/xanh đen của module LCD 1602 */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[8.4, 3.8, 0.2]} />
        <meshStandardMaterial color="#064e3b" roughness={0.5} metalness={0.2} />
      </mesh>

      {/* 4 ốc vít kim loại M2.5 ở 4 góc bo mạch (như mô hình thật) */}
      {[
        [-3.8, 1.5],
        [3.8, 1.5],
        [-3.8, -1.5],
        [3.8, -1.5],
      ].map(([x, y], idx) => (
        <mesh key={idx} position={[x, y, 0.12]}>
          <cylinderGeometry args={[0.2, 0.2, 0.1, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}

      {/* 2. Khung viền kim loại đen bao quanh panel hiển thị */}
      <mesh position={[0, 0, 0.12]}>
        <boxGeometry args={[7.4, 2.6, 0.15]} />
        <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.5} />
      </mesh>

      {/* 3. Panel kính LCD 1602 Blue Backlight (phát sáng xanh) */}
      <mesh position={[0, 0, 0.22]}>
        <boxGeometry args={[6.8, 2.0, 0.08]} />
        <meshStandardMaterial
          color="#0284c7"
          emissive="#0369a1"
          emissiveIntensity={0.65}
          roughness={0.15}
        />
      </mesh>

      {/* 4. Văn bản LCD 16x2 hiển thị trực tiếp (đồng bộ với LCDSimulator) */}
      <group position={[0, 0, 0.28]} rotation={[0, Math.PI, 0]}>
        <Html
          transform
          scale={0.038}
          distanceFactor={30}
          style={{
            width: '175px',
            height: '50px',
            background: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: '2px 6px',
            fontFamily: '"Courier New", Consolas, "Lucida Console", monospace',
            fontWeight: 800,
            fontSize: '13px',
            lineHeight: 1.3,
            color: '#f0f9ff',
            textShadow: '0 0 5px rgba(56, 189, 248, 0.95), 0 0 10px rgba(14, 165, 233, 0.6)',
            letterSpacing: '0.8px',
            whiteSpace: 'pre',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div>{line1}</div>
          <div>{line2}</div>
        </Html>
      </group>
    </group>
  );
};

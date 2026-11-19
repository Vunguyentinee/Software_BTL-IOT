import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseSensorsProps {
  telemetry: ESP32Telemetry;
  showLabels?: boolean;
}

/** Nhãn HTML overlay nổi bên trên sensor */
function SensorLabel({
  label,
  value,
  color = '#fff',
  visible = true,
}: {
  label: string;
  value: string;
  color?: string;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <Html
      center
      distanceFactor={32}
      style={{
        background: 'rgba(15,23,42,0.88)',
        color,
        fontSize: '11px',
        padding: '3px 8px',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        fontFamily: 'monospace',
        border: `1px solid ${color}55`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        transform: 'translate3d(0,0,0)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '9px', opacity: 0.8, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: 'bold' }}>{value}</div>
    </Html>
  );
}

/** Cánh quạt 2 cánh màu đỏ đối xứng, quay theo fan_on */
function Fan({ fanOn }: { fanOn: boolean }) {
  const fanBladeRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (fanBladeRef.current) {
      if (fanOn) {
        // Tốc độ quay nhanh quanh trục Z khi bật
        fanBladeRef.current.rotation.z += delta * 16;
      } else {
        // Dừng dần tự nhiên
        fanBladeRef.current.rotation.z += delta * 0.8 * Math.max(0, 1 - (fanBladeRef.current.rotation.z % (Math.PI * 2)));
      }
    }
  });

  return (
    <group>
      {/* 1. Giá treo motor gắn vào xà trần nhà */}
      <mesh position={[0, 1.4, 0]}>
        <boxGeometry args={[0.3, 1.2, 0.3]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* 2. Củ motor mini DC màu xám bạc kim loại */}
      <mesh position={[0, 0.5, -0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 1.1, 16]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.85} roughness={0.2} />
      </mesh>
      {/* Dây điện motor (đỏ - đen) luồn lên trần */}
      <mesh position={[-0.15, 0.9, -0.8]}>
        <boxGeometry args={[0.06, 0.6, 0.06]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
      <mesh position={[0.15, 0.9, -0.8]}>
        <boxGeometry args={[0.06, 0.6, 0.06]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>

      {/* 3. Cụm 2 cánh quạt đỏ đối xứng 180 độ quay quanh trục Z */}
      <group position={[0, 0.5, 0.12]} ref={fanBladeRef}>
        {/* Hub trục tâm quạt màu trắng */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.35, 0.35, 0.25, 16]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.4} roughness={0.2} />
        </mesh>
        {/* Chóp nón tròn đỏ ở tâm quạt */}
        <mesh position={[0, 0, 0.15]}>
          <sphereGeometry args={[0.3, 12, 10]} />
          <meshStandardMaterial color="#dc2626" roughness={0.3} />
        </mesh>

        {/* Cánh 1: Vươn sang bên PHẢI (+X) */}
        <group rotation={[0, 0, 0.08]}>
          <mesh position={[1.35, 0, 0]}>
            <boxGeometry args={[2.3, 0.65, 0.09]} />
            <meshStandardMaterial color="#dc2626" roughness={0.35} />
          </mesh>
        </group>

        {/* Cánh 2: Đối xứng 180 độ, vươn sang bên TRÁI (-X) */}
        <group rotation={[0, 0, Math.PI + 0.08]}>
          <mesh position={[1.35, 0, 0]}>
            <boxGeometry args={[2.3, 0.65, 0.09]} />
            <meshStandardMaterial color="#dc2626" roughness={0.35} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export const HouseSensors: React.FC<HouseSensorsProps> = ({ telemetry, showLabels = true }) => {
  const { fan_on, temperature_c, humidity_pct, smoke_ppm, smoke_alarm, pir_ready } = telemetry;

  return (
    <group>
      {/* ===== QUẠT MINI 2 CÁNH ĐỎ LÀM MÁT (Gắn bên trong nội thất nhà) ===== */}
      <group position={[-2.5, 11.2, 0]}>
        <Fan fanOn={fan_on} />
        <group position={[0, 2.4, 0]}>
          <SensorLabel
            label="QUẠT LÀM MÁT"
            value={fan_on ? '🔄 ON' : '⏹ OFF'}
            color={fan_on ? '#4ade80' : '#94a3b8'}
            visible={showLabels}
          />
        </group>
      </group>

      {/* ===== DHT11 (trên sườn mái trái, góc nghiêng) ===== */}
      <group position={[-5, 17.8, -2]} rotation={[0, 0, 0.4]}>
        {/* Module DHT11 xanh biển */}
        <mesh>
          <boxGeometry args={[2.2, 2.8, 0.8]} />
          <meshStandardMaterial color="#1d4ed8" roughness={0.4} />
        </mesh>
        {/* Chân cắm */}
        {[-0.5, 0, 0.5].map((x, i) => (
          <mesh key={i} position={[x, -1.8, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 1.2, 6]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.8} />
          </mesh>
        ))}
        <group position={[0, 2.5, 0]} rotation={[0, 0, -0.4]}>
          <SensorLabel
            label="DHT11"
            value={`${(temperature_c ?? 0).toFixed(1)}°C  ${(humidity_pct ?? 0).toFixed(0)}%`}
            color="#60a5fa"
            visible={showLabels}
          />
        </group>
      </group>

      {/* ===== GAS SENSOR MQ (trên sườn mái trái/giữa) ===== */}
      <group position={[-1, 19.5, -2]} rotation={[0, 0, 0.4]}>
        {/* Module MQ đen */}
        <mesh>
          <boxGeometry args={[2.8, 2.2, 1.2]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} />
        </mesh>
        {/* Sensor dome tròn kim loại */}
        <mesh position={[0, 1.3, 0]}>
          <cylinderGeometry args={[0.75, 0.75, 0.5, 12]} />
          <meshStandardMaterial
            color={smoke_alarm ? '#ef4444' : '#64748b'}
            emissive={smoke_alarm ? '#dc2626' : '#000'}
            emissiveIntensity={smoke_alarm ? 0.6 : 0}
            metalness={0.5}
          />
        </mesh>
        <group position={[0, 3.2, 0]} rotation={[0, 0, -0.4]}>
          <SensorLabel
            label="Gas MQ (AO GPIO34)"
            value={`${smoke_ppm ?? 0} ppm${smoke_alarm ? ' 🚨' : ''}`}
            color={smoke_alarm ? '#f87171' : '#fbbf24'}
            visible={showLabels}
          />
        </group>
      </group>

      {/* ===== LDR / CẢM BIẾN ÁNH SÁNG (trên sườn mái phải) ===== */}
      <group position={[6, 17.3, 2]} rotation={[0, 0, -0.4]}>
        <mesh>
          <boxGeometry args={[1.6, 1.2, 1.0]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        <group position={[0, 2.0, 0]} rotation={[0, 0, 0.4]}>
          <SensorLabel
            label="LDR (DO GPIO33)"
            value={telemetry.is_dark ? '🌙 DARK' : '☀️ LIGHT'}
            color={telemetry.is_dark ? '#c084fc' : '#fde68a'}
            visible={showLabels}
          />
        </group>
      </group>

      {/* ===== PIR LABEL (tường trước, bên phải khi nhìn từ trước vào) ===== */}
      <group position={[-6.5, 10.5, -8.0]}>
        <SensorLabel
          label="PIR GPIO32"
          value={
            !pir_ready
              ? '⏳ Warm-up'
              : telemetry.motion_detected
              ? '🏃 Motion!'
              : '😴 Clear'
          }
          color={telemetry.motion_detected ? '#f87171' : '#a3e635'}
          visible={showLabels}
        />
      </group>
    </group>
  );
};

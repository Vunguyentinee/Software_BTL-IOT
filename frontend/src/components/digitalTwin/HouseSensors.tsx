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

/** Cánh quạt quay theo fan_on */
function Fan({ fanOn }: { fanOn: boolean }) {
  const fanRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (fanRef.current) {
      if (fanOn) {
        fanRef.current.rotation.y += delta * 8; // tốc độ quay
      } else {
        // Dừng dần
        fanRef.current.rotation.y += delta * 0.5 * Math.max(0, 1 - fanRef.current.rotation.y % (Math.PI * 2));
      }
    }
  });

  return (
    <group ref={fanRef}>
      {/* Hub quạt */}
      <mesh>
        <cylinderGeometry args={[0.5, 0.5, 0.5, 8]} />
        <meshStandardMaterial color="#f0f0f0" />
      </mesh>
      {/* 2 cánh quạt màu đỏ (như model thực) */}
      {[0, Math.PI].map((angle, i) => (
        <mesh key={i} rotation={[0, angle, 0]} position={[1.2, 0, 0]}>
          <boxGeometry args={[2.5, 0.2, 1.0]} />
          <meshStandardMaterial color="#e53935" roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** Cửa servo xoay ngang (pivot từ mép trái) */
function ServoDoor({ doorOpen }: { doorOpen: boolean }) {
  const doorRef = useRef<THREE.Group>(null);
  const targetAngle = doorOpen ? -Math.PI * 0.85 : 0;
  const currentAngle = useRef(0);

  useFrame((_, delta) => {
    if (doorRef.current) {
      currentAngle.current += (targetAngle - currentAngle.current) * Math.min(1, delta * 3);
      doorRef.current.rotation.y = currentAngle.current;
    }
  });

  return (
    // Pivot tại mép trái cửa (X = -3.5, Y = 2.2, Z = -7.7)
    <group position={[-3.5, 2.2, -7.7]}>
      <group ref={doorRef}>
        {/* Cánh cửa (pivot tại X=0, cánh rộng 3.8 kéo dài về X+) */}
        <mesh position={[1.9, 0, 0]}>
          <boxGeometry args={[3.8, 4.0, 0.22]} />
          <meshStandardMaterial
            color={doorOpen ? '#B58850' : '#C8A96E'}
            roughness={0.7}
          />
        </mesh>
        {/* Tay nắm cửa */}
        <mesh position={[3.4, 0, -0.22]}>
          <sphereGeometry args={[0.22, 8, 6]} />
          <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

export const HouseSensors: React.FC<HouseSensorsProps> = ({ telemetry, showLabels = true }) => {
  const { fan_on, door_command, temperature_c, humidity_pct, smoke_ppm, smoke_alarm, pir_ready } = telemetry;
  const doorOpen = door_command === 'open';

  return (
    <group>
      {/* ===== QUẠT MINI CÁNH ĐỎ (trên sống nóc mái) ===== */}
      <group position={[3, 20.0, -0.5]}>
        <Fan fanOn={fan_on} />
        <group position={[0, 2.2, 0]}>
          <SensorLabel
            label="FAN"
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

      {/* ===== CÁNH CỬA SERVO ===== */}
      <ServoDoor doorOpen={doorOpen} />
    </group>
  );
};

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseSensorsProps {
  telemetry: ESP32Telemetry;
}

/** Nhãn HTML overlay nổi bên trên sensor */
function SensorLabel({ label, value, color = '#fff' }: { label: string; value: string; color?: string }) {
  return (
    <Html
      center
      style={{
        background: 'rgba(10,20,40,0.82)',
        color,
        fontSize: '10px',
        padding: '2px 7px',
        borderRadius: '5px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        fontFamily: 'monospace',
        border: `1px solid ${color}40`,
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: '9px', opacity: 0.7 }}>{label}</div>
      <div>{value}</div>
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
  const targetAngle = doorOpen ? -Math.PI * 0.9 : 0;
  const currentAngle = useRef(0);

  useFrame((_, delta) => {
    if (doorRef.current) {
      // Lerp mượt về góc mục tiêu
      currentAngle.current += (targetAngle - currentAngle.current) * Math.min(1, delta * 3);
      doorRef.current.rotation.y = currentAngle.current;
    }
  });

  return (
    // Pivot tại mép trái cửa (X = -3 so với giữa cửa)
    <group position={[-4.2, 2, -7.7]}>
      <group ref={doorRef}>
        {/* Cánh cửa (pivot tại X=0, cánh kéo dài về X+) */}
        <mesh position={[3, 0, 0]}>
          <boxGeometry args={[6, 4, 0.25]} />
          <meshStandardMaterial
            color={doorOpen ? '#8B6914' : '#C8A96E'}
            roughness={0.7}
          />
        </mesh>
        {/* Tay nắm */}
        <mesh position={[5.5, 0, -0.3]}>
          <sphereGeometry args={[0.3, 8, 6]} />
          <meshStandardMaterial color="#888" metalness={0.6} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

export const HouseSensors: React.FC<HouseSensorsProps> = ({ telemetry }) => {
  const { fan_on, door_command, temperature_c, humidity_pct, smoke_ppm, smoke_alarm, pir_ready } = telemetry;
  const doorOpen = door_command === 'open';

  return (
    <group>
      {/* ===== QUẠT (trên mái, phải) ===== */}
      <group position={[6, 37.5, 0]}>
        <Fan fanOn={fan_on} />
        <group position={[0, 2.5, 0]}>
          <SensorLabel
            label="FAN"
            value={fan_on ? '🔄 ON' : '⏹ OFF'}
            color={fan_on ? '#4ade80' : '#94a3b8'}
          />
        </group>
      </group>

      {/* ===== DHT11 (trên mái, trái) ===== */}
      <group position={[-6, 17.5, -2]}>
        {/* Module DHT11 (hình hộp nhỏ màu xanh) */}
        <mesh>
          <boxGeometry args={[2.5, 3, 1]} />
          <meshStandardMaterial color="#1976d2" roughness={0.5} />
        </mesh>
        {/* Chân cắm */}
        {[-0.6, 0, 0.6].map((x, i) => (
          <mesh key={i} position={[x, -2, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 1.5, 6]} />
            <meshStandardMaterial color="#aaa" metalness={0.8} />
          </mesh>
        ))}
        <group position={[0, 3, 0]}>
          <SensorLabel
            label="DHT11"
            value={`${(temperature_c ?? 0).toFixed(1)}°C  ${(humidity_pct ?? 0).toFixed(0)}%`}
            color="#60a5fa"
          />
        </group>
      </group>

      {/* ===== GAS SENSOR MQ (trên mái, giữa) ===== */}
      <group position={[0, 17.5, -1]}>
        {/* Module MQ (hình hộp đen nhỏ) */}
        <mesh>
          <boxGeometry args={[3, 2.5, 1.5]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
        </mesh>
        {/* Sensor dome tròn */}
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 0.5, 12]} />
          <meshStandardMaterial
            color={smoke_alarm ? '#ff4444' : '#888'}
            emissive={smoke_alarm ? '#ff0000' : '#000'}
            emissiveIntensity={smoke_alarm ? 0.5 : 0}
            metalness={0.4}
          />
        </mesh>
        <group position={[0, 4, 0]}>
          <SensorLabel
            label="Gas MQ (AO GPIO34)"
            value={`${smoke_ppm ?? 0} ppm${smoke_alarm ? ' 🚨' : ''}`}
            color={smoke_alarm ? '#f87171' : '#fbbf24'}
          />
        </group>
      </group>

      {/* ===== LDR / LIGHT SENSOR (trên mái, góc phải trước) ===== */}
      <group position={[8, 16, -5]}>
        <mesh>
          <boxGeometry args={[1.5, 1, 1]} />
          <meshStandardMaterial color="#333" />
        </mesh>
        <group position={[0, 2, 0]}>
          <SensorLabel
            label="LDR (DO GPIO33)"
            value={telemetry.is_dark ? '🌙 DARK' : '☀️ LIGHT'}
            color={telemetry.is_dark ? '#c084fc' : '#fde68a'}
          />
        </group>
      </group>

      {/* ===== PIR LABEL (tường trước) ===== */}
      <group position={[7, 11, -8]}>
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
        />
      </group>

      {/* ===== CÁNH CỬA SERVO ===== */}
      <ServoDoor doorOpen={doorOpen} />
    </group>
  );
};

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseGeometryProps {
  telemetry: ESP32Telemetry;
}

/** Tạo geometry cửa sổ chữ thập (2 thanh giao nhau) */
function CrossWindow({
  position,
  rotation,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Thanh ngang */}
      <mesh>
        <boxGeometry args={[4.5, 1, 0.4]} />
        <meshStandardMaterial color="#2a1a0a" />
      </mesh>
      {/* Thanh dọc */}
      <mesh>
        <boxGeometry args={[1, 4.5, 0.4]} />
        <meshStandardMaterial color="#2a1a0a" />
      </mesh>
      {/* Kính (trong suốt) */}
      <mesh position={[0, 0, 0.2]}>
        <boxGeometry args={[4.5, 4.5, 0.1]} />
        <meshStandardMaterial color="#a8d4f5" transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/** Mái nhà dạng gable (2 mặt dốc + 2 tam giác hồi) */
function GableRoof() {
  // Tạo geometry mái bằng custom vertices
  const roofGeometry = useMemo(() => {
    // Mặt cắt tam giác: đáy 20, đỉnh tại giữa, cao 21
    const geo = new THREE.BufferGeometry();

    // 6 vertices cho mái (2 mặt dốc, dọc theo trục Z=15)
    // Tọa độ: X từ -10→10, Y: đáy=0, đỉnh=21, Z: -7.5→7.5
    const vertices = new Float32Array([
      // Mặt dốc trái (nhìn từ trước)
      -10, 0, -7.5, // 0
      0, 21, -7.5,  // 1
      -10, 0, 7.5,  // 2

      0, 21, -7.5,  // 1
      0, 21, 7.5,   // 3
      -10, 0, 7.5,  // 2

      // Mặt dốc phải
      0, 21, -7.5,  // 1
      10, 0, -7.5,  // 4
      0, 21, 7.5,   // 3

      10, 0, -7.5,  // 4
      10, 0, 7.5,   // 5
      0, 21, 7.5,   // 3

      // Tam giác hồi mặt trước (Z = -7.5)
      -10, 0, -7.5,
      10, 0, -7.5,
      0, 21, -7.5,

      // Tam giác hồi mặt sau (Z = 7.5)
      10, 0, 7.5,
      -10, 0, 7.5,
      0, 21, 7.5,
    ]);

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={roofGeometry} castShadow>
      <meshStandardMaterial color="#8B6914" side={THREE.DoubleSide} roughness={0.8} />
    </mesh>
  );
}

export const HouseGeometry: React.FC<HouseGeometryProps> = ({ telemetry }) => {
  const { temperature_c, thresholds } = telemetry;

  // Màu tường theo nhiệt độ: 20°C=xanh lạnh → 35°C=đỏ cam
  const tempMin = 20;
  const tempMax = thresholds?.heat_alarm_on_temp ?? 35;
  const tempRatio = Math.max(0, Math.min(1, ((temperature_c ?? 25) - tempMin) / (tempMax - tempMin)));

  const wallColor = useMemo(() => {
    const cold = new THREE.Color('#D4E8F5'); // xanh nhạt
    const hot = new THREE.Color('#FF8C42');  // cam nóng
    return cold.clone().lerp(hot, tempRatio);
  }, [tempRatio]);

  const woodColor = '#C8A96E'; // màu gỗ MDF

  return (
    <group>
      {/* ===== THÂN NHÀ ===== */}
      {/* Tường chính (hộp rỗng: chỉ hiển thị bề mặt ngoài) */}
      {/* Tường dọc trước (mặt Z = -7.5) */}
      <mesh position={[0, 7.5, -7.65]} castShadow receiveShadow>
        <boxGeometry args={[20, 15, 0.3]} />
        <meshStandardMaterial color={wallColor} roughness={0.6} />
      </mesh>

      {/* Tường dọc sau (mặt Z = +7.5) */}
      <mesh position={[0, 7.5, 7.65]} castShadow receiveShadow>
        <boxGeometry args={[20, 15, 0.3]} />
        <meshStandardMaterial color={wallColor} roughness={0.6} />
      </mesh>

      {/* Tường hồi trái (mặt X = -10) */}
      <mesh position={[-10.15, 7.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.3, 15, 15]} />
        <meshStandardMaterial color={wallColor} roughness={0.6} />
      </mesh>

      {/* Tường hồi phải (mặt X = +10) */}
      <mesh position={[10.15, 7.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.3, 15, 15]} />
        <meshStandardMaterial color={wallColor} roughness={0.6} />
      </mesh>

      {/* Sàn nhà */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[20, 0.3, 15]} />
        <meshStandardMaterial color="#8B7355" roughness={0.9} />
      </mesh>

      {/* ===== CỬA SỔ CHỮ THẬP ===== */}
      {/* Tường trước: góc trên trái */}
      <CrossWindow position={[-6, 11, -7.9]} />

      {/* Tường hồi trái: giữa */}
      <CrossWindow position={[-10.4, 10, 0]} rotation={[0, Math.PI / 2, 0]} />

      {/* Tường hồi phải: giữa */}
      <CrossWindow position={[10.4, 10, 0]} rotation={[0, Math.PI / 2, 0]} />

      {/* ===== LCD STRIP (mặt trước, giữa) ===== */}
      {/* Nền LCD */}
      <mesh position={[-1, 7, -7.9]}>
        <boxGeometry args={[8, 2.5, 0.3]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.2} />
      </mesh>
      {/* Màn hình LCD (xanh lá hoặc xanh dương) */}
      <mesh position={[-1, 7, -8.1]}>
        <boxGeometry args={[7.5, 2, 0.1]} />
        <meshStandardMaterial color="#0d6b2e" emissive="#0d6b2e" emissiveIntensity={0.4} />
      </mesh>

      {/* ===== PIR SENSOR (phải tường trước) ===== */}
      <mesh position={[7, 8, -7.9]}>
        <boxGeometry args={[2, 2, 0.8]} />
        <meshStandardMaterial color="#2d2d2d" roughness={0.4} />
      </mesh>
      {/* Dome PIR (Sphere) */}
      <mesh position={[7, 8, -8.5]}>
        <sphereGeometry args={[0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={telemetry.motion_detected ? '#ff4444' : '#cccccc'}
          transparent
          opacity={0.8}
          roughness={0.1}
          metalness={0.3}
        />
      </mesh>

      {/* ===== KHUNG CỬA VÒNG (tường trước, dưới giữa) ===== */}
      {/* Frame trên */}
      <mesh position={[-1, 4.2, -7.9]}>
        <boxGeometry args={[7, 0.4, 0.4]} />
        <meshStandardMaterial color={woodColor} roughness={0.7} />
      </mesh>
      {/* Frame trái */}
      <mesh position={[-4.2, 2, -7.9]}>
        <boxGeometry args={[0.4, 4, 0.4]} />
        <meshStandardMaterial color={woodColor} roughness={0.7} />
      </mesh>
      {/* Frame phải */}
      <mesh position={[2.2, 2, -7.9]}>
        <boxGeometry args={[0.4, 4, 0.4]} />
        <meshStandardMaterial color={woodColor} roughness={0.7} />
      </mesh>

      {/* ===== MÁI NHÀ ===== */}
      <group position={[0, 15, 0]}>
        <GableRoof />
      </group>

      {/* ===== SÀN NỀN (ground plane) ===== */}
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#c8c8c8" roughness={1} />
      </mesh>
    </group>
  );
};

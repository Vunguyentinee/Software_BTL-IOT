import React, { useMemo } from 'react';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';
import { HouseLCD } from './HouseLCD';
import { HouseDoor } from './HouseDoor';

interface HouseGeometryProps {
  telemetry: ESP32Telemetry;
}

/** Tạo geometry cửa sổ chữ thập thanh thoát */
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
        <boxGeometry args={[3.4, 0.6, 0.25]} />
        <meshStandardMaterial color="#2a1a0a" roughness={0.7} />
      </mesh>
      {/* Thanh dọc */}
      <mesh>
        <boxGeometry args={[0.6, 3.4, 0.25]} />
        <meshStandardMaterial color="#2a1a0a" roughness={0.7} />
      </mesh>
      {/* Kính (trong suốt nhẹ) */}
      <mesh position={[0, 0, 0.08]}>
        <boxGeometry args={[3.4, 3.4, 0.06]} />
        <meshStandardMaterial color="#a8d4f5" transparent opacity={0.35} roughness={0.2} />
      </mesh>
    </group>
  );
}

/** Độ cao đỉnh mái tính từ mép tường (căn 21 cm) */
export const ROOF_PEAK_H = Math.sqrt(21); // ~4.5826 cm

/** Mái nhà dạng gable (2 mặt dốc + 2 tam giác hồi trước/sau) */
function GableRoof() {
  const roofGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const h = ROOF_PEAK_H;

    // 2 mặt dốc + 2 tam giác hồi
    // X: [-10, 10] (rộng 20cm), Z: [-7.5, 7.5] (sâu 15cm), Y: đỉnh = h
    const vertices = new Float32Array([
      // Mặt dốc trái (X: 0 -> -10)
      -10, 0, -7.5,
      0, h, -7.5,
      -10, 0, 7.5,

      0, h, -7.5,
      0, h, 7.5,
      -10, 0, 7.5,

      // Mặt dốc phải (X: 0 -> 10)
      0, h, -7.5,
      10, 0, -7.5,
      0, h, 7.5,

      10, 0, -7.5,
      10, 0, 7.5,
      0, h, 7.5,

      // Tam giác hồi mặt trước (Z = -7.5)
      -10, 0, -7.5,
      10, 0, -7.5,
      0, h, -7.5,

      // Tam giác hồi mặt sau (Z = 7.5)
      10, 0, 7.5,
      -10, 0, 7.5,
      0, h, 7.5,
    ]);

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={roofGeometry} castShadow receiveShadow>
      <meshStandardMaterial color="#B58850" side={THREE.DoubleSide} roughness={0.7} />
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

      {/* Tường dọc sau (mặt Z = +7.5) - Để hở như mô hình thực tế (ảnh 4, 5) để quan sát mạch ESP32 */}
      <mesh position={[0, 1.5, 7.65]} castShadow receiveShadow>
        <boxGeometry args={[20, 3, 0.3]} />
        <meshStandardMaterial color={wallColor} roughness={0.6} />
      </mesh>
      {/* 2 cột góc sau giữ khung mái */}
      <mesh position={[-9.85, 7.5, 7.65]}>
        <boxGeometry args={[0.3, 15, 0.3]} />
        <meshStandardMaterial color={woodColor} roughness={0.7} />
      </mesh>
      <mesh position={[9.85, 7.5, 7.65]}>
        <boxGeometry args={[0.3, 15, 0.3]} />
        <meshStandardMaterial color={woodColor} roughness={0.7} />
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
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[20, 0.3, 15]} />
        <meshStandardMaterial color="#8B7355" roughness={0.9} />
      </mesh>

      {/* ===== NỘI THẤT BÊN TRONG (mạch ESP32 & Servo bên trong như thật) ===== */}
      {/* Board ESP32 (màu đen/xanh) */}
      <mesh position={[2, 0.5, 1]}>
        <boxGeometry args={[5, 0.3, 3]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Chip ESP32 kim loại */}
      <mesh position={[2, 0.75, 1]}>
        <boxGeometry args={[2, 0.2, 2]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Servo motor xanh dương bên trong cửa (gắn ở mép bản lề X = -3.5) */}
      <mesh position={[-3.5, 1.5, -6.5]}>
        <boxGeometry args={[1.5, 2.2, 1.2]} />
        <meshStandardMaterial color="#0284c7" roughness={0.3} />
      </mesh>

      {/* ===== CỬA SỔ CHỮ THẬP ===== */}
      {/* Tường trước: chính giữa phía trên, ngay dưới chóp mái */}
      <CrossWindow position={[0, 12.0, -7.82]} />

      {/* Tường hồi trái: giữa */}
      <CrossWindow position={[-10.4, 8, 0]} rotation={[0, Math.PI / 2, 0]} />

      {/* Tường hồi phải: giữa */}
      <CrossWindow position={[10.4, 8, 0]} rotation={[0, Math.PI / 2, 0]} />

      {/* ===== MÀN HÌNH LCD 16X2 ĐỒNG BỘ THỜI GIAN THỰC (nửa bên TRÁI mặt tiền) ===== */}
      <HouseLCD telemetry={telemetry} />

      {/* ===== PIR SENSOR (nửa bên PHẢI mặt tiền khi nhìn từ trước vào) ===== */}
      <mesh position={[-6.5, 7.5, -7.84]}>
        <boxGeometry args={[2.4, 2.4, 0.2]} />
        <meshStandardMaterial color="#1e293b" roughness={0.4} />
      </mesh>
      {/* Dome PIR (Sphere bán cầu hướng ra trước Z âm) */}
      <mesh position={[-6.5, 7.5, -8.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.85, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={telemetry.motion_detected ? '#ef4444' : '#e2e8f0'}
          transparent
          opacity={0.85}
          roughness={0.2}
          metalness={0.1}
        />
      </mesh>

      {/* ===== HỆ THỐNG CỬA VÒM & CƠ CẤU SERVO SG90 THỰC TẾ ===== */}
      <HouseDoor telemetry={telemetry} />

      {/* ===== MÁI NHÀ ===== */}
      <group position={[0, 15, 0]}>
        <GableRoof />
      </group>

      {/* ===== SÀN NỀN (ground plane) - NẰM NGANG TRÊN MẶT ĐẤT ===== */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.9} />
      </mesh>
    </group>
  );
};

import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';
import { useLCDContent } from '../../hooks/useLCDContent';

interface HouseLCDProps {
  telemetry: ESP32Telemetry;
}

/**
 * Màn hình LCD 1602 I2C chân thực bằng Dynamic CanvasTexture:
 * - 100% WebGL native: sắc nét, không bị lỗi co nhỏ, không bị lệch Z-buffer
 * - Màu đèn nền xanh dương chuẩn LCD 1602 Blue Backlight (#0047AB)
 * - Tự phát sáng trong đêm 3D
 * - Đồng bộ thời gian thực từng giây với firmware và dashboard 2D
 */
export const HouseLCD: React.FC<HouseLCDProps> = ({ telemetry }) => {
  const { line1, line2 } = useLCDContent(telemetry);

  // Khởi tạo Canvas 2D độ phân giải cao và CanvasTexture
  const { canvas, texture } = useMemo(() => {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 160;
    const tex = new THREE.CanvasTexture(cvs);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return { canvas: cvs, texture: tex };
  }, []);

  // Vẽ lại canvas mỗi khi line1 hoặc line2 thay đổi (chu kỳ 4s hoặc có cảnh báo)
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Nền xanh dương phát sáng của màn LCD 1602 Blue Backlight
    const grad = ctx.createLinearGradient(0, 0, 0, 160);
    grad.addColorStop(0, '#0052cc');
    grad.addColorStop(0.5, '#003d99');
    grad.addColorStop(1, '#002966');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 160);

    // 2. Vẽ các ô ký tự ma trận 5x8 mờ nhẹ (16 cột x 2 dòng)
    ctx.fillStyle = 'rgba(0, 20, 60, 0.35)';
    const cellW = 28;
    const cellH = 58;
    const startX = 16;
    for (let row = 0; row < 2; row++) {
      const y = row === 0 ? 16 : 86;
      for (let col = 0; col < 16; col++) {
        const x = startX + col * (cellW + 2);
        ctx.fillRect(x, y, cellW, cellH);
      }
    }

    // 3. Cấu hình văn bản LCD phát quang (trắng xanh)
    ctx.font = 'bold 44px "Courier New", Consolas, "Lucida Console", monospace';
    ctx.fillStyle = '#f0f9ff';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.textBaseline = 'top';

    // 4. Vẽ 2 dòng text chuẩn LCD 16x2
    ctx.fillText(line1, 20, 22);
    ctx.fillText(line2, 20, 92);

    // 5. Viền trong phát sáng nhẹ
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 508, 156);

    // Yêu cầu Three.js tải texture mới lên GPU
    texture.needsUpdate = true;
  }, [line1, line2, canvas, texture]);

  return (
    // Đặt tại X = +4.0 (nằm ở bên TRÁI mặt tiền khi nhìn từ trước vào)
    <group position={[4.0, 7.5, 0]}>
      {/* 1. Bo mạch PCB xanh lá module LCD 1602 (nằm sát mặt ngoài tường Z = -7.84) */}
      <mesh position={[0, 0, -7.84]}>
        <boxGeometry args={[7.8, 3.4, 0.1]} />
        <meshStandardMaterial color="#064e3b" roughness={0.6} metalness={0.2} />
      </mesh>

      {/* 4 ốc vít kim loại M2.5 sáng bóng ở 4 góc bo mạch */}
      {[
        [-3.5, 1.3],
        [3.5, 1.3],
        [-3.5, -1.3],
        [3.5, -1.3],
      ].map(([x, y], idx) => (
        <mesh key={idx} position={[x, y, -7.86]}>
          <cylinderGeometry args={[0.18, 0.18, 0.08, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
        </mesh>
      ))}

      {/* 2. Khung kim loại đen bảo vệ màn hình (Z = -7.88) */}
      <mesh position={[0, 0, -7.88]}>
        <boxGeometry args={[7.0, 2.3, 0.08]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.6} />
      </mesh>

      {/* 3. Mặt kính hiển thị CanvasTexture (Z = -7.93, nổi hẳn ra ngoài mặt tường) */}
      <mesh position={[0, 0, -7.93]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[6.5, 1.9]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive="#0052cc"
          emissiveIntensity={0.8}
          roughness={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

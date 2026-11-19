import React from 'react';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseLightsProps {
  telemetry: ESP32Telemetry;
}

/**
 * Hệ thống ánh sáng môi trường (Ambient & Sunlight):
 * - Ánh sáng tự nhiên thay đổi theo cảm biến ánh sáng LDR (is_dark)
 * - Đèn nền mặt trời và fill light tạo khối 3D đổ bóng chân thực
 */
export const HouseLights: React.FC<HouseLightsProps> = ({ telemetry }) => {
  const { is_dark, smoke_alarm } = telemetry;

  // Ánh sáng môi trường: dịu và tối hơn khi trời tối (LDR kích hoạt)
  const ambientIntensity = is_dark ? 0.35 : 0.75;

  return (
    <>
      {/* Ánh sáng môi trường tổng thể */}
      <ambientLight intensity={ambientIntensity} color="#f0f4ff" />

      {/* Ánh sáng mặt trời góc cao chiếu bóng đổ tự nhiên */}
      <directionalLight
        position={[25, 35, 30]}
        intensity={is_dark ? 0.4 : 1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        color="#fffbeb"
      />

      {/* Ánh sáng phụ từ sau lưng (fill light nhẹ) */}
      <directionalLight position={[-20, 15, -20]} intensity={0.25} color="#cbd5e1" />

      {/* Báo động khói / Khí gas: Ánh sáng đỏ cam bao trùm nhẹ */}
      {smoke_alarm && (
        <pointLight
          position={[0, 16, 0]}
          intensity={2.2}
          color="#ff4422"
          distance={35}
          decay={1.6}
        />
      )}
    </>
  );
};

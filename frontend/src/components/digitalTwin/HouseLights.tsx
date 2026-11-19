import React from 'react';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseLightsProps {
  telemetry: ESP32Telemetry;
}

export const HouseLights: React.FC<HouseLightsProps> = ({ telemetry }) => {
  const { led1_on, led2_on, heat_alarm, is_dark, smoke_alarm } = telemetry;

  // Ánh sáng môi trường: tối hơn khi trời tối (LDR kích hoạt)
  const ambientIntensity = is_dark ? 0.3 : 0.7;

  return (
    <>
      {/* Ánh sáng môi trường */}
      <ambientLight intensity={ambientIntensity} color="#f0f4ff" />

      {/* Ánh sáng mặt trời từ góc cao */}
      <directionalLight
        position={[30, 40, 25]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        color="#fff8e7"
      />

      {/* Ánh sáng phụ từ phía sau (fill light) */}
      <directionalLight position={[-20, 10, -15]} intensity={0.3} color="#c8d8ff" />

      {/* LED1 — đèn trong nhà: vàng ấm (dark && motion) */}
      <pointLight
        position={[0, 5, 0]}
        intensity={led1_on ? 2.5 : 0}
        color="#FFD700"
        distance={30}
        decay={2}
      />

      {/* LED2 — cửa mở indicator: cyan */}
      <pointLight
        position={[-8, 3, 8.5]}
        intensity={led2_on ? 1.5 : 0}
        color="#00BFFF"
        distance={15}
        decay={2}
      />

      {/* LED3 / Heat Alarm — đỏ cảnh báo nhiệt */}
      <pointLight
        position={[8, 10, 0]}
        intensity={heat_alarm ? 3.0 : 0}
        color="#FF4444"
        distance={40}
        decay={1.5}
      />

      {/* Khói / Smoke alarm — flash tím/đỏ */}
      <pointLight
        position={[0, 18, 0]}
        intensity={smoke_alarm ? 2.0 : 0}
        color="#FF6688"
        distance={35}
        decay={1.8}
      />
    </>
  );
};

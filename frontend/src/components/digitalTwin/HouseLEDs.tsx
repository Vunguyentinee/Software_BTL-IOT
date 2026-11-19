import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseLEDsProps {
  telemetry: ESP32Telemetry;
}

/**
 * Hệ thống đèn LED 3D vật lý chân thực:
 * 1. LED1 (Vàng ấm): Đèn trần chiếu sáng bên trong nhà (Auto: tối && chuyển động, hoặc Manual).
 * 2. LED2 (Xanh lá): Đèn báo cửa mở ở trên khung cửa vòm (Sáng khi cửa mở).
 * 3. LED3 (Đỏ rực): Đèn cảnh báo quá nhiệt cạnh còi Buzzer (Nhấp nháy khi nhiệt độ vượt ngưỡng).
 * 4. Module dải 3 LED (Vàng - Xanh - Đỏ) ở sườn tường phải y hệt mô hình thật trong ảnh chụp.
 */
export const HouseLEDs: React.FC<HouseLEDsProps> = ({ telemetry }) => {
  const { led1_on, led2_on, heat_alarm } = telemetry;

  // Refs để điều khiển nhấp nháy cho đèn LED3 (Heat Alarm) nhịp 300ms
  const led3MeshRef = useRef<THREE.Mesh>(null);
  const led3LightRef = useRef<THREE.PointLight>(null);
  const stripLed3Ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (heat_alarm) {
      // Nhấp nháy nhịp ~300ms (tần số ~3.3Hz) khớp còi buzzer firmware
      const isBlinkOn = Math.sin(clock.elapsedTime * 12) > 0;
      const intensity = isBlinkOn ? 3.0 : 0.3;

      if (led3MeshRef.current) {
        const mat = led3MeshRef.current.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = isBlinkOn ? 2.8 : 0.1;
      }
      if (led3LightRef.current) {
        led3LightRef.current.intensity = intensity;
      }
      if (stripLed3Ref.current) {
        const mat = stripLed3Ref.current.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = isBlinkOn ? 2.8 : 0.1;
      }
    } else {
      if (led3MeshRef.current) {
        const mat = led3MeshRef.current.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0;
      }
      if (led3LightRef.current) {
        led3LightRef.current.intensity = 0;
      }
      if (stripLed3Ref.current) {
        const mat = stripLed3Ref.current.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0;
      }
    }
  });

  return (
    <group>
      {/* ============================================================== */}
      {/* 1. ĐÈN TRẦN LED1 (Chiếu sáng nội thất bên trong nhà)            */}
      {/* ============================================================== */}
      <group position={[0, 13.8, 0]}>
        {/* Chao đèn kim loại gắn trần */}
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.5, 0.8, 0.25, 16]} />
          <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.15, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.8} />
        </mesh>

        {/* Bóng đèn tròn (Bulb) phát quang vàng ấm */}
        <mesh position={[0, -0.2, 0]}>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshStandardMaterial
            color={led1_on ? '#fef08a' : '#e2e8f0'}
            emissive={led1_on ? '#f59e0b' : '#000000'}
            emissiveIntensity={led1_on ? 2.5 : 0}
            roughness={0.2}
          />
        </mesh>

        {/* Quầng sáng PointLight tỏa đều chiếu sáng phòng */}
        <pointLight
          position={[0, -0.5, 0]}
          intensity={led1_on ? 4.0 : 0}
          color="#fef08a"
          distance={28}
          decay={1.6}
          castShadow
        />
      </group>

      {/* ============================================================== */}
      {/* 2. ĐÈN LED2 5MM (Báo cửa mở - gắn phía trên khung cửa vòm)     */}
      {/* ============================================================== */}
      <group position={[-1.5, 5.0, -7.92]}>
        {/* Đài gá kim loại đinh ốc giữ LED 5mm */}
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.1, 10]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
        </mesh>

        {/* Bóng LED 5mm xanh lá phát sáng */}
        <mesh position={[0, 0, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.22, 10]} />
          <meshStandardMaterial
            color={led2_on ? '#86efac' : '#14532d'}
            emissive={led2_on ? '#22c55e' : '#000000'}
            emissiveIntensity={led2_on ? 2.5 : 0}
            roughness={0.15}
          />
        </mesh>
        <mesh position={[0, 0, -0.26]}>
          <sphereGeometry args={[0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={led2_on ? '#86efac' : '#14532d'}
            emissive={led2_on ? '#22c55e' : '#000000'}
            emissiveIntensity={led2_on ? 2.5 : 0}
          />
        </mesh>

        {/* Quầng sáng nhẹ báo trạng thái cửa */}
        <pointLight
          position={[0, 0, -0.35]}
          intensity={led2_on ? 1.5 : 0}
          color="#22c55e"
          distance={6}
          decay={2}
        />
      </group>

      {/* ============================================================== */}
      {/* 3. ĐÈN LED3 5MM & CÒI BUZZER (Cảnh báo quá nhiệt - Mặt tiền)    */}
      {/* ============================================================== */}
      <group position={[0, 9.8, -7.92]}>
        {/* Còi chíp Buzzer màu đen bên cạnh */}
        <mesh position={[-1.0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.3, 16]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} />
        </mesh>
        {/* Lỗ thoát âm giữa còi buzzer */}
        <mesh position={[-1.0, 0, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.05, 8]} />
          <meshBasicMaterial color="#020617" />
        </mesh>

        {/* Đài gá kim loại giữ bóng LED3 đỏ */}
        <mesh position={[0.5, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.1, 10]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
        </mesh>

        {/* Bóng LED 5mm đỏ nhấp nháy báo động */}
        <mesh ref={led3MeshRef} position={[0.5, 0, -0.15]} rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.22, 10]} />
          <meshStandardMaterial
            color={heat_alarm ? '#fca5a5' : '#7f1d1d'}
            emissive="#ef4444"
            emissiveIntensity={0}
            roughness={0.15}
          />
        </mesh>
        <mesh position={[0.5, 0, -0.26]}>
          <sphereGeometry args={[0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={heat_alarm ? '#fca5a5' : '#7f1d1d'}
            emissive={heat_alarm ? '#ef4444' : '#000000'}
            emissiveIntensity={heat_alarm ? 2.5 : 0}
          />
        </mesh>

        {/* Ánh sáng đỏ nhấp nháy báo động hỏa hoạn */}
        <pointLight
          ref={led3LightRef}
          position={[0.5, 0, -0.4]}
          intensity={0}
          color="#ff0000"
          distance={16}
          decay={1.8}
        />
      </group>

      {/* ============================================================== */}
      {/* 4. MODULE THANH 3 LED Ở SƯỜN TƯỜNG (Khớp ảnh 3, 4 mô hình thật) */}
      {/* ============================================================== */}
      <group position={[-10.25, 13.0, 1.2]} rotation={[0, -Math.PI / 2, 0]}>
        {/* 2 ốc vít dài cắm từ tường giữ thanh PCB */}
        <mesh position={[-1.8, 0, -0.3]}>
          <cylinderGeometry args={[0.07, 0.07, 0.6, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} />
        </mesh>
        <mesh position={[1.8, 0, -0.3]}>
          <cylinderGeometry args={[0.07, 0.07, 0.6, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} />
        </mesh>

        {/* Tấm bo mạch PCB xanh lá */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[4.4, 1.2, 0.14]} />
          <meshStandardMaterial color="#064e3b" roughness={0.6} />
        </mesh>

        {/* 1. LED1 Vàng trên module */}
        <group position={[-1.2, 0, 0.15]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.2, 10]} />
            <meshStandardMaterial
              color={led1_on ? '#fef08a' : '#713f12'}
              emissive={led1_on ? '#f59e0b' : '#000000'}
              emissiveIntensity={led1_on ? 2.5 : 0}
            />
          </mesh>
        </group>

        {/* 2. LED2 Xanh trên module */}
        <group position={[0, 0, 0.15]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.2, 10]} />
            <meshStandardMaterial
              color={led2_on ? '#86efac' : '#14532d'}
              emissive={led2_on ? '#22c55e' : '#000000'}
              emissiveIntensity={led2_on ? 2.5 : 0}
            />
          </mesh>
        </group>

        {/* 3. LED3 Đỏ trên module (nhấp nháy) */}
        <group position={[1.2, 0, 0.15]}>
          <mesh ref={stripLed3Ref} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.2, 10]} />
            <meshStandardMaterial
              color={heat_alarm ? '#fca5a5' : '#7f1d1d'}
              emissive="#ef4444"
              emissiveIntensity={0}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
};

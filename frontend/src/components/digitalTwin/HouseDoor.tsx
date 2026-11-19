import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseDoorProps {
  telemetry: ESP32Telemetry;
}

/**
 * Cửa vòm thông minh với micro-servo nhỏ gọn phía trên đỉnh bản lề:
 * - Loại bỏ motor cồng kềnh và thanh gạt dài
 * - Micro-servo nhỏ gọn, tinh tế nằm ngay trên đỉnh bản lề cửa
 * - Tự động xoay mở cửa mượt mà khi cảm biến chuyển động (PIR) bắt được người
 *   hoặc khi nhận lệnh mở cửa (door_command === 'open')
 */
export const HouseDoor: React.FC<HouseDoorProps> = ({ telemetry }) => {
  const { door_command, motion_detected } = telemetry;

  // Cửa xoay mở khi cảm biến chuyển động bắt được HOẶC khi có lệnh mở cửa
  const isTriggered = motion_detected || door_command === 'open';

  // Refs điều khiển xoay cửa và trục servo
  const doorPivotRef = useRef<THREE.Group>(null);
  const servoShaftRef = useRef<THREE.Group>(null);

  // Góc mục tiêu khi mở cửa: ~80 độ
  const targetAngle = isTriggered ? -Math.PI * 0.45 : 0;
  const currentAngle = useRef(0);

  // Cập nhật chuyển động xoay mượt mà (lerp)
  useFrame((_, delta) => {
    currentAngle.current += (targetAngle - currentAngle.current) * Math.min(1, delta * 3.8);

    if (doorPivotRef.current) {
      doorPivotRef.current.rotation.y = currentAngle.current;
    }
    if (servoShaftRef.current) {
      // Trục servo nhỏ phía trên xoay đồng bộ theo góc cửa
      servoShaftRef.current.rotation.y = currentAngle.current;
    }
  });

  // Tạo Shape cánh cửa vòm cong bán nguyệt (Arch Door)
  const archDoorGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    const w = 3.8; // chiều rộng 3.8cm
    const hRect = 3.4; // phần chữ nhật cao 3.4cm
    const r = w / 2; // bán kính vòm cong = 1.9cm (tổng chiều cao = 5.3cm)

    shape.moveTo(0, 0);
    shape.lineTo(0, hRect);
    shape.absarc(r, hRect, r, Math.PI, 0, true);
    shape.lineTo(w, 0);
    shape.closePath();

    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
    });
  }, []);

  // Tạo Shape khung viền vòm ốp trên tường
  const archFrameGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    const wOut = 4.6;
    const hOut = 3.6;
    const rOut = wOut / 2;

    shape.moveTo(0, 0);
    shape.lineTo(0, hOut);
    shape.absarc(rOut, hOut, rOut, Math.PI, 0, true);
    shape.lineTo(wOut, 0);
    shape.closePath();

    const hole = new THREE.Path();
    const wIn = 3.84;
    const hIn = 3.42;
    const rIn = wIn / 2;
    const pad = (wOut - wIn) / 2;

    hole.moveTo(pad, 0);
    hole.lineTo(pad, hIn);
    hole.absarc(pad + rIn, hIn, rIn, Math.PI, 0, true);
    hole.lineTo(pad + wIn, 0);
    hole.closePath();

    shape.holes.push(hole);

    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: false,
    });
  }, []);

  const woodColor = '#C89D66'; // Màu gỗ MDF laser
  const woodEdgeColor = '#6A431D'; // Mép viền cháy laser

  return (
    <group>
      {/* ============================================================== */}
      {/* 1. KHUNG VIỀN CỬA VÒM ỐP TƯỜNG (ở nửa bên PHẢI mặt tiền)        */}
      {/* ============================================================== */}
      <group position={[-3.8, 0.15, -7.86]}>
        <mesh geometry={archFrameGeometry} castShadow>
          <meshStandardMaterial color={woodEdgeColor} roughness={0.7} />
        </mesh>
      </group>

      {/* Lỗ khoét tối bên trong cửa (nhìn vào nội thất khi mở) */}
      <mesh position={[-1.5, 2.7, -7.6]}>
        <planeGeometry args={[3.8, 5.2]} />
        <meshBasicMaterial color="#181512" />
      </mesh>

      {/* ============================================================== */}
      {/* 2. CÁNH CỬA VÒM XOAY MỞ (Bản lề tại X = 0.4)                   */}
      {/* ============================================================== */}
      <group position={[0.4, 0.15, -7.8]}>
        <group ref={doorPivotRef}>
          {/* Cánh cửa vòm (pivot tại mép phải X=0, vươn về -X) */}
          <group position={[-3.8, 0, 0]}>
            <mesh geometry={archDoorGeometry} castShadow receiveShadow>
              <meshStandardMaterial
                color={woodColor}
                roughness={0.65}
                metalness={0.05}
              />
            </mesh>

            {/* Các đường rãnh gỗ khắc trang trí dọc cửa */}
            {[-1.2, 0, 1.2].map((xOffset, i) => (
              <mesh key={i} position={[1.9 + xOffset, 1.8, 0.24]}>
                <boxGeometry args={[0.04, 3.0, 0.02]} />
                <meshStandardMaterial color={woodEdgeColor} />
              </mesh>
            ))}

            {/* Tay nắm cửa tròn nhỏ màu đồng tinh tế ở mép trái (mép mở) */}
            <mesh position={[0.5, 2.3, 0.32]}>
              <sphereGeometry args={[0.16, 10, 8]} />
              <meshStandardMaterial color="#d97706" metalness={0.8} roughness={0.25} />
            </mesh>
          </group>
        </group>
      </group>

      {/* ============================================================== */}
      {/* 3. MICRO-SERVO NHỎ GỌN TRÊN ĐỈNH BẢN LỀ (Vừa vặn, tinh tế)     */}
      {/* ============================================================== */}
      <group position={[0.4, 5.5, -7.84]}>
        {/* Vỏ hộp micro-servo nhỏ gọn (xanh dương translucent) */}
        <mesh position={[0, 0.35, 0]} castShadow>
          <boxGeometry args={[0.9, 0.7, 0.8]} />
          <meshStandardMaterial
            color="#0284c7"
            transparent
            opacity={0.9}
            roughness={0.3}
            metalness={0.15}
          />
        </mesh>

        {/* Nắp trên micro-servo màu đen */}
        <mesh position={[0, 0.72, 0]}>
          <boxGeometry args={[0.92, 0.08, 0.82]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} />
        </mesh>

        {/* Tai gá servo nhỏ bắt ốc vào tường */}
        <mesh position={[0, 0.35, 0.42]}>
          <boxGeometry args={[1.2, 0.3, 0.06]} />
          <meshStandardMaterial color="#0284c7" />
        </mesh>
        <mesh position={[-0.45, 0.35, 0.46]}>
          <cylinderGeometry args={[0.04, 0.04, 0.04, 6]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} />
        </mesh>
        <mesh position={[0.45, 0.35, 0.46]}>
          <cylinderGeometry args={[0.04, 0.04, 0.04, 6]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} />
        </mesh>

        {/* Dây cáp điều khiển mini (cam/đỏ/nâu) uốn vào trong tường */}
        <mesh position={[0, 0.55, -0.42]}>
          <boxGeometry args={[0.08, 0.12, 0.08]} />
          <meshBasicMaterial color="#f97316" />
        </mesh>

        {/* Trục servo nhỏ phía dưới cắm vào đỉnh cửa và xoay theo hoạt ảnh */}
        <group ref={servoShaftRef}>
          {/* Trục xoay kim loại */}
          <mesh position={[0, -0.1, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.22, 10]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
          </mesh>

          {/* Cánh tay đòn servo nhỏ màu trắng gắn chốt vào mép cửa */}
          <mesh position={[-0.35, -0.1, 0]}>
            <boxGeometry args={[0.7, 0.12, 0.08]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
          <mesh position={[-0.65, -0.1, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.14, 8]} />
            <meshStandardMaterial color="#475569" metalness={0.8} />
          </mesh>
        </group>
      </group>
    </group>
  );
};

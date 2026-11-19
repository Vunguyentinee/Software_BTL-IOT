import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ESP32Telemetry } from '../../types/telemetry';

interface HouseDoorProps {
  telemetry: ESP32Telemetry;
}

/**
 * Cửa vòm và cơ cấu truyền động Servo SG90 thực tế (Mô phỏng 1:1 theo ảnh thật):
 * - Cửa hình vòm cong bán nguyệt (Arch Door) bằng gỗ MDF cắt laser
 * - Motor micro servo SG90 xanh dương gắn trên giá đỡ gỗ bên góc trái dưới
 * - Cánh tay đòn servo màu trắng (Servo Horn)
 * - Thanh gỗ gạt truyền lực dài (Linkage Rod) nối từ servo sang cánh cửa vòm
 * - Động học liên hoàn mượt mà (smooth lerp) khi mở/đóng cửa theo telemetry
 */
export const HouseDoor: React.FC<HouseDoorProps> = ({ telemetry }) => {
  const { door_command } = telemetry;
  const isDoorOpen = door_command === 'open';

  // Refs điều khiển góc xoay của các bộ phận
  const doorPivotRef = useRef<THREE.Group>(null);
  const servoHornRef = useRef<THREE.Group>(null);
  const linkageRodRef = useRef<THREE.Group>(null);

  // Góc mục tiêu
  const targetDoorAngle = isDoorOpen ? -Math.PI * 0.42 : 0; // mở góc ~75 độ ra ngoài
  const targetServoAngle = isDoorOpen ? Math.PI * 0.38 : 0; // servo quay góc ~68 độ
  const currentAngle = useRef(0);

  // Cập nhật chuyển động mượt mà (lerp)
  useFrame((_, delta) => {
    currentAngle.current += (targetDoorAngle - currentAngle.current) * Math.min(1, delta * 3.5);
    const progress = Math.abs(currentAngle.current / (Math.PI * 0.42));

    if (doorPivotRef.current) {
      doorPivotRef.current.rotation.y = currentAngle.current;
    }
    if (servoHornRef.current) {
      servoHornRef.current.rotation.z = -targetServoAngle * progress;
    }
    if (linkageRodRef.current) {
      // Thanh gạt dịch chuyển theo độ mở cửa
      linkageRodRef.current.position.z = -7.95 + progress * 0.35;
      linkageRodRef.current.rotation.y = -progress * 0.22;
      linkageRodRef.current.rotation.z = progress * 0.08;
    }
  });

  // Tạo Shape cánh cửa vòm cong (Arch Door)
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

  // Tạo Shape khung viền vòm gắn trên tường
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

    // Khoét lỗ giữa để tạo khung rỗng
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
      depth: 0.15,
      bevelEnabled: false,
    });
  }, []);

  const woodColor = '#C89D66'; // Màu gỗ MDF laser
  const woodEdgeColor = '#6A431D'; // Mép viền cháy laser

  return (
    <group>
      {/* ============================================================== */}
      {/* 1. KHUNG VIỀN CỬA VÒM TRÊN MẶT TƯỜNG (ở nửa bên PHẢI, X = -2.0)  */}
      {/* ============================================================== */}
      <group position={[-3.8, 0.15, -7.86]}>
        <mesh geometry={archFrameGeometry} castShadow>
          <meshStandardMaterial color={woodEdgeColor} roughness={0.7} />
        </mesh>
      </group>

      {/* Lỗ khoét tối bên trong cửa (nhìn xuyên vào nhà khi mở) */}
      <mesh position={[-1.5, 2.7, -7.6]}>
        <planeGeometry args={[3.8, 5.2]} />
        <meshBasicMaterial color="#1e1b18" />
      </mesh>

      {/* ============================================================== */}
      {/* 2. CÁNH CỬA VÒM XOAY MỞ (Pivot tại bản lề bên phải X = 0.4)    */}
      {/* ============================================================== */}
      <group position={[0.4, 0.15, -7.8]}>
        <group ref={doorPivotRef}>
          {/* Cánh cửa vòm (pivot tại mép phải, kéo về -X) */}
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

            {/* Chốt kim loại nhỏ nơi thanh truyền nối vào (tại X = 1.0, Y = 1.6) */}
            <mesh position={[1.0, 1.6, 0.28]}>
              <cylinderGeometry args={[0.15, 0.15, 0.12, 10]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} />
            </mesh>
          </group>
        </group>
      </group>

      {/* ============================================================== */}
      {/* 3. CỤM MOTOR SERVO SG90 XANH (Góc dưới bên TRÁI, dưới LCD)     */}
      {/* ============================================================== */}
      <group position={[5.6, 1.6, -7.85]}>
        {/* Giá đỡ bằng gỗ nhô ra từ tường để bắt servo */}
        <mesh position={[0, -0.6, -0.3]}>
          <boxGeometry args={[3.2, 0.25, 1.6]} />
          <meshStandardMaterial color={woodColor} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.6, -0.3]}>
          <boxGeometry args={[3.2, 0.25, 1.6]} />
          <meshStandardMaterial color={woodColor} roughness={0.7} />
        </mesh>

        {/* Thân Micro Servo SG90 (màu xanh dương bán trong suốt) */}
        <mesh position={[0, 0, -0.2]} castShadow>
          <boxGeometry args={[2.3, 1.25, 2.2]} />
          <meshStandardMaterial
            color="#0284c7"
            transparent
            opacity={0.88}
            roughness={0.25}
            metalness={0.1}
          />
        </mesh>

        {/* Tai bắt ốc 2 bên của servo */}
        <mesh position={[0, 0, 0.1]}>
          <boxGeometry args={[3.2, 1.2, 0.2]} />
          <meshStandardMaterial color="#0284c7" transparent opacity={0.88} />
        </mesh>

        {/* 2 ốc vít bắt servo màu bạc */}
        <mesh position={[-1.3, 0, 0.22]}>
          <cylinderGeometry args={[0.08, 0.08, 0.1, 8]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.9} />
        </mesh>
        <mesh position={[1.3, 0, 0.22]}>
          <cylinderGeometry args={[0.08, 0.08, 0.1, 8]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.9} />
        </mesh>

        {/* Tem nhãn Micro Servo SG90 màu đen */}
        <mesh position={[0, 0, -0.08]}>
          <planeGeometry args={[1.6, 0.9]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>

        {/* Bó dây điện 3 màu (nâu, đỏ, cam) luồn vào trong lỗ tường */}
        {[-0.08, 0, 0.08].map((offset, i) => (
          <mesh key={i} position={[-0.8, -0.7, -0.2 + offset]}>
            <boxGeometry args={[0.06, 0.4, 0.06]} />
            <meshBasicMaterial color={i === 0 ? '#78350f' : i === 1 ? '#dc2626' : '#f97316'} />
          </mesh>
        ))}

        {/* Trục servo xoay tròn màu trắng nhô ra phía trước */}
        <mesh position={[-0.5, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.35, 12]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.3} />
        </mesh>

        {/* Cánh tay đòn servo màu trắng (Servo Horn) xoay theo lệnh */}
        <group position={[-0.5, 0, 0.52]} ref={servoHornRef}>
          {/* Vòng chụp tròn trung tâm */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.35, 0.35, 0.1, 12]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
          {/* Cánh đòn trắng vươn dài sang bên trái */}
          <mesh position={[-0.6, 0, 0]}>
            <boxGeometry args={[1.3, 0.28, 0.08]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
          {/* Ốc tâm bắt servo horn */}
          <mesh position={[0, 0, 0.06]}>
            <cylinderGeometry args={[0.1, 0.1, 0.05, 8]} />
            <meshStandardMaterial color="#475569" metalness={0.8} />
          </mesh>
        </group>
      </group>

      {/* ============================================================== */}
      {/* 4. THANH GỖ GẠT TRUYỀN ĐỘNG DÀI (Linkage Rod nối servo -> cửa)   */}
      {/* ============================================================== */}
      <group position={[1.2, 1.6, -7.95]} ref={linkageRodRef}>
        {/* Thanh gỗ dài truyền lực cắt laser */}
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[7.2, 0.45, 0.18]} />
          <meshStandardMaterial color={woodColor} roughness={0.7} />
        </mesh>
        {/* Lỗ chốt nối 2 đầu thanh gạt */}
        <mesh position={[-3.3, 0, 0.1]}>
          <cylinderGeometry args={[0.12, 0.12, 0.08, 8]} />
          <meshStandardMaterial color="#475569" metalness={0.8} />
        </mesh>
        <mesh position={[3.3, 0, 0.1]}>
          <cylinderGeometry args={[0.12, 0.12, 0.08, 8]} />
          <meshStandardMaterial color="#475569" metalness={0.8} />
        </mesh>
      </group>
    </group>
  );
};

import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Html, Grid, ContactShadows, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { ESP32Telemetry } from '../types/telemetry';
import { useLCDContent } from '../hooks/useLCDContent';

export interface SmartHouseSceneProps {
  telemetry: ESP32Telemetry;
  isCutaway: boolean;
  showLabels: boolean;
  showPirCone: boolean;
  onToggleCutaway?: () => void;
  onToggleLabels?: () => void;
  onTogglePirCone?: () => void;
}

/**
 * Màn hình LCD 16x2 hiển thị thời gian thực trên mặt tiền ngôi nhà 3D
 * - Dynamic CanvasTexture độ phân giải cao kết xuất trực tiếp lên mặt kính màn hình
 * - Đồng bộ thời gian thực từng giây với useLCDContent và LCDSimulator 2D
 * - Đổi màu nền cảnh báo khẩn cấp khi phát hiện Khói/Nhiệt độ cao
 * - Nhãn 3D <Html> nổi hiển thị 2 dòng ký tự sắc nét khi bật showLabels
 */
function LCDScreen3D({
  telemetry,
  showLabels,
}: {
  telemetry: ESP32Telemetry;
  showLabels: boolean;
}) {
  const { line1, line2, pageTitle } = useLCDContent(telemetry);
  const isAlarm = Boolean(telemetry.smoke_alarm || telemetry.gas_alarm || telemetry.heat_alarm);

  // Tạo CanvasTexture độ phân giải cao tỷ lệ 512x205 (chuẩn 2.5:1)
  const { canvas, texture } = useMemo(() => {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 205;
    const tex = new THREE.CanvasTexture(cvs);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return { canvas: cvs, texture: tex };
  }, []);

  // Vẽ nội dung LCD 16x2 lên CanvasTexture khi line1/line2 hoặc trạng thái cảnh báo thay đổi
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (isAlarm) {
      // 1. Nền đỏ cam báo động khẩn cấp
      const grad = ctx.createLinearGradient(0, 0, 0, 205);
      grad.addColorStop(0, '#991b1b');
      grad.addColorStop(0.5, '#7f1d1d');
      grad.addColorStop(1, '#450a0a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 205);

      // Kẻ ma trận ô ký tự mờ 5x8
      ctx.fillStyle = 'rgba(69, 10, 10, 0.4)';
      const cellW = 28;
      const cellH = 75;
      const startX = 14;
      for (let row = 0; row < 2; row++) {
        const y = row === 0 ? 18 : 108;
        for (let col = 0; col < 16; col++) {
          const x = startX + col * (cellW + 3);
          ctx.fillRect(x, y, cellW, cellH);
        }
      }

      // Văn bản LCD cảnh báo: Vàng rực sáng chói
      ctx.font = 'bold 50px "Courier New", Consolas, monospace';
      ctx.fillStyle = '#fef08a';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 12;
      ctx.textBaseline = 'top';

      ctx.fillText(line1, 18, 26);
      ctx.fillText(line2, 18, 116);

      // Viền phát sáng đỏ
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 506, 199);
    } else {
      // 1. Nền xanh dương phát quang chuẩn LCD 1602 Blue Backlight
      const grad = ctx.createLinearGradient(0, 0, 0, 205);
      grad.addColorStop(0, '#0052cc');
      grad.addColorStop(0.5, '#003399');
      grad.addColorStop(1, '#001a4d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 205);

      // 2. Kẻ ma trận ô ký tự mờ 5x8 (16 cột x 2 dòng)
      ctx.fillStyle = 'rgba(0, 15, 50, 0.35)';
      const cellW = 28;
      const cellH = 75;
      const startX = 14;
      for (let row = 0; row < 2; row++) {
        const y = row === 0 ? 18 : 108;
        for (let col = 0; col < 16; col++) {
          const x = startX + col * (cellW + 3);
          ctx.fillRect(x, y, cellW, cellH);
        }
      }

      // 3. Văn bản LCD phát quang (trắng xanh cyan)
      ctx.font = 'bold 50px "Courier New", Consolas, monospace';
      ctx.fillStyle = '#f0f9ff';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.textBaseline = 'top';

      // 4. Vẽ 2 dòng text chuẩn LCD 16x2
      ctx.fillText(line1, 18, 26);
      ctx.fillText(line2, 18, 116);

      // 5. Viền trong phát sáng
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 5;
      ctx.strokeRect(3, 3, 506, 199);
    }

    texture.needsUpdate = true;
  }, [line1, line2, isAlarm, canvas, texture]);

  return (
    <group position={[-0.038, 0.060, 0.1039]}>
      {/* 1. Mặt hiển thị CanvasTexture gắn phẳng mặt ngoài ManHinh_LCD_Nen */}
      <mesh>
        <planeGeometry args={[0.039, 0.0155]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive={isAlarm ? '#ef4444' : '#0052cc'}
          emissiveIntensity={isAlarm ? 1.8 : 1.4}
          roughness={0.15}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 2. Ánh sáng nhẹ tỏa từ màn hình LCD */}
      <pointLight
        position={[0, 0, 0.012]}
        color={isAlarm ? '#ef4444' : '#38bdf8'}
        intensity={isAlarm ? 0.35 : 0.2}
        distance={0.08}
      />

      {/* 3. Nhãn 3D <Html> nổi hiển thị 2 dòng LCD 16x2 sắc nét */}
      {showLabels && (
        <Html position={[0, 0.026, 0.005]} center distanceFactor={0.42}>
          <div
            className={`px-2.5 py-1.5 rounded-lg shadow-2xl backdrop-blur-md font-mono text-[10px] pointer-events-none select-none min-w-[150px] border transition-all ${
              isAlarm
                ? 'bg-rose-950/95 border-rose-500 text-yellow-300 shadow-rose-900/50'
                : 'bg-slate-950/92 border-blue-500/70 text-cyan-300 shadow-blue-900/40'
            }`}
          >
            <div
              className={`flex items-center justify-between text-[8px] pb-0.5 mb-1 font-sans border-b ${
                isAlarm ? 'text-rose-300 border-rose-800' : 'text-blue-400 border-blue-900/70'
              }`}
            >
              <span className="flex items-center gap-1 font-semibold">
                📟 LCD 16×2
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </span>
              <span className={`font-semibold ${isAlarm ? 'text-yellow-400 font-bold animate-pulse' : 'text-cyan-400'}`}>
                {pageTitle}
              </span>
            </div>
            <div className="text-white font-bold tracking-wider whitespace-pre leading-tight drop-shadow-[0_0_6px_rgba(56,189,248,0.7)]">
              {line1}
            </div>
            <div
              className={`font-bold tracking-wider whitespace-pre mt-0.5 leading-tight ${
                isAlarm
                  ? 'text-yellow-300 drop-shadow-[0_0_6px_rgba(239,68,68,0.7)]'
                  : 'text-cyan-300 drop-shadow-[0_0_6px_rgba(56,189,248,0.5)]'
              }`}
            >
              {line2}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * Component hiển thị mô hình nhà 3D và điều khiển thời gian thực
 */
function HouseModel({
  telemetry,
  isCutaway,
  showLabels,
  showPirCone,
}: {
  telemetry: ESP32Telemetry;
  isCutaway: boolean;
  showLabels: boolean;
  showPirCone: boolean;
}) {
  const gltf = useGLTF('/nha_cap_4.glb');

  // Clone scene và clone materials để không bị ghi đè cache
  const cloned = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone());
        } else if (mesh.material) {
          mesh.material = mesh.material.clone();
        }
      }
    });
    return root;
  }, [gltf.scene]);

  // Các reference tới các mesh/node tương tác
  const doorRef = useRef<THREE.Object3D | null>(null);
  const fanRef = useRef<THREE.Object3D | null>(null);
  const led1Ref = useRef<THREE.Mesh | null>(null);
  const led2Ref = useRef<THREE.Mesh | null>(null);
  const led3Ref = useRef<THREE.Mesh | null>(null);
  const buzzerWaveRef = useRef<THREE.Mesh | null>(null);
  const gasProbeRef = useRef<THREE.Mesh | null>(null);
  const cutawayWallsRef = useRef<THREE.Mesh[]>([]);

  // Tọa độ các sensor để gắn nhãn <Html>
  // PIR đã được dời và xoay ra mặt ngoài phía trên cửa chính (Z > 0.10)
  const pirPos = useMemo(() => new THREE.Vector3(0.036, 0.114, 0.112), []);
  const dht11Pos = useMemo(() => new THREE.Vector3(-0.068, 0.080, 0), []);
  const gasPos = useMemo(() => new THREE.Vector3(0.063, 0.110, 0.025), []);
  const ldrPos = useMemo(() => new THREE.Vector3(-0.045, 0.098, 0.1035), []);

  // Ánh xạ các Mesh theo tên khi nạp scene
  useEffect(() => {
    cutawayWallsRef.current = [];

    cloned.traverse((child) => {
      const name = child.name;

      // 1. Cửa chính (Pivot/Origin tại bản lề phải)
      if (name === 'Cua_Chinh') {
        doorRef.current = child;
      }

      // 2. Cánh quạt thông gió (Origin tại tâm trục)
      if (name === 'Canh_Quat') {
        fanRef.current = child;
      }

      // 3. Đèn LED1 trần
      if (name === 'Den_LED1' && (child as THREE.Mesh).isMesh) {
        led1Ref.current = child as THREE.Mesh;
      }

      // 4. Đèn LED2 báo mở cửa trên vòm
      if (name === 'Den_LED2' && (child as THREE.Mesh).isMesh) {
        led2Ref.current = child as THREE.Mesh;
      }

      // 5. Đèn LED3 cảnh báo tổng trên đỉnh mặt tiền
      if (name === 'Den_LED3_CanhBao' && (child as THREE.Mesh).isMesh) {
        led3Ref.current = child as THREE.Mesh;
      }

      // 6. Vòng sóng âm còi
      if (name === 'Song_Am_Coi' && (child as THREE.Mesh).isMesh) {
        buzzerWaveRef.current = child as THREE.Mesh;
      }

      // 7. Đầu dò cảm biến Gas MQ-2
      if (name === 'CamBien_Gas_DauDo' && (child as THREE.Mesh).isMesh) {
        gasProbeRef.current = child as THREE.Mesh;
      }

      // 8. Kính cửa sổ trước & sau: Bán trong suốt
      if ((name === 'Cua_So_Truoc' || name === 'Cua_So_Sau') && (child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.transparent = true;
          mat.opacity = 0.42;
          mat.roughness = 0.1;
          mat.color.set('#60a5fa');
        }
      }

      // 9. Các mesh cho chế độ X-Ray/Cutaway: Mai_Nha, Tuong_Trai, Tuong_Phai
      if (
        (name === 'Tuong_Trai' || name === 'Tuong_Phai' || name === 'Mai_Nha' || name.includes('Khung_Quat')) &&
        (child as THREE.Mesh).isMesh
      ) {
        cutawayWallsRef.current.push(child as THREE.Mesh);
      }

      // 10. Màn hình LCD 1602: Nền và viền hiển thị mặt tiền
      if (name === 'ManHinh_LCD_Nen' && (child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.color.set('#001b3d');
          mat.roughness = 0.2;
          mat.metalness = 0.4;
        }
      }
      if (name === 'ManHinh_LCD_Vien' && (child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.color.set('#1e293b');
          mat.roughness = 0.6;
        }
      }

      // 11. Dời & xoay cụm cảm biến PIR từ mặt trong ra mặt ngoài Tuong_Truoc (+Z, phía trên Den_LED2)
      if (name === 'CamBien_PIR_BoMach') {
        child.position.set(0.036, 0.114, 0.101);
      }
      if (name === 'CamBien_PIR_Co') {
        child.position.set(0.036, 0.114, 0.1035);
      }
      if (name === 'CamBien_PIR_ThauKinh') {
        child.position.set(0.036, 0.114, 0.105);
        // Xoay +90° quanh trục X để chỏm vòm thấu kính hướng ra mặt ngoài (+Z) thay vì vào trong (-Z)
        child.rotation.set(Math.PI / 2, 0, 0);
      }
    });
  }, [cloned]);

  // Cập nhật chế độ X-Ray / Cutaway khi `isCutaway` thay đổi
  useEffect(() => {
    cutawayWallsRef.current.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat) {
        if (isCutaway) {
          mat.transparent = true;
          mat.opacity = 0.2;
          mat.depthWrite = false;
        } else {
          mat.transparent = false;
          mat.opacity = 1.0;
          mat.depthWrite = true;
        }
      }
    });
  }, [isCutaway]);

  // Cập nhật màu sắc Emissive cho các đèn & đầu dò theo trạng thái Telemetry
  useEffect(() => {
    // LED1: Vàng ấm #ffdd55 khi bật
    if (led1Ref.current) {
      const mat = led1Ref.current.material as THREE.MeshStandardMaterial;
      if (mat) {
        if (telemetry.led1_on) {
          mat.emissive.set('#ffdd55');
          mat.emissiveIntensity = 2.8;
        } else {
          mat.emissive.set('#000000');
          mat.emissiveIntensity = 0;
        }
      }
    }

    // LED2: Xanh lá #22c55e khi cửa mở / đón người
    if (led2Ref.current) {
      const mat = led2Ref.current.material as THREE.MeshStandardMaterial;
      if (mat) {
        if (telemetry.led2_on) {
          mat.emissive.set('#22c55e');
          mat.emissiveIntensity = 2.5;
        } else {
          mat.emissive.set('#000000');
          mat.emissiveIntensity = 0;
        }
      }
    }

    // LED3: Báo động tổng, giữ đỏ rực #ef4444 liên tục (không chớp tắt)
    if (led3Ref.current) {
      const mat = led3Ref.current.material as THREE.MeshStandardMaterial;
      if (mat) {
        if (telemetry.led3_on) {
          mat.emissive.set('#ef4444');
          mat.emissiveIntensity = 3.2;
        } else {
          mat.emissive.set('#000000');
          mat.emissiveIntensity = 0;
        }
      }
    }

    // Đầu dò Gas: Đỏ cam rực khi có cảnh báo gas/khói
    if (gasProbeRef.current) {
      const mat = gasProbeRef.current.material as THREE.MeshStandardMaterial;
      if (mat) {
        if (telemetry.smoke_alarm || telemetry.gas_alarm) {
          mat.emissive.set('#f97316');
          mat.emissiveIntensity = 2.6;
        } else {
          mat.emissive.set('#000000');
          mat.emissiveIntensity = 0;
        }
      }
    }
  }, [telemetry.led1_on, telemetry.led2_on, telemetry.led3_on, telemetry.smoke_alarm, telemetry.gas_alarm]);

  // Vòng lặp Frame animation: Lerp mở cửa, quay cánh quạt, xung sóng âm 300ms/300ms
  useFrame((_, delta) => {
    // 1. Cửa chính: rotation.y = Math.PI / 2 khi mở, 0 khi đóng (lerp mượt mà)
    if (doorRef.current) {
      const targetDoorY = telemetry.door_command === 'open' ? Math.PI / 2 : 0;
      doorRef.current.rotation.y = THREE.MathUtils.lerp(
        doorRef.current.rotation.y,
        targetDoorY,
        Math.min(1, delta * 7)
      );
    }

    // 2. Cánh quạt: quay liên tục quanh trục X (rotation.x += delta * 22)
    if (fanRef.current && telemetry.fan_on) {
      fanRef.current.rotation.x += delta * 22;
    }

    // 3. Vòng sóng âm còi: nhịp 300ms BẬT / 300ms TẮT kèm phóng to thu nhỏ
    if (buzzerWaveRef.current) {
      const isAlarmActive = Boolean(
        telemetry.led3_on ||
        telemetry.buzzer_on ||
        telemetry.heat_alarm ||
        telemetry.smoke_alarm ||
        telemetry.gas_alarm
      );

      if (isAlarmActive) {
        const now = performance.now();
        const isBeepOn = Math.floor(now / 300) % 2 === 0;
        buzzerWaveRef.current.visible = isBeepOn;

        if (isBeepOn) {
          const progress = (now % 300) / 300; // 0 -> 1
          const scale = 1.0 + progress * 0.45;
          buzzerWaveRef.current.scale.set(scale, scale, scale);

          const mat = buzzerWaveRef.current.material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.transparent = true;
            mat.opacity = Math.max(0.2, 0.9 * (1.0 - progress * 0.45));
            mat.emissive?.set('#ef4444');
            mat.emissiveIntensity = 2.0;
          }
        }
      } else {
        buzzerWaveRef.current.visible = false;
      }
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Mô hình nhà 3D từ file GLB */}
      <primitive object={cloned} />

      {/* Màn hình LCD 16x2 đồng bộ thời gian thực với CanvasTexture và nhãn 3D */}
      <LCDScreen3D telemetry={telemetry} showLabels={showLabels} />

      {/* PointLight chiếu sáng nội thất khi Đèn LED1 bật */}
      <pointLight
        position={[0, 0.14, 0]}
        color="#ffdd55"
        intensity={telemetry.led1_on ? 1.6 : 0}
        distance={0.45}
        decay={2}
        castShadow
      />

      {/* Đèn vòm phụ khi LED2 bật */}
      <pointLight
        position={[0.036, 0.098, 0.108]}
        color="#22c55e"
        intensity={telemetry.led2_on ? 0.35 : 0}
        distance={0.12}
      />

      {/* Đèn đỏ báo động khi LED3 bật */}
      <pointLight
        position={[-0.012, 0.143, 0.108]}
        color="#ef4444"
        intensity={telemetry.led3_on ? 0.8 : 0}
        distance={0.2}
      />

      {/* Nón quét PIR 3D: CamBien_PIR_VungQuet (hướng ra mặt ngoài +Z, đỉnh nón đặt tại thấu kính) */}
      {showPirCone && (
        <group position={[0.036, 0.114, 0.111]}>
          <mesh position={[0, -0.0283, 0.0283]} rotation={[-Math.PI / 4, 0, 0]}>
            <coneGeometry args={[0.035, 0.08, 16, 1, true]} />
            <meshStandardMaterial
              color={telemetry.motion_detected ? '#eab308' : '#38bdf8'}
              transparent
              opacity={0.35}
              side={THREE.DoubleSide}
              wireframe={false}
            />
          </mesh>
          <mesh position={[0, -0.0283, 0.0283]} rotation={[-Math.PI / 4, 0, 0]}>
            <coneGeometry args={[0.035, 0.08, 12, 1, true]} />
            <meshStandardMaterial
              color={telemetry.motion_detected ? '#facc15' : '#0284c7'}
              wireframe
              transparent
              opacity={0.5}
            />
          </mesh>
        </group>
      )}

      {/* 4 CỤM CẢM BIẾN CHI TIẾT - NHÃN 3D NỔI <Html> */}
      {showLabels && (
        <>
          {/* 1. CamBien_PIR_ThauKinh */}
          <Html position={[pirPos.x, pirPos.y + 0.02, pirPos.z]} center distanceFactor={0.45}>
            <div
              className={`px-2 py-1 rounded-md text-[10px] font-mono font-semibold whitespace-nowrap shadow-lg border backdrop-blur-md pointer-events-none transition-all ${
                telemetry.motion_detected
                  ? 'bg-amber-500/90 border-amber-300 text-slate-950 animate-pulse'
                  : 'bg-slate-900/80 border-slate-700 text-slate-200'
              }`}
            >
              🏃 PIR: {telemetry.motion_detected ? 'Phát hiện người' : 'Không có người'}
            </div>
          </Html>

          {/* 2. CamBien_DHT11_Vo */}
          <Html position={[dht11Pos.x, dht11Pos.y + 0.025, dht11Pos.z]} center distanceFactor={0.45}>
            <div
              className={`px-2 py-1 rounded-md text-[10px] font-mono font-semibold whitespace-nowrap shadow-lg border backdrop-blur-md pointer-events-none transition-all ${
                !telemetry.dht_ok
                  ? 'bg-rose-900/90 border-rose-500 text-rose-200'
                  : 'bg-slate-900/85 border-slate-700 text-slate-200'
              }`}
            >
              🌡️ {(telemetry.temperature_c ?? 0).toFixed(1)}°C | 💧 {(telemetry.humidity_pct ?? 0).toFixed(0)}%
              {!telemetry.dht_ok && <span className="ml-1 text-rose-400 font-bold">[LỖI]</span>}
            </div>
          </Html>

          {/* 3. CamBien_Gas_DauDo */}
          <Html position={[gasPos.x, gasPos.y + 0.025, gasPos.z]} center distanceFactor={0.45}>
            <div
              className={`px-2 py-1 rounded-md text-[10px] font-mono font-semibold whitespace-nowrap shadow-lg border backdrop-blur-md pointer-events-none transition-all ${
                telemetry.smoke_alarm || telemetry.gas_alarm
                  ? 'bg-rose-600/95 border-rose-300 text-white font-bold animate-bounce shadow-rose-500/50'
                  : 'bg-slate-900/85 border-slate-700 text-slate-200'
              }`}
            >
              ☣️ Gas ADC: {telemetry.gas_raw ?? telemetry.smoke_raw ?? 0}
              {(telemetry.smoke_alarm || telemetry.gas_alarm) && (
                <span className="ml-1 bg-white text-rose-700 px-1 rounded text-[9px]">NGUY HIỂM</span>
              )}
            </div>
          </Html>

          {/* 4. CamBien_AnhSang_Mat */}
          <Html position={[ldrPos.x, ldrPos.y + 0.02, ldrPos.z + 0.01]} center distanceFactor={0.45}>
            <div className="px-2 py-1 rounded-md text-[10px] font-mono font-semibold whitespace-nowrap shadow-lg border border-slate-700 bg-slate-900/85 text-slate-200 backdrop-blur-md pointer-events-none">
              {telemetry.is_dark ? '🌙 Trời tối' : '☀️ Ban ngày'}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

useGLTF.preload('/nha_cap_4.glb');

export const SmartHouseScene: React.FC<SmartHouseSceneProps> = ({
  telemetry,
  isCutaway,
  showLabels,
  showPirCone,
  onToggleCutaway,
  onToggleLabels,
  onTogglePirCone,
}) => {
  return (
    <div className="relative w-full h-full min-h-[520px] rounded-2xl overflow-hidden bg-slate-900 border border-slate-200/80 shadow-md flex flex-col">
      {/* Thanh điều khiển nhanh góc trên 3D HUD */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2">
        <span className="bg-slate-900/90 text-cyan-400 font-mono text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-700 shadow-md backdrop-blur-md">
          🏠 3D Digital Twin — Nhà Cấp 4
        </span>

        {/* Nút X-Ray / Cutaway Toggle */}
        <button
          type="button"
          onClick={onToggleCutaway}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all shadow-md backdrop-blur-md border cursor-pointer ${
            isCutaway
              ? 'bg-indigo-600 text-white border-indigo-400 shadow-indigo-500/25'
              : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800'
          }`}
          title="Làm mờ Mái nhà & Tường để quan sát nội thất bên trong"
        >
          🔍 X-Ray / Cutaway: {isCutaway ? 'BẬT (0.2)' : 'TẮT'}
        </button>

        {/* Nút bật/tắt toàn bộ nhãn 3D */}
        <button
          type="button"
          onClick={onToggleLabels}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all shadow-md backdrop-blur-md border cursor-pointer ${
            showLabels
              ? 'bg-blue-600 text-white border-blue-400 shadow-blue-500/25'
              : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800'
          }`}
          title="Bật/Tắt nhãn thông số 3D nổi gắn tại từng cảm biến"
        >
          🏷️ Nhãn 3D: {showLabels ? 'HIỆN' : 'ẨN'}
        </button>

        {/* Nút bật/tắt nón quét PIR */}
        <button
          type="button"
          onClick={onTogglePirCone}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all shadow-md backdrop-blur-md border cursor-pointer ${
            showPirCone
              ? 'bg-emerald-600 text-white border-emerald-400 shadow-emerald-500/25'
              : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800'
          }`}
          title="Bật/Tắt nón quét vùng chuyển động PIR"
        >
          📡 Vùng quét PIR: {showPirCone ? 'BẬT' : 'ẨN'}
        </button>
      </div>

      {/* Thông tin nhanh trạng thái thực thi góc dưới */}
      <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
        {telemetry.fan_on && (
          <span className="bg-cyan-600 text-white text-[11px] font-mono px-2.5 py-1 rounded-md shadow-md backdrop-blur-md flex items-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            🌀 Quạt 7 cánh: 22 rad/s
          </span>
        )}
        {telemetry.door_command === 'open' && (
          <span className="bg-emerald-600 text-white text-[11px] font-mono px-2.5 py-1 rounded-md shadow-md backdrop-blur-md flex items-center gap-1.5">
            🚪 Cửa mở 90° (Vòm phải)
          </span>
        )}
        {telemetry.led3_on && (
          <span className="bg-rose-600 text-white text-[11px] font-mono px-2.5 py-1 rounded-md shadow-md backdrop-blur-md flex items-center gap-1.5 font-bold">
            🚨 BÁO ĐỘNG ĐỎ LIÊN TỤC + CÒI 300MS
          </span>
        )}
        {telemetry.door_safety_lock && (
          <span className="bg-amber-600 text-white text-[11px] font-mono px-2.5 py-1 rounded-md shadow-md backdrop-blur-md">
            🔒 Khóa an toàn 60s
          </span>
        )}
      </div>

      {/* Canvas 3D Three.js */}
      <Canvas
        className="w-full h-full cursor-grab active:cursor-grabbing"
        camera={{ position: [0.24, 0.22, 0.3], fov: 45 }}
        shadows
      >
        {/* Nền Slate Studio mềm mại, sáng rõ hơn */}
        <color attach="background" args={['#1e293b']} />

        {/* Lưới sàn (Grid) kỹ thuật số */}
        <Grid
          position={[0, -0.001, 0]}
          args={[1.2, 1.2]}
          cellSize={0.02}
          cellThickness={0.7}
          cellColor="#475569"
          sectionSize={0.1}
          sectionThickness={1.4}
          sectionColor="#64748b"
          fadeDistance={0.8}
        />

        {/* Đổ bóng mềm tiếp xúc mặt sàn (ContactShadows) */}
        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={0.65}
          scale={0.45}
          blur={1.6}
          far={0.25}
          color="#000000"
        />

        {/* Thiết lập ánh sáng 3 điểm (Three-Point Lighting) sáng rõ nội & ngoại thất */}
        <ambientLight intensity={0.9} />
        {/* Key light có đổ bóng */}
        <directionalLight
          position={[0.35, 0.5, 0.35]}
          intensity={1.8}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0001}
        />
        {/* Fill light */}
        <directionalLight position={[-0.3, 0.35, -0.25]} intensity={0.8} />
        {/* Rim / Back light */}
        <directionalLight position={[0, 0.4, -0.35]} intensity={0.5} />

        <Environment preset="city" />

        {/* Tải và điều khiển mô hình nhà */}
        <React.Suspense
          fallback={
            <Html center>
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-cyan-400 rounded-xl border border-cyan-800 text-xs font-mono animate-pulse">
                <span>Đang tải mô hình nha_cap_4.glb...</span>
              </div>
            </Html>
          }
        >
          <HouseModel
            telemetry={telemetry}
            isCutaway={isCutaway}
            showLabels={showLabels}
            showPirCone={showPirCone}
          />
        </React.Suspense>

        {/* OrbitControls xoay/zoom quanh tâm ngôi nhà [0, 0.08, 0] */}
        <OrbitControls
          target={[0, 0.08, 0]}
          minDistance={0.12}
          maxDistance={0.9}
          maxPolarAngle={Math.PI / 2 + 0.04}
          enablePan
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>
    </div>
  );
};

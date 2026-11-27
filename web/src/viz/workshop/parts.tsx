'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { BELT_Y } from './stages';
import { flow } from './flowState';

type V3 = [number, number, number];

export function Box({
  p, s, c, rough = 0.85, metal = 0.1, opacity = 1, r,
}: { p: V3; s: V3; c: string; rough?: number; metal?: number; opacity?: number; r?: V3 }) {
  return (
    <mesh position={p} rotation={r} castShadow={false}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} flatShading roughness={rough} metalness={metal} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

export function Cyl({
  p, r, h, c, rot, seg = 12, opacity = 1, wire = false,
}: { p: V3; r: number; h: number; c: string; rot?: V3; seg?: number; opacity?: number; wire?: boolean }) {
  return (
    <mesh position={p} rotation={rot}>
      <cylinderGeometry args={[r, r, h, seg]} />
      <meshStandardMaterial color={c} flatShading roughness={0.7} metalness={0.2} transparent={opacity < 1} opacity={opacity} wireframe={wire} />
    </mesh>
  );
}

export function Spin({ axis = 'x', speed = 1, p, children }: { axis?: 'x' | 'y' | 'z'; speed?: number; p?: V3; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current && flow.on) ref.current.rotation[axis] += dt * speed * flow.speed;
  });
  return (
    <group ref={ref} position={p}>
      {children}
    </group>
  );
}

let stripeTex: THREE.CanvasTexture | null = null;
function stripes() {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f2937';
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#374151';
  g.fillRect(0, 0, 8, 16);
  g.fillRect(32, 0, 8, 16);
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  return stripeTex;
}

/** Конвейерная лента с бегущей текстурой. */
export function Belt({ x0, x1, y = BELT_Y, z = 0, w = 1.6, speed = 2.4 }: { x0: number; x1: number; y?: number; z?: number; w?: number; speed?: number }) {
  const len = x1 - x0;
  const tex = useMemo(() => {
    const t = stripes().clone();
    t.needsUpdate = true;
    t.repeat.set(len / 1.2, 1);
    return t;
  }, [len]);
  useFrame((_, dt) => {
    if (flow.on) tex.offset.x -= (dt * speed * flow.speed) / 1.2;
  });
  const cx = (x0 + x1) / 2;
  return (
    <group position={[cx, y, z]}>
      <mesh position={[0, -0.12, 0]}>
        <boxGeometry args={[len, 0.14, w]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, -0.05, (k * (w + 0.12)) / 2]}>
          <boxGeometry args={[len, 0.3, 0.1]} />
          <meshStandardMaterial color="#475569" flatShading metalness={0.3} />
        </mesh>
      ))}
      {Array.from({ length: Math.floor(len / 4) + 1 }, (_, i) => (
        <mesh key={i} position={[-len / 2 + i * 4 + 0.1, -0.6, 0]}>
          <boxGeometry args={[0.15, 1.0, w + 0.2]} />
          <meshStandardMaterial color="#334155" flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Бункер-приёмник для фракции. */
export function Bunker({ x, z, color, w = 2, d = 2.2 }: { x: number; z: number; color: string; w?: number; d?: number }) {
  return (
    <group position={[x, 0, z]}>
      <Box p={[0, 0.7, 0]} s={[w, 1.4, d]} c="#64748b" />
      <Box p={[0, 1.05, 0]} s={[w - 0.15, 0.62, d - 0.15]} c={color} rough={1} />
      <Box p={[0, 1.42, 0]} s={[w + 0.12, 0.1, d + 0.12]} c="#94a3b8" metal={0.3} />
    </group>
  );
}

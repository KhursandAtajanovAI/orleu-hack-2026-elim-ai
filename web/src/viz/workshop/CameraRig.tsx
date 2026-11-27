'use client';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STAGES } from './stages';

export const OVERVIEW = { pos: [0, 30, 54] as [number, number, number], target: [0, 0, 0] as [number, number, number] };

/** Плавный перелёт камеры к этапу + свободное вращение мышью/пальцем. */
export function CameraRig({ focus, token, onUserMove }: { focus: number; token: number; onUserMove: () => void }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const goal = useRef({ pos: new THREE.Vector3(...OVERVIEW.pos), target: new THREE.Vector3(...OVERVIEW.target) });
  const moving = useRef(true);
  const { camera, size } = useThree();

  useEffect(() => {
    const portrait = size.width / size.height < 0.9;
    const k = portrait ? 1.5 : 1;
    if (focus < 0) {
      goal.current.pos.set(OVERVIEW.pos[0], OVERVIEW.pos[1] * (portrait ? 1.3 : 1), OVERVIEW.pos[2] * (portrait ? 1.5 : 1));
      goal.current.target.set(...OVERVIEW.target);
    } else {
      const s = STAGES[focus];
      goal.current.pos.set(s.x + s.cam[0], s.cam[1] * k, s.cam[2] * k);
      goal.current.target.set(s.x, 1.2, 0);
    }
    moving.current = true;
  }, [focus, token, size.width, size.height]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || !moving.current) return;
    const a = 1 - Math.exp(-dt * 2.6);
    camera.position.lerp(goal.current.pos, a);
    c.target.lerp(goal.current.target, a);
    c.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.05) moving.current = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={5}
      maxDistance={90}
      maxPolarAngle={Math.PI / 2.05}
      onStart={() => {
        moving.current = false;
        onUserMove();
      }}
    />
  );
}

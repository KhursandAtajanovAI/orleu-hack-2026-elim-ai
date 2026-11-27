'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BELT_START, BELT_Y, BUNKER_Z, EXITS, MAT_COLOR, stageX, type Exit } from './stages';
import { flow } from './flowState';

const BELT_SPEED = 2.4;
const BAG_UNTIL = stageX('opening') + 3.4; // пакеты вскрываются здесь
const COUNT = 80;

interface Item {
  exit: Exit;
  x: number;
  state: 'belt' | 'eject' | 'sink' | 'wait';
  t: number;
  wait: number;
  size: number;
  bottle: boolean;
  open: boolean;
}

function pick(): Exit {
  const total = EXITS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of EXITS) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return EXITS[0];
}

/** Поток предметов по ленте: пакеты → вскрытие → разделение по бункерам по материалу. */
export function Flow() {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const items = useMemo<Item[]>(
    () =>
      Array.from({ length: COUNT }, () => {
        const exit = pick();
        return {
          exit,
          x: BELT_START + Math.random() * (exit.x - BELT_START),
          state: 'belt',
          t: 0,
          wait: 0,
          size: 0.3 + Math.random() * 0.22,
          bottle: exit.mat === 'pet' || (exit.mat === 'glass' && Math.random() > 0.4),
          open: false,
        } satisfies Item;
      }),
    [],
  );
  const bagColor = useMemo(() => new THREE.Color('#475569'), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((_, dtRaw) => {
    if (!flow.on) return;
    const dt = Math.min(dtRaw, 0.05) * flow.speed;
    items.forEach((it, i) => {
      const m = refs.current[i];
      if (!m) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (it.state === 'wait') {
        it.wait -= dt;
        m.visible = false;
        if (it.wait <= 0) {
          it.exit = pick();
          it.x = BELT_START;
          it.state = 'belt';
          it.open = false;
          it.bottle = it.exit.mat === 'pet' || (it.exit.mat === 'glass' && Math.random() > 0.4);
        }
        return;
      }
      m.visible = true;
      if (it.state === 'belt') {
        it.x += BELT_SPEED * dt;
        const bag = it.x < BAG_UNTIL;
        if (!bag && !it.open) it.open = true;
        const s = bag ? it.size * 2.3 : it.size;
        m.scale.set(s, bag ? s * 0.75 : s, s);
        mat.color.copy(bag ? bagColor : tmp.set(MAT_COLOR[it.exit.mat]));
        m.position.set(it.x, BELT_Y + 0.12 + s * 0.4, Math.sin(i * 12.9) * 0.45);
        m.rotation.set(0, i, 0);
        if (it.x >= it.exit.x) {
          it.state = 'eject';
          it.t = 0;
        }
      } else if (it.state === 'eject') {
        it.t += dt / 0.85;
        const k = Math.min(1, it.t);
        const z0 = Math.sin(i * 12.9) * 0.45;
        const tz = BUNKER_Z + (Math.sin(i * 7.7) * 0.4);
        m.position.set(
          it.exit.x + (it.exit.bx - it.exit.x) * k,
          BELT_Y + 0.4 + Math.sin(Math.PI * k) * 1.5 - k * 0.0 + k * 0.7,
          z0 + (tz - z0) * k,
        );
        m.rotation.x += dt * 6;
        if (k >= 1) {
          it.state = 'sink';
          it.t = 0;
        }
      } else if (it.state === 'sink') {
        it.t += dt / 0.35;
        const s = it.size * Math.max(0, 1 - it.t);
        m.scale.setScalar(s);
        m.position.y -= dt * 0.6;
        if (it.t >= 1) {
          it.state = 'wait';
          it.wait = 0.2 + Math.random() * 2.2;
        }
      }
    });
  });

  return (
    <group>
      {items.map((it, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }}>
          {it.bottle ? <cylinderGeometry args={[0.5, 0.5, 1.6, 8]} /> : <boxGeometry args={[1, 0.8, 1]} />}
          <meshStandardMaterial color="#475569" flatShading roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

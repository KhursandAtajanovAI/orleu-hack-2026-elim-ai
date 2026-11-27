'use client';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useRef } from 'react';
import * as THREE from 'three';
import { Belt, Box, Bunker, Cyl, Spin } from './parts';
import { BELT_END, BELT_START, BELT_Y, BUNKER_Z, EXITS, MAT_COLOR, STAGES, stageX, type Mat } from './stages';
import { flow } from './flowState';
import { useI18n } from '@/lib/i18n';

const bx = (m: Mat) => EXITS.find((e) => e.mat === m)!.bx;

export function Floor({ dark }: { dark: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[120, 34]} />
        <meshStandardMaterial color={dark ? '#1e293b' : '#cbd5e1'} roughness={1} />
      </mesh>
      {STAGES.map((s) => (
        <mesh key={s.id} rotation={[-Math.PI / 2, 0, 0]} position={[s.x, 0.005, 0.5]}>
          <planeGeometry args={[10.4, 15]} />
          <meshStandardMaterial color={s.n % 2 ? (dark ? '#273449' : '#d3dce8') : dark ? '#222e42' : '#c5d0de'} roughness={1} />
        </mesh>
      ))}
      {/* задняя стена-ограждение */}
      <Box p={[0, 1.2, -9]} s={[120, 2.4, 0.3]} c={dark ? '#334155' : '#94a3b8'} />
    </group>
  );
}

/** Подпись зоны — кликабельный HTML-маркер над этапом. */
export function StageLabel({ id, active, onPick, y = 5.6 }: { id: (typeof STAGES)[number]['id']; active: boolean; onPick: (i: number) => void; y?: number }) {
  const { t } = useI18n();
  const st = STAGES.find((s) => s.id === id)!;
  return (
    <Html position={[st.x, y, 0]} center zIndexRange={[20, 0]} distanceFactor={22} occlude={false} style={{ pointerEvents: 'auto' }}>
      <button
        onClick={() => onPick(st.n - 1)}
        className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[15px] font-semibold shadow-lg backdrop-blur ${
          active ? 'border-emerald-400 bg-emerald-500 text-[#052e1f]' : 'border-slate-500/50 bg-slate-900/80 text-slate-100'
        }`}
      >
        <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${active ? 'bg-[#052e1f] text-emerald-300' : 'bg-emerald-500 text-[#052e1f]'}`}>{st.n}</span>
        {t(st.title)}
      </button>
    </Html>
  );
}

export function Receiving() {
  const x = stageX('receiving');
  const truck = useRef<THREE.Group>(null);
  const bed = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (!flow.on || !bed.current) return;
    const k = (Math.sin(st.clock.elapsedTime * 0.5 * flow.speed) + 1) / 2; // кузов поднимается
    bed.current.rotation.z = k * 0.45;
  });
  return (
    <group position={[x, 0, 0]}>
      {/* автомобильные весы */}
      <Box p={[-1, 0.12, 4.2]} s={[7, 0.24, 3.2]} c="#475569" metal={0.4} />
      <Box p={[-1, 0.26, 4.2]} s={[6.6, 0.06, 2.8]} c="#fbbf24" />
      <Box p={[3.2, 0.8, 5.2]} s={[0.9, 1.6, 0.6]} c="#0f172a" />
      <Box p={[3.2, 1.35, 4.88]} s={[0.7, 0.4, 0.05]} c="#22c55e" metal={0} />
      {/* мусоровоз */}
      <group ref={truck} position={[-1, 0.6, 4.2]}>
        <Box p={[-1.3, 0.7, 0]} s={[1.6, 1.0, 1.9]} c="#0ea5e9" />
        <Box p={[-1.9, 1.0, 0]} s={[0.6, 0.55, 1.5]} c="#bae6fd" metal={0.3} opacity={0.8} />
        <group position={[-0.1, 0.5, 0]}>
          <group ref={bed}>
            <Box p={[1.8, 0.8, 0]} s={[3.8, 1.5, 2.0]} c="#16a34a" />
          </group>
        </group>
        {[-1.6, 0.8, 2.2].map((wx) => (
          <Cyl key={wx} p={[wx, -0.1, 1.0]} r={0.4} h={0.3} c="#111827" rot={[Math.PI / 2, 0, 0]} seg={10} />
        ))}
        {[-1.6, 0.8, 2.2].map((wx) => (
          <Cyl key={`b${wx}`} p={[wx, -0.1, -1.0]} r={0.4} h={0.3} c="#111827" rot={[Math.PI / 2, 0, 0]} seg={10} />
        ))}
      </group>
      {/* приёмная площадка: куча отходов */}
      {Array.from({ length: 26 }, (_, i) => {
        const a = i * 2.4;
        const r = 0.5 + (i % 5) * 0.55;
        const cols = ['#a16207', '#64748b', '#38bdf8', '#fde047', '#94a3b8', '#d6a05a'];
        return (
          <Box
            key={i}
            p={[3.6 + Math.cos(a) * r * 0.9, 0.2 + (5 - (i % 5)) * 0.18, -4 + Math.sin(a) * r * 0.7]}
            s={[0.5 + (i % 3) * 0.15, 0.4, 0.5]}
            c={cols[i % cols.length]}
            r={[0.3 * i, i, 0.2]}
          />
        );
      })}
      <Box p={[3.6, 0.1, -4]} s={[4.6, 0.1, 3.6]} c="#57534e" />
      {/* погрузчик */}
      <group position={[-3, 0, -3.5]}>
        <Box p={[0, 0.8, 0]} s={[1.8, 0.9, 1.4]} c="#f59e0b" />
        <Box p={[-0.2, 1.6, 0]} s={[0.9, 0.8, 1.1]} c="#fde68a" opacity={0.8} />
        <Box p={[1.4, 0.5, 0]} s={[1.0, 0.5, 1.8]} c="#475569" />
        {[-0.6, 0.6].map((wx) => (
          <Cyl key={wx} p={[wx, 0.4, 0.85]} r={0.4} h={0.3} c="#111827" rot={[Math.PI / 2, 0, 0]} seg={10} />
        ))}
      </group>
    </group>
  );
}

export function Opening() {
  const x = stageX('opening');
  return (
    <group position={[x, 0, 0]}>
      {/* бункер подачи */}
      <group position={[-3, 0, 0]}>
        <mesh position={[0, 2.2, 0]}>
          <cylinderGeometry args={[2.1, 1.0, 2.2, 4, 1, true]} />
          <meshStandardMaterial color="#64748b" flatShading side={THREE.DoubleSide} metalness={0.3} />
        </mesh>
        <Box p={[0, 3.45, 0]} s={[4.4, 0.12, 4.4]} c="#475569" opacity={0.0} />
        <Box p={[0, 0.6, 0]} s={[1.2, 1.4, 1.2]} c="#334155" />
      </group>
      {/* пакеторазрыватель */}
      <group position={[1.6, 0, 0]}>
        <Box p={[0, 2.0, 0]} s={[3.4, 1.8, 2.4]} c="#f59e0b" opacity={0.92} />
        <Box p={[0, 3.0, 0]} s={[3.6, 0.2, 2.6]} c="#92400e" />
        <Spin axis="z" speed={3} p={[0, 2.0, 1.25]}>
          <Cyl p={[0, 0, 0]} r={0.12} h={0.1} c="#e5e7eb" rot={[Math.PI / 2, 0, 0]} />
        </Spin>
        <Spin axis="x" speed={4} p={[0, 1.8, 0]}>
          <Cyl p={[0, 0, 0]} r={0.35} h={2.6} c="#1e293b" rot={[Math.PI / 2, 0, 0]} />
          {Array.from({ length: 12 }, (_, i) => (
            <Box key={i} p={[Math.cos(i * 0.52) * 0.55, Math.sin(i * 0.52) * 0.55, -1 + (i % 4) * 0.66]} s={[0.12, 0.3, 0.12]} c="#e5e7eb" r={[0, 0, i * 0.52]} />
          ))}
        </Spin>
      </group>
    </group>
  );
}

export function Trommel() {
  const x = stageX('trommel');
  return (
    <group position={[x, 0, 0]}>
      <Spin axis="x" speed={0.9} p={[0, 2.5, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[1.5, 1.5, 6.4, 14, 1, true]} />
          <meshStandardMaterial color="#94a3b8" wireframe side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[1.45, 1.45, 6.3, 14, 1, true]} />
          <meshStandardMaterial color="#38bdf8" transparent opacity={0.18} side={THREE.DoubleSide} />
        </mesh>
        {[-3.1, 0, 3.1].map((px) => (
          <mesh key={px} position={[px, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[1.5, 0.08, 6, 16]} />
            <meshStandardMaterial color="#f59e0b" />
          </mesh>
        ))}
      </Spin>
      {[-3.2, 3.2].map((px) => (
        <Box key={px} p={[px, 0.8, 0]} s={[0.4, 1.6, 2.6]} c="#334155" />
      ))}
      {/* лоток мелкой фракции к бункеру */}
      <Box p={[bx('organic') - x, 0.95, 2.9]} s={[1.4, 0.2, 3.6]} c="#475569" r={[0.5, 0, 0]} />
    </group>
  );
}

export function Magnet() {
  const x = stageX('magnet');
  return (
    <group position={[x, 0, 0]}>
      {/* подвесной магнит с лентой */}
      <Box p={[-1.5, 2.4, 0]} s={[3.6, 0.7, 2.2]} c="#ef4444" />
      <Box p={[-1.5, 2.0, 0]} s={[3.2, 0.12, 1.9]} c="#111827" />
      {[-2.9, -0.1].map((px) => (
        <Box key={px} p={[px, 3.4, 0]} s={[0.15, 2, 0.15]} c="#94a3b8" />
      ))}
      <Box p={[-1.5, 4.4, 0]} s={[3.6, 0.15, 0.4]} c="#94a3b8" />
      {/* вихретоковый сепаратор: барабан в конце ленты */}
      <Spin axis="z" speed={-6} p={[2.8, BELT_Y - 0.1, 0]}>
        <Cyl p={[0, 0, 0]} r={0.55} h={1.8} c="#6366f1" rot={[Math.PI / 2, 0, 0]} />
        {Array.from({ length: 8 }, (_, i) => (
          <Box key={i} p={[Math.cos(i * 0.785) * 0.6, Math.sin(i * 0.785) * 0.6, 0]} s={[0.08, 0.08, 1.8]} c="#e0e7ff" />
        ))}
      </Spin>
      <Box p={[2.8, 0.45, 0]} s={[1.5, 0.5, 2.2]} c="#334155" />
    </group>
  );
}

export function Optical() {
  const x = stageX('optical');
  const scan = useRef<THREE.Mesh>(null);
  const nozzles = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (!flow.on) return;
    const t = st.clock.elapsedTime * flow.speed;
    if (scan.current) (scan.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.2 * Math.sin(t * 14);
    if (nozzles.current) nozzles.current.children.forEach((c, i) => ((c as THREE.Mesh).scale.y = 1 + 0.4 * Math.max(0, Math.sin(t * 9 + i * 1.7))));
  });
  return (
    <group position={[x, 0, 0]}>
      {/* портал с ИИ-камерой */}
      {[-1.4, 1.4].map((pz) => (
        <Box key={pz} p={[0, 1.9, pz]} s={[0.3, 3.8, 0.3]} c="#475569" />
      ))}
      <Box p={[0, 3.8, 0]} s={[0.5, 0.4, 3.2]} c="#1e293b" />
      <Box p={[0, 3.35, 0]} s={[0.9, 0.5, 0.9]} c="#0f172a" />
      <Cyl p={[0, 3.0, 0]} r={0.22} h={0.2} c="#22d3ee" seg={12} />
      {/* плоскость сканирования */}
      <mesh ref={scan} position={[0, 2.0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.6, 2]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* рамки ИИ над потоком */}
      <Html position={[0, 4.6, 0]} center distanceFactor={22} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded-md border border-cyan-400/60 bg-slate-900/80 px-2 py-0.5 text-[13px] font-semibold text-cyan-300">AI · NIR</div>
      </Html>
      {/* оптический сепаратор: форсунки по ходу ленты */}
      <Box p={[3.8, 2.0, 0]} s={[3.4, 0.3, 1.9]} c="#0891b2" />
      <group ref={nozzles}>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[2.4 + i * 0.28, 1.65, 0]}>
            <boxGeometry args={[0.08, 0.34, 0.08]} />
            <meshStandardMaterial color="#e0f2fe" emissive="#7dd3fc" emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Manual() {
  const x = stageX('manual');
  const arms = useRef<THREE.Group[]>([]);
  useFrame((st) => {
    if (!flow.on) return;
    const t = st.clock.elapsedTime * flow.speed;
    arms.current.forEach((g, i) => g && (g.rotation.x = -0.7 + Math.sin(t * 3 + i * 1.3) * 0.5));
  });
  const workers: Array<[number, number]> = [[-2.4, 1.5], [-0.8, -1.5], [0.8, 1.5], [2.4, -1.5]];
  return (
    <group position={[x, 0, 0]}>
      {/* кабина */}
      <Box p={[0, 3.2, 0]} s={[8, 0.15, 5]} c="#475569" />
      {[[-4, -2.5], [4, -2.5], [-4, 2.5], [4, 2.5]].map(([px, pz], i) => (
        <Box key={i} p={[px, 1.6, pz]} s={[0.15, 3.2, 0.15]} c="#94a3b8" />
      ))}
      <Box p={[0, 1.7, -2.5]} s={[8, 3, 0.06]} c="#7dd3fc" opacity={0.22} />
      <Box p={[0, 1.7, 2.5]} s={[8, 3, 0.06]} c="#7dd3fc" opacity={0.14} />
      {workers.map(([px, pz], i) => (
        <group key={i} position={[px, 0, pz * 1.0]} rotation={[0, pz > 0 ? Math.PI : 0, 0]}>
          <Cyl p={[0, 0.7, 0]} r={0.28} h={1.1} c={i % 2 ? '#f97316' : '#eab308'} seg={8} />
          <mesh position={[0, 1.5, 0]}>
            <sphereGeometry args={[0.24, 8, 6]} />
            <meshStandardMaterial color="#fde4c8" flatShading />
          </mesh>
          <Box p={[0, 1.75, 0]} s={[0.5, 0.1, 0.5]} c="#facc15" />
          <group ref={(el) => { if (el) arms.current[i] = el; }} position={[0, 1.1, -0.3]}>
            <Box p={[0.3, 0, -0.35]} s={[0.12, 0.12, 0.7]} c="#f59e0b" />
            <Box p={[-0.3, 0, -0.35]} s={[0.12, 0.12, 0.7]} c="#f59e0b" />
          </group>
        </group>
      ))}
    </group>
  );
}

/** Пресс: подача → сжатие → тюк → склад. Работает от собственной анимации. */
export function Baling() {
  const x = stageX('baling');
  const piston = useRef<THREE.Mesh>(null);
  const bale = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (!flow.on) return;
    const t = (st.clock.elapsedTime * flow.speed) % 4;
    if (piston.current) piston.current.position.x = -1.4 + (t < 1.5 ? (t / 1.5) * 1.0 : t < 2 ? 1.0 - ((t - 1.5) / 0.5) * 1.0 : 0);
    if (bale.current) {
      const k = Math.max(0, (t - 2) / 2);
      bale.current.position.x = 1.0 + k * 3.2;
      bale.current.visible = t > 2;
    }
  });
  const colors = ['#38bdf8', '#fde047', '#d6a05a', '#f97316'];
  return (
    <group position={[x, 0, -5]}>
      {/* подающий конвейер */}
      <Belt x0={x - 6} x1={x - 1.7} y={0.9} z={-5} w={1.3} speed={1.6} />
      {/* пресс */}
      <Box p={[0, 1.5, 0]} s={[3.4, 2.4, 2.4]} c="#1d4ed8" />
      <Box p={[0, 2.8, 0]} s={[3.6, 0.3, 2.6]} c="#1e3a8a" />
      <mesh ref={piston} position={[-1.4, 1.5, 0]}>
        <boxGeometry args={[0.7, 1.8, 1.9]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.5} flatShading />
      </mesh>
      <mesh ref={bale} position={[1, 0.8, 0]}>
        <boxGeometry args={[1.1, 0.9, 1.4]} />
        <meshStandardMaterial color="#38bdf8" flatShading />
      </mesh>
      {/* склад вторсырья */}
      {Array.from({ length: 12 }, (_, i) => (
        <Box
          key={i}
          p={[4.2 + (i % 3) * 1.15, 0.45 + Math.floor(i / 6) * 0.9, -1.4 + ((Math.floor(i / 3)) % 2) * 1.5]}
          s={[1.05, 0.85, 1.35]}
          c={colors[i % 4]}
        />
      ))}
      <Box p={[5.3, 0.01, -0.6]} s={[4.6, 0.05, 3.8]} c="#475569" />
    </group>
  );
}

export function Residue() {
  const x = stageX('residue');
  return (
    <group position={[x, 0, 0]}>
      {/* шредер */}
      <Box p={[-0.8, 1.6, 0]} s={[2.6, 1.8, 2.2]} c="#ea580c" />
      <mesh position={[-0.8, 3.0, 0]}>
        <cylinderGeometry args={[1.5, 0.9, 1.0, 4, 1, true]} />
        <meshStandardMaterial color="#9a3412" flatShading side={THREE.DoubleSide} />
      </mesh>
      <Spin axis="x" speed={5} p={[-0.8, 1.9, 0]}>
        <Cyl p={[0, 0, 0]} r={0.35} h={2} c="#111827" rot={[Math.PI / 2, 0, 0]} seg={8} />
      </Spin>
      {/* труба RDF */}
      <Box p={[0.8, 2.8, 1.8]} s={[0.3, 0.3, 4]} c="#a3a3a3" r={[0.2, 0, 0]} />
      {/* ёмкость RDF и контейнер полигона у бункеров */}
    </group>
  );
}

export function Bunkers() {
  const list: Array<{ mat: Mat; w?: number }> = [
    { mat: 'organic', w: 2.2 }, { mat: 'metal' }, { mat: 'alu' },
    { mat: 'pet', w: 1.2 }, { mat: 'hdpe', w: 1.2 }, { mat: 'cardboard', w: 1.2 }, { mat: 'film', w: 1.2 },
    { mat: 'paper', w: 1.8 }, { mat: 'glass', w: 1.8 }, { mat: 'rdf', w: 2.2 }, { mat: 'landfill', w: 2.4 },
  ];
  return (
    <group>
      {list.map(({ mat, w }) => (
        <Bunker key={mat} x={bx(mat)} z={BUNKER_Z} color={MAT_COLOR[mat]} w={w ?? 2} d={w && w < 1.5 ? 1.8 : 2.2} />
      ))}
    </group>
  );
}

export { BELT_START, BELT_END };

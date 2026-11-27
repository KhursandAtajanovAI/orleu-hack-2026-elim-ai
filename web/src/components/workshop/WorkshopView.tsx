'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TopBar } from '@/components/ui/TopBar';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { WORKSHOP_STATS } from '@/mocks/astana';
import { CameraRig } from './CameraRig';
import { Flow } from './Flow';
import { Baling, Bunkers, Floor, Magnet, Manual, Opening, Optical, Receiving, Residue, StageLabel, Trommel } from './Machines';
import { Belt } from './parts';
import { BELT_END, BELT_START, STAGES, type StageId } from './stages';
import { flow } from './flowState';
import { MAT_COLOR } from './stages';

const TOUR_MS = 7500;

function BatchRing({ x, label }: { x: number; label: string }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (!ring.current) return;
    const k = 1 + 0.08 * Math.sin(st.clock.elapsedTime * 3);
    ring.current.scale.set(k, k, 1);
  });
  return (
    <group position={[x, 0, 0.5]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[5.0, 5.25, 48]} />
        <meshBasicMaterial color="#34d399" transparent opacity={0.9} />
      </mesh>
      <Html position={[0, 7.4, 0]} center distanceFactor={22} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded-full bg-amber-400 px-3 py-1 text-[14px] font-bold text-slate-900 shadow-lg">📦 {label}</div>
      </Html>
    </group>
  );
}

function Scene({ dark, focus, token, onPick, onUserMove, batchStage, batchLabel }: {
  dark: boolean; focus: number; token: number; onPick: (i: number) => void; onUserMove: () => void;
  batchStage: StageId | null; batchLabel: string;
}) {
  const active = focus >= 0 ? STAGES[focus].id : null;
  const bg = dark ? '#0b1220' : '#dbe4ee';
  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 70, 150]} />
      <hemisphereLight args={[dark ? '#94a3b8' : '#ffffff', dark ? '#0f172a' : '#94a3b8', dark ? 0.9 : 1.1]} />
      <directionalLight position={[20, 40, 25]} intensity={dark ? 1.3 : 1.6} />
      <directionalLight position={[-25, 15, -10]} intensity={0.4} />
      <Floor dark={dark} />
      <Belt x0={BELT_START} x1={BELT_END} />
      <Receiving />
      <Opening />
      <Trommel />
      <Magnet />
      <Optical />
      <Manual />
      <Baling />
      <Residue />
      <Bunkers />
      <Flow />
      {STAGES.map((s) => (
        <StageLabel key={s.id} id={s.id} active={active === s.id} onPick={onPick} />
      ))}
      {batchStage && <BatchRing x={STAGES.find((s) => s.id === batchStage)!.x} label={batchLabel} />}
      <CameraRig focus={focus} token={token} onUserMove={onUserMove} />
    </>
  );
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function WorkshopView() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const [focus, setFocus] = useState(-1);
  const [token, setToken] = useState(0);
  const [tour, setTour] = useState(false);
  const [running, setRunning] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [gl, setGl] = useState<boolean | null>(null);
  const [batchStage, setBatchStage] = useState<StageId | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    setGl(hasWebGL());
    const q = new URLSearchParams(window.location.search);
    const s = q.get('stage') as StageId | null;
    const f = q.get('from');
    setFrom(f);
    // «Ваша партия здесь»: явный ?stage= или, если пришли из пути, — этап ИИ-сортировки
    const target: StageId | null = s && STAGES.some((x) => x.id === s) ? s : f || q.get('batch') ? 'optical' : null;
    if (target) {
      setBatchStage(target);
      const i = STAGES.findIndex((x) => x.id === target);
      setFocus(i);
      setToken((n) => n + 1);
    }
    const onR = () => setMobile(window.innerWidth < 768);
    onR();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  useEffect(() => {
    flow.on = running;
  }, [running]);

  const go = (i: number) => {
    setFocus(i);
    setToken((n) => n + 1);
  };

  // экскурсия: автопролёт по этапам
  useEffect(() => {
    if (!tour) return;
    let i = 0;
    go(0);
    const id = setInterval(() => {
      i += 1;
      if (i >= STAGES.length) {
        setTour(false);
        go(-1);
        return;
      }
      go(i);
    }, TOUR_MS);
    return () => clearInterval(id);
  }, [tour]);

  const stage = focus >= 0 ? STAGES[focus] : null;
  const dark = theme === 'dark';

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden">
      {gl === false ? (
        <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">{t('workshop.webgl_error')}</div>
      ) : (
        <Canvas
          camera={{ position: [0, 30, 54], fov: 45, near: 0.1, far: 400 }}
          dpr={[1, mobile ? 1.5 : 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <Suspense fallback={null}>
            <Scene
              dark={dark}
              focus={focus}
              token={token}
              onPick={(i) => {
                setTour(false);
                go(i);
              }}
              onUserMove={() => setTour(false)}
              batchStage={batchStage}
              batchLabel={t('workshop.batch_here')}
            />
          </Suspense>
        </Canvas>
      )}

      {/* верхняя панель */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3">
        <TopBar current="workshop" />
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <button className={`btn ${tour ? 'btn-primary' : ''}`} onClick={() => setTour((v) => !v)}>
            {tour ? '■ ' + t('workshop.tour.stop') : '▶ ' + t('workshop.tour.start')}
          </button>
          <button className="btn" onClick={() => setRunning((v) => !v)}>
            {running ? '❚❚ ' : '▶ '}
            {t(running ? 'workshop.flow.on' : 'workshop.flow.off')}
          </button>
          <button
            className="btn"
            onClick={() => {
              setTour(false);
              go(-1);
            }}
          >
            ⤢ {t('workshop.free_camera')}
          </button>
        </div>
      </div>

      {/* список этапов (десктоп) */}
      <div className="pointer-events-none absolute left-3 top-24 hidden max-h-[calc(100dvh-8rem)] w-[250px] flex-col gap-2 md:flex">
        <div className="glass pointer-events-auto overflow-y-auto rounded-2xl p-2 shadow-lg">
          <div className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wide text-muted">{t('workshop.stages')}</div>
          {STAGES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setTour(false);
                go(i);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm ${focus === i ? 'bg-brand/20' : 'hover:bg-brand/10'}`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${focus === i ? 'bg-brand text-[#052e1f]' : 'bg-line text-ink'}`}>{s.n}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium leading-tight">{t(s.title)}</span>
                <span className="block truncate text-[11px] text-muted">{t(s.short)}</span>
              </span>
              {batchStage === s.id && <span title={t('workshop.batch_here')}>📦</span>}
            </button>
          ))}
        </div>
      </div>

      {/* карточка этапа */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-stretch gap-2 p-3 md:inset-x-auto md:right-3 md:top-24 md:bottom-3 md:w-[380px] md:justify-start">
        {mobile && (
          <div className="pointer-events-auto flex gap-1.5 overflow-x-auto pb-1">
            {STAGES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setTour(false);
                  go(i);
                }}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-bold ${focus === i ? 'border-transparent bg-brand text-[#052e1f]' : 'glass'}`}
              >
                {s.n}
              </button>
            ))}
          </div>
        )}
        <div className="glass pointer-events-auto max-h-[36vh] overflow-y-auto rounded-2xl p-4 shadow-xl md:max-h-full">
          {stage ? (
            <>
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand font-bold text-[#052e1f]">{stage.n}</span>
                <div>
                  <div className="text-lg font-semibold leading-tight">{t(stage.title)}</div>
                  <div className="text-xs text-muted">{t(stage.short)}</div>
                </div>
              </div>
              {batchStage === stage.id && (
                <div className="mt-3 rounded-xl bg-amber-400/20 px-3 py-2 text-sm font-semibold text-amber-500">📦 {t('workshop.batch_here')}</div>
              )}
              <div className="mt-3 text-[11px] uppercase tracking-wide text-muted">{t('workshop.how')}</div>
              <p className="mt-1 text-sm leading-relaxed">{t(stage.desc)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-brand/5 p-2.5">
                  <div className="mb-0.5 font-semibold text-muted">⬇ {t('workshop.input')}</div>
                  {t(stage.input)}
                </div>
                <div className="rounded-xl bg-brand/5 p-2.5">
                  <div className="mb-0.5 font-semibold text-muted">⬆ {t('workshop.output')}</div>
                  {t(stage.output)}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn flex-1" disabled={focus <= 0} onClick={() => go(focus - 1)}>
                  ← {t('workshop.prev')}
                </button>
                <button className="btn btn-primary flex-1" disabled={focus >= STAGES.length - 1} onClick={() => go(focus + 1)}>
                  {t('workshop.next')} →
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold">{t('workshop.title')}</div>
              <p className="mt-1 text-sm text-muted">{t('workshop.hint')}</p>
              <button className="btn btn-primary mt-3 w-full" onClick={() => go(0)}>
                {t('workshop.next')} →
              </button>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <button className="btn flex-1 text-xs" onClick={() => router.push(from ? `/map?path=${from}` : '/map?facility=f-sort')}>
              🗺 {t('workshop.on_map')}
            </button>
            <button className="btn flex-1 text-xs" onClick={() => setStatsOpen((v) => !v)}>
              📊 {t('workshop.stats')}
            </button>
          </div>
          {statsOpen && (
            <div className="mt-3 space-y-2">
              <div className="rounded-xl bg-brand/5 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">{t('workshop.stats.received')}</div>
                <div className="text-xl font-semibold">{(WORKSHOP_STATS.received_kg / 1000).toFixed(1)} {t('common.t')}</div>
              </div>
              <div className="text-[11px] uppercase tracking-wide text-muted">{t('workshop.stats.share')}</div>
              {WORKSHOP_STATS.shares.map((s) => (
                <div key={s.type} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0">{t(`output.${s.type}` as 'output.PET')}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${s.share * 100}%`, background: MAT_COLOR[(s.type === 'PET' ? 'pet' : s.type === 'RDF' ? 'rdf' : s.type.toLowerCase()) as keyof typeof MAT_COLOR] ?? '#94a3b8' }}
                    />
                  </span>
                  <span className="w-9 text-right tabular-nums">{Math.round(s.share * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

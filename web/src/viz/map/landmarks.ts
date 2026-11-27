/**
 * Процедурные 3D-модели достопримечательностей Астаны (low-poly из примитивов).
 * Координаты и размеры — приблизительные, по открытым описаниям; сверить с OSM/Яндекс/2ГИС.
 * Размеры в метрах, смещения x (восток) / y (север) от точки здания.
 */
import type { MessageKey } from '@/viz/lib/messages/ru';

export type Shape = 'box' | 'cyl' | 'cone' | 'sphere' | 'pyramid' | 'frustum';
export interface Part {
  shape: Shape;
  /** смещение от центра, м */
  x?: number;
  y?: number;
  /** высота основания, м */
  z?: number;
  /** размеры X, Y, Z, м (для sphere/cyl/cone: диаметр, диаметр, высота) */
  s: [number, number, number];
  color: string;
}
export interface Landmark {
  id: string;
  lon: number;
  lat: number;
  height: number; // для подписи
  parts: Part[];
}

const W = '#f1f5f9';
const GOLD = '#fbbf24';

const minaret = (x: number, y: number): Part => ({ shape: 'frustum', x, y, s: [7, 7, 78], color: W });

export const LANDMARKS: Landmark[] = [
  {
    id: 'baiterek', lon: 71.4305, lat: 51.1283, height: 105,
    parts: [
      { shape: 'cyl', s: [44, 44, 6], color: '#cbd5e1' },
      { shape: 'frustum', z: 6, s: [18, 18, 58], color: '#94a3b8' },
      { shape: 'sphere', z: 62, s: [24, 24, 24], color: GOLD },
      { shape: 'cone', z: 84, s: [6, 6, 20], color: '#cbd5e1' },
    ],
  },
  {
    id: 'khanshatyr', lon: 71.4036, lat: 51.1327, height: 160,
    parts: [
      { shape: 'cyl', s: [200, 200, 12], color: '#e2e8f0' },
      { shape: 'cone', z: 12, s: [190, 190, 140], color: '#bae6fd' },
      { shape: 'cone', z: 150, s: [4, 4, 40], color: '#94a3b8' },
    ],
  },
  {
    id: 'nuralem', lon: 71.4162, lat: 51.0894, height: 100,
    parts: [
      { shape: 'cyl', s: [78, 78, 24], color: '#94a3b8' },
      { shape: 'sphere', z: 14, s: [80, 80, 80], color: '#a5b4fc' },
    ],
  },
  {
    id: 'palace', lon: 71.4627, lat: 51.123, height: 62,
    parts: [
      { shape: 'box', s: [100, 100, 6], color: '#d6c8a0' },
      { shape: 'pyramid', z: 6, s: [88, 88, 56], color: '#e7d9aa' },
    ],
  },
  {
    id: 'akorda', lon: 71.4474, lat: 51.1253, height: 80,
    parts: [
      { shape: 'box', s: [130, 55, 18], color: W },
      { shape: 'box', x: -55, y: 0, s: [26, 50, 24], color: W },
      { shape: 'box', x: 55, y: 0, s: [26, 50, 24], color: W },
      { shape: 'cyl', z: 18, s: [36, 36, 20], color: W },
      { shape: 'sphere', z: 34, s: [36, 36, 22], color: '#38bdf8' },
      { shape: 'cone', z: 56, s: [3, 3, 30], color: GOLD },
    ],
  },
  {
    id: 'mosque', lon: 71.4619, lat: 51.1288, height: 80,
    parts: [
      { shape: 'box', s: [95, 95, 22], color: W },
      { shape: 'sphere', z: 14, s: [44, 44, 40], color: '#e2e8f0' },
      minaret(-55, -55), minaret(55, -55), minaret(-55, 55), minaret(55, 55),
    ],
  },
  {
    id: 'arena', lon: 71.4036, lat: 51.1085, height: 55,
    parts: [
      { shape: 'cyl', s: [220, 220, 38], color: '#cbd5e1' },
      { shape: 'cyl', z: 38, s: [200, 200, 6], color: '#64748b' },
    ],
  },
  {
    id: 'megasilk', lon: 71.4093, lat: 51.1306, height: 40,
    parts: [
      { shape: 'box', s: [170, 120, 30], color: '#e5e7eb' },
      { shape: 'cyl', x: -50, y: 0, s: [50, 50, 44], color: '#bfdbfe' },
      { shape: 'cyl', x: 50, y: 0, s: [50, 50, 44], color: '#bfdbfe' },
    ],
  },
];

export const landmarkName = (id: string) => `landmark.${id}.name` as MessageKey;
export const landmarkDesc = (id: string) => `landmark.${id}.desc` as MessageKey;

// ---------- меши ----------
interface Mesh {
  attributes: { positions: { size: 3; value: Float32Array }; normals: { size: 3; value: Float32Array } };
  indices: { size: 1; value: Uint16Array };
}

function frustum(topRatio: number, seg: number, rot = 0): Mesh {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const rb = 0.5;
  const rt = 0.5 * topRatio;
  for (let i = 0; i < seg; i++) {
    const a0 = rot + (i / seg) * Math.PI * 2;
    const a1 = rot + ((i + 1) / seg) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const nx = Math.cos(am), ny = Math.sin(am);
    const o = pos.length / 3;
    pos.push(
      Math.cos(a0) * rb, Math.sin(a0) * rb, 0,
      Math.cos(a1) * rb, Math.sin(a1) * rb, 0,
      Math.cos(a1) * rt, Math.sin(a1) * rt, 1,
      Math.cos(a0) * rt, Math.sin(a0) * rt, 1,
    );
    for (let k = 0; k < 4; k++) nrm.push(nx, ny, 0.3);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    // крышка
    const c = pos.length / 3;
    pos.push(0, 0, 1, Math.cos(a0) * rt, Math.sin(a0) * rt, 1, Math.cos(a1) * rt, Math.sin(a1) * rt, 1);
    for (let k = 0; k < 3; k++) nrm.push(0, 0, 1);
    idx.push(c, c + 1, c + 2);
  }
  return pack(pos, nrm, idx);
}

function sphere(): Mesh {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const la = 12, lo = 20;
  for (let i = 0; i <= la; i++) {
    const th = (i / la) * Math.PI;
    for (let j = 0; j <= lo; j++) {
      const ph = (j / lo) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.sin(th) * Math.sin(ph), z = Math.cos(th);
      pos.push(x * 0.5, y * 0.5, 0.5 + z * 0.5);
      nrm.push(x, y, z);
    }
  }
  for (let i = 0; i < la; i++)
    for (let j = 0; j < lo; j++) {
      const a = i * (lo + 1) + j, b = a + lo + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return pack(pos, nrm, idx);
}

function box(): Mesh {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const f: Array<[number[], number[]]> = [
    [[0, 0, 1], [-.5, -.5, 1, .5, -.5, 1, .5, .5, 1, -.5, .5, 1]],
    [[0, 0, -1], [-.5, .5, 0, .5, .5, 0, .5, -.5, 0, -.5, -.5, 0]],
    [[0, 1, 0], [-.5, .5, 0, -.5, .5, 1, .5, .5, 1, .5, .5, 0]],
    [[0, -1, 0], [.5, -.5, 0, .5, -.5, 1, -.5, -.5, 1, -.5, -.5, 0]],
    [[1, 0, 0], [.5, -.5, 0, .5, .5, 0, .5, .5, 1, .5, -.5, 1]],
    [[-1, 0, 0], [-.5, .5, 0, -.5, -.5, 0, -.5, -.5, 1, -.5, .5, 1]],
  ];
  f.forEach(([n, v], k) => {
    pos.push(...v);
    for (let i = 0; i < 4; i++) nrm.push(...n);
    const o = k * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return pack(pos, nrm, idx);
}

function pack(pos: number[], nrm: number[], idx: number[]): Mesh {
  return {
    attributes: { positions: { size: 3, value: new Float32Array(pos) }, normals: { size: 3, value: new Float32Array(nrm) } },
    indices: { size: 1, value: new Uint16Array(idx) },
  };
}

let cache: Record<Shape, Mesh> | null = null;
export function shapeMeshes(): Record<Shape, Mesh> {
  if (!cache) {
    cache = {
      box: box(),
      cyl: frustum(1, 28),
      cone: frustum(0.02, 28),
      frustum: frustum(0.35, 20),
      pyramid: frustum(0.02, 4, Math.PI / 4),
      sphere: sphere(),
    };
  }
  return cache;
}

export interface PartInstance {
  lid: string;
  shape: Shape;
  pos: [number, number, number];
  scale: [number, number, number];
  color: string;
}

/** Плоский список деталей с координатами lon/lat — вход для SimpleMeshLayer. */
export const PART_INSTANCES: PartInstance[] = LANDMARKS.flatMap((l) =>
  l.parts.map((p) => ({
    lid: l.id,
    shape: p.shape,
    pos: [
      l.lon + (p.x ?? 0) / (111320 * Math.cos((l.lat * Math.PI) / 180)),
      l.lat + (p.y ?? 0) / 110540,
      p.z ?? 0,
    ] as [number, number, number],
    scale: p.s,
    color: p.color,
  })),
);

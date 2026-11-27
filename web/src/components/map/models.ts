/**
 * Детальные 3D-модели НАШИХ объектов цепочки (сортировка, переработка, полигон, компост, RDF,
 * пункты приёма) и контейнерных площадок. Процедурные, размеры в метрах, ориентированы по осям.
 */
import type { MapFacility, MapSite, WasteType } from '@/lib/contracts';
import { WASTE_COLOR } from './constants';
import type { Part, PartInstance } from './landmarks';

const grid = (n: number, f: (i: number) => Part): Part[] => Array.from({ length: n }, (_, i) => f(i));

function facilityParts(f: MapFacility): Part[] {
  switch (f.type) {
    case 'sorting':
      return [
        { shape: 'box', s: [120, 46, 16], color: '#8fa3b8' },
        { shape: 'box', z: 16, s: [122, 48, 2], color: '#64748b' },
        { shape: 'box', x: -80, y: 0, s: [34, 32, 10], color: '#b8c4d0' }, // приёмка
        { shape: 'box', x: -80, y: 0, z: 10, s: [36, 34, 1.5], color: '#475569' },
        ...grid(3, (i): Part => ({ shape: 'cyl' as const, x: 30 + i * 14, y: 38, s: [10, 10, 26], color: '#e2e8f0' })), // бункеры
        { shape: 'cyl', x: -45, y: -40, s: [4, 4, 42], color: '#94a3b8' },
        ...grid(8, (i): Part => ({ shape: 'box' as const, x: 78 + (i % 4) * 8, y: -26 + Math.floor(i / 4) * 8, s: [7, 6.5, 6], color: ['#38bdf8', '#fde047', '#d6a05a', '#f97316'][i % 4] })), // тюки
        { shape: 'box', x: 0, y: -50, s: [70, 6, 0.3], color: '#475569' }, // подъезд
      ];
    case 'recycling':
      return [
        { shape: 'box', s: [80, 38, 14], color: '#86b79a' },
        { shape: 'box', z: 14, s: [82, 40, 1.5], color: '#4d7c64' },
        ...grid(3, (i): Part => ({ shape: 'cyl' as const, x: -25 + i * 22, y: 36, s: [14, 14, 18], color: '#cbd5e1' })),
        { shape: 'frustum', x: 50, y: -10, s: [6, 6, 38], color: '#a8a29e' },
      ];
    case 'landfill':
      return [
        { shape: 'frustum', s: [300, 300, 9], color: '#6b6258' },
        { shape: 'frustum', z: 9, s: [250, 250, 9], color: '#756b60' },
        { shape: 'frustum', z: 18, s: [200, 200, 9], color: '#80766a' },
        { shape: 'frustum', z: 27, s: [140, 140, 8], color: '#8b8175' },
        ...grid(6, (i): Part => ({ shape: 'cyl' as const, x: Math.cos(i) * 40, y: Math.sin(i) * 40, z: 35, s: [1.6, 1.6, 12], color: '#e5e7eb' })), // газоотвод
        { shape: 'box', x: -190, y: -150, s: [24, 14, 5], color: '#cbd5e1' },
        { shape: 'box', x: -150, y: -150, s: [16, 8, 4], color: '#f59e0b' }, // весовая
      ];
    case 'composting':
      return [
        ...grid(5, (i): Part => ({ shape: 'box' as const, x: 0, y: -40 + i * 20, s: [110, 9, 4.5], color: '#5b4636' })),
        { shape: 'box', x: -80, y: 10, s: [40, 26, 8], color: '#9ab87c' },
        { shape: 'box', x: -80, y: 10, z: 8, s: [42, 28, 1], color: '#4d7c0f' },
      ];
    case 'energy':
      return [
        { shape: 'box', s: [60, 36, 15], color: '#a8a29e' },
        { shape: 'box', x: 25, y: 0, s: [28, 28, 40], color: '#d97706' },
        { shape: 'cyl', x: 45, y: 25, s: [8, 8, 92], color: '#e2e8f0' },
        { shape: 'cyl', x: 45, y: 25, z: 70, s: [8.4, 8.4, 6], color: '#ef4444' },
        { shape: 'cyl', x: -20, y: 36, s: [12, 12, 20], color: '#cbd5e1' },
      ];
    case 'collection_point': {
      const cols = f.accepts.map((w) => WASTE_COLOR[w]);
      return [
        { shape: 'box', s: [14, 8, 3.2], color: '#f97316' },
        { shape: 'box', z: 3.2, s: [16, 10, 0.5], color: '#7c2d12' },
        ...cols.map((c, i): Part => ({ shape: 'box', x: -5 + i * 3.4, y: -8, s: [2.2, 1.6, 1.8], color: c })),
      ];
    }
  }
}

function sitePartsOf(s: MapSite): Part[] {
  const n = s.containers.length;
  return [
    { shape: 'box', s: [Math.max(8, n * 2.4 + 2), 6, 0.2], color: '#475569' },
    { shape: 'box', y: 3.2, z: 0, s: [Math.max(8, n * 2.4 + 2), 0.2, 1.8], color: '#94a3b8' },
    ...s.containers.map((c, i) => ({
      shape: 'box' as const,
      x: (i - (n - 1) / 2) * 2.4,
      y: 0,
      z: 0.2,
      s: [2, 1.4, 1.6 + (c.fill_level / 100) * 0.3] as [number, number, number],
      color: WASTE_COLOR[c.waste_type as WasteType],
    })),
  ];
}

const toInstances = (id: string, lon: number, lat: number, parts: Part[]): PartInstance[] =>
  parts.map((p) => ({
    lid: id,
    shape: p.shape,
    pos: [lon + (p.x ?? 0) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (p.y ?? 0) / 110540, p.z ?? 0],
    scale: p.s,
    color: p.color,
  }));

const fCache = new WeakMap<object, PartInstance[]>();
const sCache = new WeakMap<object, PartInstance[]>();

export function facilityInstances(list: MapFacility[]): PartInstance[] {
  let v = fCache.get(list);
  if (!v) fCache.set(list, (v = list.flatMap((f) => toInstances(f.id, f.lon, f.lat, facilityParts(f)))));
  return v;
}
export function siteInstances(list: MapSite[]): PartInstance[] {
  let v = sCache.get(list);
  if (!v) sCache.set(list, (v = list.flatMap((s) => toInstances(s.id, s.lon, s.lat, sitePartsOf(s)))));
  return v;
}

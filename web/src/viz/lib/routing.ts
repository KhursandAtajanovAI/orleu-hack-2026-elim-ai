import { haversine, type LonLat } from './geo';

const OSRM = process.env.NEXT_PUBLIC_OSRM_URL || 'https://router.project-osrm.org';
const cache = new Map<string, LonLat[]>();

/** Фолбэк, если OSRM недоступен: Г-образные отрезки (похоже на сетку улиц). */
export function manhattan(points: LonLat[]): LonLat[] {
  const out: LonLat[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    out.push([b[0], a[1]], b);
  }
  return out;
}

/** Маршрут по дорогам через OSRM; при ошибке — Г-образная ломаная. */
export async function routeVia(points: LonLat[]): Promise<{ coords: LonLat[]; fallback: boolean }> {
  const key = points.map((p) => p.map((v) => v.toFixed(5)).join(',')).join(';');
  const hit = cache.get(key);
  if (hit) return { coords: hit, fallback: false };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(
      `${OSRM}/route/v1/driving/${key}?overview=full&geometries=geojson`,
      { signal: ctl.signal },
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const coords = json?.routes?.[0]?.geometry?.coordinates as LonLat[] | undefined;
    if (!coords || coords.length < 2) throw new Error('empty');
    cache.set(key, coords);
    return { coords, fallback: false };
  } catch {
    const coords = manhattan(points);
    cache.set(key, coords);
    return { coords, fallback: true };
  }
}

export function pathLength(coords: LonLat[]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/**
 * Треки по дорогам: OSRM (публичный router.project-osrm.org или свой OSRM_URL) с кэшем на диске.
 * Если OSRM недоступен — «манхэттенская» ломаная между точками (как по кварталам), чтобы
 * симулятор работал и без сети. Плюс разбиение трека на GPS-точки с заданной скоростью.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LonLat = [number, number];

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function headingDeg(a: LonLat, b: LonLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

export function lineLengthM(line: LonLat[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += distanceM(line[i - 1], line[i]);
  return s;
}

// ------------------------------------------------------------------ OSRM + кэш
export class Router {
  private cache: Record<string, LonLat[]> = {};
  private cacheFile: string;
  private url: string;
  private online = true;
  stats = { osrm: 0, cached: 0, fallback: 0 };

  constructor(cacheFile: string, url = process.env.OSRM_URL ?? 'https://router.project-osrm.org') {
    this.cacheFile = cacheFile;
    this.url = url.replace(/\/$/, '');
    if (existsSync(cacheFile)) this.cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (process.env.OSRM_OFFLINE === '1') this.online = false;
  }

  save(): void {
    mkdirSync(dirname(this.cacheFile), { recursive: true });
    writeFileSync(this.cacheFile, JSON.stringify(this.cache));
  }

  /** Дорога от a до b (несколько точек). */
  async leg(a: LonLat, b: LonLat): Promise<LonLat[]> {
    const key = [a, b].map((p) => p.map((v) => v.toFixed(5)).join(',')).join(';');
    if (this.cache[key]) {
      this.stats.cached++;
      return this.cache[key];
    }
    if (this.online) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`${this.url}/route/v1/driving/${key}?overview=full&geometries=geojson`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          const body = (await res.json()) as { routes?: { geometry: { coordinates: LonLat[] } }[] };
          const coords = body.routes?.[0]?.geometry.coordinates;
          if (coords && coords.length >= 2) {
            this.stats.osrm++;
            this.cache[key] = coords.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
            await new Promise((r) => setTimeout(r, 120)); // бережно к публичному серверу
            return this.cache[key];
          }
        } else if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch {
        this.online = false; // нет сети — дальше без OSRM
        console.warn('OSRM недоступен — треки строятся по кварталам (без привязки к дорогам)');
      }
    }
    this.stats.fallback++;
    return [a, [b[0], a[1]], b];
  }

  async path(points: LonLat[]): Promise<LonLat[]> {
    const out: LonLat[] = [];
    for (let i = 1; i < points.length; i++) {
      const leg = await this.leg(points[i - 1], points[i]);
      out.push(...(i === 1 ? leg : leg.slice(1)));
    }
    return out;
  }
}

// ------------------------------------------------------------------ GPS-точки
export interface GpsPoint { lon: number; lat: number; speed: number; heading: number; t: number }

/**
 * Пройти ломаную со скоростью speedKmh, точка каждые stepS секунд, начиная с времени t0 (мс).
 * Возвращает точки и время прибытия.
 */
export function drive(line: LonLat[], t0: number, speedKmh: number, stepS: number, jitter = () => 1): { points: GpsPoint[]; t: number } {
  const points: GpsPoint[] = [];
  if (line.length < 2) return { points, t: t0 };
  const v = (speedKmh * 1000) / 3600;
  let t = t0;
  let carry = 0; // м до следующей точки
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const seg = distanceM(a, b);
    if (seg < 0.5) continue;
    const hd = headingDeg(a, b);
    let pos = carry;
    while (pos <= seg) {
      const k = pos / seg;
      const sp = Math.max(5, speedKmh * jitter());
      points.push({ lon: a[0] + (b[0] - a[0]) * k, lat: a[1] + (b[1] - a[1]) * k, speed: Math.round(sp * 10) / 10, heading: hd, t: t + (pos / v) * 1000 });
      pos += v * stepS;
    }
    carry = pos - seg;
    t += (seg / v) * 1000;
  }
  const last = line[line.length - 1];
  points.push({ lon: last[0], lat: last[1], speed: 0, heading: points.at(-1)?.heading ?? 0, t });
  return { points, t };
}

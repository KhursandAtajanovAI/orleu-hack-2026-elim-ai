import { CELL_LAT, CELL_LON, TIERS, cellOf, convert, queryFor, tierLayers, type Feat, type LayerKind, type Tier } from './convert';

const ENDPOINTS = (process.env.NEXT_PUBLIC_OVERPASS_URL
  ? process.env.NEXT_PUBLIC_OVERPASS_URL.split(',')
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
).map((s) => s.trim());
const STATIC_BASE = process.env.NEXT_PUBLIC_OSM_STATIC || '/data/astana';
const MIN_ZOOM = 13;
const MAX_CELLS = 28;
const PARALLEL = 2;

export type FC = { type: 'FeatureCollection'; features: Feat[] };
export interface LoadStats { total: number; done: number; failed: number; mode: 'static' | 'overpass' | 'unknown' }

/**
 * Ленивая подгрузка модели города по ячейкам в видимой области.
 * Порядок: сначала ключевое (магистрали, значимые здания, ЖК, зоны/полигоны), потом детализация.
 * Источник: готовые файлы /data/astana (scripts/fetch-osm.ts) → иначе Overpass API прямо из браузера.
 */
export class OsmLoader {
  private status = new Map<string, 'queued' | 'loading' | 'done' | 'error'>();
  private layers: Record<LayerKind, Map<string, Feat>> = { roads: new Map(), buildings: new Map(), areas: new Map(), points: new Map() };
  private queue: Array<{ tier: Tier; cx: number; cy: number; prio: number }> = [];
  private running = 0;
  private mode: LoadStats['mode'] = 'unknown';
  private modeP: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epEnd = 0;
  listeners = new Set<() => void>();

  private emit() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.listeners.forEach((f) => f());
    }, 250);
  }

  stats(): LoadStats {
    let done = 0, failed = 0;
    this.status.forEach((s) => (s === 'done' ? done++ : s === 'error' ? failed++ : 0));
    return { total: this.status.size, done, failed, mode: this.mode };
  }

  collection(kind: LayerKind): FC {
    return { type: 'FeatureCollection', features: [...this.layers[kind].values()] };
  }

  /** Вызывать при moveend. bounds = [w,s,e,n]. */
  update(bounds: [number, number, number, number], center: [number, number], zoom: number) {
    if (zoom < MIN_ZOOM) return;
    const [w, s, e, n] = bounds;
    const [x0, y0] = cellOf(w, s);
    const [x1, y1] = cellOf(e, n);
    const cells: Array<[number, number, number]> = [];
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const dx = (cx + 0.5) * CELL_LON - center[0];
        const dy = (cy + 0.5) * CELL_LAT - center[1];
        cells.push([cx, cy, dx * dx * 0.5 + dy * dy]); // lon короче по метрам
      }
    cells.sort((a, b) => a[2] - b[2]);
    const picked = cells.slice(0, MAX_CELLS);
    // очередь пересобираем: актуальные ячейки, ключевые уровни — раньше деталей
    this.queue = this.queue.filter((q) => this.status.get(`${q.tier}:${q.cx}:${q.cy}`) === 'loading');
    picked.forEach(([cx, cy, d], i) => {
      TIERS.forEach((tier, ti) => {
        const key = `${tier}:${cx}:${cy}`;
        if (this.status.has(key) && this.status.get(key) !== 'error') return;
        this.status.set(key, 'queued');
        // приоритет: сначала уровень (ключевое), внутри уровня — ближе к центру
        this.queue.push({ tier, cx, cy, prio: ti * 1000 + i });
      });
    });
    this.queue.sort((a, b) => a.prio - b.prio);
    this.emit();
    this.pump();
  }

  private async detectMode() {
    if (this.mode !== 'unknown') return;
    this.modeP ??= (async () => {
      try {
        const r = await fetch(`${STATIC_BASE}/manifest.json`, { cache: 'no-cache' });
        this.mode = r.ok && (r.headers.get('content-type') ?? '').includes('json') ? 'static' : 'overpass';
      } catch {
        this.mode = 'overpass';
      }
    })();
    await this.modeP;
  }

  private async pump() {
    await this.detectMode();
    while (this.running < PARALLEL && this.queue.length) {
      const job = this.queue.shift()!;
      const key = `${job.tier}:${job.cx}:${job.cy}`;
      if (this.status.get(key) !== 'queued') continue;
      this.status.set(key, 'loading');
      this.running++;
      this.fetchCell(job.tier, job.cx, job.cy)
        .then((feats) => {
          for (const k of tierLayers[job.tier]) {
            const target = k === 'points' ? 'points' : k;
            for (const f of feats) {
              const isPoint = f.geometry.type === 'Point';
              if ((target === 'points') !== isPoint) continue;
              this.layers[target as LayerKind].set(String(f.id), f);
            }
          }
          this.status.set(key, 'done');
        })
        .catch(() => this.status.set(key, 'error'))
        .finally(() => {
          this.running--;
          this.emit();
          this.pump();
        });
    }
  }

  private async fetchCell(tier: Tier, cx: number, cy: number): Promise<Feat[]> {
    const cacheKey = `https://kaida.local/osm/${tier}/${cx}_${cy}`;
    try {
      const c = await caches.open('kaida-osm-v1');
      const hit = await c.match(cacheKey);
      if (hit) return (await hit.json()) as Feat[];
    } catch {}

    let feats: Feat[];
    if (this.mode === 'static') {
      const r = await fetch(`${STATIC_BASE}/${tier}/${cx}_${cy}.json`);
      feats = r.ok ? ((await r.json()) as Feat[]) : [];
    } else {
      feats = convert(tier, await this.overpass(queryFor(tier, cx, cy)));
    }
    try {
      const c = await caches.open('kaida-osm-v1');
      await c.put(cacheKey, new Response(JSON.stringify(feats), { headers: { 'content-type': 'application/json' } }));
    } catch {}
    return feats;
  }

  private async overpass(q: string) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
      const url = ENDPOINTS[(this.epEnd + attempt) % ENDPOINTS.length];
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 70000);
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        clearTimeout(timer);
        if (r.status === 429 || r.status === 504) {
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
          throw new Error(String(r.status));
        }
        if (!r.ok) throw new Error(String(r.status));
        this.epEnd = (this.epEnd + attempt) % ENDPOINTS.length;
        return (await r.json()).elements ?? [];
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }
}

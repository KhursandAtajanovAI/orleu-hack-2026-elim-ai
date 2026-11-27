/**
 * Overpass JSON → GeoJSON для 3D-модели города. Самодостаточный модуль (без алиасов @/),
 * чтобы его мог запускать и браузер, и scripts/fetch-osm.ts.
 * Данные © участники OpenStreetMap, лицензия ODbL.
 */
export type LonLat = [number, number];
export type Tier = 'roads1' | 'buildings1' | 'areas1' | 'roads2' | 'buildings2' | 'areas2';
export const TIERS: Tier[] = ['roads1', 'buildings1', 'areas1', 'roads2', 'buildings2', 'areas2'];
export type LayerKind = 'roads' | 'buildings' | 'areas' | 'points';
export const tierLayers: Record<Tier, LayerKind[]> = {
  roads1: ['roads'], roads2: ['roads'],
  buildings1: ['buildings'], buildings2: ['buildings'],
  areas1: ['areas', 'points'], areas2: ['areas'],
};

export interface Feat {
  type: 'Feature';
  id: string;
  geometry: { type: 'Polygon'; coordinates: LonLat[][] } | { type: 'LineString'; coordinates: LonLat[] } | { type: 'Point'; coordinates: LonLat };
  properties: Record<string, string | number | boolean | undefined>;
}

// ---------- сетка ячеек ----------
export const CELL_LON = 0.02;
export const CELL_LAT = 0.0125;
export const cellOf = (lon: number, lat: number) => [Math.floor(lon / CELL_LON), Math.floor(lat / CELL_LAT)] as const;
export const cellBBox = (cx: number, cy: number) => ({
  w: cx * CELL_LON, s: cy * CELL_LAT, e: (cx + 1) * CELL_LON, n: (cy + 1) * CELL_LAT,
});

// ---------- запросы Overpass ----------
const KEY_BUILDINGS =
  'apartments|civic|public|government|hospital|school|university|kindergarten|college|commercial|retail|office|industrial|warehouse|church|mosque|cathedral|stadium|train_station|hotel|dormitory|sports_hall|supermarket';

export function queryFor(tier: Tier, cx: number, cy: number): string {
  const { w, s, e, n } = cellBBox(cx, cy);
  const b = `(${s},${w},${n},${e})`;
  const body: Record<Tier, string> = {
    roads1: `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]${b};`,
    roads2: `way["highway"~"^(residential|unclassified|living_street|service|pedestrian)$"]${b};`,
    buildings1: `way["building"]["name"]${b};way["building"~"^(${KEY_BUILDINGS})$"]${b};way["building"]["building:levels"~"^([9]|[1-9][0-9])$"]${b};relation["building"]["name"]${b};`,
    buildings2: `way["building"]${b};relation["building"]${b};`,
    areas1: `way["landuse"~"^(landfill|industrial|residential|retail|commercial|quarry|brownfield|garages)$"]${b};relation["landuse"~"^(landfill|industrial|residential)$"]${b};way["amenity"="recycling"]${b};node["amenity"~"^(recycling|waste_disposal|waste_transfer_station)$"]${b};way["man_made"~"^(wastewater_plant|works)$"]${b};way["amenity"="waste_transfer_station"]${b};`,
    areas2: `way["leisure"~"^(park|garden|pitch|playground)$"]${b};way["natural"="water"]${b};relation["natural"="water"]${b};`,
  };
  return `[out:json][timeout:90];(${body[tier]});out geom tags qt;`;
}

// ---------- геометрия ----------
interface Pt { lat: number; lon: number }
const toLL = (g: Pt[]): LonLat[] => g.map((p) => [p.lon, p.lat]);
const same = (a: LonLat, b: LonLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

function closeRing(r: LonLat[]): LonLat[] | null {
  if (r.length < 3) return null;
  const c = same(r[0], r[r.length - 1]) ? r : [...r, r[0]];
  return c.length >= 4 ? c : null;
}

/** Склеивает незамкнутые отрезки (границы мультиполигона) в кольца. */
export function stitch(ways: LonLat[][]): LonLat[][] {
  const rings: LonLat[][] = [];
  const pool = ways.filter((w) => w.length > 1).map((w) => w.slice());
  while (pool.length) {
    let cur = pool.pop()!;
    let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 5000) {
      const end = cur[cur.length - 1];
      const i = pool.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
      if (i < 0) break;
      const w = pool.splice(i, 1)[0];
      cur = cur.concat(same(w[0], end) ? w.slice(1) : w.slice().reverse().slice(1));
    }
    const r = closeRing(cur);
    if (r && same(cur[0], cur[cur.length - 1])) rings.push(r);
  }
  return rings;
}

interface El {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: Pt[];
  members?: Array<{ type: string; role: string; geometry?: Pt[] }>;
  lat?: number;
  lon?: number;
}

function polygonsOf(el: El): LonLat[][][] {
  if (el.type === 'way' && el.geometry) {
    const r = closeRing(toLL(el.geometry));
    return r ? [[r]] : [];
  }
  if (el.type === 'relation' && el.members) {
    const outers = stitch(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => toLL(m.geometry!)));
    const inners = stitch(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => toLL(m.geometry!)));
    if (!outers.length) return [];
    return outers.map((o, i) => (i === 0 ? [o, ...inners] : [o]));
  }
  return [];
}

// ---------- свойства ----------
function num(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

const CAT: Record<string, string> = {
  apartments: 'res', residential: 'res', dormitory: 'res', house: 'res', detached: 'res', terrace: 'res',
  civic: 'public', public: 'public', government: 'public', hospital: 'public', school: 'public', university: 'public', kindergarten: 'public', college: 'public',
  commercial: 'commerce', retail: 'commerce', office: 'commerce', hotel: 'commerce', supermarket: 'commerce',
  industrial: 'industry', warehouse: 'industry', factory: 'industry', garages: 'industry',
  church: 'culture', mosque: 'culture', cathedral: 'culture', stadium: 'culture', sports_hall: 'culture', train_station: 'culture',
};
const DEFAULT_H: Record<string, number> = { res: 18, public: 11, commerce: 14, industry: 9, culture: 18, other: 7 };

export function buildingProps(t: Record<string, string>) {
  const cat = CAT[t.building] ?? (t.building === 'yes' ? 'other' : 'other');
  const levels = num(t['building:levels']);
  let h = num(t.height) ?? (levels ? levels * 3.2 + 1 : undefined);
  const guessed = h === undefined;
  if (h === undefined) h = DEFAULT_H[cat];
  const base = num(t.min_height) ?? (num(t['building:min_level']) ? num(t['building:min_level'])! * 3.2 : 0);
  return { cat, h: Math.min(h, 400), base: Math.min(base, h - 1), guessed, name: t.name || t['name:ru'] || undefined, lv: levels };
}

const AREA_KIND = (t: Record<string, string>) =>
  t.landuse === 'landfill' ? 'landfill'
  : t.amenity === 'recycling' || t.amenity === 'waste_transfer_station' || t.amenity === 'waste_disposal' ? 'waste'
  : t.man_made === 'wastewater_plant' ? 'waste'
  : t.landuse === 'industrial' || t.man_made === 'works' || t.landuse === 'brownfield' || t.landuse === 'quarry' || t.landuse === 'garages' ? 'industrial'
  : t.landuse === 'residential' ? 'residential'
  : t.landuse === 'retail' || t.landuse === 'commercial' ? 'commercial'
  : t.natural === 'water' ? 'water'
  : t.leisure ? 'green'
  : 'other';

const MAJOR = /^(motorway|trunk|primary|secondary|tertiary)/;

export function convert(tier: Tier, elements: El[]): Feat[] {
  const out: Feat[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const id = `${el.type[0]}${el.id}`;
    if (tier === 'roads1' || tier === 'roads2') {
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
      const hw = t.highway ?? '';
      out.push({
        type: 'Feature', id,
        geometry: { type: 'LineString', coordinates: toLL(el.geometry) },
        properties: { id, hw, cls: MAJOR.test(hw) ? 'major' : 'minor', name: t.name, bridge: t.bridge === 'yes' || undefined },
      });
    } else if (tier === 'buildings1' || tier === 'buildings2') {
      const p = buildingProps(t);
      const polys = polygonsOf(el);
      polys.forEach((rings, i) =>
        out.push({ type: 'Feature', id: polys.length > 1 ? `${id}_${i}` : id, geometry: { type: 'Polygon', coordinates: rings }, properties: { id, ...p } }),
      );
    } else {
      const kind = AREA_KIND(t);
      if (el.type === 'node' && el.lat != null && el.lon != null) {
        out.push({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [el.lon, el.lat] }, properties: { id, kind, name: t.name } });
        continue;
      }
      const polys = polygonsOf(el);
      polys.forEach((rings, i) =>
        out.push({ type: 'Feature', id: polys.length > 1 ? `${id}_${i}` : id, geometry: { type: 'Polygon', coordinates: rings }, properties: { id, kind, name: t.name } }),
      );
    }
  }
  return out;
}

/** Центроид кольца (для подписей). */
export function centroid(ring: LonLat[]): LonLat {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/**
 * Мок-данные Астаны (левый берег, р-н «Есиль») — заменяются сидами потока H.
 * Адреса и координаты площадок — ПЛЕЙСХОЛДЕРЫ для разработки фронта,
 * реальные адреса приходят из seed-скрипта.
 */
import type {
  MapComplaint,
  MapContainer,
  MapFacility,
  MapSite,
  MapVehicle,
  OutputType,
  PathOutput,
  SitePath,
  WasteType,
} from '@/lib/contracts';
import { rng, type LonLat } from '@/lib/geo';

export const CITY_CENTER: LonLat = [71.435, 51.13];
export const MAP_BBOX: [number, number, number, number] = [71.3, 51.0, 71.6, 51.2];

export const FACILITIES: MapFacility[] = [
  { id: 'f-sort', type: 'sorting', name: 'Сортировочный комплекс «Астана-Сорт»', lon: 71.352, lat: 51.083, accepts: ['mixed', 'plastic', 'paper', 'glass', 'metal'], capacity_tpd: 600, week_tons: 3120 },
  { id: 'f-rec1', type: 'recycling', name: 'Переработка ПЭТ «Эко-Полимер»', lon: 71.505, lat: 51.092, accepts: ['plastic'], capacity_tpd: 80, week_tons: 410 },
  { id: 'f-rec2', type: 'recycling', name: 'Стеклозавод «Кристалл»', lon: 71.332, lat: 51.148, accepts: ['glass'], capacity_tpd: 120, week_tons: 280 },
  { id: 'f-land', type: 'landfill', name: 'Полигон ТБО', lon: 71.56, lat: 51.025, accepts: ['mixed'], capacity_tpd: 2000, week_tons: 5200 },
  { id: 'f-comp', type: 'composting', name: 'Площадка компостирования', lon: 71.52, lat: 51.04, accepts: ['organic'], capacity_tpd: 90, week_tons: 640 },
  { id: 'f-rdf', type: 'energy', name: 'Установка RDF-топлива', lon: 71.372, lat: 51.062, accepts: ['mixed'], capacity_tpd: 150, week_tons: 520 },
  { id: 'f-cp1', type: 'collection_point', name: 'Пункт приёма №1', lon: 71.418, lat: 51.121, accepts: ['plastic', 'paper', 'glass', 'metal'], capacity_tpd: 6, week_tons: 18 },
  { id: 'f-cp2', type: 'collection_point', name: 'Пункт приёма №2', lon: 71.448, lat: 51.139, accepts: ['plastic', 'paper', 'metal'], capacity_tpd: 5, week_tons: 14 },
  { id: 'f-cp3', type: 'collection_point', name: 'Пункт приёма №3', lon: 71.463, lat: 51.121, accepts: ['plastic', 'glass'], capacity_tpd: 4, week_tons: 9 },
];

export const DEPOT: LonLat = [71.385, 51.1];
const DISTRICT = 'd-esil';
const COMPLEXES = ['ЖК «Алтын Орда»', 'ЖК «Нур-Астана»', 'ЖК «Сарыарка»', 'ЖК «Тулпар»', 'ЖК «Бастау»'];

function containersFor(r: () => number, siteIdx: number): MapContainer[] {
  const types: WasteType[] = ['mixed', 'plastic', 'paper', 'glass', 'metal', 'organic'];
  const n = 2 + Math.floor(r() * 3);
  return Array.from({ length: n }, (_, k) => ({
    id: `c-${siteIdx}-${k}`,
    waste_type: types[(siteIdx + k * 2) % types.length],
    volume_l: [660, 1100, 770][Math.floor(r() * 3)],
    fill_level: Math.round(20 + r() * 80),
  }));
}

function genSites(): MapSite[] {
  const r = rng(4242);
  const cols = 6;
  const rows = 5;
  const out: MapSite[] = [];
  let i = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (i >= 26) break;
      const lon = 71.405 + (x + 0.2 + r() * 0.6) * (0.06 / cols);
      const lat = 51.112 + (y + 0.2 + r() * 0.6) * (0.04 / rows);
      const score = i % 7 === 0 ? 32 + r() * 15 : i % 3 === 0 ? 52 + r() * 25 : 78 + r() * 20;
      const n = String(i + 1).padStart(2, '0');
      out.push({
        id: `s-${n}`,
        address: `Тестовая площадка ${n}, р-н Есиль`,
        complex: COMPLEXES[i % COMPLEXES.length],
        district_id: DISTRICT,
        lon,
        lat,
        qr_code: `AST-${n}`,
        cleanliness_score: Math.round(score),
        last_pickup_at: new Date(Date.now() - (3 + r() * 40) * 3600e3).toISOString(),
        week_kg: Math.round(180 + r() * 900),
        containers: containersFor(r, i),
      });
      i++;
    }
  }
  return out;
}

export const SITES: MapSite[] = genSites();

export interface MockVehicleSpec {
  id: string;
  plate: string;
  carrier: string;
  type: string;
  waste_type: WasteType;
  trip_id: string;
  siteIds: string[];
}

const VEH_META: Array<Pick<MockVehicleSpec, 'plate' | 'carrier' | 'type' | 'waste_type'>> = [
  { plate: '123 ABC 01', carrier: 'ТОО «ЭкоТранс»', type: 'мусоровоз 20 м³', waste_type: 'mixed' },
  { plate: '456 DEF 01', carrier: 'ТОО «ЭкоТранс»', type: 'мусоровоз 20 м³', waste_type: 'plastic' },
  { plate: '789 GHI 01', carrier: 'ТОО «Чистый город»', type: 'мусоровоз 16 м³', waste_type: 'paper' },
  { plate: '321 JKL 01', carrier: 'ТОО «Чистый город»', type: 'мусоровоз 16 м³', waste_type: 'glass' },
  { plate: '654 MNO 01', carrier: 'ТОО «ЭкоТранс»', type: 'мусоровоз 20 м³', waste_type: 'mixed' },
];

export const VEHICLE_SPECS: MockVehicleSpec[] = VEH_META.map((m, i) => ({
  ...m,
  id: `v-${i + 1}`,
  trip_id: `t-today-${i + 1}`,
  // площадки раздаются по машинам «диагональными» блоками — маршруты компактные
  siteIds: SITES.filter((_, k) => k % 5 === i).map((s) => s.id),
}));

export function vehicleOfSite(siteId: string): MockVehicleSpec {
  return VEHICLE_SPECS.find((v) => v.siteIds.includes(siteId)) ?? VEHICLE_SPECS[0];
}

export function initialVehicles(): MapVehicle[] {
  return VEHICLE_SPECS.map((v) => ({
    id: v.id,
    plate: v.plate,
    carrier: v.carrier,
    type: v.type,
    waste_type: v.waste_type,
    trip_id: v.trip_id,
    lon: DEPOT[0],
    lat: DEPOT[1],
    heading: 0,
    speed: 0,
    recorded_at: new Date().toISOString(),
  }));
}

export const COMPLAINTS: MapComplaint[] = (() => {
  const r = rng(77);
  const types = ['mixed', 'overflow', 'dump', 'other'] as const;
  const statuses = ['new', 'in_work', 'confirmed', 'rejected'] as const;
  return Array.from({ length: 9 }, (_, i) => {
    const s = SITES[Math.floor(r() * SITES.length)];
    return {
      id: `r-${i + 1}`,
      site_id: s.id,
      type: types[i % 4],
      status: statuses[Math.floor(r() * 4)],
      lon: s.lon + (r() - 0.5) * 0.0008,
      lat: s.lat + (r() - 0.5) * 0.0006,
      photo_url: null,
      comment: i % 2 ? 'Контейнер переполнен, мусор рядом' : undefined,
      created_at: new Date(Date.now() - r() * 5 * 86400e3).toISOString(),
    };
  });
})();

// ---------- Путь отходов ----------

const SHARES: Array<[OutputType, number, PathOutput['outcome'], string]> = [
  ['organic', 0.37, 'recycling', 'f-comp'],
  ['PET', 0.16, 'recycling', 'f-rec1'],
  ['paper', 0.05, 'buyer', 'buyer-paper'],
  ['cardboard', 0.06, 'buyer', 'buyer-paper'],
  ['glass', 0.09, 'recycling', 'f-rec2'],
  ['metal', 0.03, 'buyer', 'buyer-metal'],
  ['HDPE', 0.04, 'recycling', 'f-rec1'],
  ['film', 0.06, 'energy', 'f-rdf'],
  ['RDF', 0.09, 'energy', 'f-rdf'],
  ['landfill', 0.05, 'landfill', 'f-land'],
];

const BUYERS: Record<string, { name: string; lon: number; lat: number }> = {
  'buyer-paper': { name: 'ТОО «Макулатура-Заготовка»', lon: 71.39, lat: 51.075 },
  'buyer-metal': { name: 'ТОО «Металлолом-Астана»', lon: 71.345, lat: 51.105 },
};

/** Собирает «путь» для площадки по контракту GET /sites/{id}/path (мок). */
export function buildSitePath(site: MapSite, track: LonLat[]): SitePath {
  const spec = vehicleOfSite(site.id);
  const sort = FACILITIES.find((f) => f.id === 'f-sort')!;
  const r = rng(site.id.length * 997 + Number(site.id.slice(2)));
  const mixedFlag = Number(site.id.slice(2)) % 7 === 0;
  const now = Date.now();
  const startedAt = new Date(now - 5 * 3600e3).toISOString();
  const weight = Math.round(2600 + r() * 1200);

  let left = weight;
  const outputs: PathOutput[] = SHARES.map(([output_type, share, outcome, dest], i) => {
    const w = i === SHARES.length - 1 ? left : Math.round(weight * share);
    left -= w;
    const fac = FACILITIES.find((f) => f.id === dest);
    const buyer = BUYERS[dest];
    return {
      output_type,
      weight_kg: w,
      outcome,
      destination: fac
        ? { kind: 'facility', id: fac.id, name: fac.name, lon: fac.lon, lat: fac.lat }
        : { kind: 'buyer', id: dest, name: buyer.name, lon: buyer.lon, lat: buyer.lat },
    };
  });

  return {
    site,
    period: '7d',
    trips: [
      {
        id: spec.trip_id,
        vehicle_plate: spec.plate,
        carrier: spec.carrier,
        waste_type: spec.waste_type,
        started_at: startedAt,
        finished_at: new Date(now - 3 * 3600e3).toISOString(),
        track,
        destination: { id: sort.id, type: sort.type, name: sort.name, lon: sort.lon, lat: sort.lat },
        mixed_flag: mixedFlag,
        route_deviation: false,
        pickups: site.containers.map((c) => ({
          container_id: c.id,
          waste_type: c.waste_type,
          picked_at: new Date(now - (4.8 - r() * 0.5) * 3600e3).toISOString(),
          photo_url: null,
          contamination_pct: Math.round(site.cleanliness_score < 50 ? 40 + r() * 30 : r() * 25),
          mixed_flag: mixedFlag,
        })),
        batch: {
          id: `b-${site.id}`,
          weight_kg: weight,
          received_at: new Date(now - 2.8 * 3600e3).toISOString(),
          facility_id: sort.id,
        },
        outputs,
      },
    ],
  };
}

export const WORKSHOP_STATS = {
  received_kg: 118_400,
  shares: [
    { type: 'organic' as OutputType, share: 0.37 },
    { type: 'PET' as OutputType, share: 0.16 },
    { type: 'paper' as OutputType, share: 0.11 },
    { type: 'glass' as OutputType, share: 0.09 },
    { type: 'RDF' as OutputType, share: 0.1 },
    { type: 'landfill' as OutputType, share: 0.17 },
  ],
};

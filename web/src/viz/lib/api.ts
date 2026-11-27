import type { MapFacility, MapObjects, MapSite, MapVehicle, OutputType, PathOutput, PathTrip, SitePath, WasteType } from './contracts';
import { USE_MOCKS } from './vehicleFeed';
import { COMPLAINTS, FACILITIES, SITES, buildSitePath, initialVehicles } from '@/viz/mocks/astana';
import { getRouteForSite } from '@/viz/mocks/routes';
import { supabase } from '@/lib/supabase';

/**
 * Данные 3D-карты: моки (src/viz/mocks) или живой бэкенд потока A.
 * Живой режим ходит в те же функции БД, что REST API (map_objects, site_path), и переводит
 * их ответ в формат contracts.ts этого модуля.
 */
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function rpc<T = Any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const OUT: Record<string, OutputType> = { pet: 'PET', hdpe: 'HDPE', rdf: 'RDF' };
const OUTCOME: Record<string, PathOutput['outcome']> = { recycler: 'recycling', compost: 'recycling', buyer: 'buyer', energy: 'energy', landfill: 'landfill' };
let facilitiesCache: MapFacility[] = [];
let carriersCache: Record<string, string> | null = null;

export const toVehicle = (v: Any, carriers: Record<string, string> = carriersCache ?? {}): MapVehicle => ({
  id: v.vehicle_id, plate: v.plate_number, carrier: carriers[v.carrier_id] ?? '', type: 'rear_loader',
  waste_type: v.waste_type as WasteType, trip_id: v.trip_id, lon: v.location?.lon, lat: v.location?.lat,
  heading: Number(v.heading ?? 0), speed: Number(v.speed ?? 0), recorded_at: v.recorded_at,
});

export async function loadCarriers(): Promise<Record<string, string>> {
  if (carriersCache) return carriersCache;
  const { data } = await supabase().from('carriers').select('id,name');
  carriersCache = Object.fromEntries((data ?? []).map((c: Any) => [c.id, c.name]));
  return carriersCache ?? {};
}

/** GET /map/objects?bbox= */
export async function fetchMapObjects(bbox: [number, number, number, number]): Promise<MapObjects> {
  if (USE_MOCKS) return { sites: SITES, facilities: FACILITIES, vehicles: initialVehicles(), complaints: COMPLAINTS };
  const [d, carriers] = await Promise.all([
    rpc('map_objects', { p_min_lon: bbox[0], p_min_lat: bbox[1], p_max_lon: bbox[2], p_max_lat: bbox[3] }),
    loadCarriers(),
  ]);
  const sites: MapSite[] = (d.sites ?? []).map((s: Any) => ({
    id: s.id, address: s.address, district_id: s.district_id, lon: s.location.lon, lat: s.location.lat, qr_code: s.qr_code,
    cleanliness_score: s.cleanliness_score == null ? 0 : Math.round(Number(s.cleanliness_score)), last_pickup_at: s.last_pickup_at ?? undefined,
    week_kg: 0, containers: (s.container_types ?? []).map((w: WasteType, i: number) => ({ id: `${s.id}-${i}`, waste_type: w, volume_l: 1100, fill_level: 0 })),
  }));
  const facilities: MapFacility[] = (d.facilities ?? []).map((f: Any) => ({
    id: f.id, type: f.type, name: f.name, lon: f.location.lon, lat: f.location.lat, accepts: f.accepted_waste_types ?? [],
    capacity_tpd: Number(f.capacity_tpd ?? 0), week_tons: Number(f.week_tonnes ?? 0), model_3d_url: f.model_3d_url,
  }));
  facilitiesCache = facilities;
  return {
    sites, facilities,
    vehicles: (d.vehicles ?? []).filter((v: Any) => v.location).map((v: Any) => toVehicle(v, carriers)),
    complaints: (d.reports ?? []).filter((r: Any) => r.location).map((r: Any) => ({
      id: r.id, site_id: r.site_id ?? '', type: r.type, status: r.status, lon: r.location.lon, lat: r.location.lat,
      photo_url: r.photo_url, created_at: r.created_at,
    })),
  };
}

/** GET /sites/{id}/path?period=7d → рейсы площадки (последний первым) */
export async function fetchSitePath(site: MapSite, period = '7d'): Promise<SitePath> {
  if (USE_MOCKS) {
    const route = await getRouteForSite(site.id);
    return buildSitePath(site, route.outbound);
  }
  const d = await rpc('site_path', { p_site_id: site.id, p_period_days: parseInt(period, 10) || 7 });
  const trips = [d.latest, ...(d.history ?? []).filter((h: Any) => h?.trip_id !== d.latest?.trip_id)]
    .filter((x: Any) => x && x.track?.coordinates?.length >= 2 && x.destination_facility)
    .map((x: Any) => toTrip(x));
  return { site, period, trips };
}

function toTrip(x: Any): PathTrip {
  const dest = x.destination_facility;
  const landfill = facilitiesCache.find((f) => f.type === 'landfill');
  const batch = (x.batches ?? [])[0] as Any | undefined;
  const outputs: PathOutput[] = (x.batches ?? []).flatMap((b: Any) => (b.outputs ?? []).map((o: Any, i: number) => {
    const nf = o.next_facility as Any | null;
    // куда ушло: объект из БД; если его нет — полигон для остатка, иначе точка рядом с сортировкой
    const target = nf ? { kind: 'facility' as const, id: nf.id, name: nf.name, lon: nf.location.lon, lat: nf.location.lat }
      : o.destination === 'landfill' && landfill ? { kind: 'facility' as const, id: landfill.id, name: landfill.name, lon: landfill.lon, lat: landfill.lat }
      : { kind: o.destination === 'buyer' ? 'buyer' as const : 'facility' as const, id: `${o.destination}-${i}`, name: o.buyer_name ?? o.destination,
          lon: dest.location.lon + 0.03 * Math.cos(i), lat: dest.location.lat + 0.02 * Math.sin(i) };
    return { output_type: OUT[o.output_type] ?? o.output_type, weight_kg: Number(o.site_kg ?? o.weight_kg), outcome: OUTCOME[o.destination] ?? 'recycling', destination: target };
  }));
  return {
    id: x.trip_id, vehicle_plate: x.vehicle?.plate_number ?? '', carrier: x.carrier?.name ?? '', waste_type: x.waste_type,
    started_at: x.started_at, finished_at: x.finished_at ?? x.started_at,
    track: x.track.coordinates as [number, number][],
    destination: { id: dest.id, type: dest.type, name: dest.name, lon: dest.location.lon, lat: dest.location.lat },
    mixed_flag: !!x.mixed_flag, route_deviation: !!x.deviation_flag,
    pickups: (x.pickups ?? []).map((p: Any) => ({ container_id: p.container_id, waste_type: p.container_waste_type, picked_at: p.picked_at,
      photo_url: p.photo_url, contamination_pct: Number(p.contamination_pct ?? 0), mixed_flag: !!p.mixed_flag })),
    batch: { id: batch?.id ?? '', weight_kg: Math.round(Number(batch?.site_kg ?? batch?.weight_kg ?? 0)), received_at: batch?.received_at ?? x.finished_at, facility_id: batch?.facility?.id ?? dest.id },
    outputs,
  };
}

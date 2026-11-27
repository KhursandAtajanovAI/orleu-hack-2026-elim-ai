import { DEPOT, FACILITIES, SITES, VEHICLE_SPECS, vehicleOfSite } from './astana';
import { routeVia } from '@/viz/lib/routing';
import { cumulative, type LonLat } from '@/viz/lib/geo';

export interface VehicleRoute {
  vehicleId: string;
  /** депо → площадки → сортировка (рабочая часть рейса) */
  outbound: LonLat[];
  /** сортировка → депо */
  back: LonLat[];
  fallback: boolean;
}

const routes = new Map<string, Promise<VehicleRoute>>();

export function getVehicleRoute(vehicleId: string): Promise<VehicleRoute> {
  let p = routes.get(vehicleId);
  if (!p) {
    p = (async () => {
      const spec = VEHICLE_SPECS.find((v) => v.id === vehicleId)!;
      const sort = FACILITIES.find((f) => f.id === 'f-sort')!;
      const stops = spec.siteIds
        .map((id) => SITES.find((s) => s.id === id)!)
        .sort((a, b) => a.lon + a.lat - (b.lon + b.lat))
        .map((s) => [s.lon, s.lat] as LonLat);
      const sortPt: LonLat = [sort.lon, sort.lat];
      const [o, b] = await Promise.all([
        routeVia([DEPOT, ...stops, sortPt]),
        routeVia([sortPt, DEPOT]),
      ]);
      return { vehicleId, outbound: o.coords, back: b.coords, fallback: o.fallback || b.fallback };
    })();
    routes.set(vehicleId, p);
  }
  return p;
}

export function getRouteForSite(siteId: string) {
  return getVehicleRoute(vehicleOfSite(siteId).id);
}

export function loopOf(r: VehicleRoute) {
  const coords = [...r.outbound, ...r.back];
  return { coords, cum: cumulative(coords) };
}

import type { MapObjects, MapSite, SitePath } from './contracts';
import { USE_MOCKS } from './vehicleFeed';
import { COMPLAINTS, FACILITIES, SITES, buildSitePath, initialVehicles } from '@/mocks/astana';
import { getRouteForSite } from '@/mocks/routes';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function http<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** GET /map/objects?bbox= */
export async function fetchMapObjects(bbox: [number, number, number, number]): Promise<MapObjects> {
  if (!USE_MOCKS) return http<MapObjects>(`/map/objects?bbox=${bbox.join(',')}`);
  return { sites: SITES, facilities: FACILITIES, vehicles: initialVehicles(), complaints: COMPLAINTS };
}

/** GET /sites/{id}/path?period=7d */
export async function fetchSitePath(site: MapSite, period = '7d'): Promise<SitePath> {
  if (!USE_MOCKS) return http<SitePath>(`/sites/${site.id}/path?period=${period}`);
  const route = await getRouteForSite(site.id);
  return buildSitePath(site, route.outbound);
}

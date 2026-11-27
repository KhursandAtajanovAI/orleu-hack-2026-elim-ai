import type { VehiclePosition } from './contracts';
import { VEHICLE_SPECS } from '@/mocks/astana';
import { getVehicleRoute, loopOf } from '@/mocks/routes';
import { pointAt } from './geo';

export type Unsub = () => void;

export interface VehicleFeed {
  subscribe(cb: (p: VehiclePosition) => void): Unsub;
}

/**
 * Мок-фид: «ведёт» машины по дорожным ломаным и шлёт GPS-точки с тем же
 * форматом, что Realtime vehicle_positions. Скорость симуляции ×SPEED.
 * Точки приходят редко (как с реального телефона) — плавность даёт интерполяция в карте.
 */
export class MockVehicleFeed implements VehicleFeed {
  constructor(private speedKmh = 38, private factor = 8, private periodMs = 3000) {}

  subscribe(cb: (p: VehiclePosition) => void): Unsub {
    let alive = true;
    const timers: ReturnType<typeof setInterval>[] = [];
    VEHICLE_SPECS.forEach(async (spec, idx) => {
      const route = await getVehicleRoute(spec.id);
      if (!alive) return;
      const { coords, cum } = loopOf(route);
      const total = cum[cum.length - 1];
      let d = (total / VEHICLE_SPECS.length) * idx; // разнесём машины по маршруту
      const step = (this.speedKmh / 3.6) * (this.periodMs / 1000) * this.factor;
      const emit = () => {
        d = (d + step) % total;
        const { lonlat } = pointAt(coords, cum, d);
        cb({
          vehicle_id: spec.id,
          trip_id: spec.trip_id,
          lon: lonlat[0],
          lat: lonlat[1],
          speed: this.speedKmh,
          recorded_at: new Date().toISOString(),
        });
      };
      emit();
      timers.push(setInterval(emit, this.periodMs));
    });
    return () => {
      alive = false;
      timers.forEach(clearInterval);
    };
  }
}

/**
 * Реальный фид: Supabase Realtime по таблице vehicle_positions.
 * Ожидает в payload либо поля lon/lat, либо GeoJSON в location.
 */
export class SupabaseVehicleFeed implements VehicleFeed {
  subscribe(cb: (p: VehiclePosition) => void): Unsub {
    let cleanup: Unsub = () => {};
    let alive = true;
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;
      const { createClient } = await import('@supabase/supabase-js');
      if (!alive) return;
      const sb = createClient(url, key);
      const ch = sb
        .channel('vehicle_positions')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vehicle_positions' }, (m) => {
          const r = m.new as Record<string, any>;
          const loc = r.location;
          const lon = r.lon ?? loc?.coordinates?.[0];
          const lat = r.lat ?? loc?.coordinates?.[1];
          if (typeof lon !== 'number' || typeof lat !== 'number') return;
          cb({
            vehicle_id: r.vehicle_id,
            trip_id: r.trip_id,
            lon,
            lat,
            speed: r.speed ?? 0,
            recorded_at: r.recorded_at ?? new Date().toISOString(),
          });
        })
        .subscribe();
      cleanup = () => {
        sb.removeChannel(ch);
      };
    })();
    return () => {
      alive = false;
      cleanup();
    };
  }
}

export const USE_MOCKS =
  process.env.NEXT_PUBLIC_USE_MOCKS === 'true' ||
  (!process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL);

export function createVehicleFeed(): VehicleFeed {
  return USE_MOCKS ? new MockVehicleFeed() : new SupabaseVehicleFeed();
}

import type { VehiclePosition } from './contracts';
import { VEHICLE_SPECS } from '@/viz/mocks/astana';
import { getVehicleRoute, loopOf } from '@/viz/mocks/routes';
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
 * Реальный фид: позиции активных рейсов из map_objects раз в 5 с (координаты уже lon/lat;
 * в Realtime по vehicle_positions geography приходит в WKB). Плавность даёт интерполяция карты.
 */
export class SupabaseVehicleFeed implements VehicleFeed {
  subscribe(cb: (p: VehiclePosition) => void): Unsub {
    let alive = true;
    const last = new Map<string, string>();
    const tick = async () => {
      const { supabase } = await import('@/lib/supabase');
      const { data } = await supabase().rpc('map_objects', { p_min_lon: 70.9, p_min_lat: 50.8, p_max_lon: 72.0, p_max_lat: 51.4, p_layers: ['vehicles'] });
      if (!alive) return;
      for (const v of ((data as Record<string, any>)?.vehicles ?? []) as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!v.location || last.get(v.vehicle_id) === v.recorded_at) continue;
        last.set(v.vehicle_id, v.recorded_at);
        cb({ vehicle_id: v.vehicle_id, trip_id: v.trip_id, lon: v.location.lon, lat: v.location.lat, speed: Number(v.speed ?? 0), recorded_at: v.recorded_at });
      }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }
}

export const USE_MOCKS =
  process.env.NEXT_PUBLIC_USE_MOCKS === 'true' || !process.env.NEXT_PUBLIC_SUPABASE_URL;

export function createVehicleFeed(): VehicleFeed {
  return USE_MOCKS ? new MockVehicleFeed() : new SupabaseVehicleFeed();
}

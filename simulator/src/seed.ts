/**
 * Сиды (ТЗ 14): город, район, 25 площадок с контейнерами, объекты, перевозчики, машины,
 * маршруты на каждый день, тестовые аккаунты всех ролей и 20 жителей.
 * Пишется через PostgREST от имени демо-администратора (RLS «admin write»), id детерминированы —
 * повторный запуск обновляет те же записи, а не плодит дубли.
 */
import { CITY, DISTRICT, DISTRICT_BOUNDARY, SITES, FACILITIES, CARRIERS, VEHICLES, VOLUME_L, ACCOUNTS, OPERATOR_FACILITY } from '../data/astana.ts';
import { Api, type Session, seedId, ewkt, ewktPolygon, pool } from './client.ts';
import { Rng, hashSeed, type WasteType } from './model.ts';

export const ids = {
  city: seedId('city:astana'),
  district: seedId('district:astana:esil'),
  site: (k: string) => seedId(`site:${k}`),
  container: (site: string, t: WasteType) => seedId(`container:${site}:${t}`),
  facility: (k: string) => seedId(`facility:${k}`),
  carrier: (k: string) => seedId(`carrier:${k}`),
  vehicle: (k: string) => seedId(`vehicle:${k}`),
  route: (v: string, date: string) => seedId(`route:${v}:${date}`),
};

export interface World {
  admin: Session;
  akimat: Session;
  drivers: Session[];
  operators: Session[];
  residents: Session[];
}

/** Местная дата Астаны (UTC+5) для момента t */
export function localDate(t: number): string {
  return new Date(t + 5 * 3600_000).toISOString().slice(0, 10);
}

export async function loginAll(api: Api): Promise<World> {
  const admin = await api.login('admin', 1);
  const akimat = await api.login('akimat', 1);
  const drivers = await pool(Array.from({ length: ACCOUNTS.driver }, (_, i) => i + 1), 1, (i) => api.login('driver', i));
  const operators = await pool(Array.from({ length: ACCOUNTS.operator }, (_, i) => i + 1), 1, (i) => api.login('operator', i));
  const residents = await pool(Array.from({ length: ACCOUNTS.resident }, (_, i) => i + 1), 1, (i) => api.login('resident', i));
  return { admin, akimat, drivers, operators, residents };
}

/** Площадки, которые обслуживает машина для данного типа рейса */
export function vehicleStops(vKey: string, waste: WasteType): string[] {
  const v = VEHICLES.find((x) => x.key === vKey)!;
  const pool_ = v.sites === 'all' ? SITES.map((s) => s.key) : v.sites;
  return pool_.filter((k) => {
    const s = SITES.find((x) => x.key === k)!;
    return s.containers.includes(waste);
  });
}

/** Маршруты на дни [from..to] относительно сегодня (идемпотентно; history и live вызывают перед работой) */
export async function ensureRoutes(api: Api, admin: Session, from: number, to: number): Promise<number> {
  const routes: Record<string, unknown>[] = [];
  for (let d = from; d <= to; d++) {
    const date = localDate(Date.now() + d * 86400_000);
    const wd = new Date(date + 'T12:00:00Z').getUTCDay();
    for (const v of VEHICLES) {
      const waste = v.plan(wd);
      if (!waste) continue;
      const stops = vehicleStops(v.key, waste);
      if (!stops.length) continue;
      routes.push({
        id: ids.route(v.key, date), vehicle_id: ids.vehicle(v.key), route_date: date, waste_type: waste,
        site_ids: stops.map(ids.site), planned_facility_id: ids.facility('sorting'),
      });
    }
  }
  await api.upsert(admin, 'routes', routes);
  return routes.length;
}

export async function seed(api: Api, opts: { days: number; ahead: number }): Promise<World> {
  const t0 = Date.now();
  const world = await loginAll(api);
  const a = world.admin;
  console.log(`✓ аккаунты: admin, akimat, ${world.drivers.length} водителей, ${world.operators.length} операторов, ${world.residents.length} жителей`);

  await api.upsert(a, 'cities', [{
    id: ids.city, slug: CITY.slug, name_ru: CITY.name_ru, name_kk: CITY.name_kk, timezone: CITY.timezone, center: ewkt(CITY.center),
  }]);
  await api.upsert(a, 'districts', [{
    id: ids.district, city_id: ids.city, name_ru: DISTRICT.name_ru, name_kk: DISTRICT.name_kk, boundary: ewktPolygon(DISTRICT_BOUNDARY),
  }]);
  await api.upsert(a, 'facilities', FACILITIES.map((f) => ({
    id: ids.facility(f.key), city_id: ids.city, type: f.type, name: f.name, address: f.address, location: ewkt(f.lonlat),
    accepted_waste_types: f.accepted, capacity_tpd: f.capacity_tpd ?? null, opening_hours: f.opening_hours ?? null,
    geofence_radius_m: f.type === 'collection_point' ? 100 : 300,
  })));
  await api.upsert(a, 'sites', SITES.map((s) => ({
    id: ids.site(s.key), district_id: ids.district, address: s.address, location: ewkt(s.lonlat),
    qr_code: `AST-${s.key.toUpperCase()}`,
  })));
  const rng = new Rng(hashSeed('containers'));
  await api.upsert(a, 'containers', SITES.flatMap((s) => s.containers.map((t) => ({
    id: ids.container(s.key, t), site_id: ids.site(s.key), waste_type: t, volume_l: VOLUME_L[t],
    fill_level: rng.int(10, 60), qr_code: `AST-${s.key.toUpperCase()}-${t.toUpperCase()}`,
  }))));
  await api.upsert(a, 'carriers', CARRIERS.map((c) => ({ id: ids.carrier(c.key), city_id: ids.city, name: c.name, bin: c.bin, phone: c.phone })));
  await api.upsert(a, 'vehicles', VEHICLES.map((v) => ({
    id: ids.vehicle(v.key), carrier_id: ids.carrier(v.carrier), plate_number: v.plate, vehicle_type: v.type,
    capacity_kg: v.capacity_kg, driver_id: world.drivers[v.driver - 1].userId,
  })));
  console.log(`✓ справочники: 1 город, 1 район, ${SITES.length} площадок, ${SITES.reduce((n, s) => n + s.containers.length, 0)} контейнеров, ${FACILITIES.length} объектов, ${CARRIERS.length} перевозчика, ${VEHICLES.length} машин`);

  const n = await ensureRoutes(api, a, -opts.days, opts.ahead);
  console.log(`✓ маршруты: ${n} (с ${localDate(Date.now() - opts.days * 86400_000)} по ${localDate(Date.now() + opts.ahead * 86400_000)})`);


  // роли с привязкой: операторы — к объектам, акимат — к городу
  for (const [n, fk] of Object.entries(OPERATOR_FACILITY)) {
    await api.rpc(a, 'admin_set_roles', {
      p_user_id: world.operators[Number(n) - 1].userId, p_roles: ['resident', 'operator'], p_facility_id: ids.facility(fk),
    });
  }
  await api.rpc(a, 'admin_set_roles', { p_user_id: world.akimat.userId, p_roles: ['resident', 'akimat'], p_city_id: ids.city });
  await api.rpc(a, 'admin_set_roles', { p_user_id: a.userId, p_roles: ['resident', 'admin', 'akimat'], p_city_id: ids.city });

  // жители: дом, имя, согласия (каждый — сам, через свой профиль)
  const names = ['Айгерим', 'Нурлан', 'Дана', 'Ерлан', 'Асель', 'Тимур', 'Мадина', 'Арман', 'Жанна', 'Ильяс',
    'Камила', 'Даурен', 'Алия', 'Санжар', 'Айжан', 'Руслан', 'Динара', 'Бауыржан', 'Сабина', 'Алихан'];
  await pool(world.residents, 4, (r, i) => api.update(r, 'profiles', `user_id=eq.${r.userId}`, {
    full_name: `${names[i % names.length]} (демо)`, home_site_id: ids.site(SITES[i % SITES.length].key),
    consent_data: true, consent_training: i % 3 !== 0, consent_at: new Date().toISOString(), language: i % 4 === 0 ? 'kk' : 'ru',
  }));
  await pool([...world.drivers, ...world.operators, world.akimat], 4, (s) =>
    api.update(s, 'profiles', `user_id=eq.${s.userId}`, { full_name: `Демо: ${s.role} ${s.index}`, consent_data: true }));
  console.log(`✓ профили и роли (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
  return world;
}

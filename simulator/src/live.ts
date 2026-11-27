/**
 * Режим реального времени (ТЗ 14): ведёт 5 машин по сегодняшним маршрутам и отправляет GPS
 * через тот же API, что и приложение водителя (раз в 10 с пачкой). Скорость ×1 / ×10 / ×60.
 *
 * Пульт — запись app_settings.simulator {status, speed, command_id}: её меняет админка
 * (вкладка «Симулятор») или команда `sim control`. Статусы:
 *   running — едем; paused — стоим (GPS не шлём); reset — завершить рейсы и начать заново; stopped — выход.
 * Скриптованные события (для проверки флагов): машина v1 забирает раздельный пластик в смешанный рейс,
 * машина v4 везёт пластик на полигон вместо сортировки.
 */
import { SITES, FACILITIES, VEHICLES, DEPOTS, VOLUME_L } from '../data/astana.ts';
import { Api, type Session, ApiError } from './client.ts';
import { Router, drive, type GpsPoint, type LonLat } from './geo.ts';
import { Rng, hashSeed, aiResult, containerKg, type WasteType } from './model.ts';
import { ids, localDate, loginAll, vehicleStops, ensureRoutes, type World } from './seed.ts';
import { Photos, orderStops, processBatch, DEFAULT_SCENARIO, type TripResult } from './history.ts';

interface Control { status: 'running' | 'paused' | 'stopped' | 'reset'; speed: number; command_id: number }

interface Car {
  key: string;
  driver: Session;
  waste: WasteType;
  tripId: string | null;
  /** очередь событий: точки GPS и остановки, в «симулированных» секундах от старта */
  events: ({ kind: 'gps'; p: GpsPoint } | { kind: 'stop'; site: string; types: WasteType[]; at: number } | { kind: 'end'; at: number })[];
  simT: number;
  net: number;
  destination: 'sorting' | 'landfill';
  done: boolean;
}

const site = (k: string) => SITES.find((s) => s.key === k)!;

export async function readControl(api: Api): Promise<Control> {
  const rows = await api.select<{ value: Control }>(null, 'app_settings', 'key=eq.simulator&select=value');
  return rows[0]?.value ?? { status: 'running', speed: 10, command_id: 0 };
}

export async function setControl(api: Api, admin: Session, patch: Partial<Control>): Promise<Control> {
  const cur = await readControl(api);
  const next = { ...cur, ...patch, command_id: (cur.command_id ?? 0) + 1 };
  await api.update(admin, 'app_settings', 'key=eq.simulator', { value: next });
  return next;
}

async function buildCar(api: Api, router: Router, world: World, vKey: string, events: boolean, rng: Rng): Promise<Car | null> {
  const v = VEHICLES.find((x) => x.key === vKey)!;
  const today = localDate(Date.now());
  const waste = v.plan(new Date(today + 'T12:00:00Z').getUTCDay());
  if (!waste) return null;
  const stops = orderStops(DEPOTS[v.carrier], vehicleStops(vKey, waste));
  const mixAt = new Set<string>(events && vKey === 'v1' ? stops.filter((k) => site(k).containers.includes('plastic')).slice(1, 3) : []);
  const destination = events && vKey === 'v4' ? 'landfill' : 'sorting';
  const car: Car = { key: vKey, driver: world.drivers[v.driver - 1], waste, tripId: null, events: [], simT: 0, net: 0, destination, done: false };
  let pos: LonLat = DEPOTS[v.carrier];
  let t = 0;
  for (const k of stops) {
    const d = drive(await router.path([pos, site(k).lonlat]), t, rng.range(22, 30), 10, () => rng.range(0.8, 1.15));
    car.events.push(...d.points.map((p) => ({ kind: 'gps' as const, p })));
    t = d.t + 60_000;
    car.events.push({ kind: 'stop', site: k, at: t, types: site(k).containers.filter((c) => c === waste || (mixAt.has(k) && c === 'plastic')) });
    t += 120_000;
    pos = site(k).lonlat;
  }
  const dest = FACILITIES.find((f) => f.key === destination)!;
  const d = drive(await router.path([pos, dest.lonlat]), t, rng.range(35, 50), 10, () => rng.range(0.85, 1.1));
  car.events.push(...d.points.map((p) => ({ kind: 'gps' as const, p })));
  car.events.push({ kind: 'end', at: d.t + 60_000 });
  router.save();
  return car;
}

async function finishActive(api: Api, world: World) {
  for (const v of VEHICLES) {
    const rows = await api.select<{ id: string }>(null, 'trips', `vehicle_id=eq.${ids.vehicle(v.key)}&status=eq.active&select=id`);
    for (const r of rows) await api.rpc(world.drivers[v.driver - 1], 'trip_finish', { p_trip_id: r.id }).catch(() => undefined);
  }
}

export async function live(api: Api, router: Router, opts: { speed?: number; minutes: number; events: boolean; seed: number }) {
  const world = await loginAll(api);
  const photos = new Photos(api);
  if (opts.speed) await setControl(api, world.admin, { status: 'running', speed: opts.speed });
  else await setControl(api, world.admin, { status: 'running' });
  await ensureRoutes(api, world.admin, 0, 1);
  await finishActive(api, world);
  const rng = new Rng(hashSeed(opts.seed, Date.now()));
  let cars = (await Promise.all(VEHICLES.map((v) => buildCar(api, router, world, v.key, opts.events, rng)))).filter(Boolean) as Car[];
  const deadline = Date.now() + opts.minutes * 60_000;
  let ctl = await readControl(api);
  let lastCmd = ctl.command_id;
  const TICK = 10_000;
  console.log(`▶ реальное время: ${cars.length} машин, скорость ×${ctl.speed}, до ${new Date(deadline).toLocaleTimeString('ru-RU')}`);

  while (Date.now() < deadline) {
    const tickStart = Date.now();
    ctl = await readControl(api).catch(() => ctl);
    if (ctl.status === 'stopped') break;
    if (ctl.status === 'reset' && ctl.command_id !== lastCmd) {
      console.log('↺ сброс: рейсы завершены, машины возвращаются на базу');
      await finishActive(api, world);
      cars = (await Promise.all(VEHICLES.map((v) => buildCar(api, router, world, v.key, opts.events, rng)))).filter(Boolean) as Car[];
      await setControl(api, world.admin, { status: 'running' });
      ctl = await readControl(api);
    }
    lastCmd = ctl.command_id;
    if (ctl.status === 'paused') {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const speed = [1, 10, 60].includes(Number(ctl.speed)) ? Number(ctl.speed) : Math.max(1, Math.min(120, Number(ctl.speed) || 10));
    const advance = TICK * speed;

    await Promise.all(cars.filter((c) => !c.done).map(async (car) => {
      try {
        if (!car.tripId) {
          const tr = await api.rpc(car.driver, 'trip_start', { p_route_id: ids.route(car.key, localDate(Date.now())), p_is_simulated: true })
            .catch(async (e: ApiError) => {
              if (e.code !== 'NOT_FOUND') throw e; // маршрута на сегодня нет — едем без него
              return api.rpc(car.driver, 'trip_start', { p_vehicle_id: ids.vehicle(car.key), p_waste_type: car.waste, p_is_simulated: true });
            });
          car.tripId = tr.trip_id;
        }
        const until = car.simT + advance;
        const due: Car['events'] = [];
        while (car.events.length && ('p' in car.events[0] ? car.events[0].p.t : car.events[0].at) <= until) due.push(car.events.shift()!);
        car.simT = until;
        const gps = due.filter((e) => e.kind === 'gps') as { kind: 'gps'; p: GpsPoint }[];
        if (gps.length) {
          // реальные метки времени, равномерно внутри тика — карта видит движение «сейчас»
          const base = Date.now() - TICK;
          await api.rpc(car.driver, 'trip_add_positions', {
            p_trip_id: car.tripId,
            p_points: gps.map((e, i) => ({ lon: +e.p.lon.toFixed(6), lat: +e.p.lat.toFixed(6), speed: e.p.speed, heading: e.p.heading,
              recorded_at: new Date(base + Math.round(((i + 1) / gps.length) * TICK)).toISOString() })),
          });
        }
        for (const e of due) {
          if (e.kind === 'stop') {
            const s = site(e.site);
            for (const ct of e.types) {
              const fill = Math.round(rng.normal(74, 16, 25, 100));
              const contamination = ct === 'mixed' ? null : s.dirty ? rng.normal(46, 12, 18, 85) : rng.normal(11, 6, 0, 35);
              const ai = aiResult(rng, ct, contamination ?? 0);
              if (contamination === null) (ai as { contamination_pct: number | null }).contamination_pct = null;
              const r = await api.rpc(car.driver, 'pickup_create', {
                p_trip_id: car.tripId, p_container_id: ids.container(e.site, ct), p_status: 'picked',
                p_photo_url: await photos.url(car.driver, `container_${ct}_${rng.int(1, 2)}`), p_ai_result: ai, p_fill_level: fill,
                p_lon: s.lonlat[0], p_lat: s.lonlat[1], p_client_id: `live:${car.tripId}:${e.site}:${ct}`,
              });
              car.net += containerKg(ct, VOLUME_L[ct], fill);
              console.log(`  ${car.key} ${s.address}: вывоз ${ct}${r.mixed_flag ? ' ⚠ СМЕШИВАНИЕ' : ''}`);
            }
          } else if (e.kind === 'end') {
            await api.rpc(car.driver, 'trip_finish', { p_trip_id: car.tripId });
            car.done = true;
            console.log(`■ ${car.key} приехал: ${car.destination === 'landfill' ? 'ПОЛИГОН (нарушение)' : 'сортировка'}`);
            const tr: TripResult = { tripId: car.tripId!, netKg: Math.round(car.net), arrivedAt: Date.now(), destination: car.destination,
              flags: { mixed: false, landfill: car.destination === 'landfill' } };
            await processBatch(api, world, tr, car.waste, rng, { ...DEFAULT_SCENARIO, chainShare: 0 }, Date.now() + 1000, Date.now());
          }
        }
      } catch (err) {
        console.error(`  ${car.key}: ${(err as Error).message}`);
      }
    }));

    if (cars.every((c) => c.done)) {
      console.log('✓ все машины завершили рейсы — следующий круг');
      cars = (await Promise.all(VEHICLES.map((v) => buildCar(api, router, world, v.key, opts.events, rng)))).filter(Boolean) as Car[];
    }
    const wait = TICK - (Date.now() - tickStart);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await finishActive(api, world);
  console.log('⏹ симулятор остановлен, активные рейсы завершены');
}

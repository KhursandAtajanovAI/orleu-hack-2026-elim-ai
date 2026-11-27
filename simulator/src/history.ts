/**
 * Генератор истории (ТЗ 14): один запуск → N дней данных по всей цепочке, через публичное API.
 *   водители: trip_start → trip_add_positions (трек по дорогам OSRM) → pickup_create (фото + оценка) → trip_finish
 *   операторы: batch_create (вес) → batch_add_outputs (итог по видам, сумма = весу) → партия у переработчика
 *   жители: фото (scans), жалобы (reports), сдачи в пункте приёма (drop_offs); акимат: статусы жалоб
 * Время в прошлом передаётся параметрами API (p_started_at, p_picked_at, p_received_at, recorded_at);
 * для жалоб, фото и сдач — служебной функцией sim_backdate (только демо-данные).
 *
 * Заданная доля нарушений: смешивание раздельных контейнеров, рейсы на полигон, «грязные» площадки, жалобы.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITES, FACILITIES, VEHICLES, DEPOTS, VOLUME_L } from '../data/astana.ts';
import { Api, type Session, pool, ApiError } from './client.ts';
import { Router, drive, distanceM, type LonLat } from './geo.ts';
import { Rng, hashSeed, aiResult, aiItemResult, containerKg, sortingShares, splitWeight, type WasteType, type OutputType } from './model.ts';
import { ids, localDate, vehicleStops, ensureRoutes, type World } from './seed.ts';

export interface Scenario {
  /** доля рейсов «смешанной» машины, забравших раздельный контейнер (правило 2) */
  mixViolation: number;
  /** доля рейсов, уехавших на полигон вместо сортировки (правила 2 и 3) */
  landfillViolation: number;
  reportsPerDay: number;
  scansPerDay: number;
  dropOffsPerDay: number;
  /** доля партий ПЭТ, ушедших переработчику следующей партией (цепочка parent_output_id) */
  chainShare: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  mixViolation: 0.12, landfillViolation: 0.07, reportsPerDay: 1.6, scansPerDay: 7, dropOffsPerDay: 3, chainShare: 0.5,
};

const PHOTO_DIR = fileURLToPath(new URL('../photos/', import.meta.url));
const site = (k: string) => SITES.find((s) => s.key === k)!;
const fac = (k: string) => FACILITIES.find((f) => f.key === k)!;
const BUYERS: Partial<Record<OutputType, string>> = {
  hdpe: 'ТОО «ПолимерСнаб» (тест)', film: 'ТОО «ПолимерСнаб» (тест)', glass: 'ТОО «Стеклотара КЗ» (тест)', metal: 'ТОО «Металлолом Астана» (тест)',
};

/** Куда уходит вид после сортировки */
export function outputDestination(t: OutputType) {
  switch (t) {
    case 'pet': return { destination: 'recycler', next_facility_id: ids.facility('rec_pet') };
    case 'paper': case 'cardboard': return { destination: 'recycler', next_facility_id: ids.facility('rec_paper') };
    case 'organic': return { destination: 'compost' };
    case 'rdf': return { destination: 'energy' };
    case 'landfill': return { destination: 'landfill' };
    default: return { destination: 'buyer', buyer_name: BUYERS[t] ?? 'Покупатель (тест)' };
  }
}

/** Порядок объезда: ближайший сосед от базы */
export function orderStops(start: LonLat, keys: string[]): string[] {
  const left = [...keys], out: string[] = [];
  let cur = start;
  while (left.length) {
    left.sort((a, b) => distanceM(cur, site(a).lonlat) - distanceM(cur, site(b).lonlat));
    const k = left.shift()!;
    out.push(k);
    cur = site(k).lonlat;
  }
  return out;
}

// ------------------------------------------------------------------ фото
export class Photos {
  private urls = new Map<string, string>();
  private api: Api;
  constructor(api: Api) {
    this.api = api;
  }
  async url(s: Session, name: string): Promise<string> {
    const key = `${s.userId}:${name}`;
    let u = this.urls.get(key);
    if (!u) {
      u = await this.api.uploadPhoto(s, `sim/${name}.jpg`, readFileSync(PHOTO_DIR + name + '.jpg'));
      this.urls.set(key, u);
    }
    return u;
  }
}

export interface TripPlan {
  vehicleKey: string;
  waste: WasteType;
  stops: string[];
  /** раздельные контейнеры, которые «смешанная» машина заберёт по ошибке */
  mixAt: Set<string>;
  destination: 'sorting' | 'landfill';
}

/** План рейса машины на день со сценарием нарушений */
export function planTrip(vKey: string, waste: WasteType, rng: Rng, sc: Scenario, force: { mix?: boolean; landfill?: boolean } = {}): TripPlan {
  const v = VEHICLES.find((x) => x.key === vKey)!;
  const stops = orderStops(DEPOTS[v.carrier], vehicleStops(vKey, waste));
  const mixAt = new Set<string>();
  if (waste === 'mixed' && (force.mix || rng.chance(sc.mixViolation))) {
    const cands = stops.filter((k) => site(k).containers.includes('plastic'));
    for (let i = 0; i < Math.min(cands.length, rng.int(2, 3)); i++) mixAt.add(rng.pick(cands));
  }
  const destination = force.landfill || rng.chance(sc.landfillViolation * (waste === 'mixed' ? 0.6 : 1.4)) ? 'landfill' : 'sorting';
  return { vehicleKey: vKey, waste, stops, mixAt, destination };
}

export interface TripResult { tripId: string; netKg: number; arrivedAt: number; destination: 'sorting' | 'landfill'; flags: { mixed: boolean; landfill: boolean } }

/** Один рейс целиком в прошлом (история) */
export async function runTrip(api: Api, router: Router, photos: Photos, driver: Session, plan: TripPlan, startAt: number, rng: Rng, routeDate: string): Promise<TripResult | null> {
  const v = VEHICLES.find((x) => x.key === plan.vehicleKey)!;
  const start = () => api.rpc(driver, 'trip_start', {
    p_route_id: ids.route(v.key, routeDate), p_started_at: new Date(startAt).toISOString(), p_is_simulated: true,
  });
  const trip = await start().catch(async (e: ApiError) => {
    if (e.code !== 'CONFLICT') throw e;
    // активный рейс остался от прерванного запуска — завершаем его и начинаем заново
    const stale = await api.select<{ id: string; started_at: string }>(null, 'trips', `vehicle_id=eq.${ids.vehicle(v.key)}&status=eq.active&select=id,started_at`);
    for (const t of stale) await api.rpc(driver, 'trip_finish', { p_trip_id: t.id, p_finished_at: t.started_at });
    return start();
  });
  const tripId: string = trip.trip_id;
  let pos: LonLat = DEPOTS[v.carrier];
  let t = startAt;
  let net = 0;
  const speed = () => rng.range(0.75, 1.2);
  const send = async (points: { lon: number; lat: number; speed: number; heading: number; t: number }[]) => {
    for (let i = 0; i < points.length; i += 500) {
      await api.rpc(driver, 'trip_add_positions', {
        p_trip_id: tripId,
        p_points: points.slice(i, i + 500).map((p) => ({
          lon: +p.lon.toFixed(6), lat: +p.lat.toFixed(6), speed: p.speed, heading: p.heading, recorded_at: new Date(Math.round(p.t)).toISOString(),
        })),
      });
    }
  };

  for (const key of plan.stops) {
    const s = site(key);
    const line = await router.path([pos, s.lonlat]);
    const d = drive(line, t, rng.range(20, 30), 15, speed);
    await send(d.points);
    t = d.t + rng.range(30, 90) * 1000;
    pos = s.lonlat;
    const types: WasteType[] = s.containers.filter((c) => c === plan.waste || (plan.mixAt.has(key) && c === 'plastic'));
    for (const ct of types) {
      const status = rng.chance(0.03) ? rng.pick(['empty', 'no_access'] as const) : 'picked';
      const fill = Math.round(rng.normal(74, 16, 25, 100));
      const contamination = ct === 'mixed' ? null : (s.dirty ? rng.normal(46, 12, 18, 85) : rng.normal(11, 6, 0, 35));
      const ai = status === 'picked' ? aiResult(rng, ct, contamination ?? 0) : null;
      if (ai && contamination === null) (ai as { contamination_pct: number | null }).contamination_pct = null;
      await api.rpc(driver, 'pickup_create', {
        p_trip_id: tripId, p_container_id: ids.container(key, ct), p_status: status,
        p_photo_url: status === 'picked' ? await photos.url(driver, `container_${ct}_${rng.int(1, 2)}`) : undefined,
        p_ai_result: ai ?? undefined, p_fill_level: fill,
        p_lon: +(s.lonlat[0] + rng.range(-0.0003, 0.0003)).toFixed(6), p_lat: +(s.lonlat[1] + rng.range(-0.0002, 0.0002)).toFixed(6),
        p_picked_at: new Date(t).toISOString(), p_client_id: `sim:${tripId}:${ct}:${key}`,
      });
      if (status === 'picked') net += containerKg(ct, VOLUME_L[ct], fill);
      t += rng.range(50, 120) * 1000;
    }
  }
  const dest = fac(plan.destination);
  const line = await router.path([pos, dest.lonlat]);
  const d = drive(line, t, rng.range(35, 55), 15, speed);
  await send(d.points);
  const arrivedAt = d.t;
  await api.rpc(driver, 'trip_finish', { p_trip_id: tripId, p_finished_at: new Date(arrivedAt + 4 * 60_000).toISOString() });
  return {
    tripId, netKg: Math.round(net * rng.range(0.95, 1.05)), arrivedAt, destination: plan.destination,
    flags: { mixed: plan.mixAt.size > 0, landfill: plan.destination === 'landfill' },
  };
}

/** Приёмка и сортировка партии рейса (оператор сортировки) + партия у переработчика ПЭТ */
export async function processBatch(api: Api, world: World, tr: TripResult, waste: WasteType, rng: Rng, sc: Scenario, now = Date.now(), receivedAtOverride?: number) {
  if (tr.destination !== 'sorting' || tr.netKg <= 0) return { batches: 0 };
  const op = world.operators[0];
  const receivedAt = receivedAtOverride ?? tr.arrivedAt + rng.range(8, 25) * 60_000;
  if (receivedAt > now) return { batches: 0 };
  const tare = 11000 + rng.int(-300, 300);
  const b = await api.rpc(op, 'batch_create', {
    p_facility_id: ids.facility('sorting'), p_trip_id: tr.tripId, p_weight_kg: tr.netKg,
    p_gross_kg: tare + tr.netKg, p_tare_kg: tare, p_received_at: new Date(receivedAt).toISOString(),
  });
  const outputs = splitWeight(tr.netKg, sortingShares(rng, waste)).map((o) => ({ output_type: o.type, weight_kg: o.kg, ...outputDestination(o.type) }));
  const res = await api.rpc(op, 'batch_add_outputs', { p_batch_id: b.id, p_outputs: outputs, p_close: true });
  let n = 1;
  // цепочка: ПЭТ уходит переработчику — там своя партия (parent_output_id) и свой итог
  const pet = (res.outputs as { id: string; output_type: string; weight_kg: number }[]).find((o) => o.output_type === 'pet');
  const recAt = receivedAt + rng.range(18, 40) * 3600_000;
  if (pet && pet.weight_kg > 5 && recAt < now && rng.chance(sc.chainShare)) {
    const op2 = world.operators[1];
    const child = await api.rpc(op2, 'batch_create', {
      p_facility_id: ids.facility('rec_pet'), p_weight_kg: pet.weight_kg, p_received_at: new Date(recAt).toISOString(), p_parent_output_id: pet.id,
    });
    const flakes = splitWeight(Number(pet.weight_kg), [{ type: 'pet', share: rng.range(88, 95) }, { type: 'landfill', share: 8 }]);
    await api.rpc(op2, 'batch_add_outputs', {
      p_batch_id: child.id, p_close: true,
      p_outputs: flakes.map((o) => (o.type === 'pet'
        ? { output_type: 'pet', weight_kg: o.kg, destination: 'buyer', buyer_name: 'ТОО «ПЭТ-Флекс» (тест)' }
        : { output_type: 'landfill', weight_kg: o.kg, destination: 'landfill' })),
    });
    n++;
  }
  return { batches: n };
}

/** Действия жителей за день: фото, жалобы, сдачи; акимат разбирает жалобы */
export async function residentsDay(api: Api, photos: Photos, world: World, dayStart: number, rng: Rng, sc: Scenario, now = Date.now()) {
  const stats = { scans: 0, reports: 0, drop_offs: 0 };
  const at = (h0: number, h1: number) => dayStart + rng.range(h0, h1) * 3600_000;
  // фото жителей
  const nScans = Math.round(rng.normal(sc.scansPerDay, 2, 1, sc.scansPerDay * 2));
  for (let i = 0; i < nScans; i++) {
    const r = rng.pick(world.residents);
    const home = SITES[(r.index - 1) % SITES.length];
    const ts = at(8, 22);
    if (ts > now) continue;
    const container = rng.chance(0.6);
    const ct = rng.pick(home.containers.filter((c) => c !== 'mixed')) ?? 'plastic';
    const contamination = home.dirty ? rng.normal(42, 14, 10, 85) : rng.normal(13, 8, 0, 45);
    const ai = container ? aiResult(rng, ct, contamination) : aiItemResult(rng);
    const scan = await api.rpc(r, 'scan_create', {
      p_mode: container ? 'container' : 'item', p_photo_url: await photos.url(r, `container_${container ? ct : 'mixed'}_${rng.int(1, 2)}`),
      p_ai_result: ai, p_site_id: ids.site(home.key), p_container_type: container ? ct : undefined,
      p_lon: home.lonlat[0], p_lat: home.lonlat[1],
    });
    await api.rpc(world.admin, 'sim_backdate', { p_kind: 'scan', p_id: scan.id ?? scan.scan_id, p_at: new Date(ts).toISOString() });
    stats.scans++;
  }
  // жалобы: чаще на «грязных» площадках
  const nReports = Math.round(rng.normal(sc.reportsPerDay, 1, 0, sc.reportsPerDay * 3));
  for (let i = 0; i < nReports; i++) {
    const s = rng.chance(0.55) ? rng.pick(SITES.filter((x) => x.dirty)) : rng.pick(SITES);
    const r = rng.pick(world.residents);
    const ts = at(7, 23);
    if (ts > now) continue;
    const type = rng.pick(['overflow', 'overflow', 'mixed', 'mixed', 'dump', 'other'] as const);
    const comments: Record<string, string[]> = {
      overflow: ['Контейнеры переполнены, мусор вокруг', 'Не вывозили два дня'],
      mixed: ['Мусоровоз высыпал раздельный пластик в общую машину', 'Видел, как синий контейнер вывалили вместе со смешанными'],
      dump: ['Свалка строительного мусора рядом с площадкой', 'Выбросили старую мебель'],
      other: ['Сломана крышка контейнера', 'Нет контейнера для стекла'],
    };
    const rep = await api.rpc(r, 'report_create', {
      p_type: type, p_photo_url: await photos.url(r, `report_${type === 'other' ? 'overflow' : type}_1`),
      p_lon: s.lonlat[0] + rng.range(-0.0002, 0.0002), p_lat: s.lonlat[1] + rng.range(-0.0002, 0.0002),
      p_site_id: ids.site(s.key), p_comment: rng.pick(comments[type]), p_client_id: `sim:report:${hashSeed(dayStart, i, s.key)}`,
    });
    if (rep.duplicate) continue;
    // разбор жалоб акиматом: старые — закрыты, свежие — в работе или новые
    const ageDays = (now - ts) / 86400_000;
    let resolvedAt: number | undefined;
    if (ageDays > 0.5) {
      const p = rng.next();
      const target = ageDays > 2 ? (p < 0.62 ? 'confirmed' : p < 0.84 ? 'rejected' : p < 0.95 ? 'in_work' : 'new') : (p < 0.5 ? 'in_work' : 'new');
      if (target !== 'new') {
        if (target !== 'in_work') await api.rpc(world.akimat, 'report_set_status', { p_report_id: rep.id, p_status: 'in_work' });
        await api.rpc(world.akimat, 'report_set_status', {
          p_report_id: rep.id, p_status: target,
          p_comment: target === 'rejected' ? 'Нарушение не подтвердилось при выезде' : target === 'confirmed' ? 'Подтверждено, перевозчику выставлено замечание' : 'Передано перевозчику',
        });
        resolvedAt = Math.min(now - 60_000, ts + rng.range(3, 40) * 3600_000);
      }
    }
    await api.rpc(world.admin, 'sim_backdate', {
      p_kind: 'report', p_id: rep.id, p_at: new Date(ts).toISOString(), p_resolved_at: resolvedAt ? new Date(resolvedAt).toISOString() : undefined,
    });
    stats.reports++;
  }
  // сдачи в пункте приёма (оператор 3 сканирует QR жителя; в истории — по user_id)
  const nDrop = Math.round(rng.normal(sc.dropOffsPerDay, 1.2, 0, sc.dropOffsPerDay * 3));
  for (let i = 0; i < nDrop; i++) {
    const r = rng.pick(world.residents);
    const ts = at(10, 19);
    if (ts > now) continue;
    const wt = rng.pick(['plastic', 'plastic', 'paper', 'glass', 'metal'] as const);
    const d = await api.rpc(world.operators[2], 'drop_off_create', {
      p_facility_id: ids.facility('cp1'), p_waste_type: wt, p_weight_kg: +rng.range(0.4, 6).toFixed(2), p_user_id: r.userId,
      p_client_id: `sim:drop:${hashSeed(dayStart, i)}`,
    }).catch((e: ApiError) => (e.code === 'LIMIT_EXCEEDED' ? null : Promise.reject(e)));
    if (!d || d.duplicate) continue;
    await api.rpc(world.admin, 'sim_backdate', { p_kind: 'drop_off', p_id: d.id, p_at: new Date(ts).toISOString() });
    stats.drop_offs++;
  }
  return stats;
}

/** История за days дней (до вчерашнего дня включительно) */
export async function history(api: Api, world: World, router: Router, opts: { days: number; seed: number; scenario?: Scenario; concurrency?: number }) {
  const sc = opts.scenario ?? DEFAULT_SCENARIO;
  const photos = new Photos(api);
  const total = { trips: 0, stops: 0, batches: 0, mixed: 0, landfill: 0, scans: 0, reports: 0, drop_offs: 0 };
  const t0 = Date.now();
  await ensureRoutes(api, world.admin, -opts.days, 1);
  for (let d = opts.days; d >= 1; d--) {
    const date = localDate(Date.now() - d * 86400_000);
    const dayStart = Date.parse(`${date}T00:00:00+05:00`);
    const wd = new Date(date + 'T12:00:00Z').getUTCDay();
    // машины работают параллельно (у каждой свой водитель), рейсы машины — последовательно
    const results = await pool(VEHICLES, opts.concurrency ?? 5, async (v, vi) => {
      const waste = v.plan(wd);
      if (!waste) return null;
      const rng = new Rng(hashSeed(opts.seed, date, v.key));
      // скриптованные события (ТЗ 14): позавчера v1 смешал раздельный пластик, 3 дня назад v4 уехал на полигон
      const plan = planTrip(v.key, waste, rng, sc, { mix: d === 2 && v.key === 'v1', landfill: d === 3 && v.key === (wd === 0 ? 'v5' : 'v4') });
      const start = dayStart + (6.5 + vi * 0.35) * 3600_000 + rng.range(0, 25) * 60_000;
      const tr = await runTrip(api, router, photos, world.drivers[v.driver - 1], plan, start, rng, date);
      if (!tr) return null;
      const bres = await processBatch(api, world, tr, waste, rng, sc);
      return { tr, plan, batches: bres.batches };
    });
    for (const r of results) {
      if (!r) continue;
      total.trips++;
      total.batches += r.batches;
      total.stops += r.plan.stops.length;
      if (r.tr.flags.mixed) total.mixed++;
      if (r.tr.flags.landfill) total.landfill++;
    }
    const st = await residentsDay(api, photos, world, dayStart, new Rng(hashSeed(opts.seed, date, 'residents')), sc);
    total.scans += st.scans;
    total.reports += st.reports;
    total.drop_offs += st.drop_offs;
    router.save();
    console.log(`  ${date}: рейсов ${results.filter(Boolean).length}, жалоб ${st.reports}, фото ${st.scans}, сдач ${st.drop_offs}`);
  }
  console.log(`✓ история за ${opts.days} дн. за ${((Date.now() - t0) / 1000).toFixed(0)} с:`, total,
    `треки: OSRM ${router.stats.osrm}, кэш ${router.stats.cached}, без дорог ${router.stats.fallback}`);
  return total;
}

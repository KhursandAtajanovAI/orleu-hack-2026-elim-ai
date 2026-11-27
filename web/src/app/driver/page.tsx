'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriverDay, WasteType } from '@kaida/contracts';
import { BINS } from '@kaida/contracts';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { api, DEMO_MODE, supabase } from '@/lib/supabase';
import { compressImage, distanceM } from '@/lib/image';
import { GpsTracker } from '@/lib/gps';
import { autoFlush, enqueue, pending } from '@/lib/offline-queue';
import { fmt, fmtDate } from '@/lib/dashboard';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Route = Any;
type Stop = Any;
const RADIUS_M = 100;

/** Отправка вывоза (фото → ИИ → pickup) через REST API; при офлайне — из очереди с тем же client_id. */
async function sendPickup(p: Record<string, unknown>, blob?: Blob): Promise<Any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(p)) if (v != null) fd.append(k, String(v));
  if (blob) fd.append('image', blob, 'container.jpg');
  return api.request<Any>('POST', '/pickups', { form: fd });
}

/**
 * Кабинет водителя (ТЗ 10.1): маршрут на сегодня, старт/финиш рейса с GPS раз в 10 с,
 * вывоз площадки «фото → ИИ → Вывезено» за ≤ 20 с, пометки, проверка 100 м, навигация, история.
 * Крупные кнопки, минимум текста — работа в перчатках.
 */
export default function Driver() {
  const { t } = useI18n();
  const { hasRole, loading: authLoading, session } = useAuth();
  const [day, setDay] = useState<DriverDay | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [routeIdx, setRouteIdx] = useState(0);
  const [stop, setStop] = useState<Stop | null>(null);
  const [queue, setQueue] = useState(0);
  const [online, setOnline] = useState(true);
  const [, force] = useState(0);
  const tracker = useRef<GpsTracker | null>(null);
  const allowed = hasRole('driver');

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('driver_route_today', {});
    if (error) setErr(error.message); else { setErr(null); setDay(data as DriverDay); }
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const route: Route | undefined = (day?.routes as Route[] | undefined)?.[routeIdx];
  const tripId: string | null = route?.active_trip_id ?? null;

  // GPS включается при активном рейсе (и после перезагрузки страницы)
  useEffect(() => {
    if (!tripId) return;
    const tr = new GpsTracker(tripId);
    tr.onUpdate = () => force((x) => x + 1);
    tr.start();
    tracker.current = tr;
    return () => { tr.stop(); tracker.current = null; };
  }, [tripId]);

  // офлайн-очередь вывозов (P1): отправится, когда появится сеть
  useEffect(() => {
    const refresh = async () => setQueue((await pending().catch(() => [])).filter((j) => j.kind === 'pickup').length);
    const off = autoFlush(async (job) => {
      if (job.kind !== 'pickup') return false;
      await sendPickup(job.payload, job.blob);
      return true;
    });
    const on = () => { setOnline(navigator.onLine); refresh(); setTimeout(() => { refresh(); load(); }, 3000); };
    window.addEventListener('online', on); window.addEventListener('offline', on);
    on();
    return () => { off(); window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, [load]);

  if (authLoading) return <p>{t('app.loading')}</p>;
  if (!session || !allowed) return <div className="card text-red-700">{t('drv.forbidden')}</div>;

  const startTrip = async () => {
    setErr(null);
    const { error } = await supabase().rpc('trip_start', { p_route_id: route!.route_id });
    if (error) setErr(error.message);
    await load();
  };
  const finishTrip = async () => {
    if (!tripId || !confirm(t('drv.finishConfirm'))) return;
    await tracker.current?.stop();
    const { error } = await supabase().rpc('trip_finish', { p_trip_id: tripId });
    if (error) setErr(error.message);
    await load();
  };

  const gps = tracker.current?.last ?? null;
  const stops: Stop[] = route?.stops ?? [];
  const next = stops.find((s) => !s.done);
  const progress = route?.progress ?? { done: 0, total: stops.length };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('drv.title')}</h1>
        <span className="text-sm text-slate-500">{day?.date}</span>
      </div>
      {!online && <div className="rounded-xl bg-amber-100 p-3 text-amber-900">{t('app.offline')}</div>}
      {queue > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('drv.queued')}: {queue}</div>}
      {err && <div className="rounded-xl bg-red-50 p-3 text-red-700">{err}</div>}
      {!day && !err && <p>{t('app.loading')}</p>}
      {day && !day.routes?.length && <div className="card text-slate-600">{t('drv.noRoute')}</div>}

      {(day?.routes?.length ?? 0) > 1 && (
        <div className="flex gap-2 overflow-auto">
          {(day!.routes as Route[]).map((r, i) => (
            <button key={r.route_id} onClick={() => setRouteIdx(i)} className={i === routeIdx ? 'btn-primary' : 'btn-ghost'}>
              {r.vehicle_plate} · {t('waste.' + r.waste_type)}
            </button>
          ))}
        </div>
      )}

      {route && (
        <>
          <section className="card space-y-3">
            <div className="flex items-center gap-3">
              <WasteBadge w={route.waste_type} />
              <div className="flex-1">
                <div className="font-semibold">{route.vehicle_plate}</div>
                <div className="text-sm text-slate-500">{t('drv.to')}: {route.planned_facility?.name ?? '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{progress.done}/{progress.total}</div>
                <div className="text-xs text-slate-500">{t('drv.progress')}</div>
              </div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
            </div>
            {tripId ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className={`h-3 w-3 rounded-full ${gps ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`} />
                  {gps ? `${t('drv.gpsOn')} · ±${fmt((gps as Any).accuracy, 0)} m` : t('drv.gpsWait')}
                  <span className="ml-auto text-slate-500">{t('drv.sent')}: {tracker.current?.sent ?? 0} · {t('drv.buffer')}: {tracker.current?.pending ?? 0}</span>
                </div>
                <button className="btn-danger w-full py-4 text-lg" onClick={finishTrip}>{t('drv.finish')}</button>
              </div>
            ) : (
              <button className="btn-primary w-full py-4 text-lg" onClick={startTrip}>{t('drv.start')}</button>
            )}
            {next && (
              <div className="flex gap-2">
                <a className="btn-ghost flex-1" target="_blank" rel="noreferrer"
                  href={`https://2gis.kz/astana/directions/points/%7C${next.location.lon}%2C${next.location.lat}`}>2ГИС → {t('drv.next')}</a>
                <a className="btn-ghost flex-1" target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${next.location.lat},${next.location.lon}`}>Google Maps</a>
              </div>
            )}
          </section>

          <ol className="space-y-2">
            {stops.map((s) => {
              const dist = gps ? distanceM(gps, s.location) : null;
              return (
                <li key={s.site_id}>
                  <button disabled={!tripId || s.done} onClick={() => setStop(s)}
                    className={`card flex w-full items-center gap-3 text-left ${s.done ? 'opacity-60' : next?.site_id === s.site_id ? 'border-brand ring-2 ring-brand/30' : ''}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${s.done ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>
                      {s.done ? '✓' : s.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.address}</div>
                      <div className="text-xs text-slate-500">
                        {s.containers.length} {t('drv.containers')} · {t('dash.site.cleanliness_score')} {fmt(s.cleanliness_score, 0)}
                        {s.pickup_status && s.pickup_status !== 'picked' ? ` · ${t('drv.status.' + s.pickup_status)}` : ''}
                      </div>
                    </div>
                    {dist != null && !s.done && <span className={`text-sm tabular-nums ${dist <= RADIUS_M ? 'text-emerald-600' : 'text-slate-500'}`}>{fmtDist(dist)}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          {!tripId && stops.some((s) => !s.done) && <p className="text-center text-sm text-slate-500">{t('drv.startHint')}</p>}
          <History trips={route.trips ?? []} />
        </>
      )}

      {stop && tripId && (
        <StopSheet stop={stop} route={route!} tripId={tripId} gps={gps} tracker={tracker.current}
          onClose={() => setStop(null)} onDone={async () => { setStop(null); await load(); setQueue((await pending()).length); }} />
      )}
    </div>
  );
}

const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

const EMOJI: Record<string, string> = { mixed: '🗑', plastic: '🧴', paper: '📦', glass: '🍾', metal: '🥫', organic: '🍂' };
function WasteBadge({ w }: { w: WasteType }) {
  return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl" style={{ background: (BINS[w]?.color ?? '#64748B') + '33' }}>{EMOJI[w] ?? '🗑'}</span>;
}

/** Экран вывоза площадки: фото каждого контейнера → «Вывезено» (ИИ оценивает чистоту) или пометка. */
function StopSheet({ stop, route, tripId, gps, tracker, onClose, onDone }: {
  stop: Stop; route: Route; tripId: string; gps: Any | null; tracker: GpsTracker | null; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<Record<string, { blob: Blob; url: string }>>({});
  const [results, setResults] = useState<Record<string, Any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demoHere, setDemoHere] = useState(false);
  const dist = gps ? distanceM(gps as { lon: number; lat: number }, stop.location) : null;
  const near = demoHere || (dist != null && dist <= RADIUS_M);
  const containers: Any[] = stop.containers;
  const allDone = containers.every((c) => results[c.id]);

  const take = async (cid: string, f: File | undefined) => {
    if (!f) return;
    const blob = await compressImage(f);
    setPhotos((p) => ({ ...p, [cid]: { blob, url: URL.createObjectURL(blob) } }));
  };

  const submit = async (c: Any, status: 'picked' | 'empty' | 'no_access' | 'broken') => {
    setBusy(c.id); setErr(null);
    const here = demoHere ? stop.location : gps;
    const payload = {
      trip_id: tripId, container_id: c.id, status, container_type: c.waste_type,
      lon: here?.lon, lat: here?.lat, picked_at: new Date().toISOString(), client_id: crypto.randomUUID(),
    };
    const blob = status === 'picked' ? photos[c.id]?.blob : undefined;
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const r = await sendPickup(payload, blob);
      setResults((x) => ({ ...x, [c.id]: r }));
    } catch (e) {
      if (e instanceof TypeError) { // сеть: сохраняем и отправим позже
        await enqueue('pickup', payload, blob);
        setResults((x) => ({ ...x, [c.id]: { queued: true, status } }));
      } else setErr((e as Error).message);
    }
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-t-3xl bg-white p-4 dark:bg-slate-900 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">{t('drv.stop')} {stop.order} · {stop.qr_code}</div>
            <h2 className="text-xl font-bold">{stop.address}</h2>
            <div className={`text-sm ${near ? 'text-emerald-600' : 'text-amber-600'}`}>
              {dist == null ? t('drv.gpsWait') : near ? t('drv.near') : `${t('drv.far')} ${fmtDist(dist)}`}
            </div>
          </div>
          <button className="btn-ghost px-4 py-3 text-lg" onClick={onClose} aria-label={t('app.close')}>✕</button>
        </div>
        {!near && DEMO_MODE && (
          <button className="btn-ghost mb-3 w-full text-sm" onClick={() => { setDemoHere(true); tracker?.push({ lon: stop.location.lon, lat: stop.location.lat }); }}>
            {t('drv.demoHere')}
          </button>
        )}
        {err && <div className="mb-3 rounded-xl bg-red-50 p-3 text-red-700">{err}</div>}
        <div className="space-y-4">
          {containers.map((c) => {
            const res = results[c.id];
            const wrong = route.waste_type === 'mixed' && c.waste_type !== 'mixed';
            const ai = res?.ai_result as Any | undefined;
            const contamination = res?.contamination_pct ?? ai?.contamination_pct;
            return (
              <div key={c.id} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 flex items-center gap-2">
                  <WasteBadge w={c.waste_type} />
                  <div className="flex-1">
                    <div className="font-semibold">{t('waste.' + c.waste_type)} · {c.volume_l} {t('drv.l')}</div>
                    {wrong && <div className="text-sm font-medium text-red-600">⚠ {t('drv.wrongBin')}</div>}
                  </div>
                </div>
                {res ? (
                  <div className={`rounded-xl p-3 ${res.mixed_flag ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'} dark:bg-slate-800 dark:text-slate-100`}>
                    {res.queued ? t('drv.savedOffline') : res.status === 'picked' || !res.status ? (
                      <>
                        <div className="text-lg font-semibold">✓ {t('drv.picked')}</div>
                        {contamination != null ? <div>{t('drv.cleanliness')}: <b>{fmt(100 - Number(contamination), 0)}%</b> ({t('dash.contamination')} {fmt(contamination, 0)}%)</div>
                          : ai?.error ? <div className="text-sm">{t('drv.aiLater')}</div> : null}
                        {res.mixed_flag && <div className="font-medium">⚠ {t('dash.flag.mixed')}</div>}
                        {res.within_radius === false && <div className="text-sm">⚠ {t('drv.outOfRadius')} ({fmt(res.distance_m, 0)} m)</div>}
                      </>
                    ) : <div className="font-semibold">✓ {t('drv.status.' + res.status)}</div>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className={`flex cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed ${photos[c.id] ? 'border-brand' : 'border-slate-300'} py-3`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {photos[c.id] ? <img src={photos[c.id].url} alt="" className="max-h-40 rounded-lg" /> : <span className="text-lg">📷 {t('drv.photo')}</span>}
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => take(c.id, e.target.files?.[0])} />
                    </label>
                    <button disabled={!photos[c.id] || !near || busy === c.id} onClick={() => submit(c, 'picked')}
                      className="btn-primary w-full py-4 text-lg">{busy === c.id ? t('drv.sending') : t('drv.pickedBtn')}</button>
                    {!near && <p className="text-center text-xs text-slate-500">{t('drv.radiusHint')}</p>}
                    <div className="grid grid-cols-3 gap-2">
                      {(['empty', 'no_access', 'broken'] as const).map((s) => (
                        <button key={s} disabled={busy === c.id} onClick={() => submit(c, s)} className="btn-ghost py-3 text-sm">{t('drv.status.' + s)}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button className="btn-primary mt-4 w-full py-4 text-lg" disabled={!allDone} onClick={onDone}>{t('drv.nextStop')}</button>
      </div>
    </div>
  );
}

/** История рейсов (P2): за сегодня по маршруту, с флагами */
function History({ trips }: { trips: Any[] }) {
  const { t } = useI18n();
  if (!trips.length) return null;
  return (
    <section className="card">
      <h2 className="mb-2 font-semibold">{t('drv.history')}</h2>
      <ul className="space-y-1 text-sm">
        {trips.map((x) => (
          <li key={x.id} className="flex justify-between gap-2">
            <span>{fmtDate(x.started_at)} → {x.finished_at ? fmtDate(x.finished_at) : t('drv.active')}</span>
            <span className={x.mixed_flag ? 'text-red-600' : 'text-emerald-600'}>{x.mixed_flag ? `⚠ ${t('dash.kpi.mixedTrips')}` : '✓'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

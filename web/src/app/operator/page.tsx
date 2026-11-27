'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WASTE_TYPES, type WasteType } from '@kaida/contracts';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { compressImage } from '@/lib/image';
import { fmt, fmtDate } from '@/lib/dashboard';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tab = 'arrivals' | 'sorting' | 'dropoff';
const OUTPUT_TYPES = ['pet', 'hdpe', 'film', 'paper', 'cardboard', 'glass', 'metal', 'organic', 'rdf', 'landfill'] as const;
const DESTS = ['recycler', 'buyer', 'energy', 'compost', 'landfill'] as const;
const DEFAULT_DEST: Record<string, string> = { landfill: 'landfill', rdf: 'energy', organic: 'compost' };

const rpc = async <T = Any,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

/**
 * Кабинет оператора приёмки (ТЗ 10.2): очередь машин в геозоне объекта, приёмка партии
 * (брутто/тара, фото кузова), итог сортировки по видам (по партии или суточный), сдача от жителя по QR.
 */
export default function Operator() {
  const { t } = useI18n();
  const { me, hasRole, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('arrivals');
  const [facilities, setFacilities] = useState<Any[]>([]);
  const [fid, setFid] = useState<string>('');
  const allowed = hasRole('operator');

  useEffect(() => {
    if (!allowed) return;
    supabase().from('facilities').select('id,name,type,address,accepted_waste_types').eq('is_active', true).order('name')
      .then(({ data }) => setFacilities(data ?? []));
  }, [allowed]);
  useEffect(() => { if (me?.facility_id) setFid(me.facility_id); }, [me?.facility_id]);
  useEffect(() => { const h = window.location.hash.slice(1) as Tab; if (['arrivals', 'sorting', 'dropoff'].includes(h)) setTab(h); }, []);

  if (loading) return <p>{t('app.loading')}</p>;
  if (!allowed) return <div className="card text-red-700">{t('op.forbidden')}</div>;
  const fac = facilities.find((f) => f.id === fid);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t('op.title')}</h1>
        <select className="input ml-auto w-auto" value={fid} onChange={(e) => setFid(e.target.value)} disabled={!!me?.facility_id && !hasRole('admin')}>
          <option value="">{t('op.pickFacility')}</option>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <nav className="grid grid-cols-3 gap-2">
        {(['arrivals', 'sorting', 'dropoff'] as Tab[]).map((x) => (
          <button key={x} className={`${x === tab ? 'btn-primary' : 'btn-ghost'} py-3`} onClick={() => { setTab(x); window.history.replaceState(null, '', '#' + x); }}>{t('op.tab.' + x)}</button>
        ))}
      </nav>
      {!fid ? <div className="card text-slate-600">{t('op.pickFacility')}</div>
        : tab === 'arrivals' ? <Arrivals fid={fid} onAccepted={() => setTab('sorting')} />
        : tab === 'sorting' ? <Sorting fid={fid} facilities={facilities} />
        : <DropOff fid={fid} accepted={(fac?.accepted_waste_types as WasteType[] | undefined) ?? [...WASTE_TYPES]} />}
    </div>
  );
}

/** Очередь приехавших рейсов (P1) + приёмка партии (P1): вес брутто/тара, фото кузова → batch */
function Arrivals({ fid, onAccepted }: { fid: string; onAccepted: () => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<Any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => rpc<Any[]>('facility_arrivals', { p_facility_id: fid }).then((d) => { setList(d); setErr(null); }).catch((e) => setErr(e.message)), [fid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // машина заехала в геозону / закончила рейс — очередь обновляется сама
    const ch = supabase().channel('op-trips').on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => load()).subscribe();
    const iv = setInterval(load, 30_000);
    return () => { supabase().removeChannel(ch); clearInterval(iv); };
  }, [load]);

  if (err) return <div className="card text-red-700">{err}</div>;
  if (!list) return <p>{t('app.loading')}</p>;
  if (!list.length) return <div className="card text-slate-600">{t('op.noArrivals')}</div>;
  return (
    <ul className="space-y-3">
      {list.map((tr) => (
        <li key={tr.trip_id} className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-lg">{tr.vehicle?.plate_number}</b>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-sm dark:bg-slate-800">{t('waste.' + tr.waste_type)}</span>
            <span className={`rounded-full px-2 py-0.5 text-sm ${tr.status === 'active' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{t('op.trip.' + tr.status)}</span>
            <span className="ml-auto text-sm text-slate-500">{tr.carrier?.name}</span>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {fmtDate(tr.started_at)} → {tr.finished_at ? fmtDate(tr.finished_at) : '…'} · {t('op.pickups')}: {(tr.pickups as Any[] | undefined)?.filter((p) => p.status === 'picked').length ?? 0}
          </div>
          {(tr.mixed_flag || tr.deviation_flag) && (
            <div className="rounded-xl bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
              {tr.mixed_flag && <div>⚠ {t('dash.flag.mixed')}</div>}{tr.deviation_flag && <div>⚠ {t('dash.flag.deviation')}</div>}
            </div>
          )}
          {open === tr.trip_id ? <Accept fid={fid} trip={tr} onDone={() => { setOpen(null); load(); onAccepted(); }} />
            : <button className="btn-primary w-full py-3 text-lg" onClick={() => setOpen(tr.trip_id)}>{t('op.accept')}</button>}
        </li>
      ))}
    </ul>
  );
}

function Accept({ fid, trip, onDone }: { fid: string; trip: Any; onDone: () => void }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const net = Number(gross) - Number(tare);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      let photoUrl: string | null = null;
      if (photo && session) {
        const path = `${session.user.id}/batches/${crypto.randomUUID()}.jpg`;
        const up = await supabase().storage.from('photos').upload(path, photo, { contentType: 'image/jpeg' });
        if (!up.error) photoUrl = supabase().storage.from('photos').getPublicUrl(path).data.publicUrl;
      }
      if (trip.status === 'active') throw new Error(t('op.stillActive'));
      await rpc('batch_create', { p_facility_id: fid, p_trip_id: trip.trip_id, p_gross_kg: Number(gross), p_tare_kg: Number(tare), p_photo_url: photoUrl });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">{t('op.gross')}<input className="input text-xl" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} /></label>
        <label className="text-sm">{t('op.tare')}<input className="input text-xl" inputMode="decimal" value={tare} onChange={(e) => setTare(e.target.value)} /></label>
      </div>
      <div className="text-lg">{t('op.net')}: <b>{gross && tare ? `${fmt(net, 0)} ${t('dash.kg')}` : '—'}</b></div>
      <label className="btn-ghost w-full cursor-pointer">
        📷 {photo ? t('op.photoOk') : t('op.bodyPhoto')}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => e.target.files?.[0] && setPhoto(await compressImage(e.target.files[0]))} />
      </label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-primary w-full py-3 text-lg" disabled={busy || !gross || !tare || net <= 0} onClick={submit}>{t('op.createBatch')}</button>
    </div>
  );
}

/** Итог сортировки (P1): кг по видам и куда ушло; сумма точно равна весу партии. Или суточный итог на все партии дня. */
function Sorting({ fid, facilities }: { fid: string; facilities: Any[] }) {
  const { t } = useI18n();
  const [batches, setBatches] = useState<Any[] | null>(null);
  const [sel, setSel] = useState<Any | null>(null);
  const [daily, setDaily] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase().from('batches').select('id,weight_kg,received_at,status,trip_id,gross_kg,tare_kg')
      .eq('facility_id', fid).neq('status', 'sorted').order('received_at', { ascending: false }).limit(100);
    setBatches(data ?? []);
  }, [fid]);
  useEffect(() => { load(); setSel(null); }, [load]);

  if (!batches) return <p>{t('app.loading')}</p>;
  const totalOpen = batches.reduce((a, b) => a + Number(b.weight_kg), 0);
  const today = new Date().toISOString().slice(0, 10); // как в facility_daily_outputs (received_at::date)
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className={!daily ? 'btn-primary flex-1' : 'btn-ghost flex-1'} onClick={() => setDaily(false)}>{t('op.perBatch')}</button>
        <button className={daily ? 'btn-primary flex-1' : 'btn-ghost flex-1'} onClick={() => setDaily(true)}>{t('op.daily')}</button>
      </div>
      {!batches.length && <div className="card text-slate-600">{t('op.noOpen')}</div>}
      {daily ? (
        batches.length > 0 && <OutputsForm key="daily" total={batches.filter((b) => b.received_at.slice(0, 10) === today).reduce((a, b) => a + Number(b.weight_kg), 0)}
          title={`${t('op.dailyTitle')} ${today}`} facilities={facilities} fid={fid}
          submit={(outs) => rpc('facility_daily_outputs', { p_facility_id: fid, p_date: today, p_outputs: outs }).then(load)} />
      ) : sel ? (
        <OutputsForm key={sel.id} total={Number(sel.weight_kg)} title={`${t('op.batch')} · ${fmtDate(sel.received_at)}`} facilities={facilities} fid={fid}
          onCancel={() => setSel(null)}
          submit={(outs) => rpc('batch_add_outputs', { p_batch_id: sel.id, p_outputs: outs, p_close: true }).then(() => { setSel(null); load(); })} />
      ) : (
        <ul className="space-y-2">
          {batches.map((b) => (
            <li key={b.id}>
              <button className="card flex w-full items-center justify-between text-left hover:border-brand" onClick={() => setSel(b)}>
                <span>{fmtDate(b.received_at)}<span className="block text-xs text-slate-500">{b.trip_id ? t('op.fromTrip') : t('op.manual')}</span></span>
                <b className="text-lg">{fmt(b.weight_kg, 0)} {t('dash.kg')}</b>
              </button>
            </li>
          ))}
          {batches.length > 1 && <li className="text-right text-sm text-slate-500">{t('op.openTotal')}: {fmt(totalOpen, 0)} {t('dash.kg')}</li>}
        </ul>
      )}
    </div>
  );
}

type Row = { output_type: string; weight_kg: string; destination: string; next_facility_id: string; buyer_name: string };
function OutputsForm({ total, title, facilities, fid, submit, onCancel }: {
  total: number; title: string; facilities: Any[]; fid: string; submit: (o: unknown[]) => Promise<unknown>; onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([
    { output_type: 'pet', weight_kg: '', destination: 'recycler', next_facility_id: '', buyer_name: '' },
    { output_type: 'landfill', weight_kg: '', destination: 'landfill', next_facility_id: '', buyer_name: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sum = rows.reduce((a, r) => a + (Number(r.weight_kg) || 0), 0);
  const rest = Math.round((total - sum) * 100) / 100;
  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await submit(rows.filter((r) => Number(r.weight_kg) > 0).map((r) => ({
        output_type: r.output_type, weight_kg: Number(r.weight_kg), destination: r.destination,
        next_facility_id: r.next_facility_id || undefined, buyer_name: r.buyer_name || undefined,
      })));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{title}</h2><b>{fmt(total, 0)} {t('dash.kg')}</b></div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700 sm:grid-cols-[1fr_7rem_1fr_1fr_auto]">
          <select className="input" value={r.output_type} onChange={(e) => set(i, { output_type: e.target.value, destination: DEFAULT_DEST[e.target.value] ?? 'recycler' })}>
            {OUTPUT_TYPES.map((o) => <option key={o} value={o}>{t('out.' + o)}</option>)}
          </select>
          <input className="input" inputMode="decimal" placeholder={t('dash.kg')} value={r.weight_kg} onChange={(e) => set(i, { weight_kg: e.target.value })} />
          <select className="input" value={r.destination} onChange={(e) => set(i, { destination: e.target.value })}>
            {DESTS.map((d) => <option key={d} value={d}>{t('dest.' + d)}</option>)}
          </select>
          {r.destination === 'buyer' ? (
            <input className="input" placeholder={t('op.buyer')} value={r.buyer_name} onChange={(e) => set(i, { buyer_name: e.target.value })} />
          ) : (
            <select className="input" value={r.next_facility_id} onChange={(e) => set(i, { next_facility_id: e.target.value })}>
              <option value="">{t('op.nextFacility')}</option>
              {facilities.filter((f) => f.id !== fid).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <button className="btn-ghost px-3" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} aria-label={t('app.delete')}>✕</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={() => setRows((rs) => [...rs, { output_type: 'paper', weight_kg: '', destination: 'recycler', next_facility_id: '', buyer_name: '' }])}>+ {t('op.addType')}</button>
        {rest > 0 && <button className="btn-ghost" onClick={() => set(rows.length - 1, { weight_kg: String(Math.round((Number(rows[rows.length - 1].weight_kg) || 0) * 100 + rest * 100) / 100) })}>{t('op.restToLast')}</button>}
        <span className={`ml-auto font-medium ${Math.abs(rest) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>{t('op.rest')}: {fmt(rest, 2)} {t('dash.kg')}</span>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        {onCancel && <button className="btn-ghost flex-1" onClick={onCancel}>{t('app.cancel')}</button>}
        <button className="btn-primary flex-1 py-3" disabled={busy || Math.abs(rest) >= 0.01 || total <= 0} onClick={go}>{t('op.close')}</button>
      </div>
    </section>
  );
}

/** Сдача от жителя (P1): QR жителя → вид и вес → бонусы начисляются автоматически */
function DropOff({ fid, accepted }: { fid: string; accepted: WasteType[] }) {
  const { t } = useI18n();
  const [qr, setQr] = useState('');
  const [type, setType] = useState<WasteType>(accepted[0] ?? 'plastic');
  const [kg, setKg] = useState('');
  const [res, setRes] = useState<Any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const scan = async () => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setErr(t('op.noScanner')); return; }
    setScanning(true); setErr(null);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).catch(() => null);
    if (!stream || !video.current) { setScanning(false); return; }
    video.current.srcObject = stream; await video.current.play();
    const det = new BD({ formats: ['qr_code'] });
    const stop = () => { stream.getTracks().forEach((x) => x.stop()); setScanning(false); };
    const tick = async () => {
      if (!video.current?.srcObject) return;
      const codes = await det.detect(video.current).catch(() => []);
      if (codes[0]) { setQr(codes[0].rawValue); stop(); } else requestAnimationFrame(tick);
    };
    tick();
    setTimeout(stop, 30_000);
  };

  const submit = async () => {
    setErr(null); setRes(null);
    try {
      const r = await rpc('drop_off_create', { p_facility_id: fid, p_waste_type: type, p_weight_kg: Number(kg), p_user_qr: qr.trim(), p_client_id: crypto.randomUUID() });
      setRes(r); setKg(''); setQr('');
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <section className="card space-y-3">
      <div className="flex gap-2">
        <input className="input text-lg" placeholder={t('op.qrPlaceholder')} value={qr} onChange={(e) => setQr(e.target.value)} />
        <button className="btn-ghost whitespace-nowrap" onClick={scan}>📷 {t('op.scan')}</button>
      </div>
      <video ref={video} className={scanning ? 'w-full rounded-xl' : 'hidden'} muted playsInline />
      <div className="grid grid-cols-3 gap-2">
        {accepted.filter((w) => w !== 'mixed').map((w) => (
          <button key={w} className={`${w === type ? 'btn-primary' : 'btn-ghost'} py-3`} onClick={() => setType(w)}>{t('waste.' + w)}</button>
        ))}
      </div>
      <label className="block text-sm">{t('op.weight')}<input className="input text-2xl" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} /></label>
      <button className="btn-primary w-full py-4 text-lg" disabled={!qr || !(Number(kg) > 0)} onClick={submit}>{t('op.dropOff')}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {res && <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">✓ {t('op.accepted')}: {fmt(res.weight_kg, 2)} {t('dash.kg')} · {t('op.bonus')}: <b>+{fmt(res.bonus, 0)}</b></div>}
    </section>
  );
}

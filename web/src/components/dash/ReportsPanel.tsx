'use client';
import { useCallback, useEffect, useState } from 'react';
import { REPORT_STATUSES, REPORT_TRANSITIONS, REPORT_TYPES, type Report, type ReportStatus, type ReportType } from '@kaida/contracts';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { fmtDate } from '@/lib/dashboard';
import MapPicker from '@/components/MapPicker';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const STATUS_CLS: Record<ReportStatus, string> = {
  new: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200',
  in_work: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  rejected: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

/** Жалобы (ТЗ 11.2, P0): фильтры, карточка (фото, карта, время, ближайший рейс), смена статуса с комментарием, realtime. */
export default function ReportsPanel({ districts }: { districts: { id: string; name_ru: string }[] }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ReportStatus | ''>('');
  const [type, setType] = useState<ReportType | ''>('');
  const [district, setDistrict] = useState('');
  const [rows, setRows] = useState<Report[]>([]);
  const [sel, setSel] = useState<Report | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('reports_list', {
      p_status: status || undefined, p_type: type || undefined, p_district_id: district || undefined, p_limit: 300,
    });
    if (error) setErr(error.message); else { setErr(null); setRows((data as Report[]) ?? []); }
  }, [status, type, district]);
  useEffect(() => { load(); }, [load]);

  // новая жалоба появляется без перезагрузки (Realtime)
  useEffect(() => {
    const ch = supabase().channel('dash-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, (p) => {
        const id = (p.new as Any)?.id as string | undefined;
        if (p.eventType === 'INSERT' && id) setFresh((s) => new Set(s).add(id));
        load();
      })
      .subscribe();
    return () => { supabase().removeChannel(ch); };
  }, [load]);

  useEffect(() => { if (sel) setSel(rows.find((r) => r.id === sel.id) ?? sel); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="card space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus | '')}>
            <option value="">{t('rep.allStatuses')}</option>
            {REPORT_STATUSES.map((s) => <option key={s} value={s}>{t('rep.status.' + s)}</option>)}
          </select>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ReportType | '')}>
            <option value="">{t('rep.allTypes')}</option>
            {REPORT_TYPES.map((s) => <option key={s} value={s}>{t('rep.type.' + s)}</option>)}
          </select>
          <select className="input" value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">{t('dash.allDistricts')}</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name_ru}</option>)}
          </select>
          <span className="flex items-center gap-1 text-xs text-slate-500 sm:col-span-3"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> {t('dash.live')}</span>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <ul className="max-h-[640px] divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {rows.map((r) => {
            const site = (r as Any).site as Any | null;
            return (
              <li key={r.id ?? ''}>
                <button onClick={() => setSel(r)} className={`flex w-full gap-3 px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${sel?.id === r.id ? 'bg-brand-light/50 dark:bg-slate-800' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.photo_url ? <img src={r.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" /> : <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-200" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t('rep.type.' + r.type)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[r.status as ReportStatus]}`}>{t('rep.status.' + r.status)}</span>
                      {fresh.has(r.id ?? '') && <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-white">{t('rep.new')}</span>}
                    </div>
                    <div className="truncate text-sm text-slate-600 dark:text-slate-300">{site?.address ?? t('rep.noSite')}</div>
                    <div className="text-xs text-slate-500">{fmtDate(r.created_at)}</div>
                  </div>
                </button>
              </li>
            );
          })}
          {!rows.length && <li className="py-6 text-center text-sm text-slate-500">{t('dash.noData')}</li>}
        </ul>
      </section>
      {sel ? <ReportCard key={sel.id} r={sel} onChanged={load} /> : <section className="card text-slate-500">{t('rep.pick')}</section>}
    </div>
  );
}

function ReportCard({ r, onChanged }: { r: Report; onChanged: () => void }) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trip, setTrip] = useState<Any | null>(null);
  const x = r as Any;

  useEffect(() => {
    if (!r.related_trip_id) return;
    supabase().rpc('trip_chain', { p_trip_id: r.related_trip_id }).then(({ data }) => setTrip(data as Any));
  }, [r.related_trip_id]);

  const change = async (to: ReportStatus) => {
    setBusy(true); setErr(null);
    const { error } = await supabase().rpc('report_set_status', { p_report_id: r.id, p_status: to, p_comment: comment || null });
    setBusy(false);
    if (error) setErr(error.message); else { setComment(''); onChanged(); }
  };
  const next = REPORT_TRANSITIONS[r.status as ReportStatus] ?? [];
  return (
    <section className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t('rep.type.' + r.type)} · {x.site?.address ?? t('rep.noSite')}</h2>
          <div className="text-sm text-slate-500">{fmtDate(r.created_at)} · <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[r.status as ReportStatus]}`}>{t('rep.status.' + r.status)}</span></div>
        </div>
      </div>
      {r.comment && <p className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-800">«{r.comment}»</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {r.photo_url && <a href={r.photo_url} target="_blank" rel="noreferrer"><img src={r.photo_url} alt="" className="max-h-64 w-full rounded-xl object-cover" /></a>}
        {r.location && <MapPicker value={{ lon: r.location.lon, lat: r.location.lat }} height={240} />}
      </div>
      <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
        <div className="mb-1 font-medium">{t('rep.nearestTrip')}</div>
        {!r.related_trip_id && <span className="text-slate-500">{t('rep.noTrip')}</span>}
        {trip && (
          <div className="space-y-0.5">
            <div>{trip.vehicle?.plate_number} · {t('waste.' + trip.waste_type)} · {trip.carrier?.name}</div>
            <div className="text-slate-500">{fmtDate(trip.started_at)} → {fmtDate(trip.finished_at)} · {trip.destination_facility?.name ?? '—'}</div>
            {trip.mixed_flag && <div className="text-red-600">⚠ {t('dash.flag.mixed')}</div>}
            {trip.deviation_flag && <div className="text-red-600">⚠ {t('dash.flag.deviation')}</div>}
          </div>
        )}
      </div>
      {!!x.history?.length && (
        <ol className="space-y-1 border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700">
          {(x.history as Any[]).map((h, i) => (
            <li key={i}><b>{t('rep.status.' + h.to)}</b> · <span className="text-slate-500">{fmtDate(h.at)}</span>{h.comment ? ` — ${h.comment}` : ''}</li>
          ))}
        </ol>
      )}
      {next.length > 0 && (
        <div className="space-y-2">
          <textarea className="input" rows={2} placeholder={t('rep.comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {next.map((s) => (
              <button key={s} disabled={busy} onClick={() => change(s)}
                className={s === 'confirmed' ? 'btn-primary' : s === 'rejected' ? 'btn-danger' : 'btn-ghost'}>{t('rep.to.' + s)}</button>
            ))}
          </div>
          {r.type === 'mixed' && <p className="text-xs text-slate-500">{t('rep.mixedHint')}</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      )}
    </section>
  );
}

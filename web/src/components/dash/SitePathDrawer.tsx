'use client';
import { useEffect, useState } from 'react';
import { PATH_STAGES, type SitePath } from '@kaida/contracts';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import { fmt, fmtDate } from '@/lib/dashboard';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Путь площадки (клик в рейтинге, ТЗ 11.1 → раздел 7): последний рейс по шагам 1–6 и итог в кг. */
export default function SitePathDrawer({ siteId, onClose, inline }: { siteId: string; onClose: () => void; inline?: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<SitePath | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    supabase().rpc('site_path', { p_site_id: siteId, p_period_days: 14 }).then(({ data: d, error }) => {
      if (error) setErr(error.message); else setData(d as SitePath);
    });
  }, [siteId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const d = data as Any | null;
  const latest = d?.latest as Any | null;
  const done = new Set((latest?.timeline ?? []).filter((s: Any) => s.done).map((s: Any) => s.stage));
  return (
    <div className={inline ? '' : 'fixed inset-0 z-40 flex justify-end bg-black/30'} onClick={inline ? undefined : onClose}>
      <aside className={inline ? 'card' : 'h-full w-full max-w-lg overflow-auto bg-white p-5 shadow-xl dark:bg-slate-900'} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">{t('dash.pathOf')}</div>
            <h2 className="text-xl font-bold">{d?.site?.address ?? '…'}</h2>
            {d?.site && <div className="text-sm text-slate-500">{d.site.qr_code} · {d.site.district?.name_ru} · {t('dash.site.cleanliness_score')}: <b>{fmt(d.site.cleanliness_score)}</b></div>}
          </div>
          {!inline && <button className="btn-ghost px-3 py-1" onClick={onClose} aria-label={t('app.close')}>✕</button>}
        </div>
        {err && <p className="text-red-600">{err}</p>}
        {!d && !err && <p>{t('app.loading')}</p>}
        {d && !latest && <p className="text-slate-500">{t('dash.noTrips')}</p>}
        {latest && (
          <div className="space-y-4">
            <ol className="space-y-2">
              {PATH_STAGES.map((s) => {
                const step = (latest.timeline as Any[]).find((x) => x.stage === s.stage);
                const ok = done.has(s.stage);
                return (
                  <li key={s.stage} className="flex gap-3">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? 'bg-brand text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700'}`}>{s.stage}</span>
                    <div>
                      <div className={ok ? 'font-medium' : 'text-slate-500'}>{t('path.' + s.code)}</div>
                      {step?.at && <div className="text-xs text-slate-500">{fmtDate(step.at)}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Info k={t('dash.trip.vehicle')} v={`${latest.vehicle?.plate_number ?? '—'} · ${t('waste.' + latest.waste_type)}`} />
              <Info k={t('dash.trip.carrier')} v={latest.carrier?.name ?? '—'} />
              <Info k={t('dash.trip.started')} v={fmtDate(latest.started_at)} />
              <Info k={t('dash.trip.destination')} v={latest.destination_facility?.name ?? '—'} />
            </div>
            {(latest.mixed_flag || latest.deviation_flag) && (
              <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
                {latest.mixed_flag && <div>⚠ {t('dash.flag.mixed')}</div>}
                {latest.deviation_flag && <div>⚠ {t('dash.flag.deviation')}</div>}
              </div>
            )}
            {latest.outcome && (
              <div>
                <h3 className="mb-2 font-semibold">{t('dash.outcomeSite')}</h3>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  {(['recycled', 'energy', 'landfill'] as const).map((c) => (
                    <div key={c} className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800">
                      <div className="text-xs text-slate-500">{t('cat.' + c)}</div>
                      <b>{fmt(latest.outcome[c + '_kg'], 0)} {t('dash.kg')}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(latest.batches as Any[] | undefined)?.map((b) => (
              <div key={b.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="mb-1 font-medium">{b.facility?.name} · {fmt(b.weight_kg, 0)} {t('dash.kg')} <span className="text-slate-500">({t('dash.siteShare')} {fmt(b.site_kg, 0)})</span></div>
                <ul className="space-y-0.5">
                  {(b.outputs as Any[]).map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <span>{t('out.' + o.output_type, o.output_type)} → {o.next_facility?.name ?? o.buyer_name ?? t('dest.' + o.destination)}</span>
                      <span className="tabular-nums">{fmt(o.weight_kg, 0)} {t('dash.kg')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {(latest.pickups as Any[] | undefined)?.filter((p) => p.photo_url).slice(0, 4).map((p) => (
              <figure key={p.id} className="text-xs text-slate-500">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photo_url} alt="" className="max-h-48 rounded-lg object-cover" loading="lazy" />
                <figcaption>{fmtDate(p.picked_at)} · {t('waste.' + p.container_waste_type)} · {t('dash.contamination')}: {fmt(p.contamination_pct)}%</figcaption>
              </figure>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

const Info = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><div className="text-xs text-slate-500">{k}</div><div className="font-medium">{v}</div></div>
);

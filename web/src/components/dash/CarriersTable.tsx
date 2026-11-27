'use client';
import type { CarrierRating } from '@kaida/contracts';
import { useI18n } from '@/lib/i18n';
import { fmt } from '@/lib/dashboard';

/** Рейтинг перевозчиков (ТЗ 11.1, P1): доля рейсов без смешивания, срывы графика, отклонения от маршрута. */
export default function CarriersTable({ rows }: { rows: CarrierRating[] }) {
  const { t } = useI18n();
  if (!rows.length) return <p className="text-sm text-slate-500">{t('dash.noData')}</p>;
  return (
    <div className="space-y-3">
      {rows.map((c) => {
        const pct = c.clean_trips_pct ?? null;
        const color = pct == null ? '#94A3B8' : pct >= 90 ? '#16A34A' : pct >= 75 ? '#EAB308' : '#DC2626';
        return (
          <div key={c.carrier_id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <b>{c.name}</b>
              <span className="text-lg font-semibold" style={{ color }}>{fmt(pct)}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full" style={{ width: `${pct ?? 0}%`, background: color }} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-4">
              <span>{t('dash.carrier.trips')}: <b>{c.trips}</b></span>
              <span>{t('dash.carrier.mixed')}: <b className={c.mixed_trips ? 'text-red-600' : ''}>{c.mixed_trips}</b></span>
              <span>{t('dash.carrier.deviation')}: <b className={c.deviation_trips ? 'text-red-600' : ''}>{c.deviation_trips}</b></span>
              <span>{t('dash.carrier.missed')}: <b>{c.missed_routes}</b></span>
              <span className="col-span-2 sm:col-span-4">{t('dash.carrier.reports')}: <b>{c.confirmed_mixed_reports}</b></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';
import type { DashboardSummary } from '@kaida/contracts';
import { useI18n } from '@/lib/i18n';
import { fmt } from '@/lib/dashboard';

/** Плитки показателей (ТЗ 11.1, P0) со сравнением с прошлым периодом. Первый экран — разрыв «заявлено / реально». */
export default function Kpis({ s }: { s: DashboardSummary }) {
  const { t } = useI18n();
  const c = s.current as Record<string, number | null>;
  const p = s.previous as Record<string, number | null>;
  const d = (s.delta_pct ?? {}) as Record<string, number | null>;
  const claimed = c.claimed_recycled_t ?? 0;
  const real = c.real_recycled_t ?? 0;
  const realPct = claimed > 0 ? Math.min(100, (100 * real) / claimed) : 0;

  const tiles: { key: string; value: string; unit?: string; delta?: number | null; good?: 'up' | 'down'; prev?: string }[] = [
    { key: 'collected', value: fmt(c.collected_t, 2), unit: t('dash.t'), delta: d.collected_t, prev: fmt(p.collected_t, 2) },
    { key: 'cleanliness', value: fmt(c.avg_cleanliness_pct), unit: '%', delta: deltaAbs(c.avg_cleanliness_pct, p.avg_cleanliness_pct), good: 'up', prev: fmt(p.avg_cleanliness_pct) },
    { key: 'mixedTrips', value: fmt(c.mixed_trips, 0), unit: `/ ${fmt(c.trips, 0)}`, delta: d.mixed_trips, good: 'down', prev: fmt(p.mixed_trips, 0) },
    { key: 'newReports', value: fmt(c.new_reports, 0), delta: d.new_reports, good: 'down', prev: fmt(p.new_reports, 0) },
  ];

  return (
    <div className="space-y-3">
      <section className="card grid gap-4 border-brand/40 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="text-sm font-medium text-slate-500">{t('dash.gapTitle')}</div>
          <div className="mt-2 flex flex-wrap items-end gap-6">
            <div>
              <div className="text-xs text-slate-500">{t('dash.claimed')}</div>
              <div className="text-3xl font-bold">{fmt(claimed, 2)} <span className="text-lg font-medium">{t('dash.t')}</span></div>
              <Delta v={d.claimed_recycled_t} />
            </div>
            <div className="text-2xl text-slate-400">→</div>
            <div>
              <div className="text-xs text-slate-500">{t('dash.real')}</div>
              <div className="text-3xl font-bold text-brand">{fmt(real, 2)} <span className="text-lg font-medium">{t('dash.t')}</span></div>
              <Delta v={d.real_recycled_t} good="up" />
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-2">
          <div className="flex justify-between text-sm">
            <span>{t('dash.realShare')}</span>
            <b>{fmt(c.real_recycled_pct)}%</b>
          </div>
          <div className="h-4 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
            <div className="h-full rounded-full bg-brand" style={{ width: `${realPct}%` }} />
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {t('dash.gap')}: <b className="text-red-600">{fmt(c.recycling_gap_t, 2)} {t('dash.t')}</b> · {t('dash.energy')}: {fmt(c.energy_t, 2)} {t('dash.t')} · {t('dash.landfill')}: {fmt(c.landfill_t, 2)} {t('dash.t')}
          </div>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.key} className="card">
            <div className="text-sm text-slate-500">{t('dash.kpi.' + x.key)}</div>
            <div className="mt-1 text-2xl font-semibold">{x.value} {x.unit && <span className="text-base font-normal text-slate-500">{x.unit}</span>}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <Delta v={x.delta} good={x.good ?? 'up'} abs={x.key === 'cleanliness'} />
              <span>{t('dash.prev')}: {x.prev}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function deltaAbs(a: number | null | undefined, b: number | null | undefined) {
  return a == null || b == null ? null : Math.round((a - b) * 10) / 10;
}

function Delta({ v, good = 'up', abs = false }: { v: number | null | undefined; good?: 'up' | 'down'; abs?: boolean }) {
  const { t } = useI18n();
  if (v == null) return <span className="text-xs text-slate-400">—</span>;
  const better = good === 'up' ? v > 0 : v < 0;
  const color = v === 0 ? 'text-slate-500' : better ? 'text-emerald-600' : 'text-red-600';
  return <span className={`text-xs font-medium ${color}`}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {Math.abs(v)}{abs ? ' ' + t('dash.pp') : '%'}</span>;
}

'use client';
import { useMemo, useState } from 'react';
import type { SiteRating } from '@kaida/contracts';
import { cleanlinessColor } from '@kaida/contracts';
import { useI18n } from '@/lib/i18n';
import { fmt, fmtDate } from '@/lib/dashboard';

type Key = 'address' | 'cleanliness_score' | 'period_cleanliness' | 'trend' | 'reports' | 'pickups' | 'mixed_pickups' | 'last_pickup_at';
export const DOT: Record<string, string> = { green: '#16A34A', yellow: '#EAB308', red: '#DC2626', gray: '#94A3B8' };

/** Рейтинг площадок (ТЗ 11.1, P0): сортировка по любому столбцу, клик → путь площадки. */
export default function SitesTable({ rows, onOpen }: { rows: SiteRating[]; onOpen: (siteId: string) => void }) {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ k: Key; asc: boolean }>({ k: 'cleanliness_score', asc: true });
  const [q, setQ] = useState('');
  const sorted = useMemo(() => {
    const r = rows.filter((x) => !q || `${x.address} ${x.qr_code}`.toLowerCase().includes(q.toLowerCase()));
    const val = (x: SiteRating) => (x as unknown as Record<Key, unknown>)[sort.k];
    return r.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ru');
      return sort.asc ? c : -c;
    });
  }, [rows, sort, q]);
  const cols: { k: Key; num?: boolean }[] = [
    { k: 'address' }, { k: 'cleanliness_score', num: true }, { k: 'period_cleanliness', num: true }, { k: 'trend', num: true },
    { k: 'reports', num: true }, { k: 'pickups', num: true }, { k: 'mixed_pickups', num: true }, { k: 'last_pickup_at' },
  ];
  return (
    <div className="space-y-2">
      <input className="input max-w-xs" placeholder={t('dash.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-[480px] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
            <tr>
              {cols.map((c) => (
                <th key={c.k} className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium ${c.num ? 'text-right' : 'text-left'}`}
                  onClick={() => setSort((s) => ({ k: c.k, asc: s.k === c.k ? !s.asc : c.k === 'address' || c.k === 'cleanliness_score' }))}>
                  {t('dash.site.' + c.k)} {sort.k === c.k ? (sort.asc ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.site_id} onClick={() => r.site_id && onOpen(r.site_id)} className="cursor-pointer border-t border-slate-100 hover:bg-brand-light/40 dark:border-slate-800 dark:hover:bg-slate-800">
                <td className="min-w-[220px] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[cleanlinessColor(r.cleanliness_score)] }} />
                    <span>{r.address}</span>
                  </div>
                  <div className="pl-4 text-xs text-slate-500">{r.qr_code}</div>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{fmt(r.cleanliness_score)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.period_cleanliness)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.trend == null ? '' : r.trend > 0 ? 'text-emerald-600' : r.trend < 0 ? 'text-red-600' : ''}`}>
                  {r.trend == null ? '—' : `${r.trend > 0 ? '▲' : r.trend < 0 ? '▼' : ''} ${fmt(Math.abs(r.trend))}`}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.reports ? 'font-semibold text-red-600' : ''}`}>{r.reports}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.pickups}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.mixed_pickups ? 'text-amber-600' : ''}`}>{r.mixed_pickups}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDate(r.last_pickup_at)}</td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-slate-500">{t('dash.noData')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

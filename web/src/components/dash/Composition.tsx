'use client';
import { useI18n } from '@/lib/i18n';
import { fmt } from '@/lib/dashboard';

type Item = { output_type: string; category: string; kg: number };
const CAT_COLOR: Record<string, string> = { recycled: '#0F766E', energy: '#F59E0B', landfill: '#64748B', other: '#A855F7' };
const SHADES = ['#0F766E', '#14B8A6', '#2DD4BF', '#5EEAD4', '#0E7490', '#22D3EE', '#99F6E4', '#115E59'];

/** Состав потока (ТЗ 11.1, P0): доли видов вторсырья, энергии и полигона — кольцо + список. */
export default function Composition({ items, landfillDirectT }: { items: Item[]; landfillDirectT?: number }) {
  const { t } = useI18n();
  const rows = [...items];
  // партии, сразу принятые на полигоне (рейс уехал не туда), — тоже полигон
  const outputsLandfill = rows.filter((r) => r.category === 'landfill').reduce((a, r) => a + Number(r.kg), 0);
  const extra = (landfillDirectT ?? 0) * 1000 - outputsLandfill;
  if (extra > 0.5) rows.push({ output_type: 'landfill_direct', category: 'landfill', kg: Math.round(extra) });
  const total = rows.reduce((a, r) => a + Number(r.kg), 0);
  let rec = 0;
  const colored = rows.sort((a, b) => order(a.category) - order(b.category) || b.kg - a.kg)
    .map((r) => ({ ...r, color: r.category === 'recycled' ? SHADES[rec++ % SHADES.length] : CAT_COLOR[r.category] ?? CAT_COLOR.other }));
  const byCat = ['recycled', 'energy', 'landfill'].map((c) => ({ c, kg: rows.filter((r) => r.category === c).reduce((a, r) => a + Number(r.kg), 0) }));

  if (!total) return <p className="text-sm text-slate-500">{t('dash.noData')}</p>;
  // кольцо
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg viewBox="0 0 200 200" className="h-44 w-44 shrink-0 -rotate-90" role="img" aria-label={t('dash.composition')}>
        <circle cx="100" cy="100" r={R} fill="none" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="34" />
        {colored.map((r) => {
          const len = (Number(r.kg) / total) * C;
          const el = <circle key={r.output_type + r.category} cx="100" cy="100" r={R} fill="none" stroke={r.color} strokeWidth="34"
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc}><title>{`${t('out.' + r.output_type, r.output_type)}: ${fmt(r.kg, 0)} ${t('dash.kg')}`}</title></circle>;
          acc += len;
          return el;
        })}
      </svg>
      <div className="w-full space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          {byCat.map(({ c, kg }) => (
            <div key={c} className="rounded-xl p-2" style={{ background: CAT_COLOR[c] + '1A' }}>
              <div className="text-xs" style={{ color: CAT_COLOR[c] }}>{t('cat.' + c)}</div>
              <div className="font-semibold">{fmt((100 * kg) / total)}%</div>
            </div>
          ))}
        </div>
        <ul className="max-h-48 space-y-1 overflow-auto pr-1">
          {colored.map((r) => (
            <li key={r.output_type + r.category} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: r.color }} />
              <span className="flex-1">{t('out.' + r.output_type, r.output_type)}</span>
              <span className="tabular-nums text-slate-500">{fmt(Number(r.kg) / 1000, 2)} {t('dash.t')}</span>
              <span className="w-12 text-right tabular-nums font-medium">{fmt((100 * Number(r.kg)) / total)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
const order = (c: string) => ({ recycled: 0, energy: 1, landfill: 2 } as Record<string, number>)[c] ?? 3;

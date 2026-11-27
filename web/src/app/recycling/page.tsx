'use client';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { rpc, type Any } from '@/lib/rpc';

const PLACES = ['collection_point', 'recycling', 'composting'];

/**
 * Справочник «во что перерабатывается» (ТЗ 13): по правилам сортировки города (waste_rules) —
 * контейнер, во что превращается, и пункты приёма / переработчики, которые берут этот вид.
 */
export default function Recycling() {
  const { t, lang } = useI18n();
  const [rules, setRules] = useState<Any[]>([]);
  const [places, setPlaces] = useState<Any[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    rpc<Any[]>('waste_rules_list').then(setRules).catch(() => setRules([]));
    supabase().from('facilities').select('id, name, type, address, accepted_waste_types')
      .in('type', PLACES).eq('is_active', true).order('name')
      .then(({ data }) => setPlaces(data ?? []));
  }, []);

  const L = (r: Any, f: string) => r[`${f}_${lang}`] ?? r[`${f}_ru`];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rules.filter((r) => [r.label_ru, r.label_kk, r.hint_ru, r.usage_ru, r.ai_class].some((x) => String(x ?? '').toLowerCase().includes(s))) : rules;
  }, [rules, q]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('rcy.title')}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('rcy.intro')}</p>
      </div>
      <input className="input" placeholder={t('rcy.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((r) => {
          const where = places.filter((p) => (p.accepted_waste_types ?? []).includes(r.bin) || (r.special_handling && p.type === 'collection_point'));
          return (
            <div key={r.ai_class} className="card space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 shrink-0 rounded-full border border-black/10" style={{ background: r.color ?? '#94a3b8' }} />
                <span className="font-semibold">{r.icon} {L(r, 'label')}</span>
              </div>
              <div className="text-sm">
                {r.special_handling ? <span className="font-medium text-amber-700">⚠ {t('rcy.special')}</span>
                  : <>{t('rcy.bin')}: <b>{t('waste.' + r.bin)}</b></>}
              </div>
              {L(r, 'hint') && <p className="text-sm text-slate-600 dark:text-slate-300">{L(r, 'hint')}</p>}
              <div className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                {r.is_recyclable && L(r, 'usage') ? <>♻ {t('rcy.becomes')}: {L(r, 'usage')}</> : t('rcy.notRecyclable')}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-brand">{t('rcy.where')} ({where.length})</summary>
                {where.length === 0 ? <p className="text-slate-500">{t('rcy.nowhere')}</p> : (
                  <ul className="mt-1 space-y-1">
                    {where.map((p) => (
                      <li key={p.id}>
                        <b>{p.name}</b> · {t('facilityType.' + p.type)}{p.address ? ` · ${p.address}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

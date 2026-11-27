'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicStats, Role } from '@kaida/contracts';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { configured, supabase } from '@/lib/supabase';

/** Главная: меню зависит от роли (ТЗ 2). Модули потоков C/D/E/F подключаются сюда. */
const MODULES: { key: string; roles: Role[] | 'all'; href?: string }[] = [
  { key: 'resident', roles: 'all' },
  { key: 'map', roles: 'all', href: '/map/' },
  { key: 'workshop', roles: 'all', href: '/workshop/' },
  { key: 'driver', roles: ['driver'], href: '/driver/' },
  { key: 'operator', roles: ['operator'], href: '/operator/' },
  { key: 'dashboard', roles: ['akimat'], href: '/dashboard/' },
  { key: 'admin', roles: ['admin'], href: '/admin/' },
];

export default function Home() {
  const { t } = useI18n();
  const { me, hasRole } = useAuth();
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    if (configured) supabase().rpc('public_stats').then(({ data }) => setStats(data as PublicStats));
  }, []);
  const visible = MODULES.filter((m) => m.roles === 'all' || m.roles.some((r) => hasRole(r)));
  return (
    <div className="space-y-6">
      <section className="card space-y-2">
        <h1 className="text-2xl font-bold">{t('home.title')}</h1>
        <p className="text-slate-600 dark:text-slate-300">{t('home.intro')}</p>
        {!me && <p className="text-sm text-slate-500">{t('home.guestHint')}</p>}
        {!configured && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{t('app.notConfigured')}</p>}
      </section>
      {stats && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['collected', stats.collected_t], ['recycled', stats.recycled_t], ['sites', stats.sites], ['cleanliness', stats.avg_cleanliness ?? '—']].map(([k, v]) => (
            <div key={String(k)} className="card"><div className="text-sm text-slate-500">{t('home.' + k)}</div><div className="text-2xl font-semibold">{String(v)}</div></div>
          ))}
        </section>
      )}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('home.modules')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((m) => m.href ? (
            <Link key={m.key} href={m.href} className="card hover:border-brand">{t('modules.' + m.key)}</Link>
          ) : (
            <div key={m.key} className="card opacity-70">{t('modules.' + m.key)} <span className="text-xs text-slate-500">· {t('modules.soon')}</span></div>
          ))}
          <a className="card hover:border-brand" href="https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/api/">{t('modules.api')}</a>
        </div>
      </section>
    </div>
  );
}

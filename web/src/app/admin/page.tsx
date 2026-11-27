'use client';
import { useEffect, useState } from 'react';
import CrudTable, { type Row } from '@/components/CrudTable';
import UsersPanel from '@/components/UsersPanel';
import QrPanel from '@/components/QrPanel';
import SimulatorPanel from '@/components/SimulatorPanel';
import PayoutsPanel from '@/components/PayoutsPanel';
import { ADMIN_TABS, ENTITIES } from '@/lib/entities';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

type Tab = (typeof ADMIN_TABS)[number];

/** Админка справочников (ТЗ 11.3). Доступ — роль admin; запись защищена RLS. */
export default function Admin() {
  const { t } = useI18n();
  const { hasRole, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('sites');
  const [site, setSite] = useState<Row | null>(null);

  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (ADMIN_TABS.includes(h)) setTab(h);
  }, []);
  const go = (x: Tab) => { setTab(x); setSite(null); window.history.replaceState(null, '', '#' + x); };

  if (loading) return <p>{t('app.loading')}</p>;
  if (!hasRole('admin')) return <div className="card text-red-700">{t('admin.forbidden')}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
      <nav className="no-print flex flex-wrap gap-2">
        {ADMIN_TABS.map((x) => (
          <button key={x} onClick={() => go(x)} className={x === tab ? 'btn-primary py-1.5' : 'btn-ghost py-1.5'}>{t('admin.' + x)}</button>
        ))}
      </nav>
      {tab === 'users' ? <UsersPanel /> : tab === 'qr' ? <QrPanel /> : tab === 'simulator' ? <SimulatorPanel /> : tab === 'payouts' ? <PayoutsPanel /> : (
        <CrudTable key={tab} config={{ ...ENTITIES[tab], onSelect: tab === 'sites' ? setSite : undefined }} />
      )}
      {tab === 'sites' && site && (
        <section className="card space-y-3">
          <h2 className="font-semibold">{t('admin.containers')}: {String(site.address)}</h2>
          <CrudTable key={String(site.id)} config={ENTITIES.containers} extraFilter={{ site_id: site.id }} />
        </section>
      )}
    </div>
  );
}

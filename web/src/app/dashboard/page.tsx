'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Report } from '@kaida/contracts';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { downloadXls, fmt, fmtDate, loadDashboard, periodRange, type DashData, type DashFilters } from '@/lib/dashboard';
import Kpis from '@/components/dash/Kpis';
import LineChart from '@/components/dash/LineChart';
import Composition from '@/components/dash/Composition';
import SitesTable from '@/components/dash/SitesTable';
import CarriersTable from '@/components/dash/CarriersTable';
import MiniMap from '@/components/dash/MiniMap';
import SitePathDrawer from '@/components/dash/SitePathDrawer';
import ReportsPanel from '@/components/dash/ReportsPanel';

type Ref = { id: string; name_ru?: string; name?: string; city_id?: string };
type Tab = 'overview' | 'reports';

/** Дашборд акимата (ТЗ 11.1–11.2). Доступ — роль akimat (или admin); данные — RPC с проверкой роли и RLS. */
export default function Dashboard() {
  const { t } = useI18n();
  const { hasRole, loading: authLoading, session } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [f, setF] = useState<DashFilters>({ period: '7d' });
  const [data, setData] = useState<DashData | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [refs, setRefs] = useState<{ cities: Ref[]; districts: Ref[]; carriers: Ref[] }>({ cities: [], districts: [], carriers: [] });
  const allowed = hasRole('akimat');

  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === 'reports') setTab('reports');
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const sb = supabase();
    Promise.all([
      sb.from('cities').select('id,name_ru').order('name_ru'),
      sb.from('districts').select('id,name_ru,city_id').order('name_ru'),
      sb.from('carriers').select('id,name,city_id').order('name'),
    ]).then(([c, d, k]) => setRefs({ cities: (c.data as Ref[]) ?? [], districts: (d.data as Ref[]) ?? [], carriers: (k.data as Ref[]) ?? [] }));
  }, [allowed]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [d, r] = await Promise.all([
        loadDashboard(f),
        supabase().rpc('reports_list', { p_status: null, p_limit: 300, p_district_id: f.district_id ?? null }),
      ]);
      setData(d); setReports((r.data as Report[]) ?? []); setErr(null); setUpdatedAt(new Date());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [f]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  // Новое фото водителя, вывоз, партия или жалоба видны на дашборде в течение 5 с (ТЗ 11, критерий приёмки)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!allowed) return;
    const kick = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, 1500); };
    const ch = supabase().channel('dash-live');
    for (const table of ['pickups', 'batches', 'reports', 'trips']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, kick);
    ch.subscribe();
    return () => { supabase().removeChannel(ch); if (timer.current) clearTimeout(timer.current); };
  }, [allowed, load]);

  if (authLoading) return <p>{t('app.loading')}</p>;
  if (!session || !allowed) return <div className="card text-red-700">{t('dash.forbidden')}</div>;

  const districts = refs.districts.filter((d) => !f.city_id || d.city_id === f.city_id);
  const carriers = refs.carriers.filter((c) => !f.city_id || !c.city_id || c.city_id === f.city_id);
  const set = (p: Partial<DashFilters>) => setF((o) => ({ ...o, ...p }));
  const labels = data?.series.map((p) => (p.date ?? '').slice(8, 10) + '.' + (p.date ?? '').slice(5, 7)) ?? [];

  const exportXls = () => {
    if (!data) return;
    const c = data.summary.current as Record<string, number | null>;
    const { from, to } = periodRange(f);
    downloadXls(`kaida-dashboard-${to.slice(0, 10)}.xls`, [
      { title: `${t('dash.title')}: ${fmtDate(from)} — ${fmtDate(to)}`, head: [t('dash.metric'), t('dash.value')], rows: [
        [t('dash.kpi.collected') + ', ' + t('dash.t'), c.collected_t], [t('dash.claimed') + ', ' + t('dash.t'), c.claimed_recycled_t],
        [t('dash.real') + ', ' + t('dash.t'), c.real_recycled_t], [t('dash.realShare') + ', %', c.real_recycled_pct],
        [t('dash.energy') + ', ' + t('dash.t'), c.energy_t], [t('dash.landfill') + ', ' + t('dash.t'), c.landfill_t],
        [t('dash.kpi.cleanliness') + ', %', c.avg_cleanliness_pct], [t('dash.carrier.trips'), c.trips], [t('dash.kpi.mixedTrips'), c.mixed_trips],
        [t('dash.carrier.deviation'), c.deviation_trips], [t('dash.kpi.newReports'), c.new_reports],
      ] },
      { title: t('dash.series'), head: [t('dash.date'), t('dash.kpi.collected'), t('dash.realLine'), t('dash.kpi.cleanliness')],
        rows: data.series.map((p) => [p.date, p.collected_t, p.real_recycled_t, p.avg_cleanliness_pct ?? null]) },
      { title: t('dash.sites'), head: ['QR', t('dash.site.address'), t('dash.site.cleanliness_score'), t('dash.site.trend'), t('dash.site.reports'), t('dash.site.pickups'), t('dash.site.mixed_pickups')],
        rows: data.sites.map((s) => [s.qr_code, s.address, s.cleanliness_score, s.trend, s.reports, s.pickups, s.mixed_pickups]) },
      { title: t('dash.carriers'), head: [t('dash.carrier.name'), t('dash.carrier.trips'), t('dash.carrier.cleanPct'), t('dash.carrier.mixed'), t('dash.carrier.deviation'), t('dash.carrier.missed'), t('dash.carrier.reports')],
        rows: data.carriers.map((k) => [k.name, k.trips, k.clean_trips_pct, k.mixed_trips, k.deviation_trips, k.missed_routes, k.confirmed_mixed_reports]) },
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t('dash.title')}</h1>
        <nav className="no-print flex gap-2">
          {(['overview', 'reports'] as Tab[]).map((x) => (
            <button key={x} className={x === tab ? 'btn-primary py-1.5' : 'btn-ghost py-1.5'}
              onClick={() => { setTab(x); window.history.replaceState(null, '', '#' + x); }}>
              {t('dash.tab.' + x)}{x === 'reports' && reports.some((r) => r.status === 'new') ? ` · ${reports.filter((r) => r.status === 'new').length}` : ''}
            </button>
          ))}
        </nav>
        <div className="no-print ml-auto flex gap-2">
          <button className="btn-ghost py-1.5" onClick={exportXls} disabled={!data}>{t('dash.excel')}</button>
          <button className="btn-ghost py-1.5" onClick={() => window.print()}>{t('dash.pdf')}</button>
        </div>
      </div>

      {/* Фильтры на всех экранах: город, район, перевозчик, период */}
      <section className="card no-print flex flex-wrap items-end gap-3">
        <Sel label={t('dash.city')} value={f.city_id ?? ''} onChange={(v) => set({ city_id: v || undefined, district_id: undefined, carrier_id: undefined })}
          all={t('dash.allCities')} opts={refs.cities.map((c) => [c.id, c.name_ru ?? ''])} />
        <Sel label={t('dash.district')} value={f.district_id ?? ''} onChange={(v) => set({ district_id: v || undefined })}
          all={t('dash.allDistricts')} opts={districts.map((c) => [c.id, c.name_ru ?? ''])} />
        <Sel label={t('dash.carrier.name')} value={f.carrier_id ?? ''} onChange={(v) => set({ carrier_id: v || undefined })}
          all={t('dash.allCarriers')} opts={carriers.map((c) => [c.id, c.name ?? ''])} />
        <div>
          <div className="mb-1 text-xs text-slate-500">{t('dash.period')}</div>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
            {(['today', '7d', '30d', 'custom'] as const).map((p) => (
              <button key={p} onClick={() => set({ period: p })}
                className={`px-3 py-2 text-sm ${f.period === p ? 'bg-brand text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{t('dash.p.' + p)}</button>
            ))}
          </div>
        </div>
        {f.period === 'custom' && (
          <div className="flex items-end gap-2">
            <label className="text-xs text-slate-500">{t('dash.from')}<input type="date" className="input" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value })} /></label>
            <label className="text-xs text-slate-500">{t('dash.to')}<input type="date" className="input" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></label>
          </div>
        )}
        <div className="ml-auto text-right text-xs text-slate-500">
          <div className="flex items-center justify-end gap-1"><span className={`h-2 w-2 rounded-full ${busy ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} /> {t('dash.live')}</div>
          {updatedAt && <div>{t('dash.updated')}: {updatedAt.toLocaleTimeString('ru-RU')}</div>}
        </div>
      </section>
      <div className="hidden print:block text-sm">{t('dash.period')}: {fmtDate(periodRange(f).from)} — {fmtDate(periodRange(f).to)}</div>

      {err && <div className="card text-red-700">{err}</div>}

      {tab === 'reports' ? (
        <ReportsPanel districts={districts.map((d) => ({ id: d.id, name_ru: d.name_ru ?? '' }))} />
      ) : !data ? (
        <p>{t('app.loading')}</p>
      ) : (
        <>
          <Kpis s={data.summary} />
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <section className="card">
              <h2 className="mb-2 font-semibold">{t('dash.series')}</h2>
              <LineChart labels={labels} unit={t('dash.t')} series={[
                { key: 'c', label: t('dash.kpi.collected'), color: '#64748B', values: data.series.map((p) => Number(p.collected_t)) },
                { key: 'r', label: t('dash.realLine'), color: '#0F766E', values: data.series.map((p) => Number(p.real_recycled_t)) },
              ]} />
            </section>
            <section className="card">
              <h2 className="mb-3 font-semibold">{t('dash.composition')}</h2>
              <Composition items={((data.summary.current as Record<string, unknown>).composition as { output_type: string; category: string; kg: number }[]) ?? []}
                landfillDirectT={Number((data.summary.current as Record<string, unknown>).landfill_t ?? 0)} />
            </section>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <section className="card">
              <h2 className="mb-2 font-semibold">{t('dash.sites')} <span className="text-sm font-normal text-slate-500">· {t('dash.sitesHint')}</span></h2>
              <SitesTable rows={data.sites} onOpen={setSite} />
            </section>
            <div className="space-y-4">
              <section className="card">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-semibold">{t('dash.map')}</h2>
                  <a className="text-sm text-brand hover:underline" href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/map/`}>{t('dash.fullMap')} →</a>
                </div>
                <MiniMap sites={data.sites} reports={reports} onSite={setSite} />
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>🟢 ≥ 80</span><span>🟡 50–79</span><span>🔴 &lt; 50</span><span>⭕ {t('dash.openReports')}: {reports.filter((r) => r.status === 'new' || r.status === 'in_work').length}</span>
                </div>
              </section>
              <section className="card">
                <h2 className="mb-2 font-semibold">{t('dash.carriers')}</h2>
                <CarriersTable rows={data.carriers} />
              </section>
            </div>
          </div>
          <p className="text-xs text-slate-500">{t('dash.formula')} · {t('dash.trips')}: {fmt((data.summary.current as Record<string, number>).trips, 0)}</p>
        </>
      )}
      {site && <SitePathDrawer siteId={site} onClose={() => setSite(null)} />}
    </div>
  );
}

function Sel({ label, value, onChange, all, opts }: { label: string; value: string; onChange: (v: string) => void; all: string; opts: [string, string][] }) {
  return (
    <label className="text-xs text-slate-500">
      <div className="mb-1">{label}</div>
      <select className="input w-auto min-w-40 text-sm text-slate-900 dark:text-slate-100" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {opts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}

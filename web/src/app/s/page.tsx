'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { rpc, type Any } from '@/lib/rpc';
import { fmt, fmtDate } from '@/lib/dashboard';
import SitePathDrawer from '@/components/dash/SitePathDrawer';

/**
 * Публичная страница площадки по QR-наклейке (ТЗ 5.4): без входа — куда уехали отходы этого двора.
 * Наклейка ведёт на /s/<код>; GitHub Pages отдаёт 404.html, который перенаправляет сюда с ?q=<код>.
 */
export default function SitePage() {
  const { t } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [site, setSite] = useState<Any | null | undefined>(undefined);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q') ?? '';
    setCode(q);
    if (q) rpc<Any | null>('site_by_qr', { p_code: q }).then(setSite).catch(() => setSite(null));
    else setSite(null);
  }, []);

  if (site === undefined) return <p>{t('app.loading')}</p>;
  if (!site) return <div className="card">{t('res.siteNotFound')} {code && <code>{code}</code>}</div>;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card space-y-1">
        <div className="text-xs text-slate-500">{t('res.yourSite')}</div>
        <h1 className="text-2xl font-bold">{site.address}</h1>
        <div className="text-sm text-slate-600 dark:text-slate-300">
          {site.residential_complex && <>{site.residential_complex} · </>}
          {t('dash.site.cleanliness_score')}: <b>{fmt(site.cleanliness_score)}</b> · {t('res.lastPickup')}: {fmtDate(site.last_pickup_at)}
        </div>
        <div className="flex flex-wrap gap-1 pt-1">
          {(site.containers ?? []).map((c: Any) => <span key={c.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{t('waste.' + c.waste_type)}</span>)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link href="/scan/" className="btn-primary text-center">📷 {t('res.whereToThrow')}</Link>
        <Link href="/scan/#report" className="btn-ghost text-center">⚠ {t('res.tab.report')}</Link>
      </div>
      <SitePathDrawer siteId={site.id} onClose={() => {}} inline />
    </div>
  );
}

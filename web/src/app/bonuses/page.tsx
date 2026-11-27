'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { rpc, type Any } from '@/lib/rpc';
import { fmt, fmtDate } from '@/lib/dashboard';

/**
 * Бонусы жителя (ТЗ 12): баланс, личный QR для пункта приёма (меняется каждые 5 минут),
 * история начислений и списаний с причиной.
 */
export default function Bonuses() {
  const { t } = useI18n();
  const { session, loading } = useAuth();
  const [data, setData] = useState<{ balance: number; transactions: Any[] } | null>(null);
  const [qr, setQr] = useState<{ token: string; expires_at: string; img: string } | null>(null);
  const [err, setErr] = useState('');

  const loadQr = useCallback(async () => {
    try {
      const q = await rpc<{ token: string; expires_at: string }>('my_personal_qr');
      setQr({ ...q, img: await QRCode.toDataURL(q.token, { width: 320, margin: 1, errorCorrectionLevel: 'M' }) });
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    if (!session) return;
    rpc<{ balance: number; transactions: Any[] }>('me_bonuses', { p_limit: 100 }).then(setData).catch((e) => setErr(e.message));
    loadQr();
  }, [session, loadQr]);

  // новый код за 5 секунд до истечения старого
  useEffect(() => {
    if (!qr) return;
    const ms = Math.max(5_000, new Date(qr.expires_at).getTime() - Date.now() - 5_000);
    const id = setTimeout(loadQr, ms);
    return () => clearTimeout(id);
  }, [qr, loadQr]);

  if (loading) return <p>{t('app.loading')}</p>;
  if (!session) return <div className="card">{t('bon.needLogin')} <Link className="text-brand underline" href="/login/">{t('app.login')}</Link></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t('bon.title')}</h1>
      {err && <div className="card text-red-700">{err}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card flex flex-col justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">{t('bon.balance')}</div>
            <div className="text-4xl font-bold text-brand">{fmt(data?.balance ?? 0)}</div>
            <div className="text-sm text-slate-500">{t('bon.unit')}</div>
          </div>
          <Link href="/shop/" className="btn-primary text-center">{t('bon.toShop')}</Link>
        </section>
        <section className="card space-y-2 text-center">
          <div className="font-semibold">{t('bon.qr')}</div>
          {qr ? <img src={qr.img} alt={t('bon.qr')} className="mx-auto w-48 rounded-lg bg-white p-2" /> : <div className="mx-auto h-48 w-48 animate-pulse rounded-lg bg-slate-100" />}
          {qr && <div className="text-xs text-slate-500">{t('bon.qrUntil')} {new Date(qr.expires_at).toLocaleTimeString()} · <button className="underline" onClick={loadQr}>{t('bon.refresh')}</button></div>}
          <p className="text-xs text-slate-500">{t('bon.qrHint')}</p>
        </section>
      </div>

      <section className="card space-y-2">
        <h2 className="font-semibold">{t('bon.history')}</h2>
        {!data ? <p className="text-slate-500">{t('app.loading')}</p> : data.transactions.length === 0 ? (
          <p className="text-slate-500">{t('bon.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.transactions.map((x) => (
              <li key={x.id} className="flex items-start gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t('bon.src.' + x.source_type)}</div>
                  {x.description && <div className="text-xs text-slate-500">{x.description}</div>}
                  <div className="text-xs text-slate-400">{fmtDate(x.created_at)}</div>
                </div>
                <div className={`font-semibold tabular-nums ${Number(x.amount) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {Number(x.amount) > 0 ? '+' : ''}{fmt(Number(x.amount))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-1 text-sm">
        <h2 className="font-semibold">{t('bon.how')}</h2>
        <p>• {t('bon.rule1')}</p>
        <p>• {t('bon.rule2')}</p>
        <p>• {t('bon.rule3')}</p>
      </section>
    </div>
  );
}

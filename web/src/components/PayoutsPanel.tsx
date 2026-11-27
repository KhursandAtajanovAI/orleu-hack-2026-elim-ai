'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { rpc, type Any } from '@/lib/rpc';
import { fmt, fmtDate } from '@/lib/dashboard';

/** Понедельник прошлой недели (Астана, UTC+5) — неделя по умолчанию для пула дома */
function lastMonday(): string {
  const d = new Date(Date.now() + 5 * 3600_000);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow - 7);
  return d.toISOString().slice(0, 10);
}

/** Админка → «Выплаты бонусов» (ТЗ 12): недельный пул дома, проверка баланса, уведомления о необычных сдачах. */
export default function PayoutsPanel() {
  const { t } = useI18n();
  const [week, setWeek] = useState(lastMonday());
  const [res, setRes] = useState<Any | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<Any[]>([]);

  const reload = useCallback(() => {
    rpc<{ mismatches: number }>('bonus_balance_check').then((x) => setCheck(x.mismatches)).catch(() => setCheck(null));
    rpc<Any[]>('bonus_alerts', { p_limit: 30 }).then(setAlerts).catch(() => setAlerts([]));
  }, []);
  useEffect(reload, [reload]);

  const run = async () => {
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await rpc('site_pool_payout', { p_week_start: week })); reload(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <h2 className="font-semibold">{t('pay.pool')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('pay.poolHint')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">{t('pay.week')}<input type="date" className="input" value={week} onChange={(e) => setWeek(e.target.value)} /></label>
          <button className="btn-primary" disabled={busy} onClick={run}>{t('pay.run')}</button>
        </div>
        {err && <div className="text-sm text-red-700">{err}</div>}
        {res && (
          <div className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">
            {t('pay.result')}: <b>{fmt(Number(res.total))}</b> {t('bon.unit')} · {res.residents} {t('pay.residents')} · {res.sites} {t('mkt.sites')}
          </div>
        )}
      </section>
      <section className="card">
        <h2 className="font-semibold">{t('pay.check')}</h2>
        <p className={`text-sm ${check === 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {check === 0 ? `✓ ${t('pay.ok')}` : check == null ? '—' : `${t('pay.mismatch')}: ${check}`}
        </p>
      </section>
      <section className="card space-y-1">
        <h2 className="font-semibold">{t('pay.alerts')}</h2>
        {alerts.length === 0 ? <p className="text-sm text-slate-500">{t('pay.noAlerts')}</p> : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {alerts.map((a) => (
              <li key={a.id} className="py-1.5"><span className="text-xs text-slate-400">{fmtDate(a.created_at)}</span> · {a.user ?? '—'} · {a.message}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

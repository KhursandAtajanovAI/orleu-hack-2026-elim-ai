'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

interface Control { status: 'running' | 'paused' | 'stopped' | 'reset'; speed: number; command_id: number }

/**
 * Пульт симулятора (ТЗ 14): запуск, пауза, сброс и скорость ×1/×10/×60.
 * Пишет app_settings.simulator — симулятор (`simulator/src/live.ts`) читает её каждые 10 с.
 * Сам процесс симулятора идёт в GitHub Actions («Симулятор · реальное время») или из Codespaces.
 */
export default function SimulatorPanel() {
  const { t } = useI18n();
  const [ctl, setCtl] = useState<Control | null>(null);
  const [stats, setStats] = useState<{ active: number; sim: number; pos: string | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const { data } = await sb.from('app_settings').select('value').eq('key', 'simulator').maybeSingle();
    setCtl((data?.value as Control) ?? null);
    const [{ count: active }, { count: sim }, { data: last }] = await Promise.all([
      sb.from('trips').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('is_simulated', true),
      sb.from('trips').select('id', { count: 'exact', head: true }).eq('is_simulated', true),
      sb.from('vehicle_positions').select('recorded_at').order('recorded_at', { ascending: false }).limit(1),
    ]);
    setStats({ active: active ?? 0, sim: sim ?? 0, pos: last?.[0]?.recorded_at ?? null });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function send(patch: Partial<Control>) {
    const next = { ...(ctl ?? { status: 'stopped', speed: 10, command_id: 0 }), ...patch, command_id: (ctl?.command_id ?? 0) + 1 };
    const { error } = await supabase().from('app_settings').update({ value: next }).eq('key', 'simulator');
    setMsg(error ? error.message : t('admin.simSaved'));
    load();
  }

  async function purge() {
    if (!window.confirm(t('admin.simPurgeConfirm'))) return;
    const { data, error } = await supabase().rpc('sim_purge');
    setMsg(error ? error.message : `${t('admin.simPurged')}: ${JSON.stringify(data)}`);
    load();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('admin.simHint')}</p>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{t('admin.simStatus')}: <b>{ctl ? t('admin.simState.' + ctl.status) : '—'}</b></span>
          <span>{t('admin.simSpeed')}: <b>×{ctl?.speed ?? '—'}</b></span>
          {stats && <span>{t('admin.simActive')}: <b>{stats.active}</b> · {t('admin.simTrips')}: <b>{stats.sim}</b></span>}
          {stats?.pos && <span className="text-slate-500">{t('admin.simLastGps')}: {new Date(stats.pos).toLocaleString()}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => send({ status: 'running' })}>{t('admin.simRun')}</button>
          <button className="btn-ghost" onClick={() => send({ status: 'paused' })}>{t('admin.simPause')}</button>
          <button className="btn-ghost" onClick={() => send({ status: 'reset' })}>{t('admin.simReset')}</button>
          <button className="btn-ghost" onClick={() => send({ status: 'stopped' })}>{t('admin.simStop')}</button>
          <span className="mx-2 h-8 w-px bg-slate-200" />
          {[1, 10, 60].map((s) => (
            <button key={s} className={ctl?.speed === s ? 'btn-primary' : 'btn-ghost'} onClick={() => send({ speed: s })}>×{s}</button>
          ))}
        </div>
      </div>
      <div className="card space-y-2 text-sm">
        <div className="font-medium">{t('admin.simHowTitle')}</div>
        <ol className="list-decimal space-y-1 pl-5 text-slate-600">
          <li>{t('admin.simHow1')}</li>
          <li>{t('admin.simHow2')}</li>
          <li>{t('admin.simHow3')}</li>
        </ol>
        <button className="btn-ghost text-red-700" onClick={purge}>{t('admin.simPurge')}</button>
      </div>
      {msg && <div className="text-sm text-brand">{msg}</div>}
    </div>
  );
}

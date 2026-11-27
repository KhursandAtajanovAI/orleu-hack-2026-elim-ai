'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@kaida/contracts';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { api, DEMO_MODE, supabase } from '@/lib/supabase';

/** Вход: email (P0) + тестовый вход по роли без пароля при DEMO_MODE (ТЗ 2). SMS — P1. */
const DEMO_ROLES: Role[] = ['resident', 'driver', 'operator', 'akimat', 'admin'];

export default function Login() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [training, setTraining] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function afterLogin() {
    // согласия — отдельными галочками (ТЗ 1)
    const { data } = await supabase().auth.getUser();
    if (data.user) await supabase().from('profiles').update({ consent_data: consent, consent_training: training }).eq('user_id', data.user.id);
    await refresh();
    router.push('/');
  }

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) return setMsg(t('login.consentRequired'));
    setBusy(true);
    const { error } = password
      ? await supabase().auth.signInWithPassword({ email, password })
      : await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + (process.env.NEXT_PUBLIC_BASE_PATH ?? '') } });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (!password) return setMsg(t('login.magicSent'));
    await afterLogin();
  }

  async function demo(role: Role) {
    if (!consent) return setMsg(t('login.consentRequired'));
    setBusy(true);
    try {
      const s = await api.demoLogin(role);
      await supabase().auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      await afterLogin();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <form onSubmit={withPassword} className="card space-y-3">
        <h1 className="text-xl font-semibold">{t('login.title')}</h1>
        <input className="input" type="email" required placeholder={t('login.email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder={t('login.password')} value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{t('login.consentData')}</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={training} onChange={(e) => setTraining(e.target.checked)} />{t('login.consentTraining')}</label>
        <button className="btn-primary w-full" disabled={busy}>{password ? t('login.submit') : t('login.magic')}</button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </form>
      {DEMO_MODE && (
        <div className="card space-y-3">
          <h2 className="font-semibold">{t('login.demoTitle')}</h2>
          <p className="text-sm text-slate-500">{t('login.demoHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ROLES.map((r) => <button key={r} className="btn-ghost" disabled={busy} onClick={() => demo(r)}>{t('login.demoAs')} {t('roles.' + r)}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

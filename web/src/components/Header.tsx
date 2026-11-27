'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useI18n, type Lang } from '@/lib/i18n';

export default function Header() {
  const { t, lang, setLang } = useI18n();
  const { me, session, signOut } = useAuth();
  return (
    <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-brand">
          <span className="inline-block h-7 w-7 rounded-lg bg-brand" aria-hidden />
          {t('app.name')}
        </Link>
        <span className="hidden text-sm text-slate-500 sm:inline">{t('app.tagline')}</span>
        <div className="ml-auto flex items-center gap-2">
          <select aria-label={t('app.language')} className="input w-auto py-1" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="ru">RU</option>
            <option value="kk">ҚАЗ</option>
          </select>
          {session ? (
            <>
              <span className="hidden text-sm md:inline">{me?.full_name ?? me?.email} · {me?.roles?.map((r) => t('roles.' + r)).join(', ')}</span>
              <button className="btn-ghost py-1" onClick={signOut}>{t('app.logout')}</button>
            </>
          ) : (
            <Link href="/login/" className="btn-primary py-1">{t('app.login')}</Link>
          )}
        </div>
      </div>
    </header>
  );
}

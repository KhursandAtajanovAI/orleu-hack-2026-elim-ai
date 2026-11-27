'use client';
import Link from 'next/link';
import { useI18n } from '@/viz/lib/i18n';
import { useTheme } from '@/viz/lib/theme';

export function TopBar({ current }: { current: 'map' | 'workshop' | 'home' }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const item = (href: string, key: 'nav.map' | 'nav.workshop', active: boolean) => (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm font-medium ${
        active ? 'bg-brand/15 text-brand' : 'text-muted hover:text-ink'
      }`}
    >
      {t(key)}
    </Link>
  );
  return (
    <header className="glass pointer-events-auto flex items-center gap-1 rounded-2xl px-2 py-1.5 shadow-lg">
      <Link href="/" className="px-2 text-sm font-bold tracking-tight text-brand">
        {t('app.name')}
      </Link>
      {item('/map', 'nav.map', current === 'map')}
      {item('/workshop', 'nav.workshop', current === 'workshop')}
      <span className="mx-1 h-5 w-px bg-line" />
      <button
        aria-label={t(theme === 'dark' ? 'map.theme.light' : 'map.theme.dark')}
        title={t(theme === 'dark' ? 'map.theme.light' : 'map.theme.dark')}
        onClick={toggle}
        className="h-9 w-9 rounded-lg text-base hover:bg-brand/10"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button
        onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}
        className="h-9 rounded-lg px-2 text-xs font-semibold uppercase text-muted hover:bg-brand/10 hover:text-ink"
      >
        {lang === 'ru' ? 'қаз' : 'рус'}
      </button>
    </header>
  );
}

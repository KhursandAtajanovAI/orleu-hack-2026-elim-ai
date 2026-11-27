'use client';
import Link from 'next/link';
import { TopBar } from '@/components/ui/TopBar';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-6">
      <div className="flex justify-center">
        <TopBar current="home" />
      </div>
      <section className="flex flex-col gap-3 pt-10">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{t('home.title')}</h1>
        <p className="max-w-xl text-muted">{t('home.lead')}</p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/map" className="glass rounded-2xl p-5 text-lg font-semibold hover:border-brand">
          🗺 {t('nav.map')}
        </Link>
        <Link href="/workshop" className="glass rounded-2xl p-5 text-lg font-semibold hover:border-brand">
          🏭 {t('nav.workshop')}
        </Link>
      </div>
    </main>
  );
}

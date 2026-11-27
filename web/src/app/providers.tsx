'use client';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { AuthProvider } from '@/lib/auth';
import Header from '@/components/Header';

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/sw.js`).catch(() => {});
    }
  }, []);
  return (
    <I18nProvider>
      <AuthProvider>
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </AuthProvider>
    </I18nProvider>
  );
}

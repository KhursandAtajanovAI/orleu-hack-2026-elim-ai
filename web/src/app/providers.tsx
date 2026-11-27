'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { I18nProvider } from '@/lib/i18n';
import { AuthProvider } from '@/lib/auth';
import Header from '@/components/Header';

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/sw.js`).catch(() => {});
    }
  }, []);
  // 3D-карта и 3D-цех — на весь экран, со своей плавающей панелью навигации
  const path = usePathname() ?? '';
  const fullscreen = /\/(map|workshop)\/?$/.test(path);
  return (
    <I18nProvider>
      <AuthProvider>
        {fullscreen ? <div className="viz">{children}</div> : (<>
          <Header />
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </>)}
      </AuthProvider>
    </I18nProvider>
  );
}

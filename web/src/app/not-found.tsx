'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

/** 404 на GitHub Pages: ссылки с QR-наклеек /s/<код> перенаправляются на /s/?q=<код>. */
export default function NotFound() {
  const { t } = useI18n();
  const [redirecting, setRedirecting] = useState(true);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    const m = window.location.pathname.slice(base.length).match(/^\/s\/([^/?#]+)\/?$/);
    if (m) window.location.replace(`${base}/s/?q=${encodeURIComponent(decodeURIComponent(m[1]))}`);
    else setRedirecting(false);
  }, []);
  if (redirecting) return <p>{t('app.loading')}</p>;
  return <div className="card">404 · <Link className="text-brand underline" href="/">{t('app.name')}</Link></div>;
}

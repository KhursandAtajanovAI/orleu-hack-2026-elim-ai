import type { Metadata, Viewport } from 'next';
import Providers from './providers';
import './globals.css';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const metadata: Metadata = {
  title: 'Қайда?',
  description: 'Платформа отслеживания пути отходов',
  manifest: `${base}/manifest.webmanifest`,
  icons: { icon: `${base}/icon.svg`, apple: `${base}/icon.svg` },
  appleWebApp: { capable: true, title: 'Қайда?', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#0F766E', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}

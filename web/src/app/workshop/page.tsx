'use client';
import dynamic from 'next/dynamic';

const WorkshopView = dynamic(() => import('@/viz/workshop/WorkshopView'), {
  ssr: false,
  loading: () => <div className="grid h-[100dvh] place-items-center text-sm text-muted">…</div>,
});

export default function WorkshopPage() {
  return <WorkshopView />;
}

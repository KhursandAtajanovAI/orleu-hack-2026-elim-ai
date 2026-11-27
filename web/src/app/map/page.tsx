'use client';
import dynamic from 'next/dynamic';

// WebGL-карта — только на клиенте
const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
  loading: () => <div className="grid h-[100dvh] place-items-center text-sm text-muted">…</div>,
});

export default function MapPage() {
  return <MapView />;
}

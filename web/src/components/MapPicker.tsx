'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/** Карта OSM: клик ставит точку (добавление площадки «точкой на карте», ТЗ 11.3). */
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
const ASTANA: [number, number] = [71.4304, 51.1282];

export interface MapPoint { lon: number; lat: number; label?: string; color?: string }

export default function MapPicker({ value, onChange, points = [], height = 320 }: {
  value?: { lon: number; lat: number } | null;
  onChange?: (p: { lon: number; lat: number }) => void;
  points?: MapPoint[];
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const others = useRef<maplibregl.Marker[]>([]);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: STYLE, center: value ? [value.lon, value.lat] : ASTANA, zoom: value ? 15 : 11 });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    m.on('click', (e) => cb.current?.({ lon: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6) }));
    map.current = m;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (value) {
      if (!marker.current) marker.current = new maplibregl.Marker({ color: '#0F766E' }).setLngLat([value.lon, value.lat]).addTo(m);
      else marker.current.setLngLat([value.lon, value.lat]);
    }
  }, [value]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    others.current.forEach((x) => x.remove());
    others.current = points.map((p) => {
      const mk = new maplibregl.Marker({ color: p.color ?? '#64748B', scale: 0.7 }).setLngLat([p.lon, p.lat]);
      if (p.label) mk.setPopup(new maplibregl.Popup({ offset: 16 }).setText(p.label));
      return mk.addTo(m);
    });
  }, [points]);

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700" />;
}

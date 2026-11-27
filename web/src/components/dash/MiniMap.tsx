'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Report, SiteRating } from '@kaida/contracts';
import { cleanlinessColor } from '@kaida/contracts';
import { DOT } from './SitesTable';

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Мини-карта (ТЗ 11.1, P1): площадки по цвету чистоты + открытые жалобы; клик по площадке → путь. */
export default function MiniMap({ sites, reports, onSite, height = 320 }: {
  sites: SiteRating[]; reports: Report[]; onSite: (id: string) => void; height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const cb = useRef(onSite);
  cb.current = onSite;

  const sitesGeo = (): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: sites.filter((s) => s.location).map((s) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [s.location!.lon, s.location!.lat] },
      properties: { id: s.site_id, color: DOT[cleanlinessColor(s.cleanliness_score)], label: `${s.address} · ${s.cleanliness_score ?? '—'}` },
    })),
  });
  const reportsGeo = (): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: reports.filter((r) => r.location && (r.status === 'new' || r.status === 'in_work')).map((r) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [r.location!.lon, r.location!.lat] }, properties: { id: r.id, status: r.status },
    })),
  });

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: STYLE, center: [71.43, 51.128], zoom: 12, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('sites', { type: 'geojson', data: sitesGeo() });
      m.addSource('reports', { type: 'geojson', data: reportsGeo() });
      m.addLayer({ id: 'reports', type: 'circle', source: 'reports', paint: { 'circle-radius': 11, 'circle-color': '#DC2626', 'circle-opacity': 0.25, 'circle-stroke-color': '#DC2626', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'sites', type: 'circle', source: 'sites', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      fit(m);
    });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    m.on('mouseenter', 'sites', (e) => {
      m.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (f) popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(String(f.properties?.label)).addTo(m);
    });
    m.on('mouseleave', 'sites', () => { m.getCanvas().style.cursor = ''; popup.remove(); });
    m.on('click', 'sites', (e) => { const id = e.features?.[0]?.properties?.id; if (id) cb.current(String(id)); });
    map.current = m;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !m.isStyleLoaded()) return;
    (m.getSource('sites') as maplibregl.GeoJSONSource | undefined)?.setData(sitesGeo());
    (m.getSource('reports') as maplibregl.GeoJSONSource | undefined)?.setData(reportsGeo());
    fit(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, reports]);

  function fit(m: maplibregl.Map) {
    const pts = sites.filter((s) => s.location).map((s) => [s.location!.lon, s.location!.lat] as [number, number]);
    if (pts.length < 2) return;
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    m.fitBounds(b, { padding: 30, maxZoom: 15, duration: 0 });
  }

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-xl" />;
}

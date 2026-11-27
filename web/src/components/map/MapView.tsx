'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MapComplaint, MapFacility, MapObjects, MapSite, MapVehicle, SitePath } from '@/lib/contracts';
import { fetchMapObjects, fetchSitePath } from '@/lib/api';
import { createVehicleFeed } from '@/lib/vehicleFeed';
import { routeVia } from '@/lib/routing';
import { bearing, boundsOf, cumulative, haversine, lerpAngle, pointAt, type LonLat } from '@/lib/geo';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { CITY_CENTER, MAP_BBOX } from '@/mocks/astana';
import { USE_MOCKS } from '@/lib/vehicleFeed';
import { TopBar } from '@/components/ui/TopBar';
import {
  CLEAN_BAD,
  CLEAN_GOOD,
  CLEAN_MID,
  COMPLAINT_STATUS_COLOR,
  FACILITY_COLOR,
  FACILITY_HEIGHT,
  NEUTRAL_SITE,
  OUTCOME_COLOR,
  WASTE_COLOR,
  cleanColor,
  rgba,
} from './constants';
import { buildTruckMesh } from './truckMesh';
import { LayerPanel, ObjectCard, PathPanel, type LayerState, type Selection } from './Panels';

const STYLE_LIGHT = process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT || 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** Запасной стиль без сети: карта остаётся рабочей, пропадают только базовые тайлы. */
const blankStyle = (dark: boolean): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#0f172a' : '#e2e8f0' } }],
});

interface VState {
  from: LonLat;
  to: LonLat;
  start: number;
  dur: number;
  heading: number;
  lastAt: number;
}

interface Leg {
  coords: LonLat[];
  cum: number[];
  outcome: keyof typeof OUTCOME_COLOR;
  label: string;
  dest: LonLat;
}

interface PathAnim {
  main: LonLat[];
  mainCum: number[];
  legs: Leg[];
  bounds: [LonLat, LonLat];
}

const PATH_TOTAL_T = 2.5; // 0..1 основной рейс, 1..2 развоз по итогам, дальше — статика
const PATH_SECONDS = 18;

interface Live {
  data: MapObjects | null;
  layers: LayerState;
  theme: 'light' | 'dark';
  selected: Selection | null;
  mobile: boolean;
  zoom: number;
  path: PathAnim | null;
  pathT: number;
}

export default function MapView() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const vstate = useRef<Map<string, VState>>(new Map());
  const follow = useRef(false);
  const fallbackUsed = useRef(false);
  const meshRef = useRef(buildTruckMesh());

  const [data, setData] = useState<MapObjects | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineBase, setOfflineBase] = useState(false);
  const [layers, setLayers] = useState<LayerState>({
    sites: true, facilities: true, vehicles: true, complaints: true, cleanliness: true, heat: false,
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [mobile, setMobile] = useState(false);
  const [liveVeh, setLiveVeh] = useState<Record<string, MapVehicle>>({});
  const [pathSite, setPathSite] = useState<string | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathData, setPathData] = useState<SitePath | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const live = useRef<Live>({
    data: null, layers, theme: 'dark', selected: null, mobile: false, zoom: 12, path: null, pathT: 0,
  });
  live.current.data = data;
  live.current.layers = layers;
  live.current.theme = theme;
  live.current.selected = selected;
  live.current.mobile = mobile;

  // ---------- адаптивность ----------
  useEffect(() => {
    const f = () => setMobile(window.innerWidth < 768);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  // ---------- данные ----------
  useEffect(() => {
    let alive = true;
    fetchMapObjects(MAP_BBOX)
      .then((d) => {
        if (!alive) return;
        setData(d);
        const m: Record<string, MapVehicle> = {};
        d.vehicles.forEach((v) => (m[v.id] = v));
        setLiveVeh(m);
        const now = performance.now();
        d.vehicles.forEach((v) =>
          vstate.current.set(v.id, { from: [v.lon, v.lat], to: [v.lon, v.lat], start: now, dur: 1, heading: v.heading, lastAt: now }),
        );
      })
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);

  // ---------- realtime машины ----------
  useEffect(() => {
    const feed = createVehicleFeed();
    return feed.subscribe((p) => {
      const now = performance.now();
      const vs = vstate.current.get(p.vehicle_id);
      const to: LonLat = [p.lon, p.lat];
      if (!vs) {
        vstate.current.set(p.vehicle_id, { from: to, to, start: now, dur: 1, heading: 0, lastAt: now });
      } else {
        const cur = displayed(vs, now);
        const moved = haversine(cur, to) > 1;
        vs.heading = moved ? bearing(cur, to) : vs.heading;
        vs.from = cur;
        vs.to = to;
        vs.start = now;
        vs.dur = Math.min(15000, Math.max(800, now - vs.lastAt));
        vs.lastAt = now;
      }
      setLiveVeh((prev) => {
        const base = prev[p.vehicle_id];
        if (!base) return prev;
        return { ...prev, [p.vehicle_id]: { ...base, lon: p.lon, lat: p.lat, speed: p.speed, trip_id: p.trip_id, recorded_at: p.recorded_at } };
      });
    });
  }, []);

  // ---------- карта ----------
  useEffect(() => {
    if (!mapDiv.current) return;
    const dark = document.documentElement.dataset.theme !== 'light';
    const isMobile = window.innerWidth < 768;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: dark ? STYLE_DARK : STYLE_LIGHT,
      center: CITY_CENTER,
      zoom: isMobile ? 12.2 : 12.8,
      pitch: isMobile ? 35 : 55,
      bearing: -15,
      maxPitch: isMobile ? 45 : 60,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      onClick: (info) => {
        const id = info.layer?.id;
        const o = info.object as { id: string } | undefined;
        if (!id || !o) return;
        if (id === 'facilities') setSelected({ kind: 'facility', id: o.id });
        else if (id === 'sites-3d') setSelected({ kind: 'site', id: o.id });
        else if (id === 'vehicles' || id === 'vehicles-flat') setSelected({ kind: 'vehicle', id: o.id });
        else if (id === 'complaints') setSelected({ kind: 'complaint', id: o.id });
      },
      onHover: (info) => {
        map.getCanvas().style.cursor = info.object ? 'pointer' : '';
      },
    });
    map.addControl(overlay as unknown as maplibregl.IControl);
    overlayRef.current = overlay;

    const setupStyle = () => {
      const style = map.getStyle();
      const isDark = live.current.theme === 'dark';
      const vecSrc = Object.entries(style.sources ?? {}).find(([, s]) => (s as { type: string }).type === 'vector')?.[0];
      const firstSymbol = style.layers?.find((l) => l.type === 'symbol')?.id;
      const font =
        ((style.layers?.find((l) => l.type === 'symbol' && (l.layout as Record<string, unknown> | undefined)?.['text-font'])?.layout as Record<string, unknown> | undefined)?.['text-font'] as string[] | undefined) ??
        ['Noto Sans Regular'];

      if (vecSrc && !map.getLayer('buildings-3d')) {
        map.addLayer(
          {
            id: 'buildings-3d',
            type: 'fill-extrusion',
            source: vecSrc,
            'source-layer': 'building',
            minzoom: live.current.mobile ? 14.5 : 13,
            filter: ['!=', ['get', 'hide_3d'], true],
            paint: {
              'fill-extrusion-color': isDark ? '#334155' : '#cbd5e1',
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 9],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
              'fill-extrusion-opacity': 0.9,
              'fill-extrusion-vertical-gradient': true,
            },
          },
          firstSymbol,
        );
      }

      if (!map.getSource('sites')) {
        map.addSource('sites', {
          type: 'geojson',
          data: sitesGeoJSON(live.current.data),
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 48,
          clusterProperties: { minScore: ['min', ['get', 'score']] },
        });
      }
      const vis = live.current.layers.sites ? 'visible' : 'none';
      if (!map.getLayer('sites-clusters')) {
        map.addLayer({
          id: 'sites-clusters',
          type: 'circle',
          source: 'sites',
          filter: ['has', 'point_count'],
          layout: { visibility: vis },
          paint: {
            'circle-color': ['step', ['get', 'minScore'], CLEAN_BAD, 50, CLEAN_MID, 80, CLEAN_GOOD],
            'circle-radius': ['step', ['get', 'point_count'], 16, 5, 20, 12, 26],
            'circle-opacity': 0.85,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-pitch-alignment': 'viewport',
          },
        });
        map.addLayer({
          id: 'sites-cluster-count',
          type: 'symbol',
          source: 'sites',
          filter: ['has', 'point_count'],
          layout: { visibility: vis, 'text-field': ['get', 'point_count_abbreviated'], 'text-font': font, 'text-size': 13, 'text-allow-overlap': true },
          paint: { 'text-color': '#0b1220' },
        });
        map.addLayer({
          id: 'sites-point',
          type: 'circle',
          source: 'sites',
          filter: ['!', ['has', 'point_count']],
          layout: { visibility: vis },
          paint: {
            'circle-color': cleanExpr(live.current.layers.cleanliness) as never,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 9],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
            'circle-pitch-alignment': 'map',
          },
        });
      }
    };

    map.on('style.load', setupStyle);
    map.on('load', () => setMapReady(true));

    // нет сети до тайлов → пустая подложка, чтобы 3D-слои всё равно работали
    map.on('error', (e) => {
      const msg = String((e as { error?: Error }).error?.message ?? '');
      if (!fallbackUsed.current && !map.isStyleLoaded() && /Failed to fetch|NetworkError|style|403|404|Load failed/i.test(msg)) {
        fallbackUsed.current = true;
        setOfflineBase(true);
        map.setStyle(blankStyle(live.current.theme === 'dark'));
      }
    });

    const onZoom = () => (live.current.zoom = map.getZoom());
    map.on('zoom', onZoom);

    const stopFollow = () => (follow.current = false);
    map.on('dragstart', stopFollow);
    map.on('wheel', stopFollow);
    map.on('touchstart', stopFollow);

    const clickSite = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f?.properties?.id) setSelected({ kind: 'site', id: f.properties.id });
    };
    const clickCluster = async (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const src = map.getSource('sites') as maplibregl.GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties!.cluster_id);
      map.easeTo({ center: (f.geometry as unknown as { coordinates: LonLat }).coordinates, zoom: zoom + 0.3 });
    };
    map.on('click', 'sites-point', clickSite);
    map.on('click', 'sites-clusters', clickCluster);
    for (const l of ['sites-point', 'sites-clusters']) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
    }

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // ---------- смена темы карты ----------
  const firstTheme = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstTheme.current) {
      firstTheme.current = false;
      // стартовая тема могла отличаться от дефолтной: подгоняем стиль
      const want = theme === 'dark' ? STYLE_DARK : STYLE_LIGHT;
      const initialDark = document.documentElement.dataset.theme !== 'light';
      if ((theme === 'dark') !== initialDark) map.setStyle(want);
      return;
    }
    map.setStyle(fallbackUsed.current ? blankStyle(theme === 'dark') : theme === 'dark' ? STYLE_DARK : STYLE_LIGHT);
  }, [theme]);

  // ---------- данные → источники карты ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !mapReady) return;
    const src = map.getSource('sites') as maplibregl.GeoJSONSource | undefined;
    src?.setData(sitesGeoJSON(data));
  }, [data, mapReady]);

  // ---------- переключатели слоёв ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const vis = layers.sites ? 'visible' : 'none';
    for (const id of ['sites-clusters', 'sites-cluster-count', 'sites-point']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    }
    if (map.getLayer('sites-point')) map.setPaintProperty('sites-point', 'circle-color', cleanExpr(layers.cleanliness) as never);
  }, [layers, mapReady, theme]);

  // ---------- главный цикл отрисовки deck.gl ----------
  const truckMesh = meshRef.current;
  const resetPathClock = useRef<() => void>(() => {});
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let pathStart = 0;
    let smoothHeading = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < 33) return; // ~30 fps
      last = ts;
      const L = live.current;
      const overlay = overlayRef.current;
      const map = mapRef.current;
      if (!overlay || !map) return;

      // анимация режима «Путь»
      if (L.path) {
        if (!pathStart) pathStart = ts;
        const k = Math.min(1, (ts - pathStart) / (PATH_SECONDS * 1000));
        L.pathT = k * PATH_TOTAL_T;
        if (follow.current && L.pathT <= 1) {
          const total = L.path.mainCum[L.path.mainCum.length - 1];
          const p = pointAt(L.path.main, L.path.mainCum, L.pathT * total);
          const ahead = pointAt(L.path.main, L.path.mainCum, Math.min(total, L.pathT * total + 250));
          smoothHeading = lerpAngle(smoothHeading, bearing(p.lonlat, ahead.lonlat), 0.05);
          map.jumpTo({ center: p.lonlat, bearing: smoothHeading, pitch: 58, zoom: 16.2 });
        } else if (follow.current && L.pathT > 1) {
          follow.current = false;
          map.fitBounds(L.path.bounds, { padding: { top: 90, bottom: 90, left: 80, right: 400 }, pitch: 45, bearing: 0, duration: 2600, maxZoom: 14.5 });
        }
      } else {
        pathStart = 0;
      }
      overlay.setProps({ layers: buildLayers(L, truckMesh, vstate.current, performance.now(), ts) });
    };
    resetPathClock.current = () => {
      pathStart = 0;
      smoothHeading = mapRef.current?.getBearing() ?? 0;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [truckMesh]);

  // ---------- выбор объекта ----------
  const selSite = selected?.kind === 'site' ? data?.sites.find((s) => s.id === selected.id) : undefined;
  const selFac = selected?.kind === 'facility' ? data?.facilities.find((f) => f.id === selected.id) : undefined;
  const selVeh = selected?.kind === 'vehicle' ? liveVeh[selected.id] : undefined;
  const selCmp = selected?.kind === 'complaint' ? data?.complaints.find((c) => c.id === selected.id) : undefined;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected || pathSite) return;
    const p =
      selSite ? ([selSite.lon, selSite.lat] as LonLat)
      : selFac ? ([selFac.lon, selFac.lat] as LonLat)
      : selCmp ? ([selCmp.lon, selCmp.lat] as LonLat)
      : null;
    if (p) map.easeTo({ center: p, zoom: Math.max(map.getZoom(), 15.2), duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ---------- режим «Путь» ----------
  const startPath = useCallback(
    async (site: MapSite) => {
      const map = mapRef.current;
      setPathSite(site.id);
      setSelected(null);
      setPathLoading(true);
      setPathData(null);
      live.current.path = null;
      try {
        const sp = await fetchSitePath(site);
        setPathData(sp);
        const trip = sp.trips[0];
        if (!trip) return;
        // ноги «объект → итог»: группируем по назначению
        const sortPt: LonLat = [trip.destination.lon, trip.destination.lat];
        const groups = new Map<string, { out: (typeof trip.outputs)[number]; kg: number }>();
        for (const o of trip.outputs) {
          const g = groups.get(o.destination.id);
          if (g) g.kg += o.weight_kg;
          else groups.set(o.destination.id, { out: o, kg: o.weight_kg });
        }
        const legs: Leg[] = await Promise.all(
          [...groups.values()].map(async ({ out, kg }) => {
            const dest: LonLat = [out.destination.lon, out.destination.lat];
            const r = await routeVia([sortPt, dest]);
            return { coords: r.coords, cum: cumulative(r.coords), outcome: out.outcome, label: `${out.destination.name} · ${kg} ${t('common.kg')}`, dest };
          }),
        );
        const main = trip.track as LonLat[];
        const anim: PathAnim = {
          main,
          mainCum: cumulative(main),
          legs,
          bounds: boundsOf([...main, ...legs.flatMap((l) => l.coords)]),
        };
        live.current.path = anim;
        follow.current = true;
        resetPathClock.current();
        if (map) map.easeTo({ center: main[0], zoom: 16.2, pitch: 58, duration: 1200 });
        history.replaceState(null, '', `/map?path=${site.id}`);
      } catch (e) {
        setError(String((e as Error).message));
      } finally {
        setPathLoading(false);
      }
    },
    [t],
  );

  const exitPath = useCallback(() => {
    live.current.path = null;
    follow.current = false;
    setPathSite(null);
    setPathData(null);
    history.replaceState(null, '', '/map');
    mapRef.current?.easeTo({ center: CITY_CENTER, zoom: live.current.mobile ? 12.2 : 12.8, pitch: live.current.mobile ? 35 : 55, bearing: -15, duration: 1600 });
  }, []);

  const replay = useCallback(() => {
    const L = live.current;
    if (!L.path) return;
    follow.current = true;
    resetPathClock.current();
    mapRef.current?.easeTo({ center: L.path.main[0], zoom: 16.2, pitch: 58, duration: 900 });
  }, []);

  // ссылки ?path=ID / ?site=ID / ?facility=ID
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!data || !mapReady || deepLinked.current) return;
    deepLinked.current = true;
    const q = new URLSearchParams(window.location.search);
    const p = q.get('path');
    const s = q.get('site');
    const f = q.get('facility');
    if (p) {
      const site = data.sites.find((x) => x.id === p || x.qr_code === p);
      if (site) startPath(site);
    } else if (s) setSelected({ kind: 'site', id: s });
    else if (f) setSelected({ kind: 'facility', id: f });
  }, [data, mapReady, startPath]);

  const toggle = (k: keyof LayerState) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const cardOpen = !pathSite && (selSite || selFac || selVeh || selCmp);
  const resetView = () => mapRef.current?.easeTo({ bearing: 0, pitch: mobile ? 35 : 55, duration: 600 });

  const banner = useMemo(() => {
    const parts: string[] = [];
    if (USE_MOCKS) parts.push(t('map.demo_data'));
    return parts.join(' · ');
  }, [t]);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden">
      <div ref={mapDiv} style={{ position: 'absolute', inset: 0 }} />

      {!mapReady && !error && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">{t('map.loading')}</div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <TopBar current="map" />
          <div className="hidden flex-col items-end gap-2 sm:flex">
            {banner && (
              <span className="glass pointer-events-auto rounded-full px-3 py-1 text-[11px] text-muted">{banner}</span>
            )}
            <span className="glass pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {t('map.live')}
            </span>
          </div>
        </div>
        <div className="w-fit">
          <LayerPanel layers={layers} onToggle={toggle} open={layersOpen} setOpen={setLayersOpen} />
        </div>
        {mobile && (
          <div className="glass pointer-events-auto w-fit max-w-[260px] rounded-xl px-3 py-1.5 text-[11px] text-muted">
            {t('map.mobile_hint')}
          </div>
        )}
        {(error || offlineBase) && (
          <div className="glass pointer-events-auto w-fit rounded-xl px-3 py-1.5 text-xs text-amber-500">
            {error ? `${t('map.error')}: ${error}` : 'Подложка недоступна (нет сети) — показаны только слои платформы'}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-stretch gap-2 p-3 sm:bottom-3 sm:left-3 sm:right-auto sm:items-start sm:p-0">
        {cardOpen && (
          <ObjectCard
            site={selSite}
            facility={selFac}
            vehicle={selVeh}
            complaint={selCmp as MapComplaint | undefined}
            onClose={() => setSelected(null)}
            onPath={startPath}
            onWorkshop={(f: MapFacility) => router.push(`/workshop?facility=${f.id}`)}
          />
        )}
      </div>

      {pathSite && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3 sm:inset-x-auto sm:right-3 sm:top-20 sm:bottom-auto sm:p-0">
          <PathPanel
            loading={pathLoading}
            data={pathData}
            onExit={exitPath}
            onReplay={replay}
            onWorkshop={(fid) => router.push(`/workshop?facility=${fid}&from=${pathSite}`)}
          />
        </div>
      )}

      <button
        onClick={resetView}
        title={t('map.reset_north')}
        aria-label={t('map.reset_north')}
        className="glass absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 rounded-xl text-sm sm:block"
      >
        ⌖
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function displayed(v: VState, now: number): LonLat {
  const f = Math.min(1, Math.max(0, (now - v.start) / Math.max(1, v.dur)));
  return [v.from[0] + (v.to[0] - v.from[0]) * f, v.from[1] + (v.to[1] - v.from[1]) * f];
}

function cleanExpr(byScore: boolean) {
  return byScore
    ? ['step', ['get', 'score'], CLEAN_BAD, 50, CLEAN_MID, 80, CLEAN_GOOD]
    : NEUTRAL_SITE;
}

function sitesGeoJSON(d: MapObjects | null) {
  return {
    type: 'FeatureCollection' as const,
    features: (d?.sites ?? []).map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      properties: { id: s.id, score: s.cleanliness_score },
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLayer = any;

function buildLayers(L: Live, truckMesh: ReturnType<typeof buildTruckMesh>, vs: Map<string, VState>, now: number, ts: number): AnyLayer[] {
  const out: AnyLayer[] = [];
  const d = L.data;
  if (!d) return out;
  const dark = L.theme === 'dark';
  const textColor: [number, number, number, number] = dark ? [226, 232, 240, 255] : [15, 23, 42, 255];
  const bg: [number, number, number, number] = dark ? [15, 23, 42, 220] : [255, 255, 255, 230];
  const pathMode = !!L.path;
  const sel = L.selected;

  if (L.layers.heat) {
    out.push(
      new HeatmapLayer({
        id: 'heat',
        data: d.sites,
        getPosition: (s: MapSite) => [s.lon, s.lat],
        getWeight: (s: MapSite) => Math.max(0, 100 - s.cleanliness_score),
        radiusPixels: 70,
        intensity: 1.4,
        threshold: 0.05,
        colorRange: [[34, 197, 94, 0], [234, 179, 8, 120], [249, 115, 22, 170], [239, 68, 68, 210], [185, 28, 28, 240]],
      }),
    );
  }

  if (L.layers.sites && !L.mobile && L.zoom > 14) {
    out.push(
      new ColumnLayer({
        id: 'sites-3d',
        data: d.sites,
        pickable: true,
        extruded: true,
        diskResolution: 6,
        radius: 7,
        getPosition: (s: MapSite) => [s.lon, s.lat],
        getElevation: (s: MapSite) => 12 + s.containers.length * 6,
        getFillColor: (s: MapSite) => rgba(L.layers.cleanliness ? cleanColor(s.cleanliness_score) : NEUTRAL_SITE, 240),
        updateTriggers: { getFillColor: [L.layers.cleanliness] },
      }),
    );
  }

  if (L.layers.facilities) {
    out.push(
      new ColumnLayer({
        id: 'facilities',
        data: d.facilities,
        pickable: true,
        extruded: true,
        diskResolution: 6,
        radius: Math.min(420, (L.mobile ? 70 : 55) * Math.max(1, Math.pow(2, 14.5 - L.zoom))),
        getPosition: (f: MapFacility) => [f.lon, f.lat],
        getElevation: (f: MapFacility) => FACILITY_HEIGHT[f.type] * Math.min(4, Math.max(1, Math.pow(2, 14.5 - L.zoom))),
        getFillColor: (f: MapFacility) => rgba(FACILITY_COLOR[f.type], f.id === (sel as { id?: string } | null)?.id ? 255 : 225),
        updateTriggers: { getFillColor: [sel], getElevation: [Math.round(L.zoom * 4)] },
        material: { ambient: 0.5, diffuse: 0.7, shininess: 20 },
      }),
      new TextLayer({
        id: 'facility-labels',
        data: d.facilities,
        getPosition: (f: MapFacility) => [f.lon, f.lat, FACILITY_HEIGHT[f.type] * Math.min(4, Math.max(1, Math.pow(2, 14.5 - L.zoom))) + 25],
        updateTriggers: { getPosition: [Math.round(L.zoom * 4)] },
        getText: (f: MapFacility) => f.name,
        getSize: 12,
        getColor: textColor,
        background: true,
        getBackgroundColor: bg,
        backgroundPadding: [5, 3],
        getPixelOffset: [0, -6],
        characterSet: 'auto',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 600,
        billboard: true,
        sizeUnits: 'pixels',
        maxWidth: 240,
        wordBreak: 'break-word',
        parameters: { depthCompare: 'always' },
        visible: L.zoom > 11.5,
      }),
    );
  }

  if (L.layers.complaints) {
    out.push(
      new ScatterplotLayer({
        id: 'complaints',
        data: d.complaints,
        pickable: true,
        getPosition: (c: MapComplaint) => [c.lon, c.lat, 30],
        getFillColor: (c: MapComplaint) => rgba(COMPLAINT_STATUS_COLOR[c.status]),
        getLineColor: [255, 255, 255, 255],
        stroked: true,
        lineWidthMinPixels: 2,
        radiusUnits: 'meters',
        getRadius: 14,
        radiusMinPixels: 7,
        radiusMaxPixels: 16,
        parameters: { depthCompare: 'always' },
      }),
    );
  }

  if (L.layers.vehicles) {
    const veh = Object.values(d.vehicles).map((v) => {
      const s = vs.get(v.id);
      const pos = s ? displayed(s, now) : ([v.lon, v.lat] as LonLat);
      return { id: v.id, pos, heading: s?.heading ?? 0, color: WASTE_COLOR[v.waste_type] };
    });
    if (L.mobile) {
      out.push(
        new ScatterplotLayer({
          id: 'vehicles-flat',
          data: veh,
          pickable: true,
          getPosition: (v: (typeof veh)[number]) => [v.pos[0], v.pos[1], 4],
          getFillColor: (v: (typeof veh)[number]) => rgba(v.color),
          getLineColor: [255, 255, 255, 255],
          stroked: true,
          lineWidthMinPixels: 2,
          radiusUnits: 'pixels',
          getRadius: 8,
          updateTriggers: { getPosition: ts },
        }),
      );
    } else {
      const scale = Math.min(14, Math.max(1.2, 3.5 * Math.pow(2, 16 - L.zoom)));
      out.push(
        new SimpleMeshLayer({
          id: 'vehicles',
          data: veh,
          mesh: truckMesh as AnyLayer,
          pickable: true,
          sizeScale: scale,
          getPosition: (v: (typeof veh)[number]) => [v.pos[0], v.pos[1], 0],
          getColor: (v: (typeof veh)[number]) => rgba(v.color),
          getOrientation: (v: (typeof veh)[number]) => [0, -v.heading, 90],
          updateTriggers: { getPosition: ts, getOrientation: ts },
          material: { ambient: 0.6, diffuse: 0.8, shininess: 30 },
        }),
      );
    }
  }

  // ---------- режим «Путь» ----------
  if (pathMode && L.path) {
    const P = L.path;
    const mainTotal = P.mainCum[P.mainCum.length - 1] || 1;
    out.push(
      new PathLayer({
        id: 'path-main-base',
        data: [{ p: P.main }],
        getPath: (x: { p: LonLat[] }) => x.p,
        getColor: [56, 189, 248, 90],
        getWidth: 5,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        parameters: { depthCompare: 'always' },
      }),
      new PathLayer({
        id: 'path-legs-base',
        data: P.legs,
        getPath: (l: Leg) => l.coords,
        getColor: (l: Leg) => rgba(OUTCOME_COLOR[l.outcome], 110),
        getWidth: 4,
        widthUnits: 'pixels',
        capRounded: true,
        parameters: { depthCompare: 'always' },
      }),
      new TripsLayer({
        id: 'path-main-anim',
        data: [{ p: P.main, ts: P.mainCum.map((c) => c / mainTotal) }],
        getPath: (x: { p: LonLat[] }) => x.p,
        getTimestamps: (x: { ts: number[] }) => x.ts,
        getColor: [56, 189, 248, 255],
        widthMinPixels: 7,
        capRounded: true,
        jointRounded: true,
        trailLength: 0.28,
        currentTime: L.pathT,
        fadeTrail: true,
        parameters: { depthCompare: 'always' },
      }),
      new TripsLayer({
        id: 'path-legs-anim',
        data: P.legs,
        getPath: (l: Leg) => l.coords,
        getTimestamps: (l: Leg) => l.cum.map((c) => 1 + c / (l.cum[l.cum.length - 1] || 1)),
        getColor: (l: Leg) => rgba(OUTCOME_COLOR[l.outcome]),
        widthMinPixels: 6,
        capRounded: true,
        trailLength: 0.3,
        currentTime: L.pathT,
        fadeTrail: true,
        parameters: { depthCompare: 'always' },
      }),
      new ScatterplotLayer({
        id: 'path-ends',
        data: [
          { p: P.main[0], c: [34, 197, 94], label: '' },
          ...P.legs.map((l) => ({ p: l.dest, c: hex3(OUTCOME_COLOR[l.outcome]), label: l.label })),
        ],
        getPosition: (x: { p: LonLat }) => [x.p[0], x.p[1], 20],
        getFillColor: (x: { c: number[] }) => [x.c[0], x.c[1], x.c[2], 255] as [number, number, number, number],
        getLineColor: [255, 255, 255, 255],
        stroked: true,
        lineWidthMinPixels: 2,
        radiusUnits: 'pixels',
        getRadius: 9,
        parameters: { depthCompare: 'always' },
      }),
      new TextLayer({
        id: 'path-labels',
        data: P.legs,
        getPosition: (l: Leg) => [l.dest[0], l.dest[1], 30],
        getText: (l: Leg) => l.label,
        getSize: 12,
        getColor: textColor,
        background: true,
        getBackgroundColor: bg,
        backgroundPadding: [5, 3],
        getPixelOffset: [0, -20],
        characterSet: 'auto',
        fontWeight: 600,
        maxWidth: 220,
        wordBreak: 'break-word',
        parameters: { depthCompare: 'always' },
      }),
    );
  }
  return out;
}

function hex3(hex: string): number[] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

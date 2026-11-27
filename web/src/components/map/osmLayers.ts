import type maplibregl from 'maplibre-gl';
import type { OsmLoader } from '@/lib/osm/loader';

const PAL = {
  light: {
    res: '#8fa9c7', public: '#e0a460', commerce: '#a994d6', industry: '#a39a8f', culture: '#e8d9a8', other: '#b6c0cc',
    roadCasing: '#94a3b8', roadMajor: '#ffffff', roadMinor: '#f8fafc',
    area: { residential: '#dbe4ef', commercial: '#e9dff3', industrial: '#e7ddd0', landfill: '#b8ada0', waste: '#f6c9a8', green: '#cfe8c9', water: '#b9dcf2', other: '#e5e7eb' },
  },
  dark: {
    res: '#5c7696', public: '#b98443', commerce: '#7a68a8', industry: '#7a7268', culture: '#b9a96f', other: '#56657a',
    roadCasing: '#050b17', roadMajor: '#6b7a90', roadMinor: '#475569',
    area: { residential: '#1f2a3d', commercial: '#2a2540', industrial: '#352f29', landfill: '#4a423a', waste: '#5a3a22', green: '#1f3a2a', water: '#16324d', other: '#243044' },
  },
};

const OSM_LAYERS = ['osm-areas', 'osm-roads-casing', 'osm-roads-minor', 'osm-roads-major', 'osm-buildings', 'osm-points'];

type Expr = unknown[];
const matchBy = (prop: string, map: Record<string, string>, fallback: string): Expr =>
  ['match', ['get', prop], ...Object.entries(map).flat(), fallback];

export function addOsmLayers(map: maplibregl.Map, dark: boolean, before: string | undefined, loader: OsmLoader, visible: boolean) {
  const p = dark ? PAL.dark : PAL.light;
  const vis = visible ? 'visible' : 'none';
  const empty = { type: 'FeatureCollection' as const, features: [] };
  (['areas', 'roads', 'buildings', 'points'] as const).forEach((k) => {
    if (!map.getSource(`osm-${k}`)) map.addSource(`osm-${k}`, { type: 'geojson', data: (loader.collection(k) as never) ?? empty });
  });
  const L = (layer: Record<string, unknown>) => {
    if (!map.getLayer(layer.id as string)) map.addLayer({ ...layer, layout: { ...(layer.layout as object), visibility: vis } } as never, before);
  };
  L({
    id: 'osm-areas', type: 'fill', source: 'osm-areas', minzoom: 11,
    paint: { 'fill-color': matchBy('kind', p.area, p.area.other) as never, 'fill-opacity': 0.85 },
  });
  const roadW = (a: number, b: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 12, a, 18, b] as never;
  L({
    id: 'osm-roads-casing', type: 'line', source: 'osm-roads', minzoom: 12,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': p.roadCasing, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, ['match', ['get', 'cls'], 'major', 3.5, 0], 14, ['match', ['get', 'cls'], 'major', 6, 2.5], 18, ['match', ['get', 'cls'], 'major', 30, 14]] as never },
  });
  L({
    id: 'osm-roads-minor', type: 'line', source: 'osm-roads', minzoom: 13.5, filter: ['==', ['get', 'cls'], 'minor'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': p.roadMinor, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13.5, 0.8, 18, 11] as never },
  });
  L({
    id: 'osm-roads-major', type: 'line', source: 'osm-roads', minzoom: 12, filter: ['==', ['get', 'cls'], 'major'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': p.roadMajor, 'line-width': roadW(2, 24) },
  });
  L({
    id: 'osm-buildings', type: 'fill-extrusion', source: 'osm-buildings', minzoom: 13,
    paint: {
      'fill-extrusion-color': matchBy('cat', { res: p.res, public: p.public, commerce: p.commerce, industry: p.industry, culture: p.culture }, p.other) as never,
      'fill-extrusion-height': ['get', 'h'] as never,
      'fill-extrusion-base': ['get', 'base'] as never,
      'fill-extrusion-opacity': 0.94,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  L({
    id: 'osm-points', type: 'circle', source: 'osm-points', minzoom: 12,
    paint: { 'circle-color': '#f97316', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 9] as never, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-pitch-alignment': 'map' },
  });
}

export function refreshOsmSources(map: maplibregl.Map, loader: OsmLoader) {
  (['areas', 'roads', 'buildings', 'points'] as const).forEach((k) => {
    (map.getSource(`osm-${k}`) as maplibregl.GeoJSONSource | undefined)?.setData(loader.collection(k) as never);
  });
}

export function setOsmVisible(map: maplibregl.Map, on: boolean) {
  OSM_LAYERS.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
}

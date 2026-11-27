/**
 * Контракты данных для 3D-карты и 3D-цеха (ТЗ §3, §4, §7).
 * Это «мок-first» слой: фронт работает на src/mocks, а когда бэкенд (поток A)
 * зафиксирует OpenAPI — достаточно сверить имена полей здесь.
 * Координаты везде [lon, lat] (WGS84).
 */

export type WasteType = 'mixed' | 'plastic' | 'paper' | 'glass' | 'metal' | 'organic';
export type FacilityType =
  | 'sorting'
  | 'recycling'
  | 'landfill'
  | 'collection_point'
  | 'composting'
  | 'energy';
export type ComplaintType = 'mixed' | 'overflow' | 'dump' | 'other';
export type ComplaintStatus = 'new' | 'in_work' | 'confirmed' | 'rejected';
export type OutputType =
  | 'PET'
  | 'HDPE'
  | 'film'
  | 'paper'
  | 'cardboard'
  | 'glass'
  | 'metal'
  | 'organic'
  | 'RDF'
  | 'landfill';

export interface MapContainer {
  id: string;
  waste_type: WasteType;
  volume_l: number;
  fill_level: number;
}

export interface MapSite {
  id: string;
  address: string;
  complex?: string;
  district_id: string;
  lon: number;
  lat: number;
  qr_code: string;
  cleanliness_score: number; // 0..100
  last_pickup_at?: string;
  week_kg: number; // вторсырьё, пришедшее с площадки за неделю
  containers: MapContainer[];
}

export interface MapFacility {
  id: string;
  type: FacilityType;
  name: string;
  lon: number;
  lat: number;
  accepts: WasteType[];
  capacity_tpd: number;
  week_tons: number;
  model_3d_url?: string | null;
}

export interface MapVehicle {
  id: string;
  plate: string;
  carrier: string;
  type: string;
  waste_type: WasteType; // тип отходов активного рейса — задаёт цвет
  trip_id: string;
  lon: number;
  lat: number;
  heading: number;
  speed: number; // км/ч
  recorded_at: string;
}

export interface MapComplaint {
  id: string;
  site_id: string;
  type: ComplaintType;
  status: ComplaintStatus;
  lon: number;
  lat: number;
  photo_url?: string | null;
  comment?: string;
  created_at: string;
}

/** GET /map/objects?bbox= */
export interface MapObjects {
  sites: MapSite[];
  facilities: MapFacility[];
  vehicles: MapVehicle[];
  complaints: MapComplaint[];
}

/** Realtime vehicle_positions */
export interface VehiclePosition {
  vehicle_id: string;
  trip_id: string;
  lon: number;
  lat: number;
  speed: number;
  recorded_at: string; // ISO
}

export interface PathOutput {
  output_type: OutputType;
  weight_kg: number;
  outcome: 'recycling' | 'energy' | 'landfill' | 'buyer';
  destination: { kind: 'facility' | 'buyer'; id: string; name: string; lon: number; lat: number };
}

export interface PathPickup {
  container_id: string;
  waste_type: WasteType;
  picked_at: string;
  photo_url?: string | null;
  contamination_pct: number;
  mixed_flag: boolean;
}

export interface PathTrip {
  id: string;
  vehicle_plate: string;
  carrier: string;
  waste_type: WasteType;
  started_at: string;
  finished_at: string;
  /** Трек рейса от площадки до объекта (по дорогам, OSRM). */
  track: [number, number][];
  destination: Pick<MapFacility, 'id' | 'type' | 'name' | 'lon' | 'lat'>;
  mixed_flag: boolean;
  route_deviation: boolean;
  pickups: PathPickup[];
  batch: { id: string; weight_kg: number; received_at: string; facility_id: string };
  outputs: PathOutput[];
}

/** GET /sites/{id}/path?period=7d */
export interface SitePath {
  site: MapSite;
  period: string;
  trips: PathTrip[];
}

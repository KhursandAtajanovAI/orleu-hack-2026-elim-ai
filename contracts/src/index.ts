/**
 * @kaida/contracts — единые контракты для всех потоков (C, D, E, F, H, G).
 *
 *  - `openapi.ts`        — типы, сгенерированные из contracts/openapi.yaml (не править руками);
 *  - этот файл           — удобные псевдонимы, константы и маленький типизированный клиент;
 *  - waste-rules.json    — 13 классов ИИ и правило «класс → контейнер» по умолчанию;
 *  - mocks/*.json        — реальные ответы API, снятые с тестовой базы (для работы на моках).
 */
import type { components, paths, operations } from './openapi';
import wasteRulesJson from '../waste-rules.json';

export type { components, paths, operations };
type S = components['schemas'];

// ------------------------------------------------------------------ перечисления
export type Role = S['Role'];
export type WasteType = S['WasteType'];
export type FacilityType = S['FacilityType'];
export type OutputType = S['OutputType'];
export type OutputDestination = S['OutputDestination'];
export type OutcomeCategory = S['OutcomeCategory'];
export type TripStatus = S['TripStatus'];
export type PickupStatus = S['PickupStatus'];
export type BatchStatus = S['BatchStatus'];
export type ReportType = S['ReportType'];
export type ReportStatus = S['ReportStatus'];
export type ScanMode = S['ScanMode'];
export type AiClass = S['AiClass'];
export type PathStage = S['PathStage'];
export type PathStageCode = S['PathStageCode'];

// ------------------------------------------------------------------ сущности
export type ApiError = S['Error'];
export type LonLat = S['LonLat'];
export type GpsPoint = S['GpsPoint'];
export type Container = S['Container'];
export type SiteBrief = S['SiteBrief'];
export type SiteNearest = S['SiteNearest'];
export type SitePath = S['SitePath'];
export type SiteCard = S['SiteCard'];
export type FacilityBrief = NonNullable<S['FacilityBrief']>;
export type TripChain = S['TripChain'];
export type TimelineStep = S['TimelineStep'];
export type Outcome = S['Outcome'];
export type BatchInChain = S['BatchInChain'];
export type BatchOutput = S['BatchOutput'];
export type BatchOutputInput = S['BatchOutputInput'];
export type Batch = S['Batch'];
export type MapObjects = S['MapObjects'];
export type PublicStats = S['PublicStats'];
export type WasteRule = S['WasteRule'];
export type Me = S['Me'];
export type AiItem = S['AiItem'];
export type AnalyzeResult = S['AnalyzeResult'];
export type ScanResult = S['ScanResult'];
export type AiHealth = S['AiHealth'];
export type Pickup = S['Pickup'];
export type DriverDay = S['DriverDay'];
export type DriverStop = S['DriverStop'];
export type Report = S['Report'];
export type Bonuses = S['Bonuses'];
export type DashboardSummary = S['DashboardSummary'];
export type DashboardMetrics = S['DashboardMetrics'];
export type TimeseriesPoint = S['TimeseriesPoint'];
export type SiteRating = S['SiteRating'];
export type CarrierRating = S['CarrierRating'];

// ------------------------------------------------------------------ константы
export const WASTE_TYPES: readonly WasteType[] = ['mixed', 'plastic', 'paper', 'glass', 'metal', 'organic'];
export const ROLES: readonly Role[] = ['resident', 'driver', 'operator', 'akimat', 'admin', 'partner', 'seller'];
export const REPORT_TYPES: readonly ReportType[] = ['mixed', 'overflow', 'dump', 'other'];
export const REPORT_STATUSES: readonly ReportStatus[] = ['new', 'in_work', 'confirmed', 'rejected'];

/** Разрешённые переходы статуса жалобы (дублирует проверку в БД — для UI). */
export const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  new: ['in_work', 'confirmed', 'rejected'],
  in_work: ['confirmed', 'rejected'],
  confirmed: [],
  rejected: [],
};

/** Статусы пути отходов (раздел 7) — ключи i18n: `path.stage.<code>`. */
export const PATH_STAGES: readonly { stage: PathStage; code: PathStageCode }[] = [
  { stage: 1, code: 'in_container' },
  { stage: 2, code: 'picked_up' },
  { stage: 3, code: 'in_transit' },
  { stage: 4, code: 'received' },
  { stage: 5, code: 'sorted' },
  { stage: 6, code: 'outcome' },
];

export interface WasteClassDef {
  id: number;
  ai_class: AiClass;
  label_ru: string;
  label_kk: string;
  bin: WasteType;
  is_recyclable: boolean;
  special_handling: boolean;
  hint_ru: string;
  hint_kk: string;
  usage_ru: string;
  usage_kk: string;
}
export interface BinDef { label_ru: string; label_kk: string; color: string; icon: string }

export const WASTE_CLASSES = wasteRulesJson.classes as WasteClassDef[];
export const BINS = wasteRulesJson.bins as Record<WasteType, BinDef>;

/** Цвет чистоты площадки (ТЗ 8): зелёный ≥ 80, жёлтый 50–79, красный < 50. */
export function cleanlinessColor(score: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (score == null) return 'gray';
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

/** Цвет машины по типу отходов рейса (ТЗ 8). */
export function wasteColor(t: WasteType): string {
  return BINS[t]?.color ?? '#6B7280';
}

// ------------------------------------------------------------------ клиент
export class KaidaApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'KaidaApiError';
  }
}

export interface ClientOptions {
  /** `${SUPABASE_URL}/functions/v1/api`, или Prism-мок `http://127.0.0.1:4010` */
  baseUrl: string;
  /** anon key Supabase — нужен шлюзу Edge Functions даже для гостя */
  anonKey?: string;
  /** access_token текущей сессии (supabase.auth.getSession()) */
  getAccessToken?: () => Promise<string | null | undefined> | string | null | undefined;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * Маленький типизированный клиент API. Не зависит от supabase-js.
 *
 * ```ts
 * const api = createApiClient({ baseUrl, anonKey, getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token });
 * const path = await api.sitePath(siteId, 7);
 * ```
 */
export function createApiClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;

  async function request<T>(method: string, path: string, init: { query?: Query; json?: unknown; form?: FormData } = {}): Promise<T> {
    const url = new URL(opts.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.anonKey) headers.apikey = opts.anonKey;
    const token = (await opts.getAccessToken?.()) ?? opts.anonKey;
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (init.form) body = init.form;
    else if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const res = await f(url, { method, headers, body });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const e = (data as ApiError | null)?.error;
      throw new KaidaApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? res.statusText, e?.details);
    }
    return data as T;
  }

  const form = (fields: Record<string, string | number | Blob | undefined | null>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, v instanceof Blob ? v : String(v));
    return fd;
  };

  return {
    request,
    health: () => request<{ status: string; version: string; demo_mode: boolean; ai: AiHealth }>('GET', '/health'),
    // публичное
    siteByQr: (code: string) => request<SiteBrief>('GET', `/sites/by-qr/${encodeURIComponent(code)}`),
    sitePath: (siteId: string, periodDays = 7) => request<SitePath>('GET', `/sites/${siteId}/path`, { query: { period: `${periodDays}d` } }),
    siteCard: (siteId: string) => request<SiteCard>('GET', `/sites/${siteId}/card`),
    nearestSites: (lon: number, lat: number, limit = 5) => request<SiteNearest[]>('GET', '/sites/nearest', { query: { lon, lat, limit } }),
    mapObjects: (bbox: [number, number, number, number], layers?: string[]) =>
      request<MapObjects>('GET', '/map/objects', { query: { bbox: bbox.join(','), layers: layers?.join(',') } }),
    publicStats: (cityId?: string, periodDays = 30) => request<PublicStats>('GET', '/stats/public', { query: { city_id: cityId, period: `${periodDays}d` } }),
    wasteRules: () => request<WasteRule[]>('GET', '/waste-rules'),
    trip: (tripId: string) => request<TripChain>('GET', `/trips/${tripId}`),
    // житель
    me: () => request<Me>('GET', '/me'),
    createScan: (p: { image: Blob; mode?: ScanMode; container_type?: WasteType; site_id?: string; lon?: number; lat?: number }) =>
      request<ScanResult>('POST', '/scans', { form: form(p) }),
    scanFeedback: (scanId: string, correct_class: AiClass, item_index?: number, comment?: string) =>
      request<{ training_image_id: string; status: string }>('POST', `/scans/${scanId}/feedback`, { json: { correct_class, item_index, comment } }),
    createReport: (p: { image: Blob; type: ReportType; lon: number; lat: number; site_id?: string; comment?: string; client_id?: string }) =>
      request<Report>('POST', '/reports', { form: form(p) }),
    listReports: (q: { status?: ReportStatus; type?: ReportType; district_id?: string; limit?: number } = {}) =>
      request<Report[]>('GET', '/reports', { query: q }),
    report: (id: string) => request<Report>('GET', `/reports/${id}`),
    myBonuses: () => request<Bonuses>('GET', '/me/bonuses'),
    myQr: () => request<{ token: string; expires_at: string }>('GET', '/me/qr'),
    // водитель
    driverRouteToday: (date?: string) => request<DriverDay>('GET', '/driver/route/today', { query: { date } }),
    startTrip: (p: { route_id?: string; vehicle_id?: string; waste_type?: WasteType; started_at?: string; is_simulated?: boolean }) =>
      request<TripChain>('POST', '/trips', { json: p }),
    addPositions: (tripId: string, points: GpsPoint[]) =>
      request<{ trip_id: string; accepted: number; received: number }>('POST', `/trips/${tripId}/positions`, { json: { points } }),
    finishTrip: (tripId: string, finished_at?: string) => request<TripChain>('POST', `/trips/${tripId}/finish`, { json: { finished_at } }),
    createPickup: (p: { trip_id: string; container_id: string; image?: Blob; status?: PickupStatus; fill_level?: number; lon?: number; lat?: number; picked_at?: string; client_id?: string }) =>
      request<Pickup>('POST', '/pickups', { form: form(p) }),
    // оператор
    facilityArrivals: (facilityId: string) => request<TripChain[]>('GET', `/facilities/${facilityId}/arrivals`),
    createBatch: (p: { facility_id: string; trip_id?: string; weight_kg?: number; gross_kg?: number; tare_kg?: number; photo_url?: string; received_at?: string; parent_output_id?: string }) =>
      request<Batch>('POST', '/batches', { json: p }),
    addBatchOutputs: (batchId: string, outputs: BatchOutputInput[], close = true) =>
      request<{ batch: Batch; outputs: BatchOutput[]; total_kg: number }>('POST', `/batches/${batchId}/outputs`, { json: { outputs, close } }),
    createDropOff: (p: { facility_id: string; waste_type: WasteType; weight_kg: number; user_qr: string; client_id?: string }) =>
      request<unknown>('POST', '/drop-offs', { json: p }),
    // акимат
    dashboardSummary: (q: DashboardQuery = {}) => request<DashboardSummary>('GET', '/dashboard/summary', { query: q }),
    dashboardTimeseries: (q: DashboardQuery = {}) => request<TimeseriesPoint[]>('GET', '/dashboard/timeseries', { query: q }),
    sitesRating: (q: DashboardQuery & { sort?: string } = {}) => request<SiteRating[]>('GET', '/dashboard/sites-rating', { query: q }),
    carriersRating: (q: DashboardQuery = {}) => request<CarrierRating[]>('GET', '/dashboard/carriers-rating', { query: q }),
    updateReportStatus: (id: string, status: ReportStatus, comment?: string) =>
      request<Report>('PATCH', `/reports/${id}`, { json: { status, comment } }),
    // админ
    setUserRoles: (userId: string, roles: Role[], city_id?: string, facility_id?: string) =>
      request<unknown>('PUT', `/admin/users/${userId}/roles`, { json: { roles, city_id, facility_id } }),
    demoLogin: (role: Role, index = 1) =>
      request<{ access_token: string; refresh_token: string; expires_in: number; user: unknown }>('POST', '/auth/demo-login', { json: { role, index } }),
  };
}

export type DashboardQuery = {
  city_id?: string;
  district_id?: string;
  carrier_id?: string;
  period?: 'today' | '7d' | '30d' | 'custom';
  from?: string;
  to?: string;
};

export type KaidaApi = ReturnType<typeof createApiClient>;

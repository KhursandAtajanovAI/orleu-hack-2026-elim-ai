/**
 * «Қайда?» — REST API из раздела 4 ТЗ поверх функций PostgreSQL.
 *
 * Этот файл не зависит от Deno и supabase-js: все внешние вызовы приходят через
 * `Deps`. Поэтому один и тот же код работает в Supabase Edge Functions
 * (index.ts) и тестируется в Node (handler.test.ts) на заглушках.
 *
 * Права: каждый запрос идёт в базу от имени пользователя (его JWT), поэтому
 * работают RLS и проверки ролей внутри функций. Ключ service_role нужен только
 * тестовому входу DEMO_MODE.
 */

export interface DbResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
}

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<DbResult<T>>;
}

export interface Deps {
  /** Клиент БД от имени вызывающего (Authorization из запроса) */
  userDb(authHeader: string | null): Db;
  /** id пользователя по JWT (null — гость) */
  getUserId(authHeader: string | null): Promise<string | null>;
  /** Загрузка фото в Storage от имени пользователя → публичный URL */
  uploadPhoto(authHeader: string, userId: string, file: Blob, kind: string): Promise<string>;
  /** Вызов ИИ-сервиса POST /ai/analyze */
  aiAnalyze(file: Blob, mode: string, containerType?: string | null): Promise<AiResponse>;
  aiHealth(): Promise<unknown>;
  /** Тестовый вход: создать при необходимости демо-пользователя и выдать сессию */
  demoLogin?(role: string, index: number): Promise<unknown>;
  env: { DEMO_MODE: boolean; VERSION: string; MAX_UPLOAD_BYTES: number };
}

export type AiResponse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

// ------------------------------------------------------------------ HTTP-утилиты
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-id',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers },
  });
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(e: HttpError): Response {
  return json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, e.status);
}

/** Коды ошибок из БД ('CODE: сообщение') → HTTP-статус */
const CODE_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  PHOTO_REQUIRED: 400,
  INVALID_QR: 400,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  LIMIT_EXCEEDED: 429,
};

/** Ошибка PostgREST/PostgreSQL → единый формат {"error":{"code","message"}} */
export function dbError(err: NonNullable<DbResult['error']>): HttpError {
  const m = /^([A-Z_]{3,40}): (.*)$/s.exec(err.message ?? '');
  if (m) return new HttpError(CODE_STATUS[m[1]] ?? 400, m[1], m[2]);
  if (err.code === '42501') return new HttpError(403, 'FORBIDDEN', 'Недостаточно прав');
  if (err.code === '22P02' || err.code === '23514' || err.code === '22023') return new HttpError(400, 'VALIDATION', err.message);
  if (err.code === '23505') return new HttpError(409, 'CONFLICT', 'Запись уже существует');
  if (err.code === '23503') return new HttpError(400, 'VALIDATION', 'Ссылка на несуществующую запись');
  if (err.code === 'PGRST202') return new HttpError(500, 'INTERNAL', 'Функция БД не найдена — примените миграции');
  if (err.code === 'PGRST301' || /JWT/i.test(err.message)) return new HttpError(401, 'UNAUTHORIZED', 'Сессия истекла, войдите снова');
  return new HttpError(500, 'INTERNAL', err.message || 'Внутренняя ошибка');
}

async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // undefined не передаём — PostgREST подставит значения по умолчанию
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  const { data, error } = await db.rpc<T>(fn, clean);
  if (error) throw dbError(error);
  return data as T;
}

// ------------------------------------------------------------------ валидация
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WASTE = ['mixed', 'plastic', 'paper', 'glass', 'metal', 'organic'];
const ROLES = ['resident', 'driver', 'operator', 'akimat', 'admin', 'partner', 'seller'];

function uuid(v: unknown, name: string, required = true): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, 'VALIDATION', `Поле ${name} обязательно`);
    return undefined;
  }
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, 'VALIDATION', `${name}: ожидается uuid`);
  return v;
}

function num(v: unknown, name: string, required = false, min = -Infinity, max = Infinity): number | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, 'VALIDATION', `Поле ${name} обязательно`);
    return undefined;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, 'VALIDATION', `${name}: неверное число`);
  return n;
}

function oneOf(v: unknown, name: string, allowed: string[], required = false): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, 'VALIDATION', `Поле ${name} обязательно`);
    return undefined;
  }
  if (typeof v !== 'string' || !allowed.includes(v)) throw new HttpError(400, 'VALIDATION', `${name}: одно из ${allowed.join(', ')}`);
  return v;
}

function str(v: unknown, max = 2000): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v).slice(0, max);
}

function periodDays(p: string | null, fallback = 7): number {
  if (!p) return fallback;
  if (p === 'today') return 1;
  const m = /^(\d{1,3})d$/.exec(p);
  if (!m) throw new HttpError(400, 'VALIDATION', 'period: today / 7d / 30d');
  return Math.max(1, Math.min(365, Number(m[1])));
}

/** from/to для дашборда: period=today|7d|30d или custom c from/to */
function periodRange(q: URLSearchParams): { p_from?: string; p_to?: string } {
  const from = q.get('from');
  const to = q.get('to');
  if (from || to) {
    for (const [k, v] of [['from', from], ['to', to]] as const) if (v && Number.isNaN(Date.parse(v))) throw new HttpError(400, 'VALIDATION', `${k}: дата ISO 8601`);
    return { p_from: from ?? undefined, p_to: to ?? undefined };
  }
  const period = q.get('period');
  if (!period || period === 'custom') return {};
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now);
    start.setUTCHours(start.getUTCHours() + 5); // Казахстан UTC+5
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCHours(start.getUTCHours() - 5);
    return { p_from: start.toISOString() };
  }
  const days = periodDays(period);
  return { p_from: new Date(now.getTime() - days * 86400_000).toISOString() };
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const t = await req.text();
  if (!t) return {};
  try {
    const v = JSON.parse(t);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'VALIDATION', 'Тело запроса — JSON-объект');
  }
}

async function readForm(req: Request): Promise<FormData> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data') && !ct.includes('application/x-www-form-urlencoded')) {
    throw new HttpError(400, 'VALIDATION', 'Ожидается multipart/form-data с полем image');
  }
  try {
    return await req.formData();
  } catch {
    throw new HttpError(400, 'VALIDATION', 'Не удалось прочитать форму');
  }
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function imageFrom(fd: FormData, maxBytes: number, required: boolean): Blob | null {
  const v = fd.get('image');
  if (!v || typeof v === 'string') {
    if (required) throw new HttpError(400, 'PHOTO_REQUIRED', 'Нужно фото (поле image)');
    return null;
  }
  if (v.size === 0) throw new HttpError(400, 'PHOTO_REQUIRED', 'Пустой файл');
  if (v.size > maxBytes) throw new HttpError(413, 'VALIDATION', `Фото больше ${Math.round(maxBytes / 1024 / 1024)} МБ — сожмите на телефоне до 1 МБ`);
  if (v.type && !IMAGE_TYPES.includes(v.type)) throw new HttpError(415, 'VALIDATION', 'Формат фото: JPEG, PNG или WebP');
  return v;
}

function fdGet(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  return typeof v === 'string' && v !== '' ? v : undefined;
}

// ------------------------------------------------------------------ роутер
type Ctx = { req: Request; url: URL; params: Record<string, string>; auth: string | null; deps: Deps };
type Handler = (c: Ctx) => Promise<Response>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/\{(\w+)\}/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, pattern, keys, handler });
}

function requireAuth(c: Ctx): string {
  if (!c.auth || !/^Bearer\s+\S+/i.test(c.auth)) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  return c.auth;
}

// ================================================================== ПУБЛИЧНОЕ
route('GET', '/health', async ({ deps }) => {
  let ai: unknown;
  try {
    ai = await deps.aiHealth();
  } catch {
    ai = { status: 'down' };
  }
  return json({ status: 'ok', version: deps.env.VERSION, demo_mode: deps.env.DEMO_MODE, ai });
});

route('GET', '/sites/by-qr/{code}', async ({ deps, auth, params }) => {
  const data = await call(deps.userDb(auth), 'site_by_qr', { p_code: decodeURIComponent(params.code) });
  if (!data) throw new HttpError(404, 'NOT_FOUND', 'Площадка с таким QR не найдена');
  return json(data, 200, { 'Cache-Control': 'public, max-age=60' });
});

route('GET', '/sites/nearest', async ({ deps, auth, url }) => {
  const q = url.searchParams;
  return json(await call(deps.userDb(auth), 'nearest_sites', {
    p_lon: num(q.get('lon'), 'lon', true, -180, 180), p_lat: num(q.get('lat'), 'lat', true, -90, 90),
    p_limit: num(q.get('limit'), 'limit', false, 1, 50),
  }));
});

route('GET', '/sites/{id}/path', async ({ deps, auth, params, url }) => {
  return json(await call(deps.userDb(auth), 'site_path', {
    p_site_id: uuid(params.id, 'id'), p_period_days: periodDays(url.searchParams.get('period')),
  }));
});

route('GET', '/sites/{id}/card', async ({ deps, auth, params }) => {
  return json(await call(deps.userDb(auth), 'site_card', { p_site_id: uuid(params.id, 'id') }));
});

route('GET', '/map/objects', async ({ deps, auth, url }) => {
  const bbox = (url.searchParams.get('bbox') ?? '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    throw new HttpError(400, 'VALIDATION', 'bbox: minLon,minLat,maxLon,maxLat');
  }
  const layers = url.searchParams.get('layers');
  return json(await call(deps.userDb(auth), 'map_objects', {
    p_min_lon: bbox[0], p_min_lat: bbox[1], p_max_lon: bbox[2], p_max_lat: bbox[3],
    p_layers: layers ? layers.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  }));
});

route('GET', '/stats/public', async ({ deps, auth, url }) => {
  return json(await call(deps.userDb(auth), 'public_stats', {
    p_city_id: uuid(url.searchParams.get('city_id'), 'city_id', false), p_days: periodDays(url.searchParams.get('period'), 30),
  }), 200, { 'Cache-Control': 'public, max-age=300' });
});

route('GET', '/waste-rules', async ({ deps, auth, url }) => {
  return json(await call(deps.userDb(auth), 'waste_rules_list', { p_city_id: uuid(url.searchParams.get('city_id'), 'city_id', false) }),
    200, { 'Cache-Control': 'public, max-age=3600' });
});

route('GET', '/trips/{id}', async ({ deps, auth, params }) => {
  const data = await call(deps.userDb(auth), 'trip_chain', { p_trip_id: uuid(params.id, 'id') });
  if (!data) throw new HttpError(404, 'NOT_FOUND', 'Рейс не найден');
  return json(data);
});

// ================================================================== ВХОД
route('POST', '/auth/demo-login', async ({ deps, req }) => {
  if (!deps.env.DEMO_MODE || !deps.demoLogin) throw new HttpError(403, 'DEMO_DISABLED', 'Тестовый вход выключен (DEMO_MODE=false)');
  const b = await readJson(req);
  const role = oneOf(b.role, 'role', ROLES, true)!;
  const index = num(b.index, 'index', false, 1, 50) ?? 1;
  return json(await deps.demoLogin(role, Math.trunc(index)));
});

route('GET', '/me', async (c) => {
  const data = await call(c.deps.userDb(requireAuth(c)), 'me');
  if (!data) throw new HttpError(404, 'NOT_FOUND', 'Профиль не найден');
  return json(data);
});

// ================================================================== ЖИТЕЛЬ
route('POST', '/scans', async (c) => {
  const fd = await readForm(c.req);
  const image = imageFrom(fd, c.deps.env.MAX_UPLOAD_BYTES, true)!;
  const mode = oneOf(fdGet(fd, 'mode') ?? 'item', 'mode', ['item', 'container'])!;
  const containerType = oneOf(fdGet(fd, 'container_type'), 'container_type', WASTE);
  if (mode === 'container' && !containerType) throw new HttpError(400, 'VALIDATION', 'Для режима «контейнер» нужен container_type');
  const siteId = uuid(fdGet(fd, 'site_id'), 'site_id', false);
  const lon = num(fdGet(fd, 'lon'), 'lon', false, -180, 180);
  const lat = num(fdGet(fd, 'lat'), 'lat', false, -90, 90);

  const userId = await c.deps.getUserId(c.auth);
  // ИИ и загрузка фото — параллельно
  const [ai, photoUrl] = await Promise.all([
    c.deps.aiAnalyze(image, mode, containerType),
    userId ? c.deps.uploadPhoto(c.auth!, userId, image, 'scans').catch(() => null) : Promise.resolve(null),
  ]);
  if (!ai.ok) throw new HttpError(ai.status, ai.code, ai.message);
  if (!userId) {
    // гость: результат без сохранения
    return json({ ...ai.data, scan_id: null, site_id: siteId ?? null, photo_url: null });
  }
  const saved = await call<Record<string, unknown>>(c.deps.userDb(c.auth), 'scan_create', {
    p_mode: mode, p_photo_url: photoUrl, p_ai_result: ai.data, p_site_id: siteId,
    p_container_type: containerType, p_lon: lon, p_lat: lat,
  });
  return json({ ...ai.data, ...saved, photo_url: photoUrl });
});

route('POST', '/scans/{id}/feedback', async (c) => {
  const b = await readJson(c.req);
  return json(await call(c.deps.userDb(requireAuth(c)), 'scan_feedback', {
    p_scan_id: uuid(c.params.id, 'id'), p_correct_class: str(b.correct_class, 40),
    p_item_index: num(b.item_index, 'item_index', false, 0, 1000), p_comment: str(b.comment),
  }));
});

route('POST', '/reports', async (c) => {
  const auth = requireAuth(c);
  const fd = await readForm(c.req);
  const image = imageFrom(fd, c.deps.env.MAX_UPLOAD_BYTES, true)!;
  const type = oneOf(fdGet(fd, 'type'), 'type', ['mixed', 'overflow', 'dump', 'other'], true);
  const lon = num(fdGet(fd, 'lon'), 'lon', true, -180, 180);
  const lat = num(fdGet(fd, 'lat'), 'lat', true, -90, 90);
  const userId = await c.deps.getUserId(auth);
  if (!userId) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  const photoUrl = await c.deps.uploadPhoto(auth, userId, image, 'reports');
  const data = await call(c.deps.userDb(auth), 'report_create', {
    p_type: type, p_photo_url: photoUrl, p_lon: lon, p_lat: lat,
    p_site_id: uuid(fdGet(fd, 'site_id'), 'site_id', false), p_comment: str(fdGet(fd, 'comment')),
    p_client_id: str(fdGet(fd, 'client_id') ?? c.req.headers.get('x-client-id'), 100),
  });
  return json(data, 201);
});

route('GET', '/reports', async (c) => {
  const q = c.url.searchParams;
  return json(await call(c.deps.userDb(requireAuth(c)), 'reports_list', {
    p_status: oneOf(q.get('status'), 'status', ['new', 'in_work', 'confirmed', 'rejected']),
    p_type: oneOf(q.get('type'), 'type', ['mixed', 'overflow', 'dump', 'other']),
    p_district_id: uuid(q.get('district_id'), 'district_id', false),
    p_limit: num(q.get('limit'), 'limit', false, 1, 500),
  }));
});

route('GET', '/reports/{id}', async (c) => {
  return json(await call(c.deps.userDb(requireAuth(c)), 'report_get', { p_id: uuid(c.params.id, 'id') }));
});

route('PATCH', '/reports/{id}', async (c) => {
  const b = await readJson(c.req);
  return json(await call(c.deps.userDb(requireAuth(c)), 'report_set_status', {
    p_report_id: uuid(c.params.id, 'id'),
    p_status: oneOf(b.status, 'status', ['new', 'in_work', 'confirmed', 'rejected'], true),
    p_comment: str(b.comment),
  }));
});

route('GET', '/me/bonuses', async (c) => json(await call(c.deps.userDb(requireAuth(c)), 'me_bonuses')));
route('GET', '/me/qr', async (c) => json(await call(c.deps.userDb(requireAuth(c)), 'my_personal_qr'), 200, { 'Cache-Control': 'no-store' }));

// ================================================================== ВОДИТЕЛЬ
route('GET', '/driver/route/today', async (c) => {
  const d = c.url.searchParams.get('date');
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'VALIDATION', 'date: YYYY-MM-DD');
  return json(await call(c.deps.userDb(requireAuth(c)), 'driver_route_today', { p_date: d ?? undefined }));
});

route('POST', '/trips', async (c) => {
  const b = await readJson(c.req);
  return json(await call(c.deps.userDb(requireAuth(c)), 'trip_start', {
    p_route_id: uuid(b.route_id, 'route_id', false), p_vehicle_id: uuid(b.vehicle_id, 'vehicle_id', false),
    p_waste_type: oneOf(b.waste_type, 'waste_type', WASTE), p_started_at: str(b.started_at, 40),
    p_is_simulated: b.is_simulated === true ? true : undefined,
  }), 201);
});

route('POST', '/trips/{id}/positions', async (c) => {
  const b = await readJson(c.req);
  if (!Array.isArray(b.points) || b.points.length === 0) throw new HttpError(400, 'VALIDATION', 'points: непустой массив');
  if (b.points.length > 1000) throw new HttpError(400, 'VALIDATION', 'Не больше 1000 точек за раз');
  const points = b.points.map((p: Record<string, unknown>, i: number) => ({
    lon: num(p?.lon, `points[${i}].lon`, true, -180, 180),
    lat: num(p?.lat, `points[${i}].lat`, true, -90, 90),
    speed: num(p?.speed, `points[${i}].speed`, false, 0, 300),
    heading: num(p?.heading, `points[${i}].heading`, false, 0, 360),
    recorded_at: str(p?.recorded_at, 40),
  }));
  return json(await call(c.deps.userDb(requireAuth(c)), 'trip_add_positions', { p_trip_id: uuid(c.params.id, 'id'), p_points: points }));
});

route('POST', '/trips/{id}/finish', async (c) => {
  const b = await readJson(c.req);
  return json(await call(c.deps.userDb(requireAuth(c)), 'trip_finish', { p_trip_id: uuid(c.params.id, 'id'), p_finished_at: str(b.finished_at, 40) }));
});

route('POST', '/pickups', async (c) => {
  const auth = requireAuth(c);
  const fd = await readForm(c.req);
  const status = oneOf(fdGet(fd, 'status') ?? 'picked', 'status', ['picked', 'empty', 'no_access', 'broken'])!;
  const image = imageFrom(fd, c.deps.env.MAX_UPLOAD_BYTES, status === 'picked');
  const tripId = uuid(fdGet(fd, 'trip_id'), 'trip_id');
  const containerId = uuid(fdGet(fd, 'container_id'), 'container_id');
  const userId = await c.deps.getUserId(auth);
  if (!userId) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');

  let aiResult: Record<string, unknown> | null = null;
  let photoUrl: string | null = null;
  if (image) {
    const [ai, url] = await Promise.all([
      // вывоз не блокируется недоступностью ИИ: оценку можно пересчитать позже
      c.deps.aiAnalyze(image, 'container', fdGet(fd, 'container_type') ?? null).catch(
        (e): AiResponse => ({ ok: false, status: 503, code: 'AI_UNAVAILABLE', message: String(e) })),
      c.deps.uploadPhoto(auth, userId, image, 'pickups'),
    ]);
    photoUrl = url;
    aiResult = ai.ok ? ai.data : { error: { code: ai.code, message: ai.message } };
  }
  const data = await call<Record<string, unknown>>(c.deps.userDb(auth), 'pickup_create', {
    p_trip_id: tripId, p_container_id: containerId, p_status: status, p_photo_url: photoUrl, p_ai_result: aiResult,
    p_fill_level: num(fdGet(fd, 'fill_level'), 'fill_level', false, 0, 100),
    p_lon: num(fdGet(fd, 'lon'), 'lon', false, -180, 180), p_lat: num(fdGet(fd, 'lat'), 'lat', false, -90, 90),
    p_picked_at: fdGet(fd, 'picked_at'), p_client_id: str(fdGet(fd, 'client_id') ?? c.req.headers.get('x-client-id'), 100),
  });
  return json(data, data?.duplicate ? 200 : 201);
});

// ================================================================== ОПЕРАТОР
route('GET', '/facilities/{id}/arrivals', async (c) =>
  json(await call(c.deps.userDb(requireAuth(c)), 'facility_arrivals', { p_facility_id: uuid(c.params.id, 'id') })));

route('POST', '/batches', async (c) => {
  const b = await readJson(c.req);
  return json(await call(c.deps.userDb(requireAuth(c)), 'batch_create', {
    p_facility_id: uuid(b.facility_id, 'facility_id'), p_trip_id: uuid(b.trip_id, 'trip_id', false),
    p_weight_kg: num(b.weight_kg, 'weight_kg', false, 0, 1e6), p_gross_kg: num(b.gross_kg, 'gross_kg', false, 0, 1e6),
    p_tare_kg: num(b.tare_kg, 'tare_kg', false, 0, 1e6), p_photo_url: str(b.photo_url, 1000),
    p_received_at: str(b.received_at, 40), p_parent_output_id: uuid(b.parent_output_id, 'parent_output_id', false),
  }), 201);
});

route('POST', '/batches/{id}/outputs', async (c) => {
  const b = await readJson(c.req);
  if (!Array.isArray(b.outputs) || b.outputs.length === 0) throw new HttpError(400, 'VALIDATION', 'outputs: непустой массив');
  return json(await call(c.deps.userDb(requireAuth(c)), 'batch_add_outputs', {
    p_batch_id: uuid(c.params.id, 'id'), p_outputs: b.outputs, p_close: b.close === false ? false : true,
  }));
});

route('POST', '/facilities/{id}/daily-outputs', async (c) => {
  const b = await readJson(c.req);
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new HttpError(400, 'VALIDATION', 'date: YYYY-MM-DD');
  return json(await call(c.deps.userDb(requireAuth(c)), 'facility_daily_outputs', {
    p_facility_id: uuid(c.params.id, 'id'), p_date: b.date, p_outputs: b.outputs,
  }));
});

route('POST', '/drop-offs', async (c) => {
  const b = await readJson(c.req);
  return json(await call(c.deps.userDb(requireAuth(c)), 'drop_off_create', {
    p_facility_id: uuid(b.facility_id, 'facility_id'), p_waste_type: oneOf(b.waste_type, 'waste_type', WASTE, true),
    p_weight_kg: num(b.weight_kg, 'weight_kg', true, 0.01, 10000), p_user_qr: str(b.user_qr, 300),
    p_client_id: str(b.client_id ?? c.req.headers.get('x-client-id'), 100),
  }), 201);
});

// ================================================================== АКИМАТ
const dashArgs = (q: URLSearchParams, withExtra = true) => ({
  p_city_id: uuid(q.get('city_id'), 'city_id', false),
  ...periodRange(q),
  ...(withExtra ? { p_district_id: uuid(q.get('district_id'), 'district_id', false), p_carrier_id: uuid(q.get('carrier_id'), 'carrier_id', false) } : {}),
});

route('GET', '/dashboard/summary', async (c) => json(await call(c.deps.userDb(requireAuth(c)), 'dashboard_summary', dashArgs(c.url.searchParams))));
route('GET', '/dashboard/timeseries', async (c) => json(await call(c.deps.userDb(requireAuth(c)), 'dashboard_timeseries', dashArgs(c.url.searchParams))));
route('GET', '/dashboard/sites-rating', async (c) => {
  const q = c.url.searchParams;
  return json(await call(c.deps.userDb(requireAuth(c)), 'dashboard_sites_rating', {
    p_city_id: uuid(q.get('city_id'), 'city_id', false), ...periodRange(q),
    p_district_id: uuid(q.get('district_id'), 'district_id', false),
    p_sort: oneOf(q.get('sort'), 'sort', ['cleanliness_asc', 'cleanliness_desc', 'reports_desc', 'trend_asc']),
    p_limit: num(q.get('limit'), 'limit', false, 1, 1000),
  }));
});
route('GET', '/dashboard/carriers-rating', async (c) => json(await call(c.deps.userDb(requireAuth(c)), 'dashboard_carriers_rating', dashArgs(c.url.searchParams, false))));

// ================================================================== АДМИН
route('PUT', '/admin/users/{id}/roles', async (c) => {
  const b = await readJson(c.req);
  if (!Array.isArray(b.roles) || b.roles.length === 0) throw new HttpError(400, 'VALIDATION', 'roles: непустой массив');
  b.roles.forEach((r: unknown, i: number) => oneOf(r, `roles[${i}]`, ROLES, true));
  return json(await call(c.deps.userDb(requireAuth(c)), 'admin_set_roles', {
    p_user_id: uuid(c.params.id, 'id'), p_roles: b.roles,
    p_city_id: uuid(b.city_id, 'city_id', false), p_facility_id: uuid(b.facility_id, 'facility_id', false),
  }));
});

// ------------------------------------------------------------------ вход
/** Путь без префикса функции: /functions/v1/api/sites/... → /sites/... */
export function stripPrefix(pathname: string): string {
  const p = pathname.replace(/^\/functions\/v1/, '').replace(/^\/api(?=\/|$)/, '');
  return p === '' ? '/' : p;
}

export function createHandler(deps: Deps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const path = stripPrefix(url.pathname);
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      try {
        return await r.handler({ req, url, params, auth: req.headers.get('authorization'), deps });
      } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        console.error(JSON.stringify({ level: 'error', path, message: String((e as Error)?.stack ?? e) }));
        return errorResponse(new HttpError(500, 'INTERNAL', 'Внутренняя ошибка'));
      }
    }
    if (methodMismatch) return errorResponse(new HttpError(405, 'METHOD_NOT_ALLOWED', `Метод ${req.method} не поддерживается`));
    return errorResponse(new HttpError(404, 'NOT_FOUND', `Нет такого метода: ${req.method} ${path}`));
  };
}

export const ROUTES = () => routes.map((r) => `${r.method} ${r.pattern.source}`);

/**
 * Тесты роутера API на заглушках (без сети и базы).
 * Запуск: node --experimental-strip-types --test db/supabase/functions/api/handler.test.ts
 * (тот же файл запускается и в Deno: deno test db/supabase/functions/api)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, dbError, stripPrefix, type Deps, type DbResult } from './handler.ts';

type Call = { fn: string; args: Record<string, unknown>; auth: string | null };

function makeDeps(over: Partial<Deps> = {}, rpcImpl?: (fn: string, args: Record<string, unknown>) => DbResult) {
  const calls: Call[] = [];
  const deps: Deps = {
    userDb: (auth) => ({
      rpc: async (fn: string, args: Record<string, unknown> = {}) => {
        calls.push({ fn, args, auth });
        return (rpcImpl?.(fn, args) ?? { data: { ok: true, fn }, error: null }) as never;
      },
    }),
    getUserId: async (auth) => (auth && auth !== 'Bearer anon' ? '11111111-1111-1111-1111-111111111111' : null),
    uploadPhoto: async (_a, uid, _f, kind) => `https://cdn/photos/${uid}/${kind}/x.jpg`,
    aiAnalyze: async (_f, mode, ct) => ({ ok: true, data: { model_version: 'waste-yolo-test', mode, container_type: ct, items: [], contamination_pct: 12, processing_ms: 5 } }),
    aiHealth: async () => ({ status: 'ok', model_version: 'waste-yolo-test' }),
    demoLogin: async (role, index) => ({ access_token: 't', role, index }),
    env: { DEMO_MODE: true, VERSION: 'test', MAX_UPLOAD_BYTES: 2 * 1024 * 1024 },
    ...over,
  };
  return { deps, calls, handle: createHandler(deps) };
}

const BASE = 'http://localhost/functions/v1/api';
const SITE = '40000000-0000-0000-0000-000000000001';
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });

test('stripPrefix убирает префикс функции', () => {
  assert.equal(stripPrefix('/functions/v1/api/sites/1/path'), '/sites/1/path');
  assert.equal(stripPrefix('/api/health'), '/health');
  assert.equal(stripPrefix('/api'), '/');
});

test('ошибки БД переводятся в единый формат', () => {
  assert.deepEqual([dbError({ message: 'FORBIDDEN: Это не ваш рейс' }).status, dbError({ message: 'FORBIDDEN: x' }).code], [403, 'FORBIDDEN']);
  assert.equal(dbError({ message: 'NOT_FOUND: Площадка не найдена' }).status, 404);
  assert.equal(dbError({ message: 'INVALID_TRANSITION: ...' }).status, 409);
  assert.equal(dbError({ message: 'permission denied for function x', code: '42501' }).code, 'FORBIDDEN');
  assert.equal(dbError({ message: 'boom' }).status, 500);
});

test('GET /sites/{id}/path → site_path с периодом', async () => {
  const { handle, calls } = makeDeps();
  const res = await handle(new Request(`${BASE}/sites/${SITE}/path?period=30d`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(calls[0], { fn: 'site_path', args: { p_site_id: SITE, p_period_days: 30 }, auth: null });
});

test('валидация: неверный uuid и период → 400 VALIDATION', async () => {
  const { handle } = makeDeps();
  let res = await handle(new Request(`${BASE}/sites/abc/path`));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'VALIDATION');
  res = await handle(new Request(`${BASE}/sites/${SITE}/path?period=week`));
  assert.equal(res.status, 400);
});

test('GET /sites/by-qr/{code}: 404 если не найдено', async () => {
  const { handle } = makeDeps({}, () => ({ data: null, error: null }));
  const res = await handle(new Request(`${BASE}/sites/by-qr/NOPE`));
  assert.equal(res.status, 404);
  assert.deepEqual(Object.keys((await res.json()).error), ['code', 'message']);
});

test('GET /map/objects разбирает bbox и слои', async () => {
  const { handle, calls } = makeDeps();
  const res = await handle(new Request(`${BASE}/map/objects?bbox=71.3,51.0,71.6,51.2&layers=sites,vehicles`));
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0].args, { p_min_lon: 71.3, p_min_lat: 51.0, p_max_lon: 71.6, p_max_lat: 51.2, p_layers: ['sites', 'vehicles'] });
  const bad = await handle(new Request(`${BASE}/map/objects?bbox=1,2,3`));
  assert.equal(bad.status, 400);
});

test('ошибка функции БД пробрасывается как JSON с HTTP-статусом', async () => {
  const { handle } = makeDeps({}, () => ({ data: null, error: { message: 'CONFLICT: У машины уже есть активный рейс' } }));
  const res = await handle(new Request(`${BASE}/trips`, { method: 'POST', headers: { Authorization: 'Bearer u' }, body: '{}' }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: { code: 'CONFLICT', message: 'У машины уже есть активный рейс' } });
});

test('методы водителя требуют вход', async () => {
  const { handle } = makeDeps();
  const res = await handle(new Request(`${BASE}/driver/route/today`));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'UNAUTHORIZED');
});

test('POST /scans: гость получает результат ИИ без сохранения', async () => {
  const { handle, calls } = makeDeps();
  const fd = new FormData();
  fd.append('image', jpeg(), 'a.jpg');
  fd.append('mode', 'item');
  const res = await handle(new Request(`${BASE}/scans`, { method: 'POST', body: fd }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scan_id, null);
  assert.equal(body.model_version, 'waste-yolo-test');
  assert.equal(calls.length, 0);
});

test('POST /scans: житель — фото в Storage, ИИ, scan_create', async () => {
  const { handle, calls } = makeDeps({}, (fn) => ({ data: { scan_id: 'S', site_id: SITE }, error: null }));
  const fd = new FormData();
  fd.append('image', jpeg(), 'a.jpg');
  fd.append('mode', 'container');
  fd.append('container_type', 'plastic');
  fd.append('lon', '71.42');
  fd.append('lat', '51.09');
  const res = await handle(new Request(`${BASE}/scans`, { method: 'POST', headers: { Authorization: 'Bearer user' }, body: fd }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scan_id, 'S');
  assert.equal(body.contamination_pct, 12);
  assert.equal(calls[0].fn, 'scan_create');
  assert.equal(calls[0].args.p_container_type, 'plastic');
  assert.match(String(calls[0].args.p_photo_url), /photos\/.*\/scans\//);
});

test('POST /scans: режим контейнера без типа контейнера → 400', async () => {
  const { handle } = makeDeps();
  const fd = new FormData();
  fd.append('image', jpeg(), 'a.jpg');
  fd.append('mode', 'container');
  const res = await handle(new Request(`${BASE}/scans`, { method: 'POST', body: fd }));
  assert.equal(res.status, 400);
});

test('POST /scans: ИИ недоступен → 503 AI_UNAVAILABLE', async () => {
  const { handle } = makeDeps({ aiAnalyze: async () => ({ ok: false, status: 503, code: 'AI_UNAVAILABLE', message: 'нет связи' }) });
  const fd = new FormData();
  fd.append('image', jpeg(), 'a.jpg');
  const res = await handle(new Request(`${BASE}/scans`, { method: 'POST', body: fd }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'AI_UNAVAILABLE');
});

test('POST /scans: слишком большое фото → 413', async () => {
  const { handle } = makeDeps({ env: { DEMO_MODE: false, VERSION: 't', MAX_UPLOAD_BYTES: 4 } });
  const fd = new FormData();
  fd.append('image', jpeg(), 'a.jpg');
  const res = await handle(new Request(`${BASE}/scans`, { method: 'POST', body: fd }));
  assert.equal(res.status, 413);
});

test('POST /pickups: вывоз не блокируется недоступностью ИИ', async () => {
  const { handle, calls } = makeDeps({ aiAnalyze: async () => { throw new Error('timeout'); } }, () => ({ data: { id: 'P' }, error: null }));
  const fd = new FormData();
  fd.append('image', jpeg(), 'a.jpg');
  fd.append('trip_id', SITE);
  fd.append('container_id', SITE);
  const res = await handle(new Request(`${BASE}/pickups`, { method: 'POST', headers: { Authorization: 'Bearer d' }, body: fd }));
  assert.equal(res.status, 201);
  assert.equal((calls[0].args.p_ai_result as { error: { code: string } }).error.code, 'AI_UNAVAILABLE');
});

test('POST /pickups: «контейнер пустой» без фото разрешён', async () => {
  const { handle, calls } = makeDeps();
  const fd = new FormData();
  fd.append('status', 'empty');
  fd.append('trip_id', SITE);
  fd.append('container_id', SITE);
  const res = await handle(new Request(`${BASE}/pickups`, { method: 'POST', headers: { Authorization: 'Bearer d' }, body: fd }));
  assert.equal(res.status, 201);
  assert.equal(calls[0].args.p_status, 'empty');
  assert.equal(calls[0].args.p_photo_url, null);
});

test('POST /trips/{id}/positions валидирует точки', async () => {
  const { handle, calls } = makeDeps();
  const ok = await handle(new Request(`${BASE}/trips/${SITE}/positions`, {
    method: 'POST', headers: { Authorization: 'Bearer d' },
    body: JSON.stringify({ points: [{ lon: 71.4, lat: 51.1, speed: 30, recorded_at: '2026-11-27T10:00:00Z' }] }),
  }));
  assert.equal(ok.status, 200);
  assert.equal((calls[0].args.p_points as unknown[]).length, 1);
  const bad = await handle(new Request(`${BASE}/trips/${SITE}/positions`, {
    method: 'POST', headers: { Authorization: 'Bearer d' }, body: JSON.stringify({ points: [{ lon: 500, lat: 1 }] }),
  }));
  assert.equal(bad.status, 400);
});

test('PATCH /reports/{id} → report_set_status', async () => {
  const { handle, calls } = makeDeps();
  const res = await handle(new Request(`${BASE}/reports/${SITE}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer a' }, body: JSON.stringify({ status: 'in_work', comment: 'Проверяем' }),
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0].args, { p_report_id: SITE, p_status: 'in_work', p_comment: 'Проверяем' });
});

test('GET /dashboard/summary: период 30d → p_from', async () => {
  const { handle, calls } = makeDeps();
  await handle(new Request(`${BASE}/dashboard/summary?period=30d&city_id=${SITE}`, { headers: { Authorization: 'Bearer a' } }));
  const from = Date.parse(String(calls[0].args.p_from));
  assert.ok(Math.abs(Date.now() - 30 * 86400_000 - from) < 5000);
  assert.equal(calls[0].args.p_city_id, SITE);
});

test('демо-вход: выключен при DEMO_MODE=false', async () => {
  const { handle } = makeDeps({ env: { DEMO_MODE: false, VERSION: 't', MAX_UPLOAD_BYTES: 1 } });
  const res = await handle(new Request(`${BASE}/auth/demo-login`, { method: 'POST', body: JSON.stringify({ role: 'driver' }) }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'DEMO_DISABLED');
});

test('демо-вход: роль и номер аккаунта', async () => {
  const { handle } = makeDeps();
  const res = await handle(new Request(`${BASE}/auth/demo-login`, { method: 'POST', body: JSON.stringify({ role: 'driver', index: 3 }) }));
  assert.deepEqual(await res.json(), { access_token: 't', role: 'driver', index: 3 });
});

test('неизвестный путь → 404, неверный метод → 405, OPTIONS → CORS', async () => {
  const { handle } = makeDeps();
  assert.equal((await handle(new Request(`${BASE}/nope`))).status, 404);
  assert.equal((await handle(new Request(`${BASE}/health`, { method: 'DELETE' }))).status, 405);
  const o = await handle(new Request(`${BASE}/scans`, { method: 'OPTIONS' }));
  assert.equal(o.status, 204);
  assert.ok(o.headers.get('access-control-allow-headers')?.includes('authorization'));
});

test('GET /health сообщает о недоступном ИИ, но отвечает 200', async () => {
  const { handle } = makeDeps({ aiHealth: async () => { throw new Error('down'); } });
  const res = await handle(new Request(`${BASE}/health`));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ai.status, 'down');
});

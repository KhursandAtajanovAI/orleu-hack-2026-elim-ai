# Как подключиться к бэкенду и ИИ (для потоков C, D, E, F, H, G)

Контракты зафиксированы — каждый поток работает **на моках сразу**, а потом меняет один адрес.

## 1. Что взять

```ts
import { createApiClient, type SitePath, WASTE_CLASSES, BINS, PATH_STAGES, cleanlinessColor, wasteColor } from '@kaida/contracts';
```

`@kaida/contracts` — npm-workspace в монорепо (`contracts/`):

| Что | Файл |
|---|---|
| OpenAPI 3.1 — все методы, схемы, ошибки | `contracts/openapi.yaml` (HTML: `/api/` на GitHub Pages) |
| Типы TS (сгенерированы, не править) | `contracts/src/openapi.ts` |
| Псевдонимы типов, константы, клиент | `contracts/src/index.ts` |
| 13 классов ИИ и «класс → контейнер», цвета контейнеров | `contracts/waste-rules.json` |
| **Моки** — настоящие ответы, снятые с тестовой базы | `contracts/mocks/*.json` |

## 2. Работа на моках

Вариант А — Prism по OpenAPI (любой метод, валидирует запросы):

```bash
npm run contracts:mock          # http://127.0.0.1:4010
const api = createApiClient({ baseUrl: 'http://127.0.0.1:4010' });
```

Вариант Б — готовые JSON из `contracts/mocks/` (правдоподобные данные, включая трек рейса,
партии, итоги, флаги смешивания):

```ts
import path from '@kaida/contracts/mocks/site-path.json';
```

| Мок | Для кого | Метод |
|---|---|---|
| `site-path.json`, `site-path-mixed.json` | C (экран «Путь»), D (режим «Путь») | `GET /sites/{id}/path` |
| `site-card.json`, `site-by-qr.json` | C (главная, QR) | `GET /sites/{id}/card`, `GET /sites/by-qr/{code}` |
| `map-objects.json`, `trip-chain.json` | D (3D-карта, трек) | `GET /map/objects`, `GET /trips/{id}` |
| `driver-route-today.json` | F (водитель) | `GET /driver/route/today` |
| `dashboard-*.json`, `report.json` | F (дашборд, жалобы) | `GET /dashboard/*`, `/reports` |
| `me.json`, `me-bonuses.json`, `waste-rules.json`, `public-stats.json` | все | `/me`, `/me/bonuses`, `/waste-rules`, `/stats/public` |

Обновить моки после изменения логики: `db/scripts/export_mocks.sh`.

## 3. Настоящий бэкенд

Облачный стенд уже работает: URL, anon key и тестовый вход — в [`CLOUD.md`](CLOUD.md).

```ts
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const api = createApiClient({
  baseUrl: `${SUPABASE_URL}/functions/v1/api`,
  anonKey: SUPABASE_ANON_KEY,
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
});
```

В `web/` это уже сделано: `import { api, supabase } from '@/lib/supabase'`.

* **Простое чтение/запись** — напрямую `supabase.from('sites').select('*,lon,lat')` (RLS проверит права).
  Координаты: читать через вычисляемые поля `lon`, `lat`; писать `location: 'SRID=4326;POINT(lon lat)'`.
* **Логика и сводки** — `api.*` (REST, раздел 4) или `supabase.rpc('site_path', {...})` (те же функции).
* **Realtime** (публикация `supabase_realtime`): `vehicle_positions`, `reports`, `pickups`, `trips`, `batches`.

```ts
supabase.channel('cars').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vehicle_positions' },
  (p) => moveCar(p.new)).subscribe();
```

* **Ошибки** — всегда `{"error": {"code", "message"}}`; клиент бросает `KaidaApiError` с `code`
  (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `PHOTO_REQUIRED`, `AI_UNAVAILABLE`,
  `IMAGE_TOO_DARK`, `IMAGE_TOO_BLURRY`, `NOTHING_FOUND`, …) — по нему показывайте состояния экрана 5.3.
* **Тестовый вход**: `await api.demoLogin('driver', 1)` → `supabase.auth.setSession(...)`. Роли:
  `resident`, `driver`, `operator`, `akimat`, `admin`. Работает, пока `DEMO_MODE=true`.
* **Офлайн** (P1): `web/src/lib/offline-queue.ts` — очередь в IndexedDB с `client_id`; сервер
  не дублирует записи с одинаковым `client_id` (вывозы, жалобы, сдачи, GPS по `recorded_at`).

## 4. Подсказки по потокам

**C · приложение жителя.** Камера → сжать до ≤ 1 МБ / 1280 px → `api.createScan({ image, mode, container_type, lon, lat })`.
Ответ: `items[]` с `box` (пиксели исходного фото после поворота EXIF и уменьшения до 1280 px —
см. `image.width/height`), `bin`, `correct`, `contamination_pct`, `tips`, `model_version`.
«ИИ ошибся» → `api.scanFeedback(scan_id, correct_class)`. Путь → `api.sitePath(id, 7)`: таймлайн —
`latest.timeline`, круговая диаграмма — `latest.outcome`, предупреждение — `latest.mixed_flag`.
QR-ссылка — `/s/{qr}` → `api.siteByQr(qr)` (без входа). Жалоба → `api.createReport(...)`
(площадка подставится по ближайшей). Подписи статусов: `PATH_STAGES` + ключи i18n `path.stage.<code>`.

**D · 3D-карта.** `api.mapObjects([minLon,minLat,maxLon,maxLat])` → `sites` (цвет — `cleanlinessColor`),
`facilities`, `vehicles` (цвет — `wasteColor(waste_type)`, `heading` для разворота), `reports`.
Режим «Путь»: `api.trip(trip_id)` → `track` (GeoJSON LineString), `destination_facility`, `batches[].outputs[].next_facility`.

**E · 3D-цех.** URL модели цеха — `facilities.model_3d_url` (бакет Storage `models3d`, публичный).
Цифры (P1): `batches` + `batch_outputs` объекта.

**F · кабинеты и дашборд.** Водитель: `driverRouteToday` → `startTrip` → `addPositions` (раз в 10 с,
пачками) → `createPickup` (фото обязательно для `picked`; `within_radius` — проверка 100 м) → `finishTrip`.
Оператор: `facilityArrivals` → `createBatch` → `addBatchOutputs(close=true)`. Дашборд:
`dashboardSummary` (`current.claimed_recycled_t` vs `current.real_recycled_t` — первый экран),
`dashboardTimeseries`, `sitesRating`, `carriersRating`; жалобы — `listReports` + `updateReportStatus`.

**H · симулятор.** Сиды — прямо в базу (service_role). Движение — **только через публичный API**
от имени демо-водителей: `startTrip(is_simulated)` → `addPositions` → `createPickup` → `finishTrip`;
партии — `createBatch`/`addBatchOutputs` от демо-оператора. Флаги смешивания посчитает база.

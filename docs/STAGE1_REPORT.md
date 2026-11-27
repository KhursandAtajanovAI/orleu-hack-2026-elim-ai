# Этап 1 · блоки A и B — отчёт по пунктам ТЗ

Обозначения: ✅ сделано и проверено тестом · 🟡 сделано частично / ждёт облачного запуска ·
⏭ следующий этап (другой поток). Все цифры тестов — из CI и локального прогона на PostgreSQL 17 + PostGIS.

## Раздел 1. Общие требования (в части A и B)

| Требование | Статус | Где / как |
|---|---|---|
| Монорепо `/web /ai /db /simulator /assets` | ✅ | + `contracts/`, `docs/` |
| Стек: Supabase (PostgreSQL+PostGIS, Auth, Storage, Realtime, Edge Functions) | ✅ | `db/supabase/` |
| ИИ — своя модель, без платных API; FastAPI + ONNX Runtime в Docker | ✅ | `ai/`, образ в GHCR |
| i18n ru (P0) / kk (P1), без текста в коде | ✅ | `web/src/messages/{ru,kk}.json`, проверка паритета ключей в CI; подсказки ИИ ru/kk — в `waste_rules` |
| Безопасность: RLS по ролям, ключи только в env, HTTPS | ✅ | RLS на всех 27 таблицах; `.env.example` без значений; service_role только в функции |
| Согласие на данные и на фото для обучения — отдельные галочки (P0) | ✅ | `profiles.consent_data/consent_training`, экран входа; фото в `training_images` — только при согласии |
| Офлайн-очередь фото и жалоб (P1) | ✅ | `web/src/lib/offline-queue.ts` (IndexedDB) + идемпотентность `client_id` на сервере |
| Логи фронта и ИИ в одно место (P1) | ✅ | таблица `app_logs`, RPC `log_event`; ИИ-сервис пишет туда через `LOG_URL` |
| Размытие лиц и номеров (P1) | ⏭ | этап C/дообучение |
| Ветки, PR, автодеплой из main | ✅ | `ci.yml` на PR; `supabase-deploy.yml`, `pages.yml`, GHCR — из main |

## Раздел 2. Роли и права

| Требование | Статус | Где / как |
|---|---|---|
| Гость, житель, водитель, оператор, акимат, админ; несколько ролей у пользователя | ✅ | `profiles.roles app_role[]`, `has_role()`; partner/seller (P2) — роли заведены |
| Права «видит / может изменять» по таблице ТЗ | ✅ | `20261127000500_rls_policies.sql` + `require_role()` в каждой функции; 20+ SQL-проверок прав |
| Акимат — только свой город | ✅ | `profiles.city_id`, `can_see_city()` |
| Роли выдаёт администратор | ✅ | `admin_set_roles`, вкладка «Пользователи» в админке; сам себе роль не поднять (триггер `tg_profiles_guard`) |
| Вход email (P0) | ✅ | email + пароль / ссылка на почту |
| Тестовый вход по роли без пароля, флаг DEMO_MODE | ✅ | `POST /auth/demo-login`, кнопки ролей на экране входа |
| SMS-вход (P1) | ⏭ | нужен платный SMS-провайдер — после согласования |

## Раздел 3. Модель данных

| Требование | Статус | Где / как |
|---|---|---|
| Все таблицы ТЗ (profiles … orders), id uuid, created_at, updated_at | ✅ | 27 таблиц, `20261127000100_schema.sql`; `updated_at` — триггером |
| geography(Point) / geography(LineString) | ✅ | `location`, `trips.track`, границы городов/районов — `geography(MultiPolygon)` |
| Цепочка containers → pickups → trips → batches → batch_outputs → следующий объект / покупатель | ✅ | `batch_outputs.next_facility_id / buyer`, партия-потомок `parent_output_id` |
| bonus_rules / bonus_transactions / drop_offs / training_images (P1) | ✅ | + баланс бонусов триггером, уникальность начисления |
| listings / partners / orders (P2) | ✅ | таблицы и RLS заведены (логика — блок G) |

## Раздел 4. API

Все методы — функции PostgreSQL (одинаковы для REST и `supabase.rpc`) + REST-роутер Edge Function `api`.
Контракт — `contracts/openapi.yaml` (36 операций), типы TS, клиент, 16 моков с настоящей базы.

| Метод | Статус | Функция |
|---|---|---|
| `POST /scans` (фото → ИИ → сохранить) | ✅ | загрузка в Storage → `/ai/analyze` → `scan_create` |
| `GET /sites/{id}/path?period=7d` | ✅ | `site_path` (вывозы → рейсы с треком → партии → итоги, с координатами) |
| `GET /sites/by-qr/{code}` | ✅ | `site_by_qr` (без входа) |
| `GET /map/objects?bbox=` | ✅ | `map_objects` |
| Realtime `vehicle_positions` | ✅ | публикация `supabase_realtime` (+ reports, pickups, trips, batches) |
| `POST /reports`, `PATCH /reports/{id}` | ✅ | `report_create` (ближайшая площадка), `report_set_status` (переходы статусов + журнал) |
| `GET /driver/route/today` | ✅ | `driver_route_today` |
| `POST /trips`, `/trips/{id}/finish`, `/trips/{id}/positions` | ✅ | `trip_start`, `trip_finish`, `trip_add_positions` (пачкой, без дублей) |
| `POST /pickups` (фото → ИИ → чистота, mixed_flag) | ✅ | `pickup_create` + триггер; проверка радиуса 100 м |
| `POST /batches`, `/batches/{id}/outputs` | ✅ | `batch_create`, `batch_add_outputs` (сумма ≤ / = весу) |
| `GET /dashboard/summary`, `timeseries`, `sites-rating`, `carriers-rating` | ✅ | `dashboard_*` |
| `GET /me/bonuses`, `POST /drop-offs` | ✅ | `me_bonuses`, `drop_off_create` по ротируемому QR жителя (HMAC, 5 мин) |
| `POST /ai/analyze`, `GET /ai/health` | ✅ | ИИ-сервис |
| Ошибки `{"error":{"code","message"}}` | ✅ | единый формат в БД, функции и ИИ-сервисе |
| Контракты зафиксированы первыми, моки для фронта | ✅ | Prism-мок `npm run contracts:mock`, JSON-моки, Redoc на Pages |
| Сверх ТЗ | ✅ | `/sites/{id}/card`, `/trips/{id}`, `/facilities/{id}/arrivals`, `/stats/public`, `/scans/{id}/feedback`, `/me/qr`, `/waste-rules`, `/reports` (список) |

## Раздел 6. ИИ-модель и сервис

| Требование | Статус | Где / как |
|---|---|---|
| 13 классов; «класс → контейнер» в waste_rules, не в модели; правила по городу | ✅ | `contracts/waste-rules.json` → сид `waste_rules` (+ `city_id`) и ИИ-сервис |
| Базовая модель YOLO n/s на COCO | ✅ | YOLO11n; до дообучения — карта COCO → наши классы (`-coco` в версии) |
| Датасеты TACO, TrashNet, Roboflow → наши классы, объединение, 80/10/10 | ✅ | `ai/training/prepare.py` + карты `maps/*.yaml`, дедупликация по хэшу |
| Дообучение с аугментациями (освещение, размытие, снег/ночь), GPU Colab/Kaggle | 🟡 | `train.py`, `augment_weather.py`, ноутбук Kaggle готовы; само обучение — запуск на GPU Kaggle (≈1–2 ч) |
| 30–50 своих фото Астаны, только для проверки | 🟡 | сплит `test_astana` + `eval_astana.py` (критерий ≥ 75%) готовы; фото нужно снять и разметить в CVAT/Label Studio |
| Экспорт ONNX, проверка скорости на CPU | ✅ | `export.py`, `bench.py`; workflow «AI · модель» (бенчмарк в summary) |
| Классификатор одного предмета (P1) | 🟡 | вариант ТЗ «самый уверенный объект детектора» для `mode=item`; отдельный классификатор — по времени |
| Цикл данных (P1): фото с согласием и «ИИ ошибся» → training_images | ✅ | `scan_create`, `scan_feedback`; бакет `training` закрыт |
| Версия модели в каждом ответе и в scans/pickups | ✅ | `model_version` (из метаданных ONNX) |
| FastAPI + ONNX Runtime, Docker, CPU | ✅ | `ai/app/`, `ai/Dockerfile`, образ GHCR |
| Вход: изображение + mode item/container + container_type | ✅ | `/ai/analyze` |
| Детекция → порог 0,35 (настраиваемый) → waste_rules → чистота | ✅ | `CONF_THRESHOLD`, NMS по классам |
| Загрязнение = площадь «чужих» рамок / площадь всех × 100% | ✅ | тест на эталонных рамках |
| Ответ в формате ТЗ (`model_version, items[class,label_ru,confidence,box,bin,correct], contamination_pct, tips, processing_ms`) | ✅ | + `label_kk`, `image.width/height`, `quality` |
| Ошибки: не читается / тёмное / размытое / ничего не найдено | ✅ | `IMAGE_UNREADABLE`, `IMAGE_TOO_DARK`, `IMAGE_TOO_BLURRY`, `NOTHING_FOUND` |
| Очередь и лимит частоты на пользователя (P1) | ✅ | семафор `MAX_CONCURRENCY` → `503 BUSY`; `RATE_LIMIT_PER_MIN` → `429` |
| Критерий: ответ на CPU ≤ 3 с для 1280 px | ✅ | YOLO11n ONNX на CPU: ≈ 32 мс на инференс 640×640 (замер в облачном контейнере), полный ответ < 0,5 с; бенчмарк — в workflow |
| Критерий: mAP50 ≥ 0,4 | 🟡 | проверяется `train.py` после дообучения на Kaggle |
| Критерий: ≥ 75% правильный контейнер на фото Астаны | 🟡 | после съёмки фото (`eval_astana.py`) |

Проверено вживую: сервис поднят с настоящей YOLO11n (экспорт Ultralytics → ONNX), `/ai/health` ок,
`/ai/analyze` на фото без отходов честно отвечает `NOTHING_FOUND`.

## Раздел 7. Путь отходов

| Требование | Статус | Где / как |
|---|---|---|
| Статусы 1–6 из событий цепочки | ✅ | `trip_chain`, `site_path`: `stage`, `timeline`, `outcome` |
| Правило 1: вес партии по площадкам ∝ объём × заполненность | ✅ | представление `trip_site_shares` |
| Правило 2: mixed_flag (вторсырьё в рейсе mixed или рейс на полигон) → нарушение перевозчика на дашборде | ✅ | `tg_pickups_before` + `apply_trip_rules`; `carriers_rating.violations` |
| Правило 3: назначение по последней точке трека в 300 м; несовпадение с планом — флаг | ✅ | `detect_destination`, `deviation_flag` |
| Правило 4: рейтинг чистоты, 14 дней, фото водителя ×2 | ✅ | `recompute_site_cleanliness`, параметры в `app_settings` |
| Правило 5: «заявлено» / «реально вторсырьё» | ✅ | `_dashboard_metrics` |
| Приёмка: путь до статуса 6; сумма кг итогов = вес партии; флаги на тестовых сценариях | ✅ | SQL-тест: 3 сценария (честный рейс, смешанный рейс, раздельный рейс на полигон), 69 проверок |

## Раздел 11.3. Админка справочников

| Требование | Статус | Где / как |
|---|---|---|
| Площадки и контейнеры: точка на карте | ✅ | `/admin` → MapLibre, клик ставит точку |
| Генерация и печать QR-наклеек (PDF) | ✅ | выбранные площадки → PDF, 4 наклейки на лист, ссылка `/s/{qr}` |
| Объекты, перевозчики, машины, маршруты | ✅ | вкладки CRUD |
| waste_rules и правила бонусов (P1) | ✅ | вкладки CRUD |
| Пользователи и выдача ролей | ✅ | вкладка «Пользователи» |

## Инфраструктура (только облако, в основном GitHub)

| Что | Статус |
|---|---|
| CI на каждый PR: SQL-тесты на PostGIS, генерация сида, OpenAPI lint + типы, тесты REST, `deno check`, сборка веба, i18n, pytest | ✅ |
| Docker-образ ИИ → GHCR; модель → GitHub Releases (workflow «AI · модель») | ✅ (запуск после merge) |
| GitHub Pages: PWA + Redoc + моки | 🟡 включить Pages (Settings → Pages → GitHub Actions) |
| Автодеплой Supabase из main | 🟡 нужен проект Supabase и 3 секрета (см. `DEPLOY.md`) |
| Codespaces: всё окружение одной кнопкой | ✅ `.devcontainer/` |

## Что осталось за рамками этапа 1

* Обучение модели на GPU Kaggle и 30–50 фото Астаны — запуск ноутбука, данные нужно снять.
* Создание облачного проекта Supabase и секретов — нужен ваш аккаунт.
* Блоки C, D, E (команда) подключаются по `docs/INTEGRATION.md`; H, F, G — следующие этапы.

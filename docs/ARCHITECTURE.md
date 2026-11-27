# Архитектура «Қайда?»

```
 Телефон / ноутбук (PWA, Next.js)                  GitHub Pages / Vercel
   │  supabase-js (RLS)          │  REST /functions/v1/api
   ▼                             ▼
 ┌──────────────── Supabase ─────────────────────────────────────┐
 │ Auth (email, DEMO_MODE)   Storage (photos, models3d)  Realtime │
 │ Edge Function `api` (Deno) ── проверка, фото → Storage, ИИ ──┐ │
 │ PostgreSQL 17 + PostGIS                                       │ │
 │   таблицы (раздел 3) · RLS по ролям (раздел 2)                │ │
 │   функции API (раздел 4) · логика пути (раздел 7, триггеры)   │ │
 └───────────────────────────────────────────────────────────────┘ │
                                                                    ▼
                                    ИИ-сервис (Docker, GHCR): FastAPI + ONNX Runtime
                                    /ai/analyze · /ai/health — VPS / Codespaces / любой Docker-хост
                                    модель: GitHub Releases ← workflow «AI · модель» ← Kaggle/Colab
```

## Принципы

1. **Логика в базе.** Правила раздела 7 (mixed_flag, geofence, доли веса, рейтинг чистоты,
   «заявлено/реально») — триггеры и функции PostgreSQL. Одинаково работают для приложения
   водителя, симулятора, сидов и любой будущей интеграции; проверяются SQL-тестом.
2. **Права в базе.** RLS на всех таблицах + проверка роли внутри каждой функции
   (`require_role`). Edge Function ходит в базу **от имени пользователя** (его JWT), а не
   service_role — обойти права через API нельзя. service_role нужен только демо-входу.
3. **Тонкий REST.** Edge Function `api` — роутер: валидация, загрузка фото, вызов ИИ, RPC.
   Код роутера (`handler.ts`) не зависит от Deno и тестируется в Node на заглушках.
4. **Контракт первым.** `contracts/openapi.yaml` → типы TS → клиент → моки с настоящей базы.
5. **Модель отдельно от правил.** Модель знает только 13 классов; «класс → контейнер»,
   подсказки ru/kk — в `waste_rules` (единый источник `contracts/waste-rules.json`, из него
   генерируется сид и его читает ИИ-сервис). Город может переопределить правила (`city_id`).
6. **Идемпотентность.** `client_id` у вывозов, жалоб, сдач; GPS — уникальность
   (vehicle_id, recorded_at); бонусы — уникальность (user, source_type, source_id).
   Повтор из офлайн-очереди не создаёт дублей и двойных начислений.
7. **Мультигород.** `cities` → `districts` → `sites`; акимат видит «свой город»
   (`profiles.city_id`), правила waste_rules — по городу.

## Цепочка пути отходов (раздел 7)

```
containers ──pickup (фото, ИИ, mixed_flag)──► trips (GPS → track, geofence 300 м → destination)
     ──► batches (вес на приёмке) ──► batch_outputs (кг по видам, куда ушло)
     ──► next_facility (партия-потомок, parent_output_id) или buyer / energy / landfill
```

| Статус | Создаёт | Функция |
|---|---|---|
| 1 В контейнере | — | `site_path.containers` |
| 2 Вывезено | `pickup_create` | триггер `pickups_before`: mixed_flag (правило 2) |
| 3 В пути | `trip_start`, `trip_add_positions` | `current_position` |
| 4 Принято | `batch_create` | |
| 5 Отсортировано | `batch_add_outputs` | сумма ≤ вес (constraint trigger) |
| 6 Итог | `batch_add_outputs(close)` | сумма = вес партии, `outcome` по категориям |

* Правило 1 — `trip_site_shares`: доля площадки = Σ(объём × заполненность) её контейнеров / Σ по рейсу.
* Правило 2 — `tg_pickups_before` + `apply_trip_rules` (приезд на полигон).
* Правило 3 — `apply_trip_rules`: последняя точка трека в `geofence_radius_m` объекта; ≠ план → `deviation_flag`.
* Правило 4 — `recompute_site_cleanliness`: 14 дней, фото водителя ×2 (настройки в `app_settings`).
* Правило 5 — `_dashboard_metrics`: `claimed_recycled_t` / `real_recycled_t`.

## ИИ-сервис (раздел 6)

`decode (EXIF, ≤1280 px) → яркость/резкость → letterbox 640 → ONNX Runtime → порог 0.35 →
NMS по классам → класс модели → наш класс → waste_rules → correct/contamination/tips`.
Поддерживаются оба формата выхода Ultralytics (`[1,4+nc,N]` и end-to-end `[1,N,6]`), имена
классов — из метаданных ONNX. До дообучения работает стартовая COCO-модель с картой
COCO → наши классы (`app/coco_map.py`), версия помечается `-coco`.
Очередь: семафор `MAX_CONCURRENCY` + таймаут → `503 BUSY`; лимит `RATE_LIMIT_PER_MIN` на пользователя → `429`.

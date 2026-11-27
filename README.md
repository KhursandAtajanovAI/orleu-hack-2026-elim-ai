# «Қайда?» · ELIM AI · Órleu Hack 2026

**Трек:** Кейс 1. Экология Казахстана · **Онлайн-этап:** до 27 ноября 2026, 23:00

[![CI](https://github.com/KhursandAtajanovAI/orleu-hack-2026-elim-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/KhursandAtajanovAI/orleu-hack-2026-elim-ai/actions/workflows/ci.yml)

## О проекте

«Қайда?» («Куда?») показывает жителю Астаны, куда на самом деле уходят отходы его дома.
Житель фотографирует отходы или сканирует QR на контейнере → **собственная ИИ-модель**
говорит, что это и в какой контейнер, и оценивает чистоту → приложение показывает **путь
отходов**: вывоз → рейс мусоровоза с GPS-треком → приёмка на сортировке → итог по видам
(вторсырьё / энергия / полигон) → при нарушении — **жалоба** в акимат. Акимат видит разрыв
«заявлено как переработанное / реально стало вторсырьём» и рейтинг перевозчиков.

Одно приложение (PWA: сайт + телефон), роли: гость, житель, водитель, оператор приёмки,
акимат, администратор.

## Демо

**Сайт (PWA):** https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/ — «Войти» → любая демо-роль, пароль не нужен.
Данные — облачный стенд Supabase, наполненный симулятором (14 дней истории Астаны, машины в реальном времени).

| Роль | Экран | Что посмотреть |
|---|---|---|
| Гость / житель | [`/scan/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/scan/) | Фото → **наша модель waste-yolo прямо в браузере** → контейнер и во что перерабатывается; проверка контейнера (% загрязнения); штрихкод → база 619 упаковок; жалоба с фото и местом |
| Гость | `/s/<QR-код>` | Наклейка на контейнере → путь отходов этого двора: шаги 1–6, рейс, объект, итог в кг |
| Все | [`/map/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/map/), [`/workshop/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/workshop/) | 3D-карта Астаны с машинами и потоками, 3D-цех сортировки |
| Житель | [`/bonuses/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/bonuses/), [`/shop/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/shop/) | Баланс, личный QR (меняется каждые 5 мин), история; магазин и промокоды партнёров |
| Все | [`/recycling/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/recycling/), [`/market/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/market/) | Справочник «куда сдать»; B2B-маркетплейс вторсырья с происхождением партий |
| Водитель | [`/driver/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/driver/) | Маршрут, GPS, фото на площадке → «Вывезено», офлайн-очередь |
| Оператор | [`/operator/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/operator/) | Очередь машин, приёмка партии, итог сортировки, сдача жителя по QR → бонусы |
| Акимат | [`/dashboard/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/dashboard/) | Разрыв «заявлено / реально», рейтинги площадок и перевозчиков, жалобы, Excel/PDF |
| Админ | [`/admin/`](https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/admin/) | Справочники, роли, QR-наклейки, пульт симулятора, выплаты бонусов |

* Документация API и моки: https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/api/
* Модель: релиз [`model-waste-yolo-0.1`](https://github.com/KhursandAtajanovAI/orleu-hack-2026-elim-ai/releases/tag/model-waste-yolo-0.1) — YOLO11n, дообучена на TACO + TrashNet + синтетике, 13 классов, mAP50 0,39–0,42 на тесте, 74% правильного контейнера ([отчёт](docs/AI_MVP_REPORT.md))
* Образ ИИ-сервиса (серверный вариант той же модели): `ghcr.io/khursandatajanovai/kaida-ai:latest`

## Что сделано (по блокам ТЗ)

| Блок | Что сделано | Отчёт |
|---|---|---|
| **A · бэкенд и данные** | PostgreSQL + PostGIS, роли и RLS, путь отходов (статусы 1–6, правила раздела 7), 90+ функций БД и RPC, Edge Function REST API, демо-вход | [STAGE1](docs/STAGE1_REPORT.md) |
| **B · ИИ** | Пайплайн обучения, дообученная модель, ИИ-сервис FastAPI + ONNX; распознавание в браузере (onnxruntime-web); база упаковок по штрихкоду | [AI_MVP](docs/AI_MVP_REPORT.md) |
| **C · житель** | Фото → контейнер, проверка контейнера, штрихкод, жалоба, страница площадки по QR | [FINAL](docs/FINAL_REPORT.md) |
| **D, E · 3D** | 3D-карта с машинами и потоками, 3D-цех сортировки — на живых данных | [FINAL](docs/FINAL_REPORT.md) |
| **F · кабинеты** | Дашборд акимата и жалобы, кабинет водителя, кабинет оператора | [STAGE3](docs/STAGE3_REPORT.md) |
| **G · бонусы и маркетплейсы** | Пул дома, магазин, B2B-маркетплейс, справочник, выплаты | [STAGE4](docs/STAGE4_REPORT.md) |
| **H · симулятор** | Сиды Астаны, история за N дней, машины в реальном времени по дорогам OSRM — в GitHub Actions | [STAGE1](docs/STAGE1_REPORT.md) |

## Стек

| Часть | Технология |
|---|---|
| Фронтенд | Next.js 15 (React 19, TypeScript), PWA, Tailwind CSS, MapLibre GL; i18n ru/kk |
| Бэкенд | Supabase: PostgreSQL 17 + PostGIS, Auth, Storage, Realtime, Edge Functions (Deno) |
| ИИ-сервис | Python 3.12, FastAPI, ONNX Runtime (CPU), Docker |
| Обучение | PyTorch, Ultralytics YOLO11n/s, Kaggle/Colab GPU |
| Контракты | OpenAPI 3.1, openapi-typescript, Redoc, Prism (моки) |
| Инфраструктура | GitHub Actions, GHCR, GitHub Pages, GitHub Releases (веса модели), Codespaces |

Внешних платных API нет: ИИ — собственная модель, работает прямо в браузере (onnxruntime-web) или на своём сервере.

## Как запустить

Всё запускается в облаке GitHub — локальная установка не обязательна.

**Вариант 1 · Codespaces (рекомендуется).** Code → Codespaces → Create. Зависимости ставятся сами.

```bash
cd db && supabase start            # PostgreSQL+PostGIS, Auth, Storage, Realtime, Edge Functions; миграции применяются сами
supabase functions serve api --env-file ../.env --no-verify-jwt   # REST API на :54321/functions/v1/api
cd ../ai && uvicorn app.main:app --port 8000                       # ИИ-сервис (нужна модель, см. ниже)
npm run dev -w @kaida/web                                          # веб на :3000
npm run contracts:mock                                             # мок API по OpenAPI на :4010
```

**Модель ИИ.** Actions → «AI · модель» → Run workflow: экспортирует YOLO11n в ONNX, проверяет
скорость на CPU и публикует `model.onnx` в GitHub Releases и образ в GHCR. Дообучение на
отходах — ноутбук [`ai/training/notebooks/train_kaggle.ipynb`](ai/training/notebooks/train_kaggle.ipynb) (GPU Kaggle/Colab).

**Тесты.**

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres db/scripts/apply_local.sh --tests   # 69 проверок пути отходов и прав
npm run test:api                                   # 22 теста REST-роутера
cd ai && pytest -q                                 # 25 тестов ИИ-сервиса и подготовки датасетов
```

Деплой в облако (Supabase, ИИ-сервис, Pages) — [`docs/DEPLOY.md`](docs/DEPLOY.md).
**Облачный стенд и данные подключения для команды** (URL, anon key, тестовый вход) — [`docs/CLOUD.md`](docs/CLOUD.md).

## Переменные окружения

Все переменные — в [`.env.example`](.env.example) без настоящих значений. В облаке — секреты
GitHub Actions и `supabase secrets`. Ключ `service_role` никогда не попадает во фронт.

## Структура проекта

```
contracts/   OpenAPI 3.1, waste-rules.json (13 классов ИИ), типы TS, клиент, моки — общий контракт для всех потоков
db/          Supabase: migrations/ (схема, роли, RLS, логика пути, API-функции), functions/api (REST), tests/, scripts/
ai/          ИИ-сервис (app/), обучение (training/), тесты, Dockerfile
web/         Next.js PWA: вход (DEMO_MODE), админка справочников; сюда подключаются модули C, D, E, F
simulator/   поток H — тестовые данные и симулятор (этап 3)
assets/      3D-модели и медиа (поток E)
docs/        архитектура, интеграция для команды, деплой, отчёт по этапу
```

Как подключить свой модуль (C — приложение жителя, D — 3D-карта, E — 3D-цех) —
[`docs/INTEGRATION.md`](docs/INTEGRATION.md). Архитектура — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Команда

- Хурсанд — [@KhursandAtajanovAI](https://github.com/KhursandAtajanovAI), капитан · бэкенд и данные (A), ИИ (B), данные и симулятор (H), кабинеты и дашборд (F), бонусы и маркетплейсы (G)
- Адилет — [@adilet-G](https://github.com/adilet-G)
- Диас — [@Dias-Kayrullin](https://github.com/Dias-Kayrullin)

Лицензии: Ultralytics YOLO — AGPL-3.0 (для хакатона подходит; перед коммерческим запуском — их
коммерческая лицензия или детектор с разрешительной лицензией). TACO — CC BY 4.0, TrashNet — MIT.

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

**Что уже работает (этап 1 — блоки A и B):**

| Блок | Что сделано | Где |
|---|---|---|
| **A · бэкенд и данные** | Схема PostgreSQL + PostGIS (27 таблиц), роли и RLS, логика пути отходов (статусы 1–6, правила 1–5 раздела 7), 40+ методов API, Edge Function REST API, тестовый вход DEMO_MODE, админка справочников с картой и QR-наклейками | [`db/`](db), [`web/`](web) |
| **B · ИИ** | ИИ-сервис FastAPI + ONNX Runtime в Docker: детекция, фильтр уверенности, waste_rules, % загрязнения, проверка яркости/резкости, очередь и лимит частоты; пайплайн обучения YOLO (TACO + TrashNet + Roboflow → 13 классов, 80/10/10, снег/ночь, экспорт ONNX, бенчмарк CPU) | [`ai/`](ai) |
| **Контракты** | OpenAPI 3.1, типы TypeScript, типизированный клиент, 16 моков, снятых с настоящей базы — фронт (потоки C, D, F) работает на моках параллельно | [`contracts/`](contracts) |
| **CI/CD** | GitHub Actions: SQL-тесты на PostGIS, тесты API и ИИ, сборка веба, Docker → GHCR, релиз модели, GitHub Pages, автодеплой Supabase из main; Codespaces | [`.github/`](.github), [`.devcontainer/`](.devcontainer) |

Подробный отчёт по пунктам ТЗ — [`docs/STAGE1_REPORT.md`](docs/STAGE1_REPORT.md).

## Демо

* Документация API и моки: https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/api/ (после включения Pages)
* Веб-приложение (PWA): https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/
* Образ ИИ-сервиса: `ghcr.io/khursandatajanovai/kaida-ai:latest`

## Стек

| Часть | Технология |
|---|---|
| Фронтенд | Next.js 15 (React 19, TypeScript), PWA, Tailwind CSS, MapLibre GL; i18n ru/kk |
| Бэкенд | Supabase: PostgreSQL 17 + PostGIS, Auth, Storage, Realtime, Edge Functions (Deno) |
| ИИ-сервис | Python 3.12, FastAPI, ONNX Runtime (CPU), Docker |
| Обучение | PyTorch, Ultralytics YOLO11n/s, Kaggle/Colab GPU |
| Контракты | OpenAPI 3.1, openapi-typescript, Redoc, Prism (моки) |
| Инфраструктура | GitHub Actions, GHCR, GitHub Pages, GitHub Releases (веса модели), Codespaces |

Внешних платных API нет: ИИ — собственная модель на своём сервере.

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

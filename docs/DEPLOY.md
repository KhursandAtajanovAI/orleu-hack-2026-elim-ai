# Деплой «Қайда?» в облако

Всё разворачивается из GitHub: Actions собирают и публикуют, локальная машина не нужна.

| Что | Куда | Workflow |
|---|---|---|
| База, RLS, логика, Storage, Edge Function `api` | Supabase (бесплатный проект) | `supabase-deploy.yml` (push в `main`) |
| Веб-приложение (PWA) + документация API + моки | GitHub Pages (или Vercel) | `pages.yml` (push в `main`) |
| Модель `model.onnx` | GitHub Releases, тег `model-<версия>` | `ai-model.yml` (Run workflow) |
| Образ ИИ-сервиса | GHCR `ghcr.io/<owner>/kaida-ai` | `ci.yml` → job `ai-image` (push в `main`), `ai-model.yml` |

## 1. Supabase

1. Создать проект на supabase.com (регион — Frankfurt/Европа, ближе к Казахстану), запомнить пароль БД.
2. В репозитории: Settings → Secrets and variables → Actions → **Secrets**:
   * `SUPABASE_ACCESS_TOKEN` — supabase.com → Account → Access Tokens;
   * `SUPABASE_PROJECT_REF` — id проекта (из URL `https://<ref>.supabase.co`);
   * `SUPABASE_DB_PASSWORD` — пароль БД.
3. Секреты Edge Function (один раз, из Codespaces или Supabase Dashboard → Edge Functions → Secrets):
   ```bash
   supabase secrets set --project-ref <ref> \
     AI_SERVICE_URL=https://<хост-ИИ> AI_SERVICE_KEY=<ключ> AI_TIMEOUT_MS=8000 \
     DEMO_MODE=true DEMO_PASSWORD=<длинный-случайный>
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` Supabase подставляет в функции сам.
4. Push в `main` → workflow «Supabase · deploy»: `supabase link` → `db push` (6 миграций) →
   `functions deploy api --no-verify-jwt`. Без секретов шаг пропускается, а не падает.
5. Auth → URL Configuration: добавить адрес сайта (Pages/Vercel) в Site URL и Redirect URLs
   (нужно для входа по ссылке на email).

Проверка: `curl https://<ref>.supabase.co/functions/v1/api/health` → `{"status":"ok",...}`.

## 2. Модель ИИ

Actions → **AI · модель** → Run workflow (по умолчанию `yolo11n.pt`, версия `waste-yolo-0.0-coco`, карта классов `coco`):
экспорт в ONNX с метаданными версии → бенчмарк на CPU раннера (отчёт в summary) → smoke-тест
ИИ-сервиса → Release `model-<версия>` с `model.onnx` и `bench.json` → образ в GHCR.

Дообученная модель: ноутбук `ai/training/notebooks/train_kaggle.ipynb` на GPU Kaggle/Colab →
`best.pt` → тот же workflow с входами `weights=<URL на best.pt>`, `version=waste-yolo-0.1`, `class_map=native`.

## 3. ИИ-сервис

Образ без GPU, ~300 МБ. Модель берётся из `MODEL_URL` при старте (или запечена при сборке).

```bash
docker run -d -p 8000:8000 \
  -e MODEL_URL=https://github.com/<owner>/<repo>/releases/download/model-waste-yolo-0.0-coco/model.onnx \
  -e AI_API_KEY=<тот же, что AI_SERVICE_KEY> \
  -e LOG_URL=https://<ref>.supabase.co/rest/v1/rpc/log_event -e LOG_KEY=<anon key> \
  ghcr.io/<owner>/kaida-ai:latest
```

Где запустить бесплатно/дёшево: любой VPS с Docker, Render / Fly.io / Railway (Docker-образ из GHCR),
на время демо — GitHub Codespaces (порт 8000 → Ports → Public). Нужен HTTPS-адрес для `AI_SERVICE_URL`.

## 4. Веб (GitHub Pages)

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → **Variables**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon-ключ публичный, его можно
   во фронт), `NEXT_PUBLIC_DEMO_MODE=true`.
3. Push в `main` → `https://<owner>.github.io/<repo>/` (приложение), `/api/` (Redoc), `/mocks/` (JSON).

Vercel (по ТЗ): Import Project → Root Directory `web`, те же переменные `NEXT_PUBLIC_*`, без `NEXT_BASE_PATH`.

## 5. Продакшен-чеклист

* `DEMO_MODE=false` в секретах функции и `NEXT_PUBLIC_DEMO_MODE=false` — тестовый вход выключается.
* `service_role` — только в секретах Supabase; во фронте и в репозитории его нет.
* Первый администратор: войти по email, затем в SQL Editor
  `update profiles set roles = array['admin']::app_role[] where user_id = (select id from auth.users where email = '...');`
* `app_settings` (SQL Editor) — радиус вывоза и привязки фото, окно рейтинга чистоты, вес фото водителя;
  радиус geofence — у каждого объекта (`facilities.geofence_radius_m`, по умолчанию 300 м).

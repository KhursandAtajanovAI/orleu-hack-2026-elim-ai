# Облачный стенд «Қайда?» — данные подключения для команды

Бесплатный проект Supabase `kaida` (регион eu-central-1, Франкфурт), создан 27.11.2026.
Всё ниже можно сразу подставлять во фронт (C, D, E, F): anon-ключ публичный, а права проверяют RLS
и функции базы. Ключ `service_role` и пароль базы данных сюда **не** кладём: они дают полный доступ.

| Что | Значение |
|---|---|
| Project ref | `xqscpsytnferdggitdzf` |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | `https://xqscpsytnferdggitdzf.supabase.co` |
| REST API (раздел 4) / `NEXT_PUBLIC_API_URL` | `https://xqscpsytnferdggitdzf.supabase.co/functions/v1/api` |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhxc2Nwc3l0bmZlcmRnZ2l0ZHpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3ODE3NTUsImV4cCI6MjExMTM1Nzc1NX0.Ki9i0rfeTUSxblDAfsdC7goNRlvRj5dAMogqMFvaJEA` |
| Publishable key (новый формат) | `sb_publishable_jIQXXpqleZSt_AZQXt_PoA_GHW0u_1n` |
| Realtime | тот же URL и anon key; таблицы `vehicle_positions`, `reports`, `pickups`, `trips`, `batches` |
| Storage (публичный) | `https://xqscpsytnferdggitdzf.supabase.co/storage/v1/object/public/photos/…`, `…/models3d/…` |

## Секреты Edge Function `api`

Задаются в Supabase Dashboard → Edge Functions → Secrets. По решению команды значения хранятся здесь,
чтобы стенд можно было пересоздать.

| Секрет | Значение | SHA256 (как показывает Dashboard) |
|---|---|---|
| `DEMO_MODE` | `true` | `b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b` |
| `DEMO_PASSWORD` | `123456789011` | `eaa288b97091fc5f9a53f2fc5ee6ab8effeaf16770d7e25a8b136a4061d51822` |
| `AI_SERVICE_URL`, `AI_SERVICE_KEY` | ещё не заданы: ИИ-сервис не развёрнут, `/scans` отвечает `AI_UNAVAILABLE` | — |

`DEMO_PASSWORD` нужен только серверу: фронт входит через `demo-login` и пароль не знает. Перед
настоящим запуском поставьте `DEMO_MODE=false` и смените пароль.

## Тестовый вход

```ts
const s = await api.demoLogin('driver', 1);          // resident | driver | operator | akimat | admin
await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
```

```bash
curl -s https://xqscpsytnferdggitdzf.supabase.co/functions/v1/api/health
curl -s -X POST https://xqscpsytnferdggitdzf.supabase.co/functions/v1/api/auth/demo-login \
  -H 'content-type: application/json' -d '{"role":"admin","index":1}'
```

Аккаунты имеют вид `demo.<роль>.<n>@kaida.demo`; пароль — `DEMO_PASSWORD`.

## Состояние (27.11.2026)

* Применены миграции 1–6 (схема, роли и RLS, логика пути, API, справочники waste_rules/bonus_rules).
* Функция `api` задеплоена. Проверено: `/health` → `ok`, `demo_mode: true`; тестовый вход выдаёт токен; `/waste-rules` отдаёт справочник.
* Тестовые данные (площадки Астаны, рейсы, партии) появятся после запуска симулятора (поток H).

Вход в Dashboard: https://supabase.com/dashboard/project/xqscpsytnferdggitdzf

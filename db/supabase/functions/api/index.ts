/**
 * Supabase Edge Function `api` — точка входа (Deno).
 * Деплой: supabase functions deploy api --no-verify-jwt   (гостевые методы без входа)
 * Переменные окружения (supabase secrets set ...):
 *   AI_SERVICE_URL   — адрес ИИ-сервиса, например https://kaida-ai.example.kz
 *   AI_SERVICE_KEY   — общий ключ X-AI-Key (тот же, что AI_API_KEY у ИИ-сервиса)
 *   DEMO_MODE        — "true" включает тестовый вход по роли без пароля
 *   DEMO_PASSWORD    — пароль демо-аккаунтов (никогда не уходит на клиент)
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — выставляет сама платформа
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { createHandler, HttpError, type AiResponse, type Db, type Deps } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AI_URL = (Deno.env.get('AI_SERVICE_URL') ?? '').replace(/\/$/, '');
const AI_KEY = Deno.env.get('AI_SERVICE_KEY') ?? '';
const DEMO_MODE = (Deno.env.get('DEMO_MODE') ?? 'false').toLowerCase() === 'true';
const DEMO_PASSWORD = Deno.env.get('DEMO_PASSWORD') ?? '';
const AI_TIMEOUT_MS = Number(Deno.env.get('AI_TIMEOUT_MS') ?? 8000);

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const admin: SupabaseClient | null = SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function userClient(authHeader: string | null): SupabaseClient {
  if (!authHeader || /^Bearer\s+$/i.test(authHeader) || authHeader === `Bearer ${ANON_KEY}`) return anon;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

async function aiFetch(path: string, init: RequestInit): Promise<Response> {
  if (!AI_URL) throw new Error('AI_SERVICE_URL не задан');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(AI_URL + path, { ...init, signal: ctrl.signal, headers: { ...(init.headers ?? {}), 'X-AI-Key': AI_KEY } });
  } finally {
    clearTimeout(t);
  }
}

const DEMO_ROLE_EXTRA: Record<string, string[]> = { admin: ['admin', 'akimat'], akimat: ['akimat'] };

const deps: Deps = {
  userDb: (auth) => userClient(auth) as unknown as Db,
  async getUserId(auth) {
    if (!auth) return null;
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token || token === ANON_KEY) return null;
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  },
  async uploadPhoto(auth, userId, file, kind) {
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const day = new Date().toISOString().slice(0, 10);
    const path = `${userId}/${kind}/${day}/${crypto.randomUUID()}.${ext}`;
    const { error } = await userClient(auth).storage.from('photos').upload(path, file, {
      contentType: file.type || 'image/jpeg', upsert: false, cacheControl: '31536000',
    });
    if (error) throw new HttpError(500, 'UPLOAD_FAILED', 'Не удалось сохранить фото: ' + error.message);
    return anon.storage.from('photos').getPublicUrl(path).data.publicUrl;
  },
  async aiAnalyze(file, mode, containerType): Promise<AiResponse> {
    const fd = new FormData();
    fd.append('image', file, 'photo.jpg');
    fd.append('mode', mode);
    if (containerType) fd.append('container_type', containerType);
    let res: Response;
    try {
      res = await aiFetch('/ai/analyze', { method: 'POST', body: fd });
    } catch (e) {
      return { ok: false, status: 503, code: 'AI_UNAVAILABLE', message: 'ИИ-сервис временно недоступен' + (e instanceof Error ? ` (${e.message})` : '') };
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = body?.error ?? {};
      return { ok: false, status: res.status >= 500 ? 503 : res.status, code: err.code ?? 'AI_ERROR', message: err.message ?? 'Ошибка ИИ-сервиса' };
    }
    return { ok: true, data: body };
  },
  async aiHealth() {
    const res = await aiFetch('/ai/health', { method: 'GET' });
    return await res.json();
  },
  async demoLogin(role, index) {
    if (!admin || !DEMO_PASSWORD) throw new HttpError(500, 'DEMO_MISCONFIGURED', 'Нужны SUPABASE_SERVICE_ROLE_KEY и DEMO_PASSWORD');
    const email = `demo.${role}.${index}@kaida.demo`;
    let session = await anon.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    if (session.error) {
      // первый вход: создаём демо-пользователя и выдаём роль
      const created = await admin.auth.admin.createUser({
        email, password: DEMO_PASSWORD, email_confirm: true,
        user_metadata: { full_name: `Демо: ${role} ${index}`, language: 'ru' },
      });
      if (created.error && !/already/i.test(created.error.message)) throw new HttpError(500, 'DEMO_FAILED', created.error.message);
      session = await anon.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
      if (session.error) throw new HttpError(500, 'DEMO_FAILED', session.error.message);
    }
    const uid = session.data.user!.id;
    const roles = DEMO_ROLE_EXTRA[role] ?? [role];
    await admin.from('profiles').update({
      roles: Array.from(new Set(role === 'resident' ? roles : ['resident', ...roles])),
      is_demo: true, consent_data: true,
    }).eq('user_id', uid);
    return {
      access_token: session.data.session!.access_token,
      refresh_token: session.data.session!.refresh_token,
      expires_in: session.data.session!.expires_in,
      user: { id: uid, email, role },
    };
  },
  env: { DEMO_MODE, VERSION: Deno.env.get('APP_VERSION') ?? '0.1.0', MAX_UPLOAD_BYTES: 2 * 1024 * 1024 },
};

Deno.serve(createHandler(deps));

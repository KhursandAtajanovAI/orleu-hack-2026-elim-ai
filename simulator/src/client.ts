/**
 * Клиент публичного API для симулятора: PostgREST (таблицы и RPC — те же функции, что у
 * REST /functions/v1/api), Storage и вход демо-аккаунтов. Всё — от имени пользователя
 * (его JWT), поэтому работают RLS и проверки ролей, как у настоящего приложения.
 *
 * Вход:
 *   основной   — POST {SUPABASE_URL}/functions/v1/api/auth/demo-login (нужен только anon key);
 *   локально   — если Edge Function не запущена, а задан SUPABASE_SERVICE_ROLE_KEY + DEMO_PASSWORD,
 *                делаем то же, что demo-login (создать пользователя, выдать роль, войти).
 */

export interface Config {
  url: string;
  anonKey: string;
  apiUrl: string;
  serviceKey?: string;
  demoPassword?: string;
  verbose?: boolean;
}

export function configFromEnv(): Config {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) {
    throw new Error('Нужны SUPABASE_URL и SUPABASE_ANON_KEY (см. simulator/README.md)');
  }
  return {
    url, anonKey,
    apiUrl: (process.env.API_URL ?? `${url}/functions/v1/api`).replace(/\/$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    demoPassword: process.env.DEMO_PASSWORD || undefined,
    verbose: process.env.SIM_VERBOSE === '1',
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(`${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

/** Ошибка PostgREST: функции БД бросают 'CODE: сообщение' */
function parseError(status: number, body: unknown): ApiError {
  const b = body as { message?: string; code?: string; error?: { code: string; message: string } } | null;
  if (b?.error?.code) return new ApiError(status, b.error.code, b.error.message);
  const m = /^([A-Z_]{3,40}): (.*)$/s.exec(b?.message ?? '');
  if (m) return new ApiError(status, m[1], m[2]);
  return new ApiError(status, b?.code ?? `HTTP_${status}`, b?.message ?? JSON.stringify(body));
}

let calls = 0;
export const callCount = () => calls;

async function request(cfg: Config, method: string, url: string, token: string | null, body?: unknown, headers: Record<string, string> = {}, raw?: BodyInit): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    calls++;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${token ?? cfg.anonKey}`,
          ...(raw ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
    } catch (e) {
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw e;
    }
    if ((res.status === 429 || res.status >= 502) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 700 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) throw parseError(res.status, data);
    return data;
  }
}

export interface Session { token: string; userId: string; email: string; role: string; index: number }

export class Api {
  cfg: Config;
  private sessions = new Map<string, Session>();
  private edgeOk: boolean | null = null;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  // -------------------------------------------------------------- вход
  async login(role: string, index = 1): Promise<Session> {
    const key = `${role}.${index}`;
    const cached = this.sessions.get(key);
    if (cached) return cached;
    let s: Session | null = null;
    if (this.edgeOk !== false) {
      try {
        const r = (await request(this.cfg, 'POST', `${this.cfg.apiUrl}/auth/demo-login`, null, { role, index })) as {
          access_token: string; user: { id: string; email: string };
        };
        s = { token: r.access_token, userId: r.user.id, email: r.user.email, role, index };
        this.edgeOk = true;
      } catch (e) {
        if (this.edgeOk === true || !this.cfg.serviceKey) throw e;
        this.edgeOk = false;
        console.warn(`demo-login через Edge Function недоступен (${(e as Error).message}) — вход через service role`);
      }
    }
    if (!s) s = await this.localDemoLogin(role, index);
    this.sessions.set(key, s);
    return s;
  }

  /** То же, что demo-login в Edge Function (db/supabase/functions/api/index.ts) */
  private async localDemoLogin(role: string, index: number): Promise<Session> {
    const { serviceKey, demoPassword } = this.cfg;
    if (!serviceKey || !demoPassword) throw new Error('Для входа без Edge Function нужны SUPABASE_SERVICE_ROLE_KEY и DEMO_PASSWORD');
    const email = `demo.${role}.${index}@kaida.demo`;
    const signIn = () => request(this.cfg, 'POST', `${this.cfg.url}/auth/v1/token?grant_type=password`, null, { email, password: demoPassword }) as
      Promise<{ access_token: string; user: { id: string } }>;
    let r: { access_token: string; user: { id: string } };
    try {
      r = await signIn();
    } catch {
      await request(this.cfg, 'POST', `${this.cfg.url}/auth/v1/admin/users`, serviceKey, {
        email, password: demoPassword, email_confirm: true, user_metadata: { full_name: `Демо: ${role} ${index}`, language: 'ru' },
      }).catch((e) => { if (!/already|exists/i.test(String(e))) throw e; });
      r = await signIn();
    }
    const extra: Record<string, string[]> = { admin: ['admin', 'akimat'], akimat: ['akimat'] };
    const roles = [...new Set(role === 'resident' ? ['resident'] : ['resident', ...(extra[role] ?? [role])])];
    await request(this.cfg, 'PATCH', `${this.cfg.url}/rest/v1/profiles?user_id=eq.${r.user.id}`, serviceKey,
      { roles, is_demo: true, consent_data: true }, { Prefer: 'return=minimal' });
    return { token: r.access_token, userId: r.user.id, email, role, index };
  }

  // -------------------------------------------------------------- данные
  rpc<T = any>(s: Session | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
    return request(this.cfg, 'POST', `${this.cfg.url}/rest/v1/rpc/${fn}`, s?.token ?? null, clean) as Promise<T>;
  }

  select<T = any>(s: Session | null, table: string, query = ''): Promise<T[]> {
    return request(this.cfg, 'GET', `${this.cfg.url}/rest/v1/${table}?${query}`, s?.token ?? null) as Promise<T[]>;
  }

  /** upsert по id (идемпотентные сиды) */
  upsert(s: Session, table: string, rows: Record<string, unknown>[], onConflict = 'id'): Promise<unknown> {
    if (!rows.length) return Promise.resolve([]);
    return request(this.cfg, 'POST', `${this.cfg.url}/rest/v1/${table}?on_conflict=${onConflict}`, s.token, rows,
      { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }

  update(s: Session, table: string, filter: string, patch: Record<string, unknown>): Promise<unknown> {
    return request(this.cfg, 'PATCH', `${this.cfg.url}/rest/v1/${table}?${filter}`, s.token, patch, { Prefer: 'return=minimal' });
  }

  /** Загрузка фото в Storage (бакет photos, папка пользователя) → публичный URL */
  async uploadPhoto(s: Session, path: string, data: Uint8Array, contentType = 'image/jpeg'): Promise<string> {
    const full = `${s.userId}/${path}`;
    // без upsert: у жителя есть право только добавлять файлы в свою папку; повтор = файл уже на месте
    await request(this.cfg, 'POST', `${this.cfg.url}/storage/v1/object/photos/${full}`, s.token, undefined,
      { 'Content-Type': contentType, 'Cache-Control': '31536000' }, new Blob([new Uint8Array(data)], { type: contentType }))
      .catch((e: ApiError) => { if (!/duplicate|already exists|409/i.test(`${e.code} ${e.message} ${e.status}`)) throw e; });
    return `${this.cfg.url}/storage/v1/object/public/photos/${full}`;
  }
}

/** Ограничение параллельности: map с не более чем n задачами одновременно */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

/** Детерминированный uuid из строки (идемпотентные сиды: повторный запуск обновляет те же записи) */
import { createHash } from 'node:crypto';
export function seedId(name: string): string {
  const h = createHash('sha1').update('kaida-seed:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const ewkt = (p: [number, number]) => `SRID=4326;POINT(${p[0]} ${p[1]})`;
export const ewktPolygon = (ring: [number, number][]) => `SRID=4326;MULTIPOLYGON(((${ring.map((p) => p.join(' ')).join(',')})))`;

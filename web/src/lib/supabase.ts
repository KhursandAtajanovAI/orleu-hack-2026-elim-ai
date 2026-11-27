'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createApiClient } from '@kaida/contracts';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const API_URL = process.env.NEXT_PUBLIC_API_URL || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/api` : '');
export const DEMO_MODE = (process.env.NEXT_PUBLIC_DEMO_MODE ?? 'true') === 'true';
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_ANON_KEY || 'anon', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

/** Типизированный клиент REST API из @kaida/contracts (сессия Supabase подставляется сама). */
export const api = createApiClient({
  baseUrl: API_URL || 'http://127.0.0.1:4010',
  anonKey: SUPABASE_ANON_KEY,
  getAccessToken: async () => (await supabase().auth.getSession()).data.session?.access_token,
});

/** EWKT для записи geography через PostgREST */
export const ewktPoint = (lon: number, lat: number) => `SRID=4326;POINT(${lon} ${lat})`;

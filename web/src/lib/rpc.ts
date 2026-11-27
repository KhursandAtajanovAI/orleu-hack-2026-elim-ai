'use client';
import { supabase } from './supabase';

export type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Вызов RPC Supabase: ошибка БД (api_error «КОД: текст») → исключение с текстом без кода. */
export async function rpc<T = Any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^[A-Z_]+:\s*/, ''));
  return data as T;
}

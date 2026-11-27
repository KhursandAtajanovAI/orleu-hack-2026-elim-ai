'use client';
import type { CarrierRating, DashboardSummary, SiteRating, TimeseriesPoint } from '@kaida/contracts';
import { supabase } from './supabase';

/** Фильтры дашборда (ТЗ 11: город, район, перевозчик, период сегодня / 7 / 30 дней / свой). */
export interface DashFilters {
  city_id?: string;
  district_id?: string;
  carrier_id?: string;
  period: 'today' | '7d' | '30d' | 'custom';
  from?: string; // YYYY-MM-DD (свой период)
  to?: string;
}

const TZ_OFFSET_H = 5; // Астана, UTC+5 — «сегодня» считаем по местному времени

/** Границы периода в ISO (UTC). Конец — «сейчас», чтобы сравнение с прошлым периодом было честным. */
export function periodRange(f: DashFilters): { from: string; to: string } {
  const now = new Date();
  if (f.period === 'custom' && f.from) {
    const from = new Date(`${f.from}T00:00:00+0${TZ_OFFSET_H}:00`);
    const to = f.to ? new Date(new Date(`${f.to}T00:00:00+0${TZ_OFFSET_H}:00`).getTime() + 86_400_000) : now;
    return { from: from.toISOString(), to: (to > now ? now : to).toISOString() };
  }
  if (f.period === 'today') {
    const local = new Date(now.getTime() + TZ_OFFSET_H * 3_600_000);
    const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return { from: new Date(startLocal - TZ_OFFSET_H * 3_600_000).toISOString(), to: now.toISOString() };
  }
  const days = f.period === '30d' ? 30 : 7;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

/** Ошибка RPC: функции БД бросают «CODE: сообщение» */
export function rpcError(e: { message?: string } | null): string | null {
  if (!e) return null;
  return e.message ?? 'error';
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== ''));
  const { data, error } = await supabase().rpc(fn, clean);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface DashData {
  summary: DashboardSummary;
  series: TimeseriesPoint[];
  sites: SiteRating[];
  carriers: CarrierRating[];
}

/**
 * Все блоки дашборда одним заходом: 4 RPC параллельно напрямую в PostgREST
 * (без Edge Function — так быстрее; права те же: require_role('akimat') + RLS).
 */
export async function loadDashboard(f: DashFilters): Promise<DashData> {
  const { from, to } = periodRange(f);
  const base = { p_city_id: f.city_id, p_from: from, p_to: to };
  // график: минимум 14 дней, чтобы были видны «две линии»
  const seriesFrom = new Date(Math.min(new Date(from).getTime(), new Date(to).getTime() - 13 * 86_400_000)).toISOString();
  const [summary, series, sites, carriers] = await Promise.all([
    rpc<DashboardSummary>('dashboard_summary', { ...base, p_district_id: f.district_id, p_carrier_id: f.carrier_id }),
    rpc<TimeseriesPoint[]>('dashboard_timeseries', { ...base, p_from: seriesFrom, p_district_id: f.district_id, p_carrier_id: f.carrier_id }),
    rpc<SiteRating[]>('dashboard_sites_rating', { ...base, p_district_id: f.district_id, p_limit: 500 }),
    rpc<CarrierRating[]>('dashboard_carriers_rating', base),
  ]);
  return { summary, series, sites, carriers };
}

export const fmt = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fmtDate = (iso: string | null | undefined, withTime = true) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }) }) : '—';

/** Выгрузка таблицы в Excel (HTML-таблица в .xls — открывается в Excel и LibreOffice с кириллицей). */
export function downloadXls(filename: string, sheets: { title: string; head: string[]; rows: (string | number | null | undefined)[][] }[]) {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${sheets.map((s) =>
    `<h3>${esc(s.title)}</h3><table border="1"><tr>${s.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${
      s.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table><br/>`).join('')}</body></html>`;
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

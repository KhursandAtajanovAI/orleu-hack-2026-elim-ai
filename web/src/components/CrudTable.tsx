'use client';
/**
 * Универсальная таблица справочника: список, поиск, добавление, правка, удаление.
 * Пишет напрямую в Supabase — права проверяет RLS (справочники меняет только админ).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase, ewktPoint } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

const MapPicker = dynamic(() => import('./MapPicker'), { ssr: false });

export type FieldType = 'text' | 'textarea' | 'number' | 'bool' | 'enum' | 'enum[]' | 'fk' | 'fk[]' | 'point' | 'json' | 'date' | 'color';
export interface Field {
  key: string;
  type: FieldType;
  labelKey?: string;
  options?: readonly string[];
  optionsI18n?: string;      // префикс ключей перевода опций, например 'waste'
  fk?: { table: string; label: string; filter?: Record<string, unknown> };
  required?: boolean;
  table?: boolean;           // показывать в таблице (по умолчанию да)
  readOnly?: boolean;
  default?: unknown;
}
export interface EntityConfig {
  table: string;
  titleKey: string;
  fields: Field[];
  order?: { column: string; ascending?: boolean };
  select?: string;
  pk?: string;
  onSelect?: (row: Row) => void;
}
export type Row = Record<string, unknown>;

export default function CrudTable({ config, extraFilter, onChanged }: { config: EntityConfig; extraFilter?: Record<string, unknown>; onChanged?: () => void }) {
  const { t } = useI18n();
  const pk = config.pk ?? 'id';
  const [rows, setRows] = useState<Row[]>([]);
  const [fkOptions, setFk] = useState<Record<string, { value: string; label: string }[]>>({});
  const [edit, setEdit] = useState<Row | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasPoint = config.fields.some((f) => f.type === 'point');

  const load = useCallback(async () => {
    let query = supabase().from(config.table).select(config.select ?? (hasPoint ? '*,lon,lat' : '*'));
    for (const [k, v] of Object.entries(extraFilter ?? {})) query = query.eq(k, v as string);
    if (config.order) query = query.order(config.order.column, { ascending: config.order.ascending ?? true });
    const { data, error } = await query.limit(1000);
    if (error) setError(error.message);
    else setRows((data as unknown as Row[]) ?? []);
  }, [config, extraFilter, hasPoint]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const out: Record<string, { value: string; label: string }[]> = {};
      for (const f of config.fields.filter((f) => f.fk)) {
        const { data } = await supabase().from(f.fk!.table).select(`id,${f.fk!.label}`).limit(1000);
        out[f.key] = ((data as unknown as Row[]) ?? []).map((r) => ({ value: String(r.id), label: String(r[f.fk!.label] ?? r.id) }));
      }
      setFk(out);
    })();
  }, [config]);

  const label = (f: Field) => t(f.labelKey ?? 'f.' + f.key);
  const fmt = (f: Field, v: unknown, row: Row): string => {
    if (v === null || v === undefined) return '—';
    if (f.type === 'point') return row.lon != null ? `${Number(row.lon).toFixed(5)}, ${Number(row.lat).toFixed(5)}` : '—';
    if (f.type === 'bool') return v ? t('app.yes') : t('app.no');
    if (f.type === 'enum') return f.optionsI18n ? t(`${f.optionsI18n}.${v}`) : String(v);
    if (f.type === 'enum[]') return (v as string[]).map((x) => (f.optionsI18n ? t(`${f.optionsI18n}.${x}`) : x)).join(', ');
    if (f.type === 'fk') return fkOptions[f.key]?.find((o) => o.value === v)?.label ?? String(v).slice(0, 8);
    if (f.type === 'fk[]') return (v as string[]).map((id) => fkOptions[f.key]?.find((o) => o.value === id)?.label ?? id.slice(0, 6)).join(' → ');
    if (f.type === 'json') return JSON.stringify(v);
    if (f.type === 'color') return String(v);
    return String(v);
  };

  const filtered = useMemo(() => {
    if (!q) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(s)));
  }, [rows, q]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const payload: Row = { ...(extraFilter ?? {}) };
    try {
      for (const f of config.fields) {
        if (f.readOnly) continue;
        let v = edit[f.key];
        if (f.type === 'point') {
          if (edit.lon != null && edit.lat != null) payload.location = ewktPoint(Number(edit.lon), Number(edit.lat));
          continue;
        }
        if (f.type === 'number') v = v === '' || v == null ? null : Number(v);
        if (f.type === 'json' && typeof v === 'string') v = v.trim() ? JSON.parse(v) : null;
        if ((f.type === 'text' || f.type === 'textarea' || f.type === 'fk' || f.type === 'date') && v === '') v = null;
        if (f.required && (v === null || v === undefined || v === '')) throw new Error(`${label(f)}: ${t('app.error')}`);
        if (v !== undefined) payload[f.key] = v;
      }
      const sb = supabase().from(config.table);
      const { error } = edit[pk] ? await sb.update(payload).eq(pk, edit[pk] as string) : await sb.insert(payload);
      if (error) throw new Error(error.message);
      setEdit(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Row) {
    if (!confirm(t('app.confirmDelete'))) return;
    const { error } = await supabase().from(config.table).delete().eq(pk, row[pk] as string);
    if (error) setError(error.message);
    else { await load(); onChanged?.(); }
  }

  const newRow = () => Object.fromEntries(config.fields.map((f) => [f.key, f.default ?? (f.type === 'enum[]' || f.type === 'fk[]' ? [] : f.type === 'bool' ? true : '')]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder={t('app.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-slate-500">{filtered.length} {t('admin.rows')}</span>
        <button className="btn-primary ml-auto" onClick={() => setEdit(newRow())}>+ {t('app.add')}</button>
      </div>
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {hasPoint && rows.length > 0 && (
        <MapPicker points={rows.filter((r) => r.lon != null).map((r) => ({ lon: Number(r.lon), lat: Number(r.lat), label: String(r.address ?? r.name ?? '') }))} height={260} />
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left dark:bg-slate-800">
            <tr>
              {config.fields.filter((f) => f.table !== false).map((f) => <th key={f.key} className="px-3 py-2 font-medium">{label(f)}</th>)}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={99}>{t('app.empty')}</td></tr>}
            {filtered.map((r) => (
              <tr key={String(r[pk])} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  onClick={() => config.onSelect?.(r)}>
                {config.fields.filter((f) => f.table !== false).map((f) => (
                  <td key={f.key} className="max-w-xs truncate px-3 py-2">
                    {f.type === 'color' ? <span className="inline-block h-4 w-4 rounded" style={{ background: String(r[f.key]) }} /> : fmt(f, r[f.key], r)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button className="text-brand hover:underline" onClick={(e) => { e.stopPropagation(); setEdit({ ...r, ...Object.fromEntries(config.fields.filter((f) => f.type === 'json').map((f) => [f.key, r[f.key] == null ? '' : JSON.stringify(r[f.key], null, 1)])) }); }}>{t('app.edit')}</button>
                  <button className="ml-3 text-red-600 hover:underline" onClick={(e) => { e.stopPropagation(); remove(r); }}>{t('app.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setEdit(null)}>
          <div className="card my-8 w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t(config.titleKey)}</h3>
            {config.fields.filter((f) => !f.readOnly).map((f) => (
              <label key={f.key} className="block space-y-1">
                <span className="text-sm font-medium">{label(f)}{f.required && ' *'}</span>
                <FieldInput f={f} row={edit} setRow={setEdit} fkOptions={fkOptions[f.key] ?? []} t={t} />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setEdit(null)}>{t('app.cancel')}</button>
              <button className="btn-primary" disabled={busy} onClick={save}>{t('app.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldInput({ f, row, setRow, fkOptions, t }: {
  f: Field; row: Row; setRow: (r: Row) => void; fkOptions: { value: string; label: string }[]; t: (k: string) => string;
}) {
  const v = row[f.key];
  const set = (val: unknown) => setRow({ ...row, [f.key]: val });
  const optLabel = (o: string) => (f.optionsI18n ? t(`${f.optionsI18n}.${o}`) : o);
  switch (f.type) {
    case 'bool':
      return <input type="checkbox" className="h-5 w-5" checked={Boolean(v)} onChange={(e) => set(e.target.checked)} />;
    case 'number':
      return <input type="number" step="any" className="input" value={(v as number | string) ?? ''} onChange={(e) => set(e.target.value)} />;
    case 'date':
      return <input type="date" className="input" value={String(v ?? '')} onChange={(e) => set(e.target.value)} />;
    case 'color':
      return <input type="color" className="h-10 w-20" value={String(v || '#6B7280')} onChange={(e) => set(e.target.value)} />;
    case 'textarea':
    case 'json':
      return <textarea className="input font-mono text-xs" rows={4} value={String(v ?? '')} onChange={(e) => set(e.target.value)} />;
    case 'enum':
      return (
        <select className="input" value={String(v ?? '')} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {f.options?.map((o) => <option key={o} value={o}>{optLabel(o)}</option>)}
        </select>
      );
    case 'enum[]': {
      const arr = (v as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-2">
          {f.options?.map((o) => (
            <label key={o} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${arr.includes(o) ? 'border-brand bg-brand-light text-brand-dark' : 'border-slate-300'}`}>
              <input type="checkbox" className="hidden" checked={arr.includes(o)} onChange={() => set(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])} />
              {optLabel(o)}
            </label>
          ))}
        </div>
      );
    }
    case 'fk':
      return (
        <select className="input" value={String(v ?? '')} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {fkOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'fk[]': {
      // упорядоченный список (маршрут: площадки по порядку)
      const arr = (v as string[]) ?? [];
      return (
        <div className="space-y-2">
          <ol className="space-y-1">
            {arr.map((id, i) => (
              <li key={id + i} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-right text-slate-500">{i + 1}.</span>
                <span className="flex-1">{fkOptions.find((o) => o.value === id)?.label ?? id}</span>
                <button type="button" className="btn-ghost px-2 py-0.5" disabled={i === 0} onClick={() => { const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set(a); }}>↑</button>
                <button type="button" className="btn-ghost px-2 py-0.5" onClick={() => set(arr.filter((_, j) => j !== i))}>✕</button>
              </li>
            ))}
          </ol>
          <select className="input" value="" onChange={(e) => e.target.value && set([...arr, e.target.value])}>
            <option value="">+ {t('app.add')}</option>
            {fkOptions.filter((o) => !arr.includes(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    }
    case 'point':
      return (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{t('admin.pickOnMap')}</p>
          <MapPicker value={row.lon != null && row.lon !== '' ? { lon: Number(row.lon), lat: Number(row.lat) } : null}
                     onChange={(p) => setRow({ ...row, lon: p.lon, lat: p.lat })} />
          <div className="flex gap-2">
            <input className="input" type="number" step="any" placeholder="lon" value={String(row.lon ?? '')} onChange={(e) => setRow({ ...row, lon: e.target.value })} />
            <input className="input" type="number" step="any" placeholder="lat" value={String(row.lat ?? '')} onChange={(e) => setRow({ ...row, lat: e.target.value })} />
          </div>
        </div>
      );
    default:
      return <input className="input" value={String(v ?? '')} onChange={(e) => set(e.target.value)} />;
  }
}

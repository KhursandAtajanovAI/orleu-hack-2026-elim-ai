'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@kaida/contracts';
import { ROLES } from '@kaida/contracts';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

interface U { user_id: string; full_name: string | null; email: string | null; phone: string | null; roles: Role[]; city_id: string | null; facility_id: string | null; is_demo: boolean }

/** Пользователи и выдача ролей (ТЗ 2, 11.3): водителя, оператора и акимата назначает администратор. */
export default function UsersPanel() {
  const { t } = useI18n();
  const [users, setUsers] = useState<U[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [cities, setCities] = useState<{ id: string; name_ru: string }[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('admin_users', { p_search: q || null });
    if (error) setMsg(error.message); else setUsers(data as U[]);
  }, [q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase().from('cities').select('id,name_ru').then(({ data }) => setCities(data ?? []));
    supabase().from('facilities').select('id,name').then(({ data }) => setFacilities(data ?? []));
  }, []);

  async function save(u: U) {
    const { error } = await supabase().rpc('admin_set_roles', { p_user_id: u.user_id, p_roles: u.roles, p_city_id: u.city_id, p_facility_id: u.facility_id });
    setMsg(error ? error.message : t('admin.rolesSaved'));
  }
  const patch = (id: string, p: Partial<U>) => setUsers((us) => us.map((u) => (u.user_id === id ? { ...u, ...p } : u)));

  return (
    <div className="space-y-3">
      <input className="input max-w-xs" placeholder={t('app.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {msg && <div className="text-sm text-brand">{msg}</div>}
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.user_id} className="card flex flex-wrap items-center gap-3">
            <div className="min-w-48">
              <div className="font-medium">{u.full_name ?? '—'} {u.is_demo && <span className="text-xs text-amber-600">demo</span>}</div>
              <div className="text-xs text-slate-500">{u.email ?? u.phone} · {u.user_id.slice(0, 8)}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {ROLES.map((r) => (
                <label key={r} className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${u.roles.includes(r) ? 'border-brand bg-brand-light text-brand-dark' : 'border-slate-300'}`}>
                  <input type="checkbox" className="hidden" checked={u.roles.includes(r)}
                         onChange={() => patch(u.user_id, { roles: u.roles.includes(r) ? u.roles.filter((x) => x !== r) : [...u.roles, r] })} />
                  {t('roles.' + r)}
                </label>
              ))}
            </div>
            <select className="input w-40" value={u.city_id ?? ''} onChange={(e) => patch(u.user_id, { city_id: e.target.value || null })}>
              <option value="">{t('f.city_id')}: —</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name_ru}</option>)}
            </select>
            <select className="input w-48" value={u.facility_id ?? ''} onChange={(e) => patch(u.user_id, { facility_id: e.target.value || null })}>
              <option value="">{t('f.facility_id')}: —</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button className="btn-primary ml-auto py-1" onClick={() => save(u)}>{t('admin.setRoles')}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

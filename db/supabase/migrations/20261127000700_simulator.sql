-- =============================================================================
-- «Қайда?» · Миграция 7: поддержка симулятора (ТЗ, раздел 14)
-- Симулятор пишет только через публичное API. Здесь — три служебные функции
-- администратора, которые работают ТОЛЬКО с демо-данными (is_demo / is_simulated)
-- и поэтому безопасны в продакшене (при DEMO_MODE=false демо-аккаунтов нет):
--   sim_backdate — перенести время жалобы / фото / сдачи в прошлое (история за 14 дней),
--   sim_purge    — удалить все симулированные данные (повторный запуск с нуля),
--   app_settings.simulator — пульт режима реального времени (старт/пауза/сброс, скорость).
-- =============================================================================

insert into public.app_settings (key, value, description) values
  ('simulator', '{"status":"stopped","speed":10,"command_id":0}',
   'Пульт симулятора: status running/paused/stopped/reset, speed 1/10/60 (ТЗ 14)')
on conflict (key) do nothing;

create or replace function public.is_demo_user(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select is_demo from public.profiles where user_id = p_user_id), false)
$$;

-- Перенос времени создания записи демо-пользователя (жалоба, фото, сдача).
-- p_resolved_at — для жалоб: когда акимат взял в работу / закрыл.
create or replace function public.sim_backdate(
  p_kind text, p_id uuid, p_at timestamptz, p_resolved_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid;
  sid uuid;
begin
  if not public.is_admin() and not public.is_privileged() then
    perform public.api_error('FORBIDDEN', 'Только администратор');
  end if;
  if p_at is null or p_at > now() + interval '1 minute' then
    perform public.api_error('VALIDATION', 'p_at: время в прошлом');
  end if;

  if p_kind = 'scan' then
    select user_id, site_id into uid, sid from public.scans where id = p_id;
    if not public.is_demo_user(uid) then perform public.api_error('FORBIDDEN', 'Только демо-данные'); end if;
    update public.scans set created_at = p_at, updated_at = p_at where id = p_id;
    if sid is not null then perform public.recompute_site_cleanliness(sid); end if;

  elsif p_kind = 'report' then
    select user_id, site_id into uid, sid from public.reports where id = p_id;
    if not public.is_demo_user(uid) then perform public.api_error('FORBIDDEN', 'Только демо-данные'); end if;
    update public.reports set created_at = p_at, updated_at = coalesce(p_resolved_at, p_at),
           related_trip_id = coalesce(related_trip_id, (
             select p.trip_id from public.pickups p where p.site_id = sid
               and p.picked_at between p_at - interval '24 hours' and p_at + interval '1 hour'
             order by abs(extract(epoch from (p_at - p.picked_at))) limit 1))
     where id = p_id;
    update public.report_status_log set created_at = p_at, updated_at = p_at where report_id = p_id and from_status is null;
    update public.report_status_log
       set created_at = case when to_status = 'in_work' then p_at + (coalesce(p_resolved_at, p_at) - p_at) / 2
                             else coalesce(p_resolved_at, p_at) end,
           updated_at = coalesce(p_resolved_at, p_at)
     where report_id = p_id and from_status is not null;
    update public.bonus_transactions set created_at = coalesce(p_resolved_at, p_at)
     where source_type = 'report_confirmed' and source_id = p_id;

  elsif p_kind = 'drop_off' then
    select user_id into uid from public.drop_offs where id = p_id;
    if not public.is_demo_user(uid) then perform public.api_error('FORBIDDEN', 'Только демо-данные'); end if;
    update public.drop_offs set created_at = p_at, updated_at = p_at where id = p_id;
    update public.bonus_transactions set created_at = p_at where source_type = 'drop_off' and source_id = p_id;

  else
    perform public.api_error('VALIDATION', 'p_kind: scan / report / drop_off');
  end if;
  return jsonb_build_object('kind', p_kind, 'id', p_id, 'at', p_at);
end $$;

-- Удалить все симулированные данные: рейсы is_simulated (с GPS, вывозами, партиями
-- и их потомками) и действия демо-пользователей. Справочники (сиды) остаются.
create or replace function public.sim_purge() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  n_trips int; n_batches int; n_reports int; n_scans int; n_drop int;
  b_ids uuid[];
begin
  if not public.is_admin() and not public.is_privileged() then
    perform public.api_error('FORBIDDEN', 'Только администратор');
  end if;
  -- партии симулированных рейсов и все партии-потомки по цепочке parent_output_id
  with recursive chain as (
    select b.id from public.batches b join public.trips t on t.id = b.trip_id where t.is_simulated
    union
    select b.id from public.batches b join public.batch_outputs o on o.id = b.parent_output_id join chain c on c.id = o.batch_id
  ) select array_agg(id) into b_ids from chain;
  b_ids := coalesce(b_ids, '{}');
  update public.batches set parent_output_id = null where id = any(b_ids);
  delete from public.batch_outputs where batch_id = any(b_ids);
  delete from public.batches where id = any(b_ids);
  n_batches := cardinality(b_ids);

  update public.sites set last_pickup_id = null, last_pickup_at = null
   where last_pickup_id in (select p.id from public.pickups p join public.trips t on t.id = p.trip_id where t.is_simulated);
  update public.reports set related_trip_id = null where related_trip_id in (select id from public.trips where is_simulated);
  delete from public.trips where is_simulated;          -- каскадом: vehicle_positions, pickups
  get diagnostics n_trips = row_count;

  delete from public.reports where public.is_demo_user(user_id);
  get diagnostics n_reports = row_count;
  delete from public.training_images where public.is_demo_user(user_id);
  delete from public.scans where public.is_demo_user(user_id);
  get diagnostics n_scans = row_count;
  delete from public.bonus_transactions where public.is_demo_user(user_id);
  delete from public.drop_offs where public.is_demo_user(user_id);
  get diagnostics n_drop = row_count;

  update public.sites s set cleanliness_score = null, last_pickup_at = (select max(picked_at) from public.pickups p where p.site_id = s.id)
   where true;  -- safeupdate (PostgREST) требует WHERE
  perform public.recompute_site_cleanliness(id) from public.sites;
  update public.app_settings set value = jsonb_set(value, '{status}', '"stopped"') where key = 'simulator';
  return jsonb_build_object('trips', n_trips, 'batches', n_batches, 'reports', n_reports, 'scans', n_scans, 'drop_offs', n_drop);
end $$;

revoke all on function public.is_demo_user(uuid), public.sim_backdate(text, uuid, timestamptz, timestamptz), public.sim_purge()
  from public, anon;
grant execute on function public.sim_backdate(text, uuid, timestamptz, timestamptz), public.sim_purge() to authenticated, service_role;
grant execute on function public.is_demo_user(uuid) to service_role;

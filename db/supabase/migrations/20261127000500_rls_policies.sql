-- =============================================================================
-- «Қайда?» · Миграция 5: доступ к данным по ролям через RLS (ТЗ 1, 2)
--
--  Гость (anon)  — карта, путь по QR, публичная статистика: чтение площадок,
--                  контейнеров, объектов, рейсов, вывозов, партий, справочников.
--  Житель        — + свои фото (scans), жалобы, бонусы; меняет свой профиль.
--  Водитель      — свои рейсы/вывозы/GPS (через RPC и напрямую по RLS).
--  Оператор      — партии своего объекта.
--  Акимат        — все данные своего города, жалобы, статусы жалоб.
--  Админ         — всё, справочники, роли.
--  service_role  — обходит RLS (бэкенд, сиды, симулятор-сидер).
-- =============================================================================
set search_path = public, extensions;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- публичное
-- Справочники и объекты цепочки читают все (гость видит карту и путь).
do $$
declare t text;
begin
  foreach t in array array['cities','districts','sites','containers','facilities','carriers','vehicles',
                           'routes','trips','vehicle_positions','pickups','batches','batch_outputs',
                           'waste_rules','bonus_rules','app_settings','listings','partners']
  loop
    execute format('create policy "%s: read for all" on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

-- Справочники меняет только админ (ТЗ 11.3)
do $$
declare t text;
begin
  foreach t in array array['cities','districts','sites','containers','facilities','carriers','vehicles',
                           'routes','waste_rules','bonus_rules','app_settings']
  loop
    execute format('create policy "%s: admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- профили
create policy "profiles: own read" on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.has_role('akimat'));
create policy "profiles: own update" on public.profiles for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "profiles: admin insert" on public.profiles for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());
create policy "profiles: admin delete" on public.profiles for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------- водитель
-- Рейсы, GPS и вывозы: водитель своей машины и админ (основной путь — RPC).
create policy "trips: driver write" on public.trips for insert to authenticated
  with check (public.is_driver_of(vehicle_id) or public.is_admin());
create policy "trips: driver update" on public.trips for update to authenticated
  using (public.is_driver_of(vehicle_id) or public.is_admin());
create policy "trips: admin delete" on public.trips for delete to authenticated using (public.is_admin());

create policy "vehicle_positions: driver insert" on public.vehicle_positions for insert to authenticated
  with check (public.is_driver_of(vehicle_id) or public.is_admin());
create policy "vehicle_positions: admin manage" on public.vehicle_positions for delete to authenticated using (public.is_admin());

create policy "pickups: driver insert" on public.pickups for insert to authenticated
  with check (public.is_admin() or exists (select 1 from public.trips t where t.id = trip_id and public.is_driver_of(t.vehicle_id)));
create policy "pickups: driver update" on public.pickups for update to authenticated
  using (public.is_admin() or exists (select 1 from public.trips t where t.id = trip_id and public.is_driver_of(t.vehicle_id)));
create policy "pickups: admin delete" on public.pickups for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- оператор
create policy "batches: operator write" on public.batches for insert to authenticated
  with check (public.is_operator_of(facility_id));
create policy "batches: operator update" on public.batches for update to authenticated
  using (public.is_operator_of(facility_id));
create policy "batches: admin delete" on public.batches for delete to authenticated using (public.is_admin());

create policy "batch_outputs: operator write" on public.batch_outputs for all to authenticated
  using (exists (select 1 from public.batches b where b.id = batch_id and public.is_operator_of(b.facility_id)))
  with check (exists (select 1 from public.batches b where b.id = batch_id and public.is_operator_of(b.facility_id)));

create policy "drop_offs: read own / operator / admin" on public.drop_offs for select to authenticated
  using (user_id = auth.uid() or public.is_operator_of(facility_id) or public.is_admin());
create policy "drop_offs: operator insert" on public.drop_offs for insert to authenticated
  with check (public.is_operator_of(facility_id));

-- ---------------------------------------------------------------- житель
create policy "scans: own read" on public.scans for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or (public.has_role('akimat') and public.can_see_city((select d.city_id from public.sites s join public.districts d on d.id = s.district_id where s.id = site_id))));
create policy "scans: own insert" on public.scans for insert to authenticated
  with check (user_id = auth.uid());
create policy "scans: own delete" on public.scans for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "reports: own or akimat read" on public.reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or (public.has_role('akimat') and (site_id is null or public.can_see_city((select d.city_id from public.sites s join public.districts d on d.id = s.district_id where s.id = site_id)))));
create policy "reports: own insert" on public.reports for insert to authenticated
  with check (user_id = auth.uid() and status = 'new');
-- Смена статуса — только через RPC report_set_status (проверка переходов и лог)
create policy "reports: admin update" on public.reports for update to authenticated using (public.is_admin());

create policy "report_status_log: read" on public.report_status_log for select to authenticated
  using (public.is_admin() or public.has_role('akimat')
         or exists (select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()));

create policy "bonus_transactions: own read" on public.bonus_transactions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "bonus_transactions: admin write" on public.bonus_transactions for insert to authenticated
  with check (public.is_admin());

create policy "training_images: own insert" on public.training_images for insert to authenticated
  with check (user_id = auth.uid());
create policy "training_images: admin manage" on public.training_images for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "app_logs: admin read" on public.app_logs for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- P2
create policy "listings: owner write" on public.listings for all to authenticated
  using (seller_id = auth.uid() or public.is_admin()) with check (seller_id = auth.uid() or public.is_admin());
create policy "partners: owner write" on public.partners for all to authenticated
  using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy "orders: participant" on public.orders for all to authenticated
  using (buyer_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.partners p where p.id = partner_id and p.owner_id = auth.uid()))
  with check (buyer_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.partners p where p.id = partner_id and p.owner_id = auth.uid()));

-- -----------------------------------------------------------------------------
-- Права на объекты: таблицы — через RLS, функции — явный список
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Публичные методы (гость)
grant execute on function
  public.site_path(uuid, int), public.site_by_qr(text), public.site_card(uuid),
  public.map_objects(double precision, double precision, double precision, double precision, text[]),
  public.public_stats(uuid, int), public.nearest_sites(double precision, double precision, int),
  public.trip_chain(uuid, uuid), public.facility_brief(uuid),
  public.output_category(public.output_type, public.output_destination),
  public.is_real_recycled(public.output_type, public.output_destination),
  public.geo_json(geography), public.lonlat(geography), public.make_point(double precision, double precision),
  public.log_event(text, text, text, jsonb),
  -- используются в RLS-политиках
  public.current_roles(), public.has_role(public.app_role), public.is_admin(), public.current_city_id(),
  public.current_facility_id(), public.can_see_city(uuid), public.is_driver_of(uuid), public.is_operator_of(uuid),
  public.me()
to anon, authenticated;

-- Методы для вошедших (роль проверяется внутри)
grant execute on function
  public.driver_route_today(date),
  public.trip_start(uuid, uuid, public.waste_type, timestamptz, boolean),
  public.trip_add_positions(uuid, jsonb),
  public.trip_finish(uuid, timestamptz),
  public.pickup_create(uuid, uuid, public.pickup_status, text, jsonb, smallint, double precision, double precision, timestamptz, text),
  public.scan_create(public.scan_mode, text, jsonb, uuid, public.waste_type, double precision, double precision),
  public.scan_feedback(uuid, text, int, text),
  public.report_create(public.report_type, text, double precision, double precision, uuid, text, text),
  public.report_json(uuid),
  public.report_set_status(uuid, public.report_status, text),
  public.facility_arrivals(uuid),
  public.batch_create(uuid, uuid, numeric, numeric, numeric, text, timestamptz, uuid),
  public.batch_add_outputs(uuid, jsonb, boolean, boolean),
  public.facility_daily_outputs(uuid, date, jsonb),
  public.dashboard_summary(uuid, timestamptz, timestamptz, uuid, uuid),
  public.dashboard_timeseries(uuid, timestamptz, timestamptz, uuid, uuid),
  public.dashboard_sites_rating(uuid, timestamptz, timestamptz, uuid, text, int),
  public.dashboard_carriers_rating(uuid, timestamptz, timestamptz),
  public.me_bonuses(int), public.my_personal_qr(),
  public.drop_off_create(uuid, public.waste_type, numeric, text, uuid, text),
  public.admin_set_roles(uuid, public.app_role[], uuid, uuid),
  public.require_auth(), public.require_role(public.app_role[]), public.api_error(text, text),
  public.setting_num(text, numeric), public.local_today()
to authenticated;

-- Внутренние функции — только service_role / владелец
revoke execute on function public._dashboard_metrics(uuid, uuid, uuid, timestamptz, timestamptz) from anon, authenticated;
revoke execute on function public.apply_trip_rules(uuid) from anon, authenticated;
revoke execute on function public.recompute_site_cleanliness(uuid) from anon, authenticated;

-- Новые объекты получают те же права по умолчанию
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;

-- -----------------------------------------------------------------------------
-- Хранилище файлов: фото (сжатые на телефоне до ≤ 1 МБ) и QR-наклейки
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('photos', 'photos', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']),
  ('training', 'training', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']),
  ('models3d', 'models3d', true, 20 * 1024 * 1024, array['model/gltf-binary', 'model/gltf+json', 'application/octet-stream'])
on conflict (id) do nothing;

-- Пользователь загружает фото только в свою папку photos/<user_id>/...
create policy "photos: user upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: public read" on storage.objects for select to anon, authenticated
  using (bucket_id in ('photos', 'models3d'));
create policy "training: admin" on storage.objects for all to authenticated
  using (bucket_id = 'training' and public.is_admin()) with check (bucket_id = 'training' and public.is_admin());
create policy "models3d: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'models3d' and public.is_admin());

-- -----------------------------------------------------------------------------
-- Realtime: позиции машин (карта), жалобы (дашборд без перезагрузки),
-- вывозы и рейсы (новое фото водителя видно на дашборде ≤ 5 с)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.vehicle_positions, public.reports, public.pickups, public.trips, public.batches;
  end if;
end $$;

grant execute on function public.reports_list(public.report_status, public.report_type, uuid, int), public.report_get(uuid)
  to authenticated;
grant execute on function public.waste_rules_list(uuid) to anon, authenticated;

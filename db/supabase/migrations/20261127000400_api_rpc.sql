-- =============================================================================
-- «Қайда?» · Миграция 4: методы API с логикой (ТЗ, раздел 4)
-- Простые чтения/записи идут напрямую через PostgREST с RLS. Здесь — методы,
-- где нужна логика, проверка роли или сводка. Каждый метод проверяет права
-- сам (security definer + require_role), ошибки — 'CODE: сообщение'.
-- Edge Function /api вызывает эти функции и отдаёт REST из раздела 4.
-- =============================================================================
set search_path = public, extensions;

-- =========================================================== КАРТА (раздел 8)
-- GET /map/objects?bbox=minLon,minLat,maxLon,maxLat&layers=sites,facilities,vehicles,reports
create or replace function public.map_objects(
  p_min_lon double precision, p_min_lat double precision,
  p_max_lon double precision, p_max_lat double precision,
  p_layers text[] default array['sites','facilities','vehicles','reports']
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  env geography := st_makeenvelope(p_min_lon, p_min_lat, p_max_lon, p_max_lat, 4326)::geography;
  res jsonb := '{}'::jsonb;
begin
  if p_min_lon is null or p_max_lon is null or p_min_lon >= p_max_lon or p_min_lat >= p_max_lat then
    perform public.api_error('VALIDATION', 'bbox: minLon,minLat,maxLon,maxLat');
  end if;

  if 'sites' = any(p_layers) then
    res := res || jsonb_build_object('sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'address', s.address, 'qr_code', s.qr_code, 'location', public.lonlat(s.location),
        'cleanliness_score', s.cleanliness_score, 'last_pickup_at', s.last_pickup_at, 'district_id', s.district_id,
        'container_types', (select coalesce(jsonb_agg(distinct c.waste_type), '[]'::jsonb) from public.containers c where c.site_id = s.id and c.is_active),
        'open_reports', (select count(*) from public.reports r where r.site_id = s.id and r.status in ('new','in_work'))))
      from public.sites s where s.is_active and st_intersects(s.location, env)), '[]'::jsonb));
  end if;

  if 'facilities' = any(p_layers) then
    -- объекты за городом (полигон, заводы) часто вне bbox района — их всегда отдаём
    res := res || jsonb_build_object('facilities', coalesce((
      select jsonb_agg(public.facility_brief(f.id) || jsonb_build_object(
        'accepted_waste_types', f.accepted_waste_types, 'capacity_tpd', f.capacity_tpd,
        'opening_hours', f.opening_hours,
        'week_tonnes', (select round(coalesce(sum(b.weight_kg), 0) / 1000, 2) from public.batches b
                         where b.facility_id = f.id and b.received_at >= now() - interval '7 days')))
      from public.facilities f where f.is_active), '[]'::jsonb));
  end if;

  if 'vehicles' = any(p_layers) then
    res := res || jsonb_build_object('vehicles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'vehicle_id', v.id, 'plate_number', v.plate_number, 'carrier_id', v.carrier_id,
        'trip_id', t.id, 'waste_type', t.waste_type, 'mixed_flag', t.mixed_flag,
        'location', public.lonlat(vp.location), 'speed', vp.speed, 'heading', vp.heading, 'recorded_at', vp.recorded_at))
      from public.trips t
      join public.vehicles v on v.id = t.vehicle_id
      join lateral (select * from public.vehicle_positions p where p.trip_id = t.id order by p.recorded_at desc limit 1) vp on true
      where t.status = 'active'), '[]'::jsonb));
  end if;

  if 'reports' = any(p_layers) then
    -- публичный слой жалоб: без автора и комментария
    res := res || jsonb_build_object('reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'status', r.status,
             'location', public.lonlat(r.location), 'photo_url', r.photo_url, 'site_id', r.site_id, 'created_at', r.created_at))
      from public.reports r where st_intersects(r.location, env) and r.created_at >= now() - interval '30 days'), '[]'::jsonb));
  end if;
  return res;
end $$;

-- Публичная статистика для гостя (раздел 2)
create or replace function public.public_stats(p_city_id uuid default null, p_days int default 30) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with b as (
    select b.*, f.city_id from public.batches b join public.facilities f on f.id = b.facility_id
     where b.received_at >= now() - make_interval(days => p_days) and b.parent_output_id is null
       and (p_city_id is null or f.city_id = p_city_id)
  )
  select jsonb_build_object(
    'period_days', p_days,
    'collected_t', round(coalesce((select sum(weight_kg) from b), 0) / 1000, 2),
    'recycled_t', round(coalesce((select sum(o.weight_kg) from public.batch_outputs o join b on b.id = o.batch_id
                                   where public.is_real_recycled(o.output_type, o.destination)), 0) / 1000, 2),
    'sites', (select count(*) from public.sites where is_active),
    'avg_cleanliness', (select round(avg(cleanliness_score), 1) from public.sites where is_active),
    'scans', (select count(*) from public.scans where created_at >= now() - make_interval(days => p_days)),
    'reports_resolved', (select count(*) from public.reports where status in ('confirmed','rejected')
                           and updated_at >= now() - make_interval(days => p_days))
  )
$$;

-- ======================================================= ВОДИТЕЛЬ (раздел 10.1)
-- GET /driver/route/today
create or replace function public.driver_route_today(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('driver');
  d date := coalesce(p_date, public.local_today());
  res jsonb;
begin
  select coalesce(jsonb_agg(r order by r ->> 'vehicle_plate'), '[]'::jsonb) into res from (
    select jsonb_build_object(
      'route_id', rt.id, 'route_date', rt.route_date, 'waste_type', rt.waste_type,
      'vehicle_id', v.id, 'vehicle_plate', v.plate_number,
      'planned_facility', public.facility_brief(rt.planned_facility_id),
      'active_trip_id', (select t.id from public.trips t where t.vehicle_id = v.id and t.status = 'active' limit 1),
      'trips', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'started_at', t.started_at,
                    'finished_at', t.finished_at, 'mixed_flag', t.mixed_flag) order by t.started_at)
                    from public.trips t where t.route_id = rt.id), '[]'::jsonb),
      'stops', coalesce((
        select jsonb_agg(jsonb_build_object(
          'order', o.ord, 'site_id', s.id, 'address', s.address, 'qr_code', s.qr_code,
          'location', public.lonlat(s.location), 'cleanliness_score', s.cleanliness_score,
          'containers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'waste_type', c.waste_type,
                            'volume_l', c.volume_l, 'fill_level', c.fill_level)), '[]'::jsonb)
                           from public.containers c where c.site_id = s.id and c.is_active
                            and (rt.waste_type = 'mixed' or c.waste_type = rt.waste_type)),
          'done', exists (select 1 from public.pickups p join public.trips t on t.id = p.trip_id
                           where t.route_id = rt.id and p.site_id = s.id),
          'pickup_status', (select p.status from public.pickups p join public.trips t on t.id = p.trip_id
                             where t.route_id = rt.id and p.site_id = s.id order by p.picked_at desc limit 1)
        ) order by o.ord)
        from unnest(rt.site_ids) with ordinality o(site_id, ord)
        join public.sites s on s.id = o.site_id), '[]'::jsonb)
    ) || jsonb_build_object('progress', jsonb_build_object(
          'total', cardinality(rt.site_ids),
          'done', (select count(distinct p.site_id) from public.pickups p join public.trips t on t.id = p.trip_id
                    where t.route_id = rt.id and p.site_id = any(rt.site_ids)))) as r
    from public.routes rt
    join public.vehicles v on v.id = rt.vehicle_id
    where rt.route_date = d and (v.driver_id = uid or public.is_admin())
  ) x;
  return jsonb_build_object('date', d, 'routes', res);
end $$;

-- POST /trips
create or replace function public.trip_start(
  p_route_id uuid default null, p_vehicle_id uuid default null,
  p_waste_type public.waste_type default null, p_started_at timestamptz default null,
  p_is_simulated boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('driver');
  rt public.routes;
  vid uuid;
  t public.trips;
begin
  if p_route_id is not null then
    select * into rt from public.routes where id = p_route_id;
    if rt.id is null then perform public.api_error('NOT_FOUND', 'Маршрут не найден'); end if;
  end if;
  vid := coalesce(p_vehicle_id, rt.vehicle_id);
  if vid is null then perform public.api_error('VALIDATION', 'Нужен route_id или vehicle_id'); end if;
  if not public.is_driver_of(vid) and not public.is_admin() then
    perform public.api_error('FORBIDDEN', 'Это не ваша машина');
  end if;
  if exists (select 1 from public.trips where vehicle_id = vid and status = 'active') then
    perform public.api_error('CONFLICT', 'У машины уже есть активный рейс');
  end if;
  insert into public.trips (route_id, vehicle_id, driver_id, waste_type, status, started_at, planned_facility_id, is_simulated)
  values (rt.id, vid, uid, coalesce(p_waste_type, rt.waste_type, 'mixed'), 'active', coalesce(p_started_at, now()),
          rt.planned_facility_id, coalesce(p_is_simulated, false))
  returning * into t;
  return public.trip_chain(t.id);
end $$;

-- POST /trips/{id}/positions — пакет GPS-точек (водитель, симулятор)
-- p_points: [{"lon":71.4,"lat":51.1,"speed":32,"heading":90,"recorded_at":"..."}]
create or replace function public.trip_add_positions(p_trip_id uuid, p_points jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('driver');
  t public.trips;
  n int;
begin
  select * into t from public.trips where id = p_trip_id;
  if t.id is null then perform public.api_error('NOT_FOUND', 'Рейс не найден'); end if;
  if not public.is_driver_of(t.vehicle_id) and not public.is_admin() then
    perform public.api_error('FORBIDDEN', 'Это не ваш рейс');
  end if;
  if t.status <> 'active' then perform public.api_error('CONFLICT', 'Рейс не активен'); end if;
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) = 0 then
    perform public.api_error('VALIDATION', 'points: непустой массив');
  end if;
  if jsonb_array_length(p_points) > 1000 then
    perform public.api_error('VALIDATION', 'Не больше 1000 точек за раз');
  end if;

  with ins as (
    insert into public.vehicle_positions (vehicle_id, trip_id, location, speed, heading, recorded_at)
    select t.vehicle_id, t.id,
           public.make_point((p ->> 'lon')::float8, (p ->> 'lat')::float8),
           nullif(p ->> 'speed', '')::numeric, nullif(p ->> 'heading', '')::numeric,
           coalesce((p ->> 'recorded_at')::timestamptz, now())
      from jsonb_array_elements(p_points) p
    on conflict (vehicle_id, recorded_at) do nothing
    returning 1
  ) select count(*) into n from ins;

  return jsonb_build_object('trip_id', t.id, 'accepted', n, 'received', jsonb_array_length(p_points));
end $$;

-- POST /trips/{id}/finish
create or replace function public.trip_finish(p_trip_id uuid, p_finished_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('driver');
  t public.trips;
begin
  select * into t from public.trips where id = p_trip_id;
  if t.id is null then perform public.api_error('NOT_FOUND', 'Рейс не найден'); end if;
  if not public.is_driver_of(t.vehicle_id) and not public.is_admin() then
    perform public.api_error('FORBIDDEN', 'Это не ваш рейс');
  end if;
  if t.status = 'finished' then return public.trip_chain(t.id); end if;  -- идемпотентно
  if t.status <> 'active' then perform public.api_error('CONFLICT', 'Рейс не активен'); end if;
  update public.trips set status = 'finished',
         finished_at = greatest(coalesce(p_finished_at, now()), started_at)
   where id = t.id;
  perform public.apply_trip_rules(t.id);
  return public.trip_chain(t.id);
end $$;

-- POST /pickups — вывоз с фото → ИИ → чистота и флаг смешивания
create or replace function public.pickup_create(
  p_trip_id uuid, p_container_id uuid,
  p_status public.pickup_status default 'picked',
  p_photo_url text default null,
  p_ai_result jsonb default null,
  p_fill_level smallint default null,
  p_lon double precision default null, p_lat double precision default null,
  p_picked_at timestamptz default null,
  p_client_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('driver');
  t public.trips;
  p public.pickups;
  site public.sites;
  dist numeric;
begin
  if p_client_id is not null then
    select * into p from public.pickups where client_id = p_client_id;
    if p.id is not null then
      return to_jsonb(p) - 'location' || jsonb_build_object('location', public.lonlat(p.location), 'duplicate', true);
    end if;
  end if;
  select * into t from public.trips where id = p_trip_id;
  if t.id is null then perform public.api_error('NOT_FOUND', 'Рейс не найден'); end if;
  if not public.is_driver_of(t.vehicle_id) and not public.is_admin() then
    perform public.api_error('FORBIDDEN', 'Это не ваш рейс');
  end if;
  if t.status <> 'active' then perform public.api_error('CONFLICT', 'Рейс не активен'); end if;
  if coalesce(p_status, 'picked') = 'picked' and p_photo_url is null then
    perform public.api_error('PHOTO_REQUIRED', 'Фото контейнера перед погрузкой обязательно');
  end if;

  select s.* into site from public.sites s join public.containers c on c.site_id = s.id where c.id = p_container_id;
  if site.id is null then perform public.api_error('NOT_FOUND', 'Контейнер не найден'); end if;
  if p_lon is not null then
    dist := round(st_distance(site.location, public.make_point(p_lon, p_lat))::numeric, 1);
  end if;

  insert into public.pickups (trip_id, container_id, site_id, status, photo_url, ai_result, fill_level,
                              location, picked_at, client_id)
  values (t.id, p_container_id, site.id, coalesce(p_status, 'picked'), p_photo_url, p_ai_result, p_fill_level,
          public.make_point(p_lon, p_lat), coalesce(p_picked_at, now()), p_client_id)
  returning * into p;

  return to_jsonb(p) - 'location' || jsonb_build_object(
    'location', public.lonlat(p.location),
    'distance_m', dist,
    'within_radius', dist is null or dist <= public.setting_num('pickup_radius_m', 100),
    'site_cleanliness_score', (select cleanliness_score from public.sites where id = site.id));
end $$;

-- ======================================================== ЖИТЕЛЬ (раздел 5)
-- POST /scans — сохранение фото жителя с результатом ИИ (вызывается из Edge Function)
create or replace function public.scan_create(
  p_mode public.scan_mode, p_photo_url text, p_ai_result jsonb,
  p_site_id uuid default null, p_container_type public.waste_type default null,
  p_lon double precision default null, p_lat double precision default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_auth();
  pt geography := public.make_point(p_lon, p_lat);
  sid uuid := p_site_id;
  sc public.scans;
  top text;
begin
  if sid is null and pt is not null then
    sid := public.nearest_site_id(pt, public.setting_num('scan_site_radius_m', 150));
  end if;
  select it ->> 'class' into top from jsonb_array_elements(coalesce(p_ai_result -> 'items', '[]'::jsonb)) it
   order by (it ->> 'confidence')::numeric desc nulls last limit 1;
  insert into public.scans (user_id, site_id, mode, container_type, photo_url, location, ai_result, model_version,
                            contamination_pct, top_class)
  values (uid, sid, p_mode, p_container_type, p_photo_url, pt, p_ai_result, p_ai_result ->> 'model_version',
          case when p_mode = 'container' and jsonb_typeof(p_ai_result -> 'contamination_pct') = 'number'
               then (p_ai_result ->> 'contamination_pct')::numeric end,
          top)
  returning * into sc;

  -- фото с согласием на обучение → кандидат в датасет (цикл данных, P1)
  if p_photo_url is not null and exists (select 1 from public.profiles where user_id = uid and consent_training) then
    insert into public.training_images (photo_url, source, source_id, user_id, predicted, model_version)
    values (p_photo_url, 'resident_scan', sc.id, uid, p_ai_result, sc.model_version);
  end if;

  return jsonb_build_object('scan_id', sc.id, 'site_id', sid, 'created_at', sc.created_at) || coalesce(p_ai_result, '{}'::jsonb);
end $$;

-- «ИИ ошибся» → training_images (ТЗ 5.3)
create or replace function public.scan_feedback(p_scan_id uuid, p_correct_class text, p_item_index int default null, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_auth();
  sc public.scans;
  ti uuid;
begin
  select * into sc from public.scans where id = p_scan_id;
  if sc.id is null then perform public.api_error('NOT_FOUND', 'Скан не найден'); end if;
  if sc.user_id is distinct from uid and not public.is_admin() then perform public.api_error('FORBIDDEN', 'Это не ваш скан'); end if;
  if not exists (select 1 from public.waste_rules where ai_class = p_correct_class) then
    perform public.api_error('VALIDATION', 'Неизвестный класс: ' || coalesce(p_correct_class, 'null'));
  end if;
  insert into public.training_images (photo_url, source, source_id, user_id, label_status, predicted, annotation, model_version)
  values (coalesce(sc.photo_url, ''), 'feedback', sc.id, uid, 'new', sc.ai_result,
          jsonb_build_object('correct_class', p_correct_class, 'item_index', p_item_index, 'comment', p_comment),
          sc.model_version)
  returning id into ti;
  return jsonb_build_object('training_image_id', ti, 'status', 'saved');
end $$;

-- POST /reports — жалоба с фото и геометкой; площадка — ближайшая
create or replace function public.report_create(
  p_type public.report_type, p_photo_url text,
  p_lon double precision, p_lat double precision,
  p_site_id uuid default null, p_comment text default null, p_client_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_auth();
  pt geography := public.make_point(p_lon, p_lat);
  r public.reports;
  sid uuid := p_site_id;
begin
  if p_client_id is not null then
    select * into r from public.reports where client_id = p_client_id;
    if r.id is not null then return public.report_json(r.id) || jsonb_build_object('duplicate', true); end if;
  end if;
  if p_photo_url is null or p_photo_url = '' then perform public.api_error('PHOTO_REQUIRED', 'Фото обязательно'); end if;
  if pt is null then perform public.api_error('VALIDATION', 'Нужна геометка'); end if;
  if sid is null then sid := public.nearest_site_id(pt, public.setting_num('report_site_radius_m', 300)); end if;

  insert into public.reports (user_id, site_id, type, photo_url, location, comment, client_id, related_trip_id)
  values (uid, sid, p_type, p_photo_url, pt, nullif(trim(p_comment), ''), p_client_id,
          -- ближайший по времени рейс, который был на этой площадке (±24 ч)
          (select p.trip_id from public.pickups p where p.site_id = sid and p.picked_at between now() - interval '24 hours' and now() + interval '1 hour'
            order by abs(extract(epoch from (now() - p.picked_at))) limit 1))
  returning * into r;
  insert into public.report_status_log (report_id, from_status, to_status, changed_by) values (r.id, null, 'new', uid);
  return public.report_json(r.id);
end $$;

create or replace function public.report_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', r.id, 'user_id', r.user_id, 'site_id', r.site_id, 'type', r.type, 'status', r.status,
    'photo_url', r.photo_url, 'location', public.lonlat(r.location), 'comment', r.comment,
    'status_comment', r.status_comment, 'related_trip_id', r.related_trip_id,
    'created_at', r.created_at, 'updated_at', r.updated_at,
    'site', (select jsonb_build_object('id', s.id, 'address', s.address, 'district_id', s.district_id) from public.sites s where s.id = r.site_id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('from', l.from_status, 'to', l.to_status, 'comment', l.comment, 'at', l.created_at) order by l.created_at)
                           from public.report_status_log l where l.report_id = r.id), '[]'::jsonb))
  from public.reports r where r.id = p_id
$$;

-- PATCH /reports/{id} — смена статуса акиматом: new → in_work → confirmed / rejected
create or replace function public.report_set_status(p_report_id uuid, p_status public.report_status, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('akimat');
  r public.reports;
  city uuid;
  bonus numeric;
begin
  select * into r from public.reports where id = p_report_id for update;
  if r.id is null then perform public.api_error('NOT_FOUND', 'Жалоба не найдена'); end if;
  select d.city_id into city from public.sites s join public.districts d on d.id = s.district_id where s.id = r.site_id;
  if city is not null and not public.can_see_city(city) then perform public.api_error('FORBIDDEN', 'Жалоба другого города'); end if;
  if r.status = p_status then return public.report_json(r.id); end if;
  if not (
       (r.status = 'new' and p_status in ('in_work', 'confirmed', 'rejected'))
    or (r.status = 'in_work' and p_status in ('confirmed', 'rejected'))
  ) then
    perform public.api_error('INVALID_TRANSITION', format('Нельзя перевести жалобу из %s в %s', r.status, p_status));
  end if;
  if p_status in ('confirmed', 'rejected') and nullif(trim(p_comment), '') is null and p_status = 'rejected' then
    perform public.api_error('VALIDATION', 'Укажите причину отклонения');
  end if;

  update public.reports set status = p_status, status_comment = coalesce(nullif(trim(p_comment), ''), status_comment),
         resolved_by = case when p_status in ('confirmed', 'rejected') then uid else resolved_by end
   where id = r.id;
  insert into public.report_status_log (report_id, from_status, to_status, comment, changed_by)
  values (r.id, r.status, p_status, p_comment, uid);

  -- Правило 3 бонусов: подтверждённая жалоба — фиксированный бонус (идемпотентно)
  if p_status = 'confirmed' and r.user_id is not null then
    select fixed_amount into bonus from public.bonus_rules where code = 'report_confirmed' and is_active;
    if coalesce(bonus, 0) > 0 then
      insert into public.bonus_transactions (user_id, amount, source_type, source_id, description)
      values (r.user_id, bonus, 'report_confirmed', r.id, 'Подтверждённая жалоба')
      on conflict do nothing;
    end if;
  end if;
  return public.report_json(r.id);
end $$;

-- ====================================================== ОПЕРАТОР (раздел 10.2)
-- Очередь приехавших рейсов: рейсы с пунктом назначения = объект, без партии
create or replace function public.facility_arrivals(p_facility_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('operator');
  fid uuid := coalesce(p_facility_id, public.current_facility_id());
begin
  if fid is null then perform public.api_error('VALIDATION', 'Не указан объект'); end if;
  if not public.is_operator_of(fid) then perform public.api_error('FORBIDDEN', 'Не ваш объект'); end if;
  return coalesce((
    select jsonb_agg(public.trip_chain(t.id) order by coalesce(t.finished_at, t.started_at) desc)
      from public.trips t
     where not exists (select 1 from public.batches b where b.trip_id = t.id)
       and (t.destination_facility_id = fid
            or (t.status = 'active' and exists (
                 select 1 from public.facilities f
                  join lateral (select location from public.vehicle_positions vp where vp.trip_id = t.id order by recorded_at desc limit 1) lp on true
                 where f.id = fid and st_dwithin(f.location, lp.location, f.geofence_radius_m))))
       and t.started_at >= now() - interval '3 days'), '[]'::jsonb);
end $$;

-- POST /batches — приёмка партии
create or replace function public.batch_create(
  p_facility_id uuid, p_trip_id uuid default null,
  p_weight_kg numeric default null, p_gross_kg numeric default null, p_tare_kg numeric default null,
  p_photo_url text default null, p_received_at timestamptz default null, p_parent_output_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('operator');
  w numeric := coalesce(p_weight_kg, p_gross_kg - p_tare_kg);
  b public.batches;
begin
  if not public.is_operator_of(p_facility_id) then perform public.api_error('FORBIDDEN', 'Не ваш объект'); end if;
  if w is null or w < 0 then perform public.api_error('VALIDATION', 'Нужен вес нетто (weight_kg) или брутто и тара'); end if;
  if p_trip_id is not null and exists (select 1 from public.batches where trip_id = p_trip_id and facility_id = p_facility_id) then
    perform public.api_error('CONFLICT', 'Партия этого рейса уже принята');
  end if;
  insert into public.batches (trip_id, facility_id, weight_kg, gross_kg, tare_kg, photo_url, operator_id, received_at, parent_output_id)
  values (p_trip_id, p_facility_id, w, p_gross_kg, p_tare_kg, p_photo_url, uid, coalesce(p_received_at, now()), p_parent_output_id)
  returning * into b;
  -- приёмка подтверждает пункт назначения; правила рейса пересчитываются
  if p_trip_id is not null then
    update public.trips set destination_facility_id = p_facility_id where id = p_trip_id and status = 'finished' and destination_facility_id is null;
    if (select status from public.trips where id = p_trip_id) = 'finished' then perform public.apply_trip_rules(p_trip_id); end if;
  end if;
  return to_jsonb(b);
end $$;

-- POST /batches/{id}/outputs — итог сортировки.
-- p_outputs: [{"output_type":"pet","weight_kg":120,"destination":"recycler","next_facility_id":"..."}]
-- p_close = true → статус sorted (сумма должна точно равняться весу партии).
create or replace function public.batch_add_outputs(p_batch_id uuid, p_outputs jsonb, p_close boolean default true, p_replace boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('operator');
  b public.batches;
begin
  select * into b from public.batches where id = p_batch_id for update;
  if b.id is null then perform public.api_error('NOT_FOUND', 'Партия не найдена'); end if;
  if not public.is_operator_of(b.facility_id) then perform public.api_error('FORBIDDEN', 'Не ваш объект'); end if;
  if b.status = 'sorted' then perform public.api_error('CONFLICT', 'Партия уже закрыта'); end if;
  if jsonb_typeof(p_outputs) <> 'array' then perform public.api_error('VALIDATION', 'outputs: массив'); end if;

  if p_replace then delete from public.batch_outputs where batch_id = b.id; end if;
  insert into public.batch_outputs (batch_id, output_type, weight_kg, destination, next_facility_id, buyer_name)
  select b.id, (o ->> 'output_type')::public.output_type, (o ->> 'weight_kg')::numeric,
         coalesce((o ->> 'destination')::public.output_destination,
                  case (o ->> 'output_type') when 'landfill' then 'landfill'::public.output_destination
                                             when 'rdf' then 'energy'::public.output_destination
                                             when 'organic' then 'compost'::public.output_destination
                                             else 'recycler'::public.output_destination end),
         nullif(o ->> 'next_facility_id', '')::uuid, nullif(o ->> 'buyer_name', '')
    from jsonb_array_elements(p_outputs) o;

  set constraints public.batch_outputs_sum_check immediate;
  if p_close then
    update public.batches set status = 'sorted' where id = b.id;
  end if;

  return jsonb_build_object('batch', to_jsonb((select x from public.batches x where x.id = b.id)),
    'outputs', (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from public.batch_outputs o where o.batch_id = b.id),
    'total_kg', (select coalesce(sum(weight_kg), 0) from public.batch_outputs where batch_id = b.id));
end $$;

-- Суточный итог сортировки с распределением на партии пропорционально весу (ТЗ 10.2)
create or replace function public.facility_daily_outputs(p_facility_id uuid, p_date date, p_outputs jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('operator');
  total_w numeric; total_out numeric; b record; o jsonb; n int := 0;
  remaining jsonb := '{}'::jsonb; last_id uuid;
begin
  if not public.is_operator_of(p_facility_id) then perform public.api_error('FORBIDDEN', 'Не ваш объект'); end if;
  select sum(weight_kg), max(id::text)::uuid into total_w, last_id from public.batches
   where facility_id = p_facility_id and received_at::date = p_date and status <> 'sorted';
  select sum((x ->> 'weight_kg')::numeric) into total_out from jsonb_array_elements(p_outputs) x;
  if coalesce(total_w, 0) = 0 then perform public.api_error('NOT_FOUND', 'Нет открытых партий за дату'); end if;
  if abs(total_out - total_w) > 0.5 then
    perform public.api_error('VALIDATION', format('Суточный итог %s кг ≠ вес партий %s кг', total_out, total_w));
  end if;
  for b in select * from public.batches where facility_id = p_facility_id and received_at::date = p_date and status <> 'sorted' order by id loop
    perform public.batch_add_outputs(b.id, (
      select jsonb_agg(x || jsonb_build_object('weight_kg',
        round((x ->> 'weight_kg')::numeric * b.weight_kg / total_out, 2)))
        from jsonb_array_elements(p_outputs) x), false, true);
    -- корректировка округления: остаток в самый крупный вид
    update public.batch_outputs bo set weight_kg = bo.weight_kg + (b.weight_kg - (select sum(weight_kg) from public.batch_outputs where batch_id = b.id))
     where bo.id = (select id from public.batch_outputs where batch_id = b.id order by weight_kg desc limit 1);
    update public.batches set status = 'sorted' where id = b.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('batches', n, 'total_kg', total_w);
end $$;

-- ===================================================== ДАШБОРД (раздел 11.1)
-- Измерения рейса для фильтров: город, район (по большинству вывозов), перевозчик
create or replace view public.trip_dims with (security_invoker = true) as
select t.id as trip_id, t.started_at, t.status, t.waste_type, t.mixed_flag, t.deviation_flag,
       t.destination_facility_id, v.carrier_id,
       (select s.district_id from public.pickups p join public.sites s on s.id = p.site_id
         where p.trip_id = t.id group by s.district_id order by count(*) desc limit 1) as district_id,
       coalesce(
         (select d.city_id from public.pickups p join public.sites s on s.id = p.site_id join public.districts d on d.id = s.district_id
           where p.trip_id = t.id limit 1),
         (select f.city_id from public.facilities f where f.id = t.destination_facility_id)) as city_id
  from public.trips t join public.vehicles v on v.id = t.vehicle_id;

create or replace function public.dashboard_check_access(p_city_id uuid) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public.require_role('akimat');
  if p_city_id is not null and not public.can_see_city(p_city_id) then
    perform public.api_error('FORBIDDEN', 'Нет доступа к данным этого города');
  end if;
end $$;

-- Внутренний расчёт показателей за период (без проверки прав)
create or replace function public._dashboard_metrics(
  p_city_id uuid, p_district_id uuid, p_carrier_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with tr as (
    select * from public.trip_dims d
     where d.started_at >= p_from and d.started_at < p_to
       and (p_city_id is null or d.city_id = p_city_id)
       and (p_district_id is null or d.district_id = p_district_id)
       and (p_carrier_id is null or d.carrier_id = p_carrier_id)
  ), b as (
    select b.*, f.type as facility_type from public.batches b
      join tr on tr.trip_id = b.trip_id
      join public.facilities f on f.id = b.facility_id
  ), o as (
    select o.*, public.output_category(o.output_type, o.destination) as category
      from public.batch_outputs o join b on b.id = o.batch_id
  ), pk as (
    select p.* from public.pickups p join tr on tr.trip_id = p.trip_id where p.status = 'picked'
  )
  select jsonb_build_object(
    'collected_t', round(coalesce((select sum(weight_kg) from b), 0) / 1000, 3),
    'avg_cleanliness_pct', (select round(avg(100 - contamination_pct), 1) from pk where contamination_pct is not null),
    'claimed_recycled_t', round(coalesce((select sum(weight_kg) from b where facility_type = 'sorting'), 0) / 1000, 3),
    'real_recycled_t', round(coalesce((select sum(weight_kg) from o where category = 'recycled'
                                        and destination in ('recycler', 'buyer', 'compost')), 0) / 1000, 3),
    'energy_t', round(coalesce((select sum(weight_kg) from o where category = 'energy'), 0) / 1000, 3),
    'landfill_t', round((coalesce((select sum(weight_kg) from o where category = 'landfill'), 0)
                         + coalesce((select sum(weight_kg) from b where facility_type = 'landfill'), 0)) / 1000, 3),
    'trips', (select count(*) from tr),
    'mixed_trips', (select count(*) from tr where mixed_flag),
    'deviation_trips', (select count(*) from tr where deviation_flag),
    'pickups', (select count(*) from pk),
    'new_reports', (select count(*) from public.reports r
                     left join public.sites s on s.id = r.site_id left join public.districts d on d.id = s.district_id
                     where r.created_at >= p_from and r.created_at < p_to
                       and (p_city_id is null or d.city_id = p_city_id)
                       and (p_district_id is null or s.district_id = p_district_id)),
    'composition', coalesce((select jsonb_agg(jsonb_build_object('output_type', output_type, 'category', category, 'kg', kg) order by kg desc)
                               from (select output_type, category, round(sum(weight_kg), 2) kg from o group by 1, 2) c), '[]'::jsonb)
  )
$$;

-- GET /dashboard/summary?city&period
create or replace function public.dashboard_summary(
  p_city_id uuid default null, p_from timestamptz default null, p_to timestamptz default null,
  p_district_id uuid default null, p_carrier_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t_to timestamptz := coalesce(p_to, clock_timestamp());
  t_from timestamptz := coalesce(p_from, t_to - interval '7 days');
  cur jsonb; prev jsonb; gap numeric;
begin
  perform public.dashboard_check_access(p_city_id);
  cur := public._dashboard_metrics(p_city_id, p_district_id, p_carrier_id, t_from, t_to);
  prev := public._dashboard_metrics(p_city_id, p_district_id, p_carrier_id, t_from - (t_to - t_from), t_from);
  gap := (cur ->> 'claimed_recycled_t')::numeric - (cur ->> 'real_recycled_t')::numeric;
  return jsonb_build_object(
    'period', jsonb_build_object('from', t_from, 'to', t_to),
    'current', cur || jsonb_build_object(
      'real_recycled_pct', case when (cur ->> 'claimed_recycled_t')::numeric > 0
        then round(100 * (cur ->> 'real_recycled_t')::numeric / (cur ->> 'claimed_recycled_t')::numeric, 1) end,
      'recycling_gap_t', round(gap, 3)),
    'previous', prev,
    'delta_pct', (select jsonb_object_agg(k, case when (prev ->> k)::numeric = 0 then null
                   else round(100 * ((cur ->> k)::numeric - (prev ->> k)::numeric) / (prev ->> k)::numeric, 1) end)
                   from unnest(array['collected_t','avg_cleanliness_pct','claimed_recycled_t','real_recycled_t','mixed_trips','new_reports']) k
                   where jsonb_typeof(cur -> k) = 'number' and jsonb_typeof(prev -> k) = 'number')
  );
end $$;

-- GET /dashboard/timeseries — вывезено и реально переработано по дням (две линии)
create or replace function public.dashboard_timeseries(
  p_city_id uuid default null, p_from timestamptz default null, p_to timestamptz default null,
  p_district_id uuid default null, p_carrier_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t_to timestamptz := coalesce(p_to, clock_timestamp());
  t_from timestamptz := coalesce(p_from, t_to - interval '30 days');
begin
  perform public.dashboard_check_access(p_city_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', day, 'collected_t', round(coalesce(col, 0) / 1000, 3),
                                        'real_recycled_t', round(coalesce(rec, 0) / 1000, 3),
                                        'avg_cleanliness_pct', cln) order by day)
    from (
      select g::date as day,
        (select sum(b.weight_kg) from public.batches b join public.trip_dims d on d.trip_id = b.trip_id
          where d.started_at::date = g::date and (p_city_id is null or d.city_id = p_city_id)
            and (p_district_id is null or d.district_id = p_district_id) and (p_carrier_id is null or d.carrier_id = p_carrier_id)) col,
        (select sum(o.weight_kg) from public.batch_outputs o join public.batches b on b.id = o.batch_id join public.trip_dims d on d.trip_id = b.trip_id
          where d.started_at::date = g::date and public.is_real_recycled(o.output_type, o.destination)
            and (p_city_id is null or d.city_id = p_city_id)
            and (p_district_id is null or d.district_id = p_district_id) and (p_carrier_id is null or d.carrier_id = p_carrier_id)) rec,
        (select round(avg(100 - p.contamination_pct), 1) from public.pickups p join public.trip_dims d on d.trip_id = p.trip_id
          where p.picked_at::date = g::date and (p_city_id is null or d.city_id = p_city_id)
            and (p_district_id is null or d.district_id = p_district_id) and (p_carrier_id is null or d.carrier_id = p_carrier_id)) cln
      from generate_series(t_from::date, t_to::date, interval '1 day') g
    ) x), '[]'::jsonb);
end $$;

-- GET /dashboard/sites-rating
create or replace function public.dashboard_sites_rating(
  p_city_id uuid default null, p_from timestamptz default null, p_to timestamptz default null,
  p_district_id uuid default null, p_sort text default 'cleanliness_asc', p_limit int default 100
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t_to timestamptz := coalesce(p_to, clock_timestamp());
  t_from timestamptz := coalesce(p_from, t_to - interval '7 days');
  half interval := (t_to - t_from);
begin
  perform public.dashboard_check_access(p_city_id);
  return coalesce((
    select jsonb_agg(x order by
      case when p_sort = 'cleanliness_asc' then (x ->> 'cleanliness_score')::numeric end asc nulls last,
      case when p_sort = 'cleanliness_desc' then (x ->> 'cleanliness_score')::numeric end desc nulls last,
      case when p_sort = 'reports_desc' then (x ->> 'reports')::int end desc,
      case when p_sort = 'trend_asc' then (x ->> 'trend')::numeric end asc nulls last,
      x ->> 'address')
    from (
      select jsonb_build_object(
        'site_id', s.id, 'address', s.address, 'district_id', s.district_id, 'qr_code', s.qr_code,
        'location', public.lonlat(s.location),
        'cleanliness_score', s.cleanliness_score,
        'period_cleanliness', (select round(avg(100 - p.contamination_pct), 1) from public.pickups p
                                where p.site_id = s.id and p.picked_at >= t_from and p.picked_at < t_to),
        'trend', (select round(avg(100 - p.contamination_pct) filter (where p.picked_at >= t_from)
                             - avg(100 - p.contamination_pct) filter (where p.picked_at < t_from), 1)
                    from public.pickups p where p.site_id = s.id and p.picked_at >= t_from - half and p.picked_at < t_to),
        'pickups', (select count(*) from public.pickups p where p.site_id = s.id and p.picked_at >= t_from and p.picked_at < t_to),
        'mixed_pickups', (select count(*) from public.pickups p where p.site_id = s.id and p.mixed_flag and p.picked_at >= t_from and p.picked_at < t_to),
        'reports', (select count(*) from public.reports r where r.site_id = s.id and r.created_at >= t_from and r.created_at < t_to),
        'last_pickup_at', s.last_pickup_at) x
      from public.sites s join public.districts d on d.id = s.district_id
      where s.is_active and (p_city_id is null or d.city_id = p_city_id) and (p_district_id is null or s.district_id = p_district_id)
      limit least(greatest(p_limit, 1), 1000)
    ) t), '[]'::jsonb);
end $$;

-- GET /dashboard/carriers-rating — доля рейсов без смешивания, срывы графика, отклонения
create or replace function public.dashboard_carriers_rating(
  p_city_id uuid default null, p_from timestamptz default null, p_to timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t_to timestamptz := coalesce(p_to, clock_timestamp());
  t_from timestamptz := coalesce(p_from, t_to - interval '7 days');
begin
  perform public.dashboard_check_access(p_city_id);
  return coalesce((
    select jsonb_agg(x order by (x ->> 'clean_trips_pct')::numeric asc nulls last)
    from (
      select jsonb_build_object(
        'carrier_id', c.id, 'name', c.name,
        'trips', count(d.trip_id),
        'mixed_trips', count(d.trip_id) filter (where d.mixed_flag),
        'clean_trips_pct', case when count(d.trip_id) > 0
           then round(100.0 * count(d.trip_id) filter (where not d.mixed_flag) / count(d.trip_id), 1) end,
        'deviation_trips', count(d.trip_id) filter (where d.deviation_flag),
        'missed_routes', (select count(*) from public.routes r join public.vehicles v on v.id = r.vehicle_id
                           where v.carrier_id = c.id and r.route_date >= t_from::date and r.route_date < public.local_today()
                             and r.route_date <= t_to::date
                             and not exists (select 1 from public.trips t where t.route_id = r.id)),
        'confirmed_mixed_reports', (select count(*) from public.reports rp join public.trips t on t.id = rp.related_trip_id
                                     join public.vehicles v on v.id = t.vehicle_id
                                    where v.carrier_id = c.id and rp.type = 'mixed' and rp.status = 'confirmed'
                                      and rp.created_at >= t_from and rp.created_at < t_to)
      ) x
      from public.carriers c
      left join public.trip_dims d on d.carrier_id = c.id and d.started_at >= t_from and d.started_at < t_to
                                  and (p_city_id is null or d.city_id = p_city_id)
      where p_city_id is null or c.city_id = p_city_id or c.city_id is null
      group by c.id, c.name
    ) t), '[]'::jsonb);
end $$;

-- ======================================================== БОНУСЫ (раздел 12)
create or replace function public.me_bonuses(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare uid uuid := public.require_auth();
begin
  return jsonb_build_object(
    'balance', (select bonus_balance from public.profiles where user_id = uid),
    'transactions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'source_type', source_type,
                     'source_id', source_id, 'description', description, 'created_at', created_at) order by created_at desc)
                     from (select * from public.bonus_transactions where user_id = uid order by created_at desc limit p_limit) t), '[]'::jsonb));
end $$;

-- Личный QR жителя: токен меняется каждые 5 минут, чтобы его нельзя было скопировать
create or replace function public.my_personal_qr() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_auth();
  secret text;
  win bigint := floor(extract(epoch from now()) / 300);
begin
  select personal_qr_secret into secret from public.profiles where user_id = uid;
  return jsonb_build_object(
    'token', uid::text || '.' || win || '.' || encode(hmac(uid::text || '.' || win, secret, 'sha256'), 'hex'),
    'expires_at', to_timestamp((win + 1) * 300));
end $$;

create or replace function public.resolve_personal_qr(p_token text) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  parts text[] := string_to_array(p_token, '.');
  uid uuid; win bigint; secret text; now_win bigint := floor(extract(epoch from now()) / 300);
begin
  if cardinality(parts) <> 3 then perform public.api_error('INVALID_QR', 'Неверный QR'); end if;
  begin
    uid := parts[1]::uuid; win := parts[2]::bigint;
  exception when others then
    perform public.api_error('INVALID_QR', 'Неверный QR');
  end;
  if win < now_win - 1 or win > now_win then perform public.api_error('INVALID_QR', 'QR устарел, обновите его'); end if;
  select personal_qr_secret into secret from public.profiles where user_id = uid;
  if secret is null or encode(hmac(uid::text || '.' || win, secret, 'sha256'), 'hex') <> parts[3] then
    perform public.api_error('INVALID_QR', 'Неверный QR');
  end if;
  return uid;
end $$;

-- POST /drop-offs — сдача вторсырья жителем в пункте приёма → бонусы (правило 1)
create or replace function public.drop_off_create(
  p_facility_id uuid, p_waste_type public.waste_type, p_weight_kg numeric,
  p_user_qr text default null, p_user_id uuid default null, p_client_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  op uuid := public.require_role('operator');
  uid uuid := coalesce(p_user_id, case when p_user_qr is not null then public.resolve_personal_qr(p_user_qr) end);
  d public.drop_offs;
  rule public.bonus_rules;
  amount numeric := 0;
  today_cnt int;
  daily_limit int;
begin
  if uid is null then perform public.api_error('VALIDATION', 'Нужен QR жителя'); end if;
  if not public.is_operator_of(p_facility_id) then perform public.api_error('FORBIDDEN', 'Не ваш объект'); end if;
  if p_client_id is not null then
    select * into d from public.drop_offs where client_id = p_client_id;
    if d.id is not null then return to_jsonb(d) || jsonb_build_object('duplicate', true); end if;
  end if;
  select * into rule from public.bonus_rules where code = 'drop_off_rate' and waste_type = p_waste_type and is_active;
  daily_limit := coalesce((select (params ->> 'daily_limit')::int from public.bonus_rules where code = 'drop_off_limits'), 5);
  select count(*) into today_cnt from public.drop_offs where user_id = uid and created_at >= now() - interval '1 day';
  if today_cnt >= daily_limit then perform public.api_error('LIMIT_EXCEEDED', 'Превышен лимит сдач за день'); end if;

  insert into public.drop_offs (user_id, facility_id, waste_type, weight_kg, operator_id, client_id)
  values (uid, p_facility_id, p_waste_type, p_weight_kg, op, p_client_id) returning * into d;

  amount := round(coalesce(rule.rate_per_kg, 0) * p_weight_kg, 2);
  if amount > 0 then
    insert into public.bonus_transactions (user_id, amount, source_type, source_id, description)
    values (uid, amount, 'drop_off', d.id, format('Сдача %s кг (%s)', p_weight_kg, p_waste_type))
    on conflict do nothing;
  end if;
  -- необычно большой объём → в журнал для администратора
  if p_weight_kg > coalesce((select (params ->> 'alert_kg')::numeric from public.bonus_rules where code = 'drop_off_limits'), 50) then
    insert into public.app_logs (source, level, message, context, user_id)
    values ('api', 'warn', 'Необычно большая сдача', jsonb_build_object('drop_off_id', d.id, 'weight_kg', p_weight_kg), uid);
  end if;
  return to_jsonb(d) || jsonb_build_object('bonus', amount);
end $$;

-- Журнал ошибок фронта/ИИ (одно место для логов, P1)
create or replace function public.log_event(p_source text, p_level text, p_message text, p_context jsonb default '{}')
returns void language sql security definer set search_path = public, extensions as $$
  insert into public.app_logs (source, level, message, context, user_id)
  values (p_source, p_level, left(p_message, 2000), coalesce(p_context, '{}'), auth.uid())
$$;

-- ============================================== списки для Edge Function
-- security invoker: работает RLS (житель — свои жалобы, акимат — своего города)
create or replace function public.reports_list(
  p_status public.report_status default null, p_type public.report_type default null,
  p_district_id uuid default null, p_limit int default 50
) returns jsonb
language sql stable security invoker set search_path = public, extensions as $$
  select coalesce(jsonb_agg(public.report_json(r.id) order by r.created_at desc), '[]'::jsonb)
  from (select r.* from public.reports r
          left join public.sites s on s.id = r.site_id
         where (p_status is null or r.status = p_status)
           and (p_type is null or r.type = p_type)
           and (p_district_id is null or s.district_id = p_district_id)
         order by r.created_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 500)) r
$$;

create or replace function public.report_get(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.reports where id = p_id) then
    perform public.api_error('NOT_FOUND', 'Жалоба не найдена');
  end if;
  return public.report_json(p_id);
end $$;

create or replace function public.waste_rules_list(p_city_id uuid default null) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(to_jsonb(w) - 'id' - 'created_at' - 'updated_at' - 'city_id' order by w.sort_order), '[]'::jsonb)
  from (
    select distinct on (ai_class) * from public.waste_rules
     where city_id is null or city_id = p_city_id
     order by ai_class, (city_id is null)   -- правило города важнее правила по умолчанию
  ) w
$$;

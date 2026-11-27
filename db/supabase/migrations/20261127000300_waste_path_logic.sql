-- =============================================================================
-- «Қайда?» · Миграция 3: логика отслеживания пути отходов (ТЗ, раздел 7)
-- Статусы: 1 В контейнере → 2 Вывезено → 3 В пути → 4 Принято на объекте →
--          5 Отсортировано → 6 Итог.
-- Правила 1–5 раздела 7 реализованы здесь, на уровне базы, поэтому одинаково
-- работают для приложения водителя, симулятора и сидов.
-- =============================================================================
set search_path = public, extensions;

-- Настройки логики пути — в одном месте, меняются без правки кода.
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger set_updated_at before update on public.app_settings for each row execute function public.tg_set_updated_at();

insert into public.app_settings (key, value, description) values
  ('cleanliness_window_days', '14', 'Окно скользящего среднего рейтинга чистоты, дней (правило 4)'),
  ('cleanliness_driver_weight', '2', 'Вес фото водителя относительно фото жителя (правило 4)'),
  ('pickup_radius_m', '100', 'Радиус «Вывезено» от площадки, м (ТЗ 10.1, P1)'),
  ('report_site_radius_m', '300', 'Поиск ближайшей площадки для жалобы, м'),
  ('scan_site_radius_m', '150', 'Привязка фото жителя к ближайшей площадке, м'),
  ('ai_confidence_threshold', '0.35', 'Порог уверенности детектора (ТЗ 6.3)'),
  ('timezone', '"Asia/Almaty"', 'Часовой пояс для «сегодня»'),
  ('demo_mode', 'true', 'Зеркало флага DEMO_MODE для UI (сам флаг — переменная окружения)');

create or replace function public.setting_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = p_key), p_default)
$$;

create or replace function public.local_today() returns date
language sql stable security definer set search_path = public, extensions as $$
  select (now() at time zone coalesce((select value #>> '{}' from public.app_settings where key = 'timezone'), 'Asia/Almaty'))::date
$$;

-- -----------------------------------------------------------------------------
-- Классификация итогов: вторсырьё / энергия / полигон (круговая диаграмма 5.4)
-- -----------------------------------------------------------------------------
create or replace function public.output_category(p_type public.output_type, p_dest public.output_destination)
returns text language sql immutable as $$
  select case
    when p_dest = 'landfill' or p_type = 'landfill' then 'landfill'
    when p_dest = 'energy' or p_type = 'rdf' then 'energy'
    else 'recycled'  -- переработчик, покупатель или компост
  end
$$;

-- Правило 5: «реально вторсырьё» — виды вторсырья, ушедшие переработчику/покупателю (+ органика в компост)
create or replace function public.is_real_recycled(p_type public.output_type, p_dest public.output_destination)
returns boolean language sql immutable as $$
  select public.output_category(p_type, p_dest) = 'recycled'
$$;

create or replace function public.geo_json(g geography) returns jsonb
language sql immutable as $$ select case when g is null then null else st_asgeojson(g::geometry, 6)::jsonb end $$;

create or replace function public.lonlat(g geography) returns jsonb
language sql immutable as $$
  select case when g is null then null
         else jsonb_build_object('lon', round(st_x(g::geometry)::numeric, 6), 'lat', round(st_y(g::geometry)::numeric, 6)) end
$$;

create or replace function public.make_point(p_lon double precision, p_lat double precision) returns geography
language plpgsql immutable as $$
begin
  if p_lon is null or p_lat is null then return null; end if;
  if p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    perform public.api_error('VALIDATION', 'Неверные координаты');
  end if;
  return st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;
end $$;

-- -----------------------------------------------------------------------------
-- Ближайшая площадка (жалобы, фото жителя, онбординг «определить по геолокации»)
-- -----------------------------------------------------------------------------
create or replace function public.nearest_site_id(p_point geography, p_radius_m double precision default null)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select s.id from public.sites s
   where s.is_active and (p_radius_m is null or st_dwithin(s.location, p_point, p_radius_m))
   order by s.location <-> p_point
   limit 1
$$;

create or replace function public.nearest_sites(p_lon double precision, p_lat double precision, p_limit int default 5)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(x order by (x->>'distance_m')::numeric), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'address', s.address, 'residential_complex', s.residential_complex,
      'qr_code', s.qr_code, 'location', public.lonlat(s.location),
      'cleanliness_score', s.cleanliness_score,
      'distance_m', round(st_distance(s.location, public.make_point(p_lon, p_lat))::numeric, 1)
    ) x
    from public.sites s where s.is_active
    order by s.location <-> public.make_point(p_lon, p_lat)
    limit least(greatest(p_limit, 1), 50)
  ) t
$$;

-- -----------------------------------------------------------------------------
-- Правило 2 (часть 1): mixed_flag при вывозе.
-- Контейнер для вторсырья (не mixed) вывезен в рейсе с waste_type = mixed.
-- -----------------------------------------------------------------------------
create or replace function public.tg_pickups_before() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.containers;
  t public.trips;
begin
  select * into c from public.containers where id = new.container_id;
  if c.id is null then perform public.api_error('NOT_FOUND', 'Контейнер не найден'); end if;
  select * into t from public.trips where id = new.trip_id;
  if t.id is null then perform public.api_error('NOT_FOUND', 'Рейс не найден'); end if;

  new.site_id := c.site_id;
  if new.fill_level is null then new.fill_level := c.fill_level; end if;
  if new.ai_result is not null then
    new.model_version := coalesce(new.model_version, new.ai_result ->> 'model_version');
    if new.contamination_pct is null and (new.ai_result ? 'contamination_pct') and jsonb_typeof(new.ai_result -> 'contamination_pct') = 'number' then
      new.contamination_pct := (new.ai_result ->> 'contamination_pct')::numeric;
    end if;
  end if;
  new.mixed_flag := new.mixed_flag
                    or (new.status = 'picked' and c.waste_type <> 'mixed' and t.waste_type = 'mixed');
  return new;
end $$;

create trigger pickups_before before insert or update of container_id, trip_id, status, ai_result on public.pickups
  for each row execute function public.tg_pickups_before();

-- -----------------------------------------------------------------------------
-- Правило 4: рейтинг чистоты = скользящее среднее (100 − contamination_pct)
-- за 14 дней по фото водителей (вес 2) и жителей (вес 1, режим «контейнер»).
-- -----------------------------------------------------------------------------
create or replace function public.recompute_site_cleanliness(p_site_id uuid) returns numeric
language plpgsql security definer set search_path = public, extensions as $$
declare
  win  interval := make_interval(days => public.setting_num('cleanliness_window_days', 14)::int);
  wd   numeric := public.setting_num('cleanliness_driver_weight', 2);
  score numeric;
begin
  select round(sum(w * (100 - c)) / nullif(sum(w), 0), 2) into score from (
    select wd as w, p.contamination_pct as c from public.pickups p
     where p.site_id = p_site_id and p.contamination_pct is not null and p.picked_at >= now() - win
    union all
    select 1, s.contamination_pct from public.scans s
     where s.site_id = p_site_id and s.mode = 'container' and s.contamination_pct is not null and s.created_at >= now() - win
  ) x;
  update public.sites set cleanliness_score = score where id = p_site_id and cleanliness_score is distinct from score;
  return score;
end $$;

create or replace function public.tg_pickups_after() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status = 'picked' then
    update public.sites s
       set last_pickup_at = new.picked_at, last_pickup_id = new.id
     where s.id = new.site_id and (s.last_pickup_at is null or s.last_pickup_at <= new.picked_at);
    -- после вывоза контейнер пустой
    update public.containers set fill_level = 0 where id = new.container_id;
  end if;
  if new.mixed_flag then
    update public.trips set mixed_flag = true where id = new.trip_id and not mixed_flag;
  end if;
  perform public.recompute_site_cleanliness(new.site_id);
  return null;
end $$;

create trigger pickups_after after insert or update on public.pickups
  for each row execute function public.tg_pickups_after();

create or replace function public.tg_scans_after() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.site_id is not null and new.mode = 'container' then
    perform public.recompute_site_cleanliness(new.site_id);
  end if;
  return null;
end $$;

create trigger scans_after after insert or update on public.scans
  for each row execute function public.tg_scans_after();

-- -----------------------------------------------------------------------------
-- Правило 3: пункт назначения — последняя точка трека в радиусе geofence
-- (по умолчанию 300 м) от объекта. Несовпадение с планом — deviation_flag.
-- Правило 2 (часть 2): рейс приехал на полигон, а не на сортировку →
-- mixed_flag у всех вывозов контейнеров для вторсырья.
-- -----------------------------------------------------------------------------
create or replace function public.detect_destination(p_point geography) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select f.id from public.facilities f
   where f.is_active and st_dwithin(f.location, p_point, f.geofence_radius_m)
   order by st_distance(f.location, p_point)
   limit 1
$$;

create or replace function public.apply_trip_rules(p_trip_id uuid) returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.trips;
  last_pt geography;
  dest uuid;
  dest_type public.facility_type;
  pts int;
begin
  select * into t from public.trips where id = p_trip_id for update;
  if t.id is null then perform public.api_error('NOT_FOUND', 'Рейс не найден'); end if;

  -- трек из GPS-точек
  select count(*) into pts from public.vehicle_positions where trip_id = t.id;
  if pts >= 2 then
    update public.trips set track = (
      select st_makeline(location::geometry order by recorded_at)::geography
        from public.vehicle_positions where trip_id = t.id
    ) where id = t.id;
  end if;
  select location into last_pt from public.vehicle_positions
   where trip_id = t.id order by recorded_at desc limit 1;

  -- пункт назначения: geofence по последней точке; если оператор уже принял партию — её объект
  dest := coalesce(public.detect_destination(last_pt),
                   (select b.facility_id from public.batches b where b.trip_id = t.id order by b.received_at limit 1),
                   t.destination_facility_id);
  select type into dest_type from public.facilities where id = dest;

  update public.trips
     set destination_facility_id = dest,
         deviation_flag = (dest is not null and t.planned_facility_id is not null and dest <> t.planned_facility_id)
   where id = t.id;

  if dest_type = 'landfill' then
    update public.pickups p set mixed_flag = true
      from public.containers c
     where p.trip_id = t.id and c.id = p.container_id and c.waste_type <> 'mixed'
       and p.status = 'picked' and not p.mixed_flag;
    if found then
      update public.trips set mixed_flag = true where id = t.id;
    end if;
  end if;

  select * into t from public.trips where id = p_trip_id;
  return t;
end $$;

-- -----------------------------------------------------------------------------
-- Правило 1: вес партии распределяется по площадкам рейса пропорционально
-- объёму × заполненности контейнеров. Если данных о заполненности нет —
-- поровну между вывезенными контейнерами.
-- -----------------------------------------------------------------------------
create or replace view public.trip_site_shares
with (security_invoker = true) as
with w as (
  select p.trip_id, p.site_id,
         sum(c.volume_l * coalesce(nullif(p.fill_level, 0), 0)::numeric / 100) as vol,
         count(*) as cnt
    from public.pickups p
    join public.containers c on c.id = p.container_id
   where p.status = 'picked'
   group by p.trip_id, p.site_id
), tot as (
  select trip_id, sum(vol) as vol, sum(cnt) as cnt from w group by trip_id
)
select w.trip_id, w.site_id,
       case when tot.vol > 0 then w.vol / tot.vol else w.cnt::numeric / tot.cnt end as share
  from w join tot using (trip_id);

comment on view public.trip_site_shares is 'Правило 1 раздела 7: доля площадки в весе партии рейса.';

-- -----------------------------------------------------------------------------
-- Итоги партии: сумма кг по видам не может превышать вес партии; статус
-- «sorted» (итог, статус 6) возможен только при точном равенстве.
-- -----------------------------------------------------------------------------
create or replace function public.tg_batch_outputs_check() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  bid uuid := coalesce(new.batch_id, old.batch_id);
  total numeric; w numeric; st public.batch_status;
begin
  select weight_kg, status into w, st from public.batches where id = bid;
  select coalesce(sum(weight_kg), 0) into total from public.batch_outputs where batch_id = bid;
  if total > w + 0.01 then
    perform public.api_error('VALIDATION', format('Сумма итогов %s кг больше веса партии %s кг', total, w));
  end if;
  if st = 'sorted' and abs(total - w) > 0.01 then
    perform public.api_error('VALIDATION', 'Партия закрыта: итоги должны точно равняться весу');
  end if;
  if st = 'received' and total > 0 then
    update public.batches set status = 'sorting' where id = bid;
  end if;
  return null;
end $$;

create constraint trigger batch_outputs_sum_check after insert or update or delete on public.batch_outputs
  deferrable initially deferred
  for each row execute function public.tg_batch_outputs_check();

create or replace function public.tg_batches_status_check() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare total numeric;
begin
  if new.status = 'sorted' then
    select coalesce(sum(weight_kg), 0) into total from public.batch_outputs where batch_id = new.id;
    if abs(total - new.weight_kg) > 0.01 then
      perform public.api_error('VALIDATION', format('Нельзя закрыть партию: итоги %s кг ≠ вес %s кг', total, new.weight_kg));
    end if;
  end if;
  if new.gross_kg is not null and new.tare_kg is not null and tg_op = 'INSERT' and new.weight_kg = 0 then
    new.weight_kg := new.gross_kg - new.tare_kg;
  end if;
  return new;
end $$;

create trigger batches_status_check before insert or update on public.batches
  for each row execute function public.tg_batches_status_check();

-- Принятая партия — подтверждение пункта назначения рейса
create or replace function public.tg_batches_after() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.trip_id is not null then
    update public.trips set destination_facility_id = coalesce(destination_facility_id, new.facility_id)
     where id = new.trip_id;
  end if;
  return null;
end $$;

create trigger batches_after after insert on public.batches
  for each row execute function public.tg_batches_after();

-- -----------------------------------------------------------------------------
-- Бонусы: баланс всегда равен сумме транзакций (ТЗ 12)
-- -----------------------------------------------------------------------------
create or replace function public.tg_bonus_balance() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := coalesce(new.user_id, old.user_id);
begin
  update public.profiles
     set bonus_balance = coalesce((select sum(amount) from public.bonus_transactions where user_id = uid), 0)
   where user_id = uid;
  return null;
end $$;

create trigger bonus_balance after insert or update or delete on public.bonus_transactions
  for each row execute function public.tg_bonus_balance();

-- -----------------------------------------------------------------------------
-- Сборка пути отходов одного рейса для одной площадки (статусы 1–6)
-- -----------------------------------------------------------------------------
create or replace function public.facility_brief(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select case when f.id is null then null else jsonb_build_object(
    'id', f.id, 'name', f.name, 'type', f.type, 'address', f.address,
    'location', public.lonlat(f.location), 'model_3d_url', f.model_3d_url) end
  from (select 1) d left join public.facilities f on f.id = p_id
$$;

create or replace function public.trip_chain(p_trip_id uuid, p_site_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t public.trips;
  v public.vehicles;
  car public.carriers;
  share numeric := 1;
  batches_json jsonb;
  outcome jsonb;
  stage int := 2;
  first_pick timestamptz;
  pickups_json jsonb;
  cur_pos jsonb;
  b_received timestamptz;
  b_sorted boolean;
  has_outputs boolean;
begin
  select * into t from public.trips where id = p_trip_id;
  if t.id is null then return null; end if;
  select * into v from public.vehicles where id = t.vehicle_id;
  select * into car from public.carriers where id = v.carrier_id;

  if p_site_id is not null then
    select coalesce((select s.share from public.trip_site_shares s where s.trip_id = t.id and s.site_id = p_site_id), 0) into share;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'container_id', p.container_id, 'site_id', p.site_id,
           'container_waste_type', c.waste_type, 'status', p.status,
           'picked_at', p.picked_at, 'photo_url', p.photo_url,
           'contamination_pct', p.contamination_pct, 'mixed_flag', p.mixed_flag,
           'model_version', p.model_version) order by p.picked_at), '[]'::jsonb),
         min(p.picked_at)
    into pickups_json, first_pick
    from public.pickups p join public.containers c on c.id = p.container_id
   where p.trip_id = t.id and (p_site_id is null or p.site_id = p_site_id);

  if t.status = 'active' then
    stage := 3;
    select jsonb_build_object('location', public.lonlat(vp.location), 'speed', vp.speed,
                              'heading', vp.heading, 'recorded_at', vp.recorded_at)
      into cur_pos
      from public.vehicle_positions vp where vp.trip_id = t.id order by vp.recorded_at desc limit 1;
  end if;

  -- партии рейса и итоги (+ один уровень «дальше по итогам»)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'facility', public.facility_brief(b.facility_id),
           'weight_kg', b.weight_kg, 'site_kg', round(b.weight_kg * share, 2),
           'received_at', b.received_at, 'status', b.status,
           'outputs', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', o.id, 'output_type', o.output_type, 'weight_kg', o.weight_kg,
                      'site_kg', round(o.weight_kg * share, 2),
                      'destination', o.destination,
                      'category', public.output_category(o.output_type, o.destination),
                      'next_facility', public.facility_brief(o.next_facility_id),
                      'buyer_name', o.buyer_name,
                      'next_batches', coalesce((
                        select jsonb_agg(jsonb_build_object('id', nb.id, 'facility', public.facility_brief(nb.facility_id),
                                                            'weight_kg', nb.weight_kg, 'received_at', nb.received_at, 'status', nb.status))
                          from public.batches nb where nb.parent_output_id = o.id), '[]'::jsonb)
                    ) order by o.weight_kg desc)
               from public.batch_outputs o where o.batch_id = b.id), '[]'::jsonb)
         ) order by b.received_at), '[]'::jsonb),
         min(b.received_at),
         coalesce(bool_and(b.status = 'sorted'), false)
    into batches_json, b_received, b_sorted
    from public.batches b where b.trip_id = t.id;

  select exists (select 1 from public.batch_outputs o join public.batches b on b.id = o.batch_id where b.trip_id = t.id)
    into has_outputs;

  select jsonb_build_object(
           'recycled_kg', round(coalesce(sum(o.weight_kg) filter (where public.output_category(o.output_type, o.destination) = 'recycled'), 0) * share, 2),
           'energy_kg',   round(coalesce(sum(o.weight_kg) filter (where public.output_category(o.output_type, o.destination) = 'energy'), 0) * share, 2),
           'landfill_kg', round(coalesce(sum(o.weight_kg) filter (where public.output_category(o.output_type, o.destination) = 'landfill'), 0) * share, 2)
         )
    into outcome
    from public.batch_outputs o join public.batches b on b.id = o.batch_id where b.trip_id = t.id;

  if t.status = 'finished' then stage := 3; end if;
  if b_received is not null then stage := 4; end if;
  if has_outputs then stage := 5; end if;
  if b_received is not null and b_sorted then stage := 6; end if;
  -- рейс приехал на полигон без приёмки: итог известен сразу — всё на полигон
  if b_received is null and t.status = 'finished'
     and (select type from public.facilities where id = t.destination_facility_id) = 'landfill' then
    stage := 6;
  end if;

  return jsonb_build_object(
    'trip_id', t.id,
    'stage', stage,
    'stage_code', (array['in_container','picked_up','in_transit','received','sorted','outcome'])[stage],
    'status', t.status,
    'waste_type', t.waste_type,
    'mixed_flag', t.mixed_flag or exists (select 1 from jsonb_array_elements(pickups_json) e where (e->>'mixed_flag')::boolean),
    'deviation_flag', t.deviation_flag,
    'started_at', t.started_at,
    'finished_at', t.finished_at,
    'vehicle', jsonb_build_object('id', v.id, 'plate_number', v.plate_number, 'vehicle_type', v.vehicle_type),
    'carrier', jsonb_build_object('id', car.id, 'name', car.name),
    'pickups', pickups_json,
    'current_position', cur_pos,
    'track', public.geo_json(t.track),
    'planned_facility', public.facility_brief(t.planned_facility_id),
    'destination_facility', public.facility_brief(t.destination_facility_id),
    'site_share', round(share, 4),
    'batches', batches_json,
    'outcome', outcome,
    'timeline', jsonb_build_array(
      jsonb_build_object('stage', 1, 'code', 'in_container', 'done', true, 'at', null),
      jsonb_build_object('stage', 2, 'code', 'picked_up', 'done', true, 'at', first_pick),
      jsonb_build_object('stage', 3, 'code', 'in_transit', 'done', stage >= 3, 'at', t.started_at,
                         'active', t.status = 'active'),
      jsonb_build_object('stage', 4, 'code', 'received', 'done', stage >= 4, 'at', b_received),
      jsonb_build_object('stage', 5, 'code', 'sorted', 'done', stage >= 5, 'at', null),
      jsonb_build_object('stage', 6, 'code', 'outcome', 'done', stage >= 6, 'at', null)
    )
  );
end $$;

-- -----------------------------------------------------------------------------
-- GET /sites/{id}/path?period=7d — путь отходов площадки
-- -----------------------------------------------------------------------------
create or replace function public.site_path(p_site_id uuid, p_period_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.sites;
  d public.districts;
  history jsonb;
  latest jsonb;
  summary jsonb;
  days int := least(greatest(coalesce(p_period_days, 7), 1), 365);
begin
  select * into s from public.sites where id = p_site_id;
  if s.id is null then perform public.api_error('NOT_FOUND', 'Площадка не найдена'); end if;
  select * into d from public.districts where id = s.district_id;

  select coalesce(jsonb_agg(public.trip_chain(x.trip_id, s.id) order by x.last_pick desc), '[]'::jsonb)
    into history
    from (select p.trip_id, max(p.picked_at) as last_pick
            from public.pickups p
           where p.site_id = s.id and p.picked_at >= now() - make_interval(days => days)
           group by p.trip_id) x;

  latest := case when jsonb_array_length(history) > 0 then history -> 0
                 else (select public.trip_chain(p.trip_id, s.id) from public.pickups p
                        where p.site_id = s.id order by p.picked_at desc limit 1) end;

  select jsonb_build_object(
           'trips', jsonb_array_length(history),
           'pickups', coalesce(sum(jsonb_array_length(h -> 'pickups')), 0),
           'site_kg', round(coalesce(sum((select sum((b ->> 'site_kg')::numeric) from jsonb_array_elements(h -> 'batches') b)), 0), 2),
           'recycled_kg', round(coalesce(sum(((h -> 'outcome') ->> 'recycled_kg')::numeric), 0), 2),
           'energy_kg', round(coalesce(sum(((h -> 'outcome') ->> 'energy_kg')::numeric), 0), 2),
           'landfill_kg', round(coalesce(sum(((h -> 'outcome') ->> 'landfill_kg')::numeric), 0), 2),
           'mixed_events', count(*) filter (where (h ->> 'mixed_flag')::boolean)
         )
    into summary
    from jsonb_array_elements(history) h;

  return jsonb_build_object(
    'site', jsonb_build_object(
      'id', s.id, 'address', s.address, 'residential_complex', s.residential_complex,
      'qr_code', s.qr_code, 'location', public.lonlat(s.location),
      'cleanliness_score', s.cleanliness_score, 'last_pickup_at', s.last_pickup_at,
      'district', jsonb_build_object('id', d.id, 'name_ru', d.name_ru, 'name_kk', d.name_kk),
      'city_id', d.city_id),
    'containers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'waste_type', c.waste_type, 'volume_l', c.volume_l, 'fill_level', c.fill_level) order by c.waste_type)
        from public.containers c where c.site_id = s.id and c.is_active), '[]'::jsonb),
    'period_days', days,
    'summary', summary,
    'latest', latest,
    'history', history
  );
end $$;

create or replace function public.site_by_qr(p_code text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select case when s.id is null then null else jsonb_build_object(
    'id', s.id, 'address', s.address, 'residential_complex', s.residential_complex,
    'qr_code', s.qr_code, 'location', public.lonlat(s.location),
    'cleanliness_score', s.cleanliness_score, 'last_pickup_at', s.last_pickup_at,
    'district_id', s.district_id,
    'containers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'waste_type', c.waste_type,
        'volume_l', c.volume_l, 'fill_level', c.fill_level)) from public.containers c where c.site_id = s.id and c.is_active), '[]'::jsonb)
  ) end
  from (select 1) d
  left join public.sites s on s.qr_code = p_code
     or s.id = (select c.site_id from public.containers c where c.qr_code = p_code limit 1)
  limit 1
$$;

-- Карточка «Моя площадка» для главной жителя (ТЗ 5.2): чистота, последний вывоз,
-- куда увезли, кг вторсырья за месяц, топ ошибок за 7 дней.
create or replace function public.site_card(p_site_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.sites;
  last_chain jsonb;
  month jsonb;
  top_errors jsonb;
begin
  select * into s from public.sites where id = p_site_id;
  if s.id is null then perform public.api_error('NOT_FOUND', 'Площадка не найдена'); end if;
  if s.last_pickup_id is not null then
    select public.trip_chain(p.trip_id, s.id) into last_chain from public.pickups p where p.id = s.last_pickup_id;
  end if;
  month := (public.site_path(s.id, 30)) -> 'summary';

  select coalesce(jsonb_agg(jsonb_build_object('class', cls, 'label_ru', wr.label_ru, 'label_kk', wr.label_kk,
                                               'bin', wr.bin, 'count', n, 'hint_ru', wr.hint_ru, 'hint_kk', wr.hint_kk)
                            order by n desc), '[]'::jsonb)
    into top_errors
    from (
      select it ->> 'class' as cls, count(*) as n
        from (select ai_result from public.scans where site_id = s.id and created_at >= now() - interval '7 days'
              union all
              select ai_result from public.pickups where site_id = s.id and picked_at >= now() - interval '7 days') src,
             jsonb_array_elements(coalesce(src.ai_result -> 'items', '[]'::jsonb)) it
       where (it ->> 'correct')::boolean is false
       group by 1 order by 2 desc limit 5
    ) e
    left join public.waste_rules wr on wr.ai_class = e.cls and wr.city_id is null;

  return jsonb_build_object(
    'site', public.site_by_qr(s.qr_code),
    'cleanliness_score', s.cleanliness_score,
    'cleanliness_color', case when s.cleanliness_score is null then 'gray'
                              when s.cleanliness_score >= 80 then 'green'
                              when s.cleanliness_score >= 50 then 'yellow' else 'red' end,
    'last_pickup_at', s.last_pickup_at,
    'last_destination', last_chain -> 'destination_facility',
    'last_stage', last_chain -> 'stage',
    'month_recycled_kg', coalesce((month ->> 'recycled_kg')::numeric, 0),
    'month_site_kg', coalesce((month ->> 'site_kg')::numeric, 0),
    'top_errors', top_errors,
    'tip_of_day', (select jsonb_build_object('class', ai_class, 'hint_ru', hint_ru, 'hint_kk', hint_kk)
                     from public.waste_rules where city_id is null and hint_ru is not null
                    order by ((extract(doy from now())::int + sort_order) % 13), sort_order limit 1)
  );
end $$;

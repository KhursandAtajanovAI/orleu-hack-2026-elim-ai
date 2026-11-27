-- =============================================================================
-- Сквозной тест цепочки пути отходов (ТЗ 7) + права доступа (ТЗ 2) + флаги.
-- Критерии приёмки раздела 7:
--   • для площадки с данными путь собирается до статуса 6;
--   • сумма кг по итогам равна весу партии;
--   • флаги смешивания срабатывают на тестовых сценариях.
-- Весь тест в транзакции и откатывается.
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

create or replace function tests.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

create or replace function tests.err(stmt text, code text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like code || '%' or sqlstate = code then
      raise notice 'ok - % (ошибка: %)', msg, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % — ожидали %, получили: % [%]', msg, code, sqlerrm, sqlstate;
  end;
  raise exception 'FAIL: % — ожидали ошибку %, но запрос прошёл', msg, code;
end $$;

create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------------ данные
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test'),
  ('00000000-0000-0000-0000-0000000000a2', 'akimat@test'),
  ('00000000-0000-0000-0000-0000000000d1', 'driver1@test'),
  ('00000000-0000-0000-0000-0000000000d2', 'driver2@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'operator@test'),
  ('00000000-0000-0000-0000-0000000000f1', 'resident1@test'),
  ('00000000-0000-0000-0000-0000000000f2', 'resident2@test');

select tests.ok((select count(*) from public.profiles) = 7, 'триггер создал профили для новых пользователей');
select tests.ok((select roles from public.profiles where email = 'resident1@test') = '{resident}', 'роль по умолчанию — житель');

insert into public.cities (id, name_ru, name_kk, slug, center)
values ('10000000-0000-0000-0000-000000000001', 'Астана', 'Астана', 'astana', public.make_point(71.4304, 51.1282));
insert into public.districts (id, city_id, name_ru) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Есиль');

insert into public.facilities (id, city_id, type, name, location, accepted_waste_types) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'sorting', 'Сортировка', public.make_point(71.5000, 51.1000), '{plastic,paper,glass,metal,mixed}'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'landfill', 'Полигон', public.make_point(71.6000, 51.0500), '{mixed}'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'recycling', 'Переработчик ПЭТ', public.make_point(71.3500, 51.2000), '{plastic}');

update public.profiles set roles = '{admin}' where email = 'admin@test';
update public.profiles set roles = '{akimat}', city_id = '10000000-0000-0000-0000-000000000001' where email = 'akimat@test';
update public.profiles set roles = '{driver}' where email in ('driver1@test', 'driver2@test');
update public.profiles set roles = '{operator}', facility_id = '30000000-0000-0000-0000-000000000001' where email = 'operator@test';
update public.profiles set consent_data = true, consent_training = true where email = 'resident1@test';

insert into public.sites (id, district_id, address, location, qr_code) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'пр. Кабанбай батыра, 11', public.make_point(71.4200, 51.0900), 'QR-S1'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'ул. Сыганак, 25',        public.make_point(71.4300, 51.0950), 'QR-S2');

insert into public.containers (id, site_id, waste_type, volume_l, fill_level) values
  ('50000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000001', 'plastic', 1100, 80),
  ('50000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000001', 'mixed',   1100, 100),
  ('50000000-0000-0000-0000-000000000021', '40000000-0000-0000-0000-000000000002', 'plastic', 1100, 40);

insert into public.carriers (id, city_id, name) values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ТОО «Таза Қала»');
insert into public.vehicles (id, carrier_id, plate_number, capacity_kg, driver_id) values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '001 AAA 01', 8000, '00000000-0000-0000-0000-0000000000d1'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '002 AAA 01', 8000, '00000000-0000-0000-0000-0000000000d2');

insert into public.routes (id, vehicle_id, route_date, site_ids, waste_type, planned_facility_id) values
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', public.local_today(),
   '{40000000-0000-0000-0000-000000000001,40000000-0000-0000-0000-000000000002}', 'plastic', '30000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', public.local_today(),
   '{40000000-0000-0000-0000-000000000001}', 'mixed', '30000000-0000-0000-0000-000000000002');

-- ================================================ Сценарий 1: честный рейс
select tests.as_user('00000000-0000-0000-0000-0000000000d1');

select tests.ok(jsonb_array_length(public.driver_route_today() -> 'routes') = 1, 'водитель видит только свой маршрут на сегодня');
select tests.ok((public.driver_route_today() -> 'routes' -> 0 -> 'progress' ->> 'total')::int = 2, 'в маршруте 2 площадки');

create temp table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to authenticated, anon;
insert into ctx select 'trip1', (public.trip_start(p_route_id => '80000000-0000-0000-0000-000000000001') ->> 'trip_id')::uuid;
select tests.ok((select status from public.trips where id = (select v from ctx where k = 'trip1')) = 'active', 'рейс начат');
select tests.err($$ select public.trip_start(p_route_id => '80000000-0000-0000-0000-000000000001') $$, 'CONFLICT', 'второй активный рейс у машины запрещён');

select tests.err(format($$ select public.pickup_create(%L, '50000000-0000-0000-0000-000000000011') $$, (select v from ctx where k = 'trip1')),
                 'PHOTO_REQUIRED', 'вывоз без фото запрещён');

select tests.ok((public.pickup_create(
  p_trip_id => (select v from ctx where k = 'trip1'), p_container_id => '50000000-0000-0000-0000-000000000011',
  p_photo_url => 'https://x/p1.jpg', p_client_id => 'offline-1', p_lon => 71.4201, p_lat => 51.0901,
  p_ai_result => '{"model_version":"waste-yolo-0.1","contamination_pct":10,"items":[{"class":"pet_bottle","correct":true},{"class":"organic","correct":false}]}'
) ->> 'within_radius')::boolean, 'вывоз S1 в радиусе 100 м');

select tests.ok((public.pickup_create(p_trip_id => (select v from ctx where k = 'trip1'), p_container_id => '50000000-0000-0000-0000-000000000011',
  p_photo_url => 'https://x/p1.jpg', p_client_id => 'offline-1') ->> 'duplicate')::boolean, 'повтор из офлайн-очереди не дублирует вывоз');

select public.pickup_create(p_trip_id => (select v from ctx where k = 'trip1'), p_container_id => '50000000-0000-0000-0000-000000000021',
  p_photo_url => 'https://x/p2.jpg', p_ai_result => '{"model_version":"waste-yolo-0.1","contamination_pct":30,"items":[]}');

select tests.ok((select count(*) from public.pickups where trip_id = (select v from ctx where k = 'trip1')) = 2, 'два вывоза в рейсе');
select tests.ok((select count(*) from public.pickups where mixed_flag) = 0, 'раздельный рейс — без флага смешивания');

-- GPS: путь от площадок к сортировке, последняя точка в 100 м от объекта
select tests.ok((public.trip_add_positions((select v from ctx where k = 'trip1'), jsonb_build_array(
  jsonb_build_object('lon', 71.4200, 'lat', 51.0900, 'speed', 0,  'recorded_at', now() - interval '50 min'),
  jsonb_build_object('lon', 71.4300, 'lat', 51.0950, 'speed', 25, 'recorded_at', now() - interval '40 min'),
  jsonb_build_object('lon', 71.4700, 'lat', 51.1000, 'speed', 45, 'recorded_at', now() - interval '20 min'),
  jsonb_build_object('lon', 71.4990, 'lat', 51.1003, 'speed', 5,  'recorded_at', now() - interval '5 min')
)) ->> 'accepted')::int = 4, 'принято 4 GPS-точки');
select tests.ok((public.trip_add_positions((select v from ctx where k = 'trip1'), jsonb_build_array(
  jsonb_build_object('lon', 71.4990, 'lat', 51.1003, 'recorded_at', now() - interval '5 min')
)) ->> 'accepted')::int = 0, 'повторная пачка GPS не дублирует точки');

-- путь в статусе 3 «В пути»
select tests.ok((public.site_path('40000000-0000-0000-0000-000000000001') -> 'latest' ->> 'stage')::int = 3, 'путь: статус 3 «В пути» при активном рейсе');

select public.trip_finish((select v from ctx where k = 'trip1'));
select tests.ok((select destination_facility_id from public.trips where id = (select v from ctx where k = 'trip1')) = '30000000-0000-0000-0000-000000000001',
                'geofence 300 м: пункт назначения — сортировка');
select tests.ok((select not deviation_flag and track is not null from public.trips where id = (select v from ctx where k = 'trip1')), 'трек собран, отклонения нет');

-- чужой водитель не может трогать рейс
select tests.as_user('00000000-0000-0000-0000-0000000000d2');
select tests.err(format($$ select public.trip_finish(%L) $$, (select v from ctx where k = 'trip1')), 'FORBIDDEN', 'чужой водитель не управляет рейсом');

-- ---------------------------------------------------- приёмка и сортировка
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ctx select 'batch1', (public.batch_create(p_facility_id => '30000000-0000-0000-0000-000000000001',
  p_trip_id => (select v from ctx where k = 'trip1'), p_gross_kg => 13000, p_tare_kg => 12000) ->> 'id')::uuid;
select tests.ok((select weight_kg from public.batches where id = (select v from ctx where k = 'batch1')) = 1000, 'вес нетто = брутто − тара');
select tests.ok((public.site_path('40000000-0000-0000-0000-000000000001') -> 'latest' ->> 'stage')::int = 4, 'путь: статус 4 «Принято на объекте»');

select tests.err(format($$ select public.batch_add_outputs(%L, '[{"output_type":"pet","weight_kg":1200,"destination":"recycler","next_facility_id":"30000000-0000-0000-0000-000000000003"}]'::jsonb) $$,
                 (select v from ctx where k = 'batch1')), 'VALIDATION', 'итоги больше веса партии отклоняются');
select tests.err(format($$ select public.batch_add_outputs(%L, '[{"output_type":"pet","weight_kg":300,"destination":"recycler","next_facility_id":"30000000-0000-0000-0000-000000000003"}]'::jsonb, true) $$,
                 (select v from ctx where k = 'batch1')), 'VALIDATION', 'закрыть партию с неполным итогом нельзя');

select public.batch_add_outputs((select v from ctx where k = 'batch1'), '[
  {"output_type":"pet","weight_kg":350,"destination":"recycler","next_facility_id":"30000000-0000-0000-0000-000000000003"},
  {"output_type":"hdpe","weight_kg":150,"destination":"buyer","buyer_name":"ТОО Полимер"},
  {"output_type":"film","weight_kg":100,"destination":"recycler","next_facility_id":"30000000-0000-0000-0000-000000000003"},
  {"output_type":"rdf","weight_kg":250},
  {"output_type":"landfill","weight_kg":150,"next_facility_id":"30000000-0000-0000-0000-000000000002"}
]'::jsonb, false);
select tests.ok((public.site_path('40000000-0000-0000-0000-000000000001') -> 'latest' ->> 'stage')::int = 5, 'путь: статус 5 «Отсортировано» (итог не закрыт)');
select public.batch_add_outputs((select v from ctx where k = 'batch1'), '[
  {"output_type":"pet","weight_kg":350,"destination":"recycler","next_facility_id":"30000000-0000-0000-0000-000000000003"},
  {"output_type":"hdpe","weight_kg":150,"destination":"buyer","buyer_name":"ТОО Полимер"},
  {"output_type":"film","weight_kg":100,"destination":"recycler","next_facility_id":"30000000-0000-0000-0000-000000000003"},
  {"output_type":"rdf","weight_kg":250},
  {"output_type":"landfill","weight_kg":150,"next_facility_id":"30000000-0000-0000-0000-000000000002"}
]'::jsonb, true);

-- ------------------------------------------------- гость открывает путь по QR
select tests.as_anon();
select tests.ok((public.site_by_qr('QR-S1') ->> 'id')::uuid = '40000000-0000-0000-0000-000000000001', 'гость находит площадку по QR');

create temp table p1 on commit drop as select public.site_path('40000000-0000-0000-0000-000000000001', 7) as j;
select tests.ok(((select j from p1) -> 'latest' ->> 'stage')::int = 6, 'путь S1 собран до статуса 6 «Итог» (гость, без входа)');
select tests.ok(((select j from p1) -> 'latest' ->> 'site_share')::numeric = 0.6667, 'правило 1: доля S1 = 880/(880+440)');
select tests.ok(
  (select sum((o ->> 'weight_kg')::numeric) from p1, jsonb_array_elements(j -> 'latest' -> 'batches' -> 0 -> 'outputs') o)
  = ((select j from p1) -> 'latest' -> 'batches' -> 0 ->> 'weight_kg')::numeric,
  'сумма кг по итогам = вес партии');
select tests.ok(
  abs((select sum((v)::numeric) from p1, jsonb_each_text(j -> 'latest' -> 'outcome') e(k, v))
      - ((select j from p1) -> 'latest' -> 'batches' -> 0 ->> 'site_kg')::numeric) < 0.05,
  'сумма вторсырьё+энергия+полигон по площадке = её доля веса партии');
select tests.ok(((select j from p1) -> 'latest' -> 'outcome' ->> 'recycled_kg')::numeric = 400.00, 'вторсырьё S1: 600 кг × 2/3');
select tests.ok(((select j from p1) -> 'latest' -> 'track' ->> 'type') = 'LineString', 'в пути есть трек GeoJSON');
select tests.ok((select cleanliness_score from public.sites where id = '40000000-0000-0000-0000-000000000001') = 90, 'правило 4: чистота S1 = 100 − 10');
select tests.ok(jsonb_array_length((public.map_objects(71.3, 51.0, 71.7, 51.3)) -> 'sites') = 2, 'карта: площадки в bbox');
select tests.err($$ select public.dashboard_summary() $$, '42501', 'гость не видит дашборд');
select tests.err($$ insert into public.reports (type, photo_url, location) values ('other', 'x', public.make_point(71.4, 51.1)) $$, '42501', 'гость не пишет жалобы');

-- ================================== Сценарий 2: смешали раздельный контейнер
select tests.as_user('00000000-0000-0000-0000-0000000000d2');
insert into ctx select 'trip2', (public.trip_start(p_route_id => '80000000-0000-0000-0000-000000000002') ->> 'trip_id')::uuid;
select public.pickup_create(p_trip_id => (select v from ctx where k = 'trip2'), p_container_id => '50000000-0000-0000-0000-000000000011',
  p_photo_url => 'https://x/p3.jpg', p_ai_result => '{"contamination_pct":60}');
select tests.ok((select mixed_flag from public.pickups where trip_id = (select v from ctx where k = 'trip2')), 'правило 2: пластик в рейсе mixed → mixed_flag');
select tests.ok((select mixed_flag from public.trips where id = (select v from ctx where k = 'trip2')), 'рейс помечен как смешивание');
select public.trip_add_positions((select v from ctx where k = 'trip2'), jsonb_build_array(
  jsonb_build_object('lon', 71.42, 'lat', 51.09, 'recorded_at', now() - interval '30 min'),
  jsonb_build_object('lon', 71.5995, 'lat', 51.0502, 'recorded_at', now() - interval '1 min')));
select public.trip_finish((select v from ctx where k = 'trip2'));
select tests.ok((select destination_facility_id = '30000000-0000-0000-0000-000000000002' and not deviation_flag from public.trips where id = (select v from ctx where k = 'trip2')),
                'рейс mixed по плану на полигон — без отклонения');
select tests.ok((public.trip_chain((select v from ctx where k = 'trip2')) ->> 'stage')::int = 6, 'рейс на полигон без приёмки — сразу итог «полигон»');

-- ================================= Сценарий 3: раздельный рейс уехал на полигон
select tests.as_user('00000000-0000-0000-0000-0000000000d1');
insert into ctx select 'trip3', (public.trip_start(p_route_id => '80000000-0000-0000-0000-000000000001') ->> 'trip_id')::uuid;
select public.pickup_create(p_trip_id => (select v from ctx where k = 'trip3'), p_container_id => '50000000-0000-0000-0000-000000000021',
  p_photo_url => 'https://x/p4.jpg', p_ai_result => '{"contamination_pct":5}');
select tests.ok(not (select mixed_flag from public.pickups where trip_id = (select v from ctx where k = 'trip3')), 'до приезда флага нет');
select public.trip_add_positions((select v from ctx where k = 'trip3'), jsonb_build_array(
  jsonb_build_object('lon', 71.43, 'lat', 51.095, 'recorded_at', now() - interval '20 min'),
  jsonb_build_object('lon', 71.6010, 'lat', 51.0495, 'recorded_at', now())));
select public.trip_finish((select v from ctx where k = 'trip3'));
select tests.ok((select mixed_flag and deviation_flag from public.trips where id = (select v from ctx where k = 'trip3')),
                'правила 2 и 3: раздельный рейс на полигоне → mixed_flag и отклонение от плана');
select tests.ok((select mixed_flag from public.pickups where trip_id = (select v from ctx where k = 'trip3')), 'вывоз пластика помечен как смешанный');
select tests.ok((public.site_path('40000000-0000-0000-0000-000000000002') -> 'summary' ->> 'mixed_events')::int = 1, 'в пути S2 видно нарушение');

-- ================================================ жалоба жителя и акимат
select tests.as_user('00000000-0000-0000-0000-0000000000f1');
insert into ctx select 'rep1', (public.report_create('mixed', 'https://x/r1.jpg', 71.4202, 51.0902, null, 'Смешали пластик с ТБО') ->> 'id')::uuid;
select tests.ok((select site_id from public.reports where id = (select v from ctx where k = 'rep1')) = '40000000-0000-0000-0000-000000000001', 'жалоба привязана к ближайшей площадке');
select tests.ok((select related_trip_id is not null from public.reports where id = (select v from ctx where k = 'rep1')), 'к жалобе подобран ближайший рейс');
select tests.err($$ select public.report_create('other', '', 71.42, 51.09) $$, 'PHOTO_REQUIRED', 'жалоба без фото запрещена');
select tests.err($$ update public.profiles set roles = '{admin}' where user_id = auth.uid() $$, 'FORBIDDEN', 'житель не выдаёт себе роли');
update public.profiles set full_name = 'Айгерим', language = 'kk', home_site_id = '40000000-0000-0000-0000-000000000001' where user_id = auth.uid();
select tests.ok((select language from public.profiles where user_id = auth.uid()) = 'kk', 'житель меняет язык и дом');
select tests.err(format($$ select public.report_set_status(%L, 'confirmed') $$, (select v from ctx where k = 'rep1')), 'FORBIDDEN', 'житель не меняет статус жалобы');
select tests.ok((public.scan_create('container', 'https://x/s1.jpg', '{"model_version":"waste-yolo-0.1","contamination_pct":40,"items":[{"class":"film","confidence":0.8,"correct":false}]}', null, 'plastic', 71.4201, 51.0901) ->> 'site_id')::uuid
                = '40000000-0000-0000-0000-000000000001', 'фото жителя привязано к ближайшей площадке');
select tests.ok((select count(*) from public.training_images) = 0, 'RLS: житель не читает датасет training_images');
select tests.ok(jsonb_array_length(public.site_card('40000000-0000-0000-0000-000000000001') -> 'top_errors') >= 1, 'карточка площадки: топ ошибок за 7 дней');

select tests.as_user('00000000-0000-0000-0000-0000000000f2');
select tests.ok((select count(*) from public.reports) = 0, 'RLS: чужие жалобы не видны');
select tests.ok((select count(*) from public.scans) = 0, 'RLS: чужие сканы не видны');

select tests.as_user('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.reports) = 1, 'акимат видит жалобы своего города');
select tests.err(format($$ select public.report_set_status(%L, 'rejected') $$, (select v from ctx where k = 'rep1')), 'VALIDATION', 'отклонение без причины запрещено');
select public.report_set_status((select v from ctx where k = 'rep1'), 'in_work', 'Проверяем');
select tests.err(format($$ select public.report_set_status(%L, 'new') $$, (select v from ctx where k = 'rep1')), 'INVALID_TRANSITION', 'обратный переход статуса запрещён');
select public.report_set_status((select v from ctx where k = 'rep1'), 'confirmed', 'Подтверждено по треку');
select tests.ok(jsonb_array_length(public.report_json((select v from ctx where k = 'rep1')) -> 'history') = 3, 'история статусов жалобы');

create temp table dash on commit drop as select public.dashboard_summary('10000000-0000-0000-0000-000000000001') j;
select tests.ok(((select j from dash) -> 'current' ->> 'collected_t')::numeric = 1.0, 'дашборд: вывезено 1 т');
select tests.ok(((select j from dash) -> 'current' ->> 'claimed_recycled_t')::numeric = 1.0, 'дашборд: заявлено как переработанное 1 т');
select tests.ok(((select j from dash) -> 'current' ->> 'real_recycled_t')::numeric = 0.6, 'дашборд: реально вторсырьё 0.6 т');
select tests.ok(((select j from dash) -> 'current' ->> 'mixed_trips')::int = 2, 'дашборд: 2 рейса со смешиванием');
select tests.ok(((select j from dash) -> 'current' ->> 'new_reports')::int = 1, 'дашборд: жалобы за период');
select tests.ok(jsonb_array_length(public.dashboard_timeseries('10000000-0000-0000-0000-000000000001')) >= 30, 'дашборд: ряд по дням');
select tests.ok(jsonb_array_length(public.dashboard_sites_rating('10000000-0000-0000-0000-000000000001')) = 2, 'дашборд: рейтинг площадок');
select tests.ok((public.dashboard_carriers_rating('10000000-0000-0000-0000-000000000001') -> 0 ->> 'confirmed_mixed_reports')::int = 1,
                'подтверждённая жалоба «смешали» засчитана перевозчику');

-- ================================================ бонусы
select tests.as_user('00000000-0000-0000-0000-0000000000f1');
select tests.ok((public.me_bonuses() ->> 'balance')::numeric = 50, 'бонус за подтверждённую жалобу');
create temp table qr on commit drop as select public.my_personal_qr() ->> 'token' as t;

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select public.drop_off_create('30000000-0000-0000-0000-000000000001', 'plastic', 4, (select t from qr), null, 'drop-1');
select public.drop_off_create('30000000-0000-0000-0000-000000000001', 'plastic', 4, (select t from qr), null, 'drop-1');
select tests.err($$ select public.drop_off_create('30000000-0000-0000-0000-000000000001', 'plastic', 4, 'bad.token.x') $$, 'INVALID_QR', 'поддельный QR отклонён');

select tests.as_user('00000000-0000-0000-0000-0000000000f1');
select tests.ok((public.me_bonuses() ->> 'balance')::numeric = 110, 'сдача 4 кг пластика × 15 = 60; повтор не начислен');
reset role;
select tests.ok((select bool_and(p.bonus_balance = coalesce((select sum(amount) from public.bonus_transactions t where t.user_id = p.user_id), 0)) from public.profiles p),
                'баланс всегда равен сумме транзакций');

select tests.ok((select count(*) from public.training_images) = 1, 'фото с согласием на обучение попало в training_images');


-- ------------------------------------------------ экспорт моков для фронта
-- db/scripts/export_mocks.sh запускает этот файл с -v mocks_dir=contracts/mocks:
-- ответы API снимаются с настоящей базы и становятся моками для потоков C, D, F.
\if :{?mocks_dir}
select tests.as_user('00000000-0000-0000-0000-0000000000a2');
\pset tuples_only on
\pset format unaligned
\o :mocks_dir/site-path.json
select jsonb_pretty(public.site_path('40000000-0000-0000-0000-000000000001', 7));
\o :mocks_dir/site-path-mixed.json
select jsonb_pretty(public.site_path('40000000-0000-0000-0000-000000000002', 7));
\o :mocks_dir/site-by-qr.json
select jsonb_pretty(public.site_by_qr('QR-S1'));
\o :mocks_dir/site-card.json
select jsonb_pretty(public.site_card('40000000-0000-0000-0000-000000000001'));
\o :mocks_dir/map-objects.json
select jsonb_pretty(public.map_objects(71.3, 51.0, 71.7, 51.3));
\o :mocks_dir/trip-chain.json
select jsonb_pretty(public.trip_chain((select v from ctx where k = 'trip1')));
\o :mocks_dir/report.json
select jsonb_pretty(public.report_json((select v from ctx where k = 'rep1')));
\o :mocks_dir/dashboard-summary.json
select jsonb_pretty(public.dashboard_summary('10000000-0000-0000-0000-000000000001'));
\o :mocks_dir/dashboard-timeseries.json
select jsonb_pretty(public.dashboard_timeseries('10000000-0000-0000-0000-000000000001', now() - interval '6 days'));
\o :mocks_dir/dashboard-sites-rating.json
select jsonb_pretty(public.dashboard_sites_rating('10000000-0000-0000-0000-000000000001'));
\o :mocks_dir/dashboard-carriers-rating.json
select jsonb_pretty(public.dashboard_carriers_rating('10000000-0000-0000-0000-000000000001'));
\o :mocks_dir/public-stats.json
select jsonb_pretty(public.public_stats());
\o :mocks_dir/waste-rules.json
select jsonb_pretty(public.waste_rules_list());
select tests.as_user('00000000-0000-0000-0000-0000000000d1');
\o :mocks_dir/driver-route-today.json
select jsonb_pretty(public.driver_route_today());
select tests.as_user('00000000-0000-0000-0000-0000000000f1');
\o :mocks_dir/me.json
select jsonb_pretty(public.me());
\o :mocks_dir/me-bonuses.json
select jsonb_pretty(public.me_bonuses());
\o
\pset tuples_only off
\pset format aligned
reset role;
\endif

rollback;

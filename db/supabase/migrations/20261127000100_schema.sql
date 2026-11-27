-- =============================================================================
-- «Қайда?» · Миграция 1: схема данных (ТЗ, раздел 3)
-- PostgreSQL + PostGIS. Координаты — geography(Point,4326), треки —
-- geography(LineString,4326). У каждой таблицы: id uuid, created_at, updated_at.
-- Цепочка пути отходов: containers → pickups → trips → batches → batch_outputs
-- → (следующий объект или покупатель). Отслеживается партия, а не предмет.
-- =============================================================================
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Перечисления. Значения — стабильные коды для API (латиница, snake_case).
-- -----------------------------------------------------------------------------
create type public.app_role as enum (
  'resident',   -- житель
  'driver',     -- водитель
  'operator',   -- оператор приёмки
  'akimat',     -- акимат
  'admin',      -- администратор платформы
  'partner',    -- партнёр (бизнес), P2
  'seller'      -- продавец/покупатель маркетплейса, P2
);

create type public.waste_type as enum ('mixed', 'plastic', 'paper', 'glass', 'metal', 'organic');

create type public.facility_type as enum (
  'sorting', 'recycling', 'landfill', 'collection_point', 'composting', 'energy'
);

create type public.trip_status as enum ('planned', 'active', 'finished', 'cancelled');

-- Отметка водителя на площадке (ТЗ 10.1): вывезено / контейнер пустой / нет доступа / сломан
create type public.pickup_status as enum ('picked', 'empty', 'no_access', 'broken');

create type public.batch_status as enum ('received', 'sorting', 'sorted');

create type public.output_type as enum (
  'pet', 'hdpe', 'film', 'paper', 'cardboard', 'glass', 'metal', 'organic', 'rdf', 'landfill'
);

-- Куда ушёл вид после сортировки (статус 6 «Итог»)
create type public.output_destination as enum ('recycler', 'buyer', 'energy', 'compost', 'landfill');

create type public.report_type as enum ('mixed', 'overflow', 'dump', 'other');
create type public.report_status as enum ('new', 'in_work', 'confirmed', 'rejected');

create type public.scan_mode as enum ('item', 'container');
create type public.photo_source as enum ('resident_scan', 'driver_pickup', 'report', 'feedback', 'dataset', 'team');
create type public.label_status as enum ('new', 'in_labeling', 'labeled', 'rejected', 'in_dataset');

create type public.bonus_source as enum ('drop_off', 'site_pool', 'report_confirmed', 'manual', 'redeem');
create type public.lang_code as enum ('ru', 'kk');

-- -----------------------------------------------------------------------------
-- Общий триггер updated_at
-- -----------------------------------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- География: города и районы (архитектура сразу под много городов)
-- -----------------------------------------------------------------------------
create table public.cities (
  id          uuid primary key default gen_random_uuid(),
  name_ru     text not null,
  name_kk     text,
  slug        text not null unique,
  boundary    geography(MultiPolygon, 4326),
  center      geography(Point, 4326),
  timezone    text not null default 'Asia/Almaty',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.districts (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references public.cities(id) on delete cascade,
  name_ru     text not null,
  name_kk     text,
  boundary    geography(MultiPolygon, 4326),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (city_id, name_ru)
);

-- -----------------------------------------------------------------------------
-- Объекты приёма/переработки (сортировка, переработчики, полигон, пункты приёма)
-- -----------------------------------------------------------------------------
create table public.facilities (
  id                  uuid primary key default gen_random_uuid(),
  city_id             uuid references public.cities(id) on delete set null,
  type                public.facility_type not null,
  name                text not null,
  address             text,
  location            geography(Point, 4326) not null,
  accepted_waste_types public.waste_type[] not null default '{}',
  capacity_tpd        numeric(10,2),             -- мощность, т/сут
  geofence_radius_m   integer not null default 300 check (geofence_radius_m between 10 and 5000),
  opening_hours       jsonb,                     -- {"mon":"09:00-18:00",...} для пунктов приёма
  model_3d_url        text,                      -- glTF/GLB цеха (блок E)
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index facilities_location_gix on public.facilities using gist (location);

-- -----------------------------------------------------------------------------
-- Контейнерные площадки и контейнеры
-- -----------------------------------------------------------------------------
create table public.sites (
  id                 uuid primary key default gen_random_uuid(),
  district_id        uuid not null references public.districts(id) on delete restrict,
  address            text not null,
  residential_complex text,                       -- ЖК
  location           geography(Point, 4326) not null,
  qr_code            text not null unique default encode(gen_random_bytes(6), 'hex'),
  cleanliness_score  numeric(5,2) check (cleanliness_score between 0 and 100),
  last_pickup_at     timestamptz,
  last_pickup_id     uuid,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index sites_location_gix on public.sites using gist (location);
create index sites_district_idx on public.sites (district_id);

create table public.containers (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.sites(id) on delete cascade,
  waste_type   public.waste_type not null,
  volume_l     integer not null default 1100 check (volume_l > 0),
  fill_level   smallint not null default 0 check (fill_level between 0 and 100), -- %
  qr_code      text unique,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index containers_site_idx on public.containers (site_id);

-- -----------------------------------------------------------------------------
-- Профили пользователей (1:1 с auth.users). Несколько ролей у одного человека.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  full_name         text,
  phone             text,
  email             text,
  language          public.lang_code not null default 'ru',
  roles             public.app_role[] not null default '{resident}',
  home_site_id      uuid references public.sites(id) on delete set null,
  city_id           uuid references public.cities(id) on delete set null,     -- для акимата: «свой город»
  facility_id       uuid references public.facilities(id) on delete set null, -- для оператора: «свой объект»
  bonus_balance     numeric(12,2) not null default 0,
  consent_data      boolean not null default false,  -- согласие на обработку ПД
  consent_training  boolean not null default false,  -- согласие на использование фото для обучения
  consent_at        timestamptz,
  is_demo           boolean not null default false,
  personal_qr_secret text not null default encode(gen_random_bytes(16), 'hex'), -- для ротации личного QR (раздел 12)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index profiles_roles_gin on public.profiles using gin (roles);

-- -----------------------------------------------------------------------------
-- Перевозчики и машины
-- -----------------------------------------------------------------------------
create table public.carriers (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid references public.cities(id) on delete set null,
  name        text not null,
  bin         text,                -- БИН компании
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  carrier_id    uuid not null references public.carriers(id) on delete restrict,
  plate_number  text not null unique,
  vehicle_type  text not null default 'rear_loader',  -- rear_loader / side_loader / ...
  capacity_kg   integer check (capacity_kg > 0),
  driver_id     uuid references auth.users(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index vehicles_driver_idx on public.vehicles (driver_id);

-- -----------------------------------------------------------------------------
-- Маршруты (план) и рейсы (факт)
-- -----------------------------------------------------------------------------
create table public.routes (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid not null references public.vehicles(id) on delete cascade,
  route_date            date not null,
  site_ids              uuid[] not null default '{}',   -- упорядоченный список площадок
  waste_type            public.waste_type not null,     -- тип отходов рейса
  planned_facility_id   uuid references public.facilities(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index routes_vehicle_date_idx on public.routes (vehicle_id, route_date);

create table public.trips (
  id                       uuid primary key default gen_random_uuid(),
  route_id                 uuid references public.routes(id) on delete set null,
  vehicle_id               uuid not null references public.vehicles(id) on delete restrict,
  driver_id                uuid references auth.users(id) on delete set null,
  waste_type               public.waste_type not null,
  status                   public.trip_status not null default 'active',
  started_at               timestamptz not null default now(),
  finished_at              timestamptz,
  track                    geography(LineString, 4326),
  planned_facility_id      uuid references public.facilities(id) on delete set null,
  destination_facility_id  uuid references public.facilities(id) on delete set null,
  mixed_flag               boolean not null default false,  -- в рейсе смешали раздельные контейнеры
  deviation_flag           boolean not null default false,  -- пункт назначения ≠ план маршрута
  is_simulated             boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (finished_at is null or finished_at >= started_at)
);
create index trips_vehicle_idx on public.trips (vehicle_id, started_at desc);
create index trips_route_idx on public.trips (route_id);
create index trips_dest_idx on public.trips (destination_facility_id);
-- у одной машины не больше одного активного рейса
create unique index trips_one_active_per_vehicle on public.trips (vehicle_id) where status = 'active';

create table public.vehicle_positions (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id) on delete cascade,
  trip_id      uuid references public.trips(id) on delete cascade,
  location     geography(Point, 4326) not null,
  speed        numeric(6,2),       -- км/ч
  heading      numeric(5,1),       -- градусы, для разворота модели машины на карте
  recorded_at  timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index vehicle_positions_trip_idx on public.vehicle_positions (trip_id, recorded_at);
create index vehicle_positions_vehicle_idx on public.vehicle_positions (vehicle_id, recorded_at desc);
-- идемпотентность пакетной отправки (повтор при плохой связи не дублирует точки)
create unique index vehicle_positions_dedup on public.vehicle_positions (vehicle_id, recorded_at);

-- -----------------------------------------------------------------------------
-- Вывозы с площадок
-- -----------------------------------------------------------------------------
create table public.pickups (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid not null references public.trips(id) on delete cascade,
  container_id       uuid not null references public.containers(id) on delete restrict,
  site_id            uuid not null references public.sites(id) on delete restrict, -- денормализация для быстрых выборок
  status             public.pickup_status not null default 'picked',
  photo_url          text,
  ai_result          jsonb,
  model_version      text,
  contamination_pct  numeric(5,2) check (contamination_pct between 0 and 100),
  fill_level         smallint check (fill_level between 0 and 100), -- заполненность в момент вывоза
  mixed_flag         boolean not null default false,
  picked_at          timestamptz not null default now(),
  location           geography(Point, 4326),
  client_id          text,          -- id из офлайн-очереди водителя, для идемпотентности
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index pickups_site_idx on public.pickups (site_id, picked_at desc);
create index pickups_trip_idx on public.pickups (trip_id);
create unique index pickups_client_id_uniq on public.pickups (client_id) where client_id is not null;

-- -----------------------------------------------------------------------------
-- Партии на приёмке и итоги сортировки
-- -----------------------------------------------------------------------------
create table public.batches (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid references public.trips(id) on delete set null,
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  weight_kg     numeric(12,2) not null check (weight_kg >= 0),   -- нетто
  gross_kg      numeric(12,2),
  tare_kg       numeric(12,2),
  photo_url     text,
  operator_id   uuid references auth.users(id) on delete set null,
  received_at   timestamptz not null default now(),
  status        public.batch_status not null default 'received',
  parent_output_id uuid,  -- партия, пришедшая не из рейса, а из итога другой партии (сортировка → переработчик)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index batches_trip_idx on public.batches (trip_id);
create index batches_facility_idx on public.batches (facility_id, received_at desc);

create table public.batch_outputs (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.batches(id) on delete cascade,
  output_type       public.output_type not null,
  weight_kg         numeric(12,2) not null check (weight_kg >= 0),
  destination       public.output_destination not null,
  next_facility_id  uuid references public.facilities(id) on delete set null,
  buyer_name        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (next_facility_id is not null or buyer_name is not null or destination in ('landfill', 'energy', 'compost'))
);
create index batch_outputs_batch_idx on public.batch_outputs (batch_id);
alter table public.batches
  add constraint batches_parent_output_fk foreign key (parent_output_id) references public.batch_outputs(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Фото жителей (оценка ИИ) и жалобы
-- -----------------------------------------------------------------------------
create table public.scans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete set null,
  site_id            uuid references public.sites(id) on delete set null,
  mode               public.scan_mode not null default 'item',
  container_type     public.waste_type,
  photo_url          text,
  location           geography(Point, 4326),
  ai_result          jsonb,
  model_version      text,
  contamination_pct  numeric(5,2),
  top_class          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index scans_site_idx on public.scans (site_id, created_at desc);
create index scans_user_idx on public.scans (user_id, created_at desc);

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,
  type             public.report_type not null,
  photo_url        text not null,                -- фото обязательно (ТЗ 5.5)
  location         geography(Point, 4326) not null,
  comment          text check (char_length(comment) <= 2000),
  status           public.report_status not null default 'new',
  status_comment   text,
  resolved_by      uuid references auth.users(id) on delete set null,
  related_trip_id  uuid references public.trips(id) on delete set null, -- ближайший рейс по времени
  client_id        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);
create index reports_site_idx on public.reports (site_id);
create index reports_location_gix on public.reports using gist (location);
create unique index reports_client_id_uniq on public.reports (client_id) where client_id is not null;

create table public.report_status_log (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  from_status public.report_status,
  to_status   public.report_status not null,
  comment     text,
  changed_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index report_status_log_report_idx on public.report_status_log (report_id, created_at);

-- -----------------------------------------------------------------------------
-- Справочники правил
-- -----------------------------------------------------------------------------
-- ai_class → тип контейнера. Соответствие хранится здесь, а не в модели (ТЗ 6.1),
-- поэтому меняется под правила конкретного города (city_id) без переобучения.
create table public.waste_rules (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid references public.cities(id) on delete cascade, -- null = правило по умолчанию
  ai_class        text not null,
  label_ru        text not null,
  label_kk        text not null,
  bin             public.waste_type not null,     -- в какой контейнер
  is_recyclable   boolean not null default true,
  special_handling boolean not null default false, -- опасные: ни в один контейнер, только пункт приёма
  hint_ru         text,
  hint_kk         text,
  usage_ru        text,                           -- во что перерабатывается
  usage_kk        text,
  icon            text,
  color           text,                           -- HEX цвета контейнера для UI
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index waste_rules_city_class_uniq
  on public.waste_rules (coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid), ai_class);

create table public.bonus_rules (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,              -- drop_off_rate / site_pool_rate / report_confirmed / ...
  waste_type         public.waste_type,
  rate_per_kg        numeric(10,2),
  fixed_amount       numeric(10,2),
  params             jsonb not null default '{}', -- пороги коэффициента чистоты, лимиты
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index bonus_rules_code_type_uniq on public.bonus_rules (code, waste_type) nulls not distinct;

create table public.bonus_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  amount       numeric(12,2) not null,
  source_type  public.bonus_source not null,
  source_id    uuid,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- повторная отправка одной и той же сдачи не даёт двойного начисления (ТЗ 12)
create unique index bonus_tx_idempotency on public.bonus_transactions (user_id, source_type, source_id)
  where source_id is not null;
create index bonus_tx_user_idx on public.bonus_transactions (user_id, created_at desc);

create table public.drop_offs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  waste_type    public.waste_type not null,
  weight_kg     numeric(10,2) not null check (weight_kg > 0),
  operator_id   uuid references auth.users(id) on delete set null,
  client_id     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index drop_offs_client_id_uniq on public.drop_offs (client_id) where client_id is not null;

create table public.training_images (
  id              uuid primary key default gen_random_uuid(),
  photo_url       text not null,
  source          public.photo_source not null,
  source_id       uuid,                 -- scan/pickup/report
  user_id         uuid references auth.users(id) on delete set null,
  label_status    public.label_status not null default 'new',
  predicted       jsonb,                -- что сказала модель
  annotation      jsonb,                -- правильная разметка (класс или рамки)
  model_version   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index training_images_status_idx on public.training_images (label_status);

-- ---------------------------------------------- P2: маркетплейсы и партнёры
create table public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid references auth.users(id) on delete set null,
  kind        text,                 -- restaurant / shop / office ...
  location    geography(Point, 4326),
  terms       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.listings (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid references auth.users(id) on delete cascade,
  partner_id   uuid references public.partners(id) on delete set null,
  kind         text not null check (kind in ('recyclable', 'item', 'shop_product')),
  title        text not null,
  description  text,
  output_type  public.output_type,
  volume_kg    numeric(12,2),
  price        numeric(12,2),
  price_bonus  numeric(12,2),
  photos       text[] not null default '{}',
  batch_ids    uuid[] not null default '{}',   -- происхождение вторсырья
  status       text not null default 'active' check (status in ('draft', 'active', 'reserved', 'sold', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid references public.listings(id) on delete set null,
  partner_id  uuid references public.partners(id) on delete set null,
  buyer_id    uuid references auth.users(id) on delete set null,
  kind        text not null default 'purchase' check (kind in ('purchase', 'pickup_request')),
  waste_type  public.waste_type,
  amount_kg   numeric(12,2),
  status      text not null default 'new' check (status in ('new', 'accepted', 'done', 'cancelled')),
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Журнал ошибок фронта и ИИ-сервиса в одном месте (ТЗ 1, P1)
-- -----------------------------------------------------------------------------
create table public.app_logs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null check (source in ('web', 'ai', 'api', 'simulator')),
  level       text not null default 'error' check (level in ('debug', 'info', 'warn', 'error')),
  message     text not null,
  context     jsonb not null default '{}',
  user_id     uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index app_logs_created_idx on public.app_logs (created_at desc);

-- -----------------------------------------------------------------------------
-- Триггеры updated_at на все таблицы схемы public
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

comment on table public.sites is 'Контейнерные площадки. cleanliness_score — скользящее среднее (100 − contamination) за 14 дней.';
comment on table public.pickups is 'Вывоз контейнера водителем: фото → ИИ → чистота; mixed_flag по правилу 2 раздела 7.';
comment on table public.batches is 'Партия на приёмке объекта (вес). Отслеживается партия, а не отдельный предмет.';
comment on table public.batch_outputs is 'Итог сортировки партии по видам и куда ушёл каждый вид. Сумма = вес партии.';
comment on table public.waste_rules is 'ai_class → контейнер, подсказки ru/kk. Меняется под правила города без переобучения модели.';

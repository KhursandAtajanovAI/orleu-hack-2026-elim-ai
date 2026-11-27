-- =============================================================================
-- «Қайда?» · Миграция 8: база упаковок по штрихкоду и история сканов (MVP)
-- packages       — справочник упаковок: штрихкод (GTIN/EAN) → материал → класс ИИ → контейнер.
--                  Наполняется парсером db/packages/collect_packages.py (Open Food Facts,
--                  Open Products Facts, синтетика) и подтверждёнными сканами жителей.
-- package_scans  — кто, когда и где сканировал упаковку (прослеживание упаковки).
-- Баллы за сам скан НЕ начисляются (один код можно сканировать бесконечно), только
-- за подтверждённую оператором сдачу (drop_off_create). Правило package_scan_reward
-- оставлено выключенным для будущего «символического» бонуса с дневным лимитом.
-- =============================================================================

create table public.packages (
  id             uuid primary key default gen_random_uuid(),
  gtin           text not null unique check (gtin ~ '^[0-9]{8,14}$'),
  name           text,
  brand          text,
  quantity       text,                              -- «0,5 л», «900 г»
  material       text,                              -- исходный материал: en:pet-polyethylene-terephthalate, en:glass…
  shape          text,                              -- en:bottle, en:can, en:box…
  ai_class       text not null default 'other',     -- один из 13 классов ИИ (waste_rules.ai_class)
  weight_g       numeric(10,2) check (weight_g is null or weight_g > 0), -- вес самой упаковки
  countries      text[] not null default '{}',
  source         text not null default 'manual' check (source in ('off', 'opf', 'synthetic', 'ai', 'manual')),
  verified       boolean not null default false,    -- проверено оператором/админом
  raw            jsonb not null default '{}',        -- исходная запись источника (для перепроверки)
  scans_count    integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index packages_ai_class_idx on public.packages (ai_class);

create table public.package_scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  gtin        text not null,
  package_id  uuid references public.packages(id) on delete set null,
  site_id     uuid references public.sites(id) on delete set null,
  location    geography(point, 4326),
  found       boolean not null,                   -- нашли ли упаковку в базе
  ai_class    text,
  bin         public.waste_type,
  client_id   text,                               -- идемпотентность офлайн-очереди
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index package_scans_client_uniq on public.package_scans (client_id) where client_id is not null;
create index package_scans_user_idx on public.package_scans (user_id, created_at desc);
create index package_scans_gtin_idx on public.package_scans (gtin, created_at desc);

create trigger set_updated_at before update on public.packages
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.package_scans
  for each row execute function public.tg_set_updated_at();

alter table public.packages enable row level security;
alter table public.package_scans enable row level security;

-- справочник упаковок читают все (как waste_rules), меняет только админ
create policy packages_read on public.packages for select to anon, authenticated using (true);
create policy packages_admin on public.packages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- сканы: житель видит свои, админ — все; запись только через RPC package_scan
create policy package_scans_own on public.package_scans for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- -------------------------------------------------------------- поиск по штрихкоду
create or replace function public.package_json(p public.packages, p_city uuid default null) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'gtin', p.gtin, 'name', p.name, 'brand', p.brand, 'quantity', p.quantity,
    'material', p.material, 'shape', p.shape, 'ai_class', p.ai_class, 'source', p.source,
    'verified', p.verified, 'scans_count', p.scans_count,
    'rule', (select jsonb_build_object('bin', r.bin, 'label_ru', r.label_ru, 'label_kk', r.label_kk,
                                       'hint_ru', r.hint_ru, 'hint_kk', r.hint_kk,
                                       'is_recyclable', r.is_recyclable, 'special_handling', r.special_handling,
                                       'color', r.color)
               from public.waste_rules r
              where r.ai_class = p.ai_class and (r.city_id = p_city or r.city_id is null)
              order by r.city_id nulls last limit 1))
$$;

create or replace function public.package_lookup(p_gtin text, p_city uuid default null) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select public.package_json(p, p_city) from public.packages p where p.gtin = p_gtin),
                  jsonb_build_object('gtin', p_gtin, 'found', false))
$$;

-- -------------------------------------------------------------- скан жителя
create or replace function public.package_scan(
  p_gtin text, p_site_id uuid default null, p_lat double precision default null,
  p_lon double precision default null, p_client_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  p public.packages;
  s public.package_scans;
  b public.waste_type;
begin
  if p_gtin is null or p_gtin !~ '^[0-9]{8,14}$' then
    perform public.api_error('VALIDATION', 'Штрихкод — 8–14 цифр');
  end if;
  if p_client_id is not null then
    select * into s from public.package_scans where client_id = p_client_id;
    if s.id is not null then return to_jsonb(s) || jsonb_build_object('duplicate', true); end if;
  end if;
  select * into p from public.packages where gtin = p_gtin;
  if p.id is not null then
    select r.bin into b from public.waste_rules r where r.ai_class = p.ai_class order by r.city_id nulls last limit 1;
    update public.packages set scans_count = scans_count + 1 where id = p.id;
  end if;
  insert into public.package_scans (user_id, gtin, package_id, site_id, location, found, ai_class, bin, client_id)
  values (auth.uid(), p_gtin, p.id, p_site_id,
          public.make_point(p_lon, p_lat),
          p.id is not null, p.ai_class, b, p_client_id)
  returning * into s;
  return jsonb_build_object('scan_id', s.id, 'found', p.id is not null,
                            'package', case when p.id is not null then public.package_json(p) end);
end $$;

grant select on public.packages to anon, authenticated;
grant select on public.package_scans to authenticated;
grant execute on function public.package_lookup(text, uuid) to anon, authenticated;
grant execute on function public.package_scan(text, uuid, double precision, double precision, text) to authenticated;
revoke execute on function public.package_json(public.packages, uuid) from public;

insert into public.bonus_rules (code, waste_type, rate_per_kg, fixed_amount, params, is_active) values
  ('package_scan_reward', null, null, 1, '{"daily_limit": 10, "comment": "выключено: баллы только за подтверждённую сдачу"}', false)
on conflict do nothing;

comment on table public.packages is 'Упаковки по штрихкоду (GTIN/EAN): материал → класс ИИ → контейнер. Источник — Open Food Facts / Open Products Facts / синтетика / ручной ввод.';
comment on table public.package_scans is 'История сканов штрихкодов: прослеживание упаковки (кто, где, когда, нашли ли в базе).';

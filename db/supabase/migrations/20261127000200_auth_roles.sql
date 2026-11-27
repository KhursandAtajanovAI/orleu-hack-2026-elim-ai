-- =============================================================================
-- «Қайда?» · Миграция 2: пользователи, роли, вспомогательные функции доступа
-- (ТЗ, раздел 2). Роли водителя, оператора и акимата выдаёт администратор.
-- =============================================================================
set search_path = public, extensions;

-- Профиль текущего пользователя (security definer — чтобы RLS-политики могли
-- обращаться к profiles без рекурсии).
create or replace function public.current_roles() returns public.app_role[]
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select roles from public.profiles where user_id = auth.uid()), '{}'::public.app_role[])
$$;

create or replace function public.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select r = any(public.current_roles())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select 'admin' = any(public.current_roles())
$$;

create or replace function public.current_city_id() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select city_id from public.profiles where user_id = auth.uid()
$$;

create or replace function public.current_facility_id() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select facility_id from public.profiles where user_id = auth.uid()
$$;

-- Акимат видит данные «своего города»; если город не задан — всех городов.
create or replace function public.can_see_city(p_city uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.is_admin()
      or (public.has_role('akimat') and (public.current_city_id() is null or public.current_city_id() = p_city))
$$;

-- Водитель управляет только своими машинами
create or replace function public.is_driver_of(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.vehicles v where v.id = p_vehicle and v.driver_id = auth.uid())
$$;

-- Оператор приёмки работает только на своём объекте (или админ)
create or replace function public.is_operator_of(p_facility uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.is_admin()
      or (public.has_role('operator') and (public.current_facility_id() is null or public.current_facility_id() = p_facility))
$$;

-- Единый способ бросить ошибку API: код попадает в {"error":{"code","message"}}.
-- Формат сообщения: 'CODE: текст'. Edge Function разбирает его в JSON.
create or replace function public.api_error(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception '%: %', p_code, p_message using errcode = 'P0001';
end $$;

-- Привилегированный вызов: service_role или прямое подключение к БД без JWT
-- (миграции, сиды). Запросы через PostgREST всегда несут роль anon/authenticated.
create or replace function public.is_privileged() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  nullif(current_setting('request.jwt.claim.role', true), ''), '') not in ('anon', 'authenticated')
$$;

create or replace function public.require_auth() returns uuid
language plpgsql stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then perform public.api_error('UNAUTHORIZED', 'Требуется вход'); end if;
  return uid;
end $$;

create or replace function public.require_role(variadic p_roles public.app_role[]) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare uid uuid := public.require_auth();
begin
  if not (public.current_roles() && p_roles) and not public.is_admin() then
    perform public.api_error('FORBIDDEN', 'Недостаточно прав: нужна роль ' || array_to_string(p_roles, ' / '));
  end if;
  return uid;
end $$;

-- -----------------------------------------------------------------------------
-- Новый пользователь auth.users → профиль жителя
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (user_id, email, phone, full_name, language)
  values (
    new.id, new.email, new.phone,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(nullif(new.raw_user_meta_data ->> 'language', ''), 'ru')::public.lang_code
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Защита полей профиля: житель меняет имя/язык/дом/согласия, но не роли,
-- баланс, привязку к городу/объекту.
-- -----------------------------------------------------------------------------
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- service_role, прямое подключение к БД без JWT (миграции, сиды) и админ могут всё
  -- pg_trigger_depth() > 1: изменение из другого триггера (пересчёт баланса бонусов)
  if public.is_privileged() or public.is_admin() or pg_trigger_depth() > 1 then
    if new.consent_data is distinct from old.consent_data or new.consent_training is distinct from old.consent_training then
      new.consent_at := now();
    end if;
    return new;
  end if;
  if new.roles is distinct from old.roles
     or new.bonus_balance is distinct from old.bonus_balance
     or new.city_id is distinct from old.city_id
     or new.facility_id is distinct from old.facility_id
     or new.is_demo is distinct from old.is_demo
     or new.user_id is distinct from old.user_id
     or new.personal_qr_secret is distinct from old.personal_qr_secret then
    perform public.api_error('FORBIDDEN', 'Эти поля профиля меняет только администратор');
  end if;
  if new.consent_data is distinct from old.consent_data or new.consent_training is distinct from old.consent_training then
    new.consent_at := now();
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- Выдача ролей администратором (ТЗ 2, 11.3)
create or replace function public.admin_set_roles(
  p_user_id uuid,
  p_roles public.app_role[],
  p_city_id uuid default null,
  p_facility_id uuid default null
) returns public.profiles
language plpgsql security definer set search_path = public, extensions as $$
declare r public.profiles;
begin
  if not public.is_admin() and not public.is_privileged() then
    perform public.api_error('FORBIDDEN', 'Роли выдаёт только администратор');
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    perform public.api_error('VALIDATION', 'Нужна хотя бы одна роль');
  end if;
  update public.profiles
     set roles = p_roles, city_id = p_city_id, facility_id = p_facility_id
   where user_id = p_user_id
  returning * into r;
  if r.id is null then perform public.api_error('NOT_FOUND', 'Пользователь не найден'); end if;
  return r;
end $$;

-- Профиль текущего пользователя для фронта (роли, дом, согласия)
create or replace function public.me() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select case when p.id is null then null else jsonb_build_object(
    'user_id', p.user_id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
    'language', p.language, 'roles', to_jsonb(p.roles), 'home_site_id', p.home_site_id,
    'city_id', p.city_id, 'facility_id', p.facility_id, 'bonus_balance', p.bonus_balance,
    'consent_data', p.consent_data, 'consent_training', p.consent_training, 'is_demo', p.is_demo,
    'driver_vehicle_ids', coalesce((select jsonb_agg(v.id) from public.vehicles v where v.driver_id = p.user_id), '[]'::jsonb)
  ) end
  from (select 1) d left join public.profiles p on p.user_id = auth.uid()
$$;

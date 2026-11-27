-- =============================================================================
-- Этап G: бонусы (ТЗ 12) и маркетплейсы (ТЗ 13).
--   • баланс = сумма транзакций; списание в магазине, нехватка бонусов, дубль по client_id;
--   • коэффициент чистоты из bonus_rules; недельный пул идемпотентен;
--   • B2B: объявление оператора → заявка → принята → выполнена → «продано»; чужой не меняет статус.
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

grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'g-admin@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'g-operator@test'),
  ('00000000-0000-0000-0000-0000000000f1', 'g-resident1@test'),
  ('00000000-0000-0000-0000-0000000000f2', 'g-resident2@test');
update public.profiles set roles = '{admin}' where email = 'g-admin@test';
update public.profiles set roles = '{operator}' where email = 'g-operator@test';

-- ------------------------------------------------------------------ коэффициент чистоты
select tests.ok(public.cleanliness_coef(92) = 1.0, 'чистота 92% → коэффициент 1');
select tests.ok(public.cleanliness_coef(60) = 0.5, 'чистота 60% → коэффициент 0,5');
select tests.ok(public.cleanliness_coef(null) = 0, 'нет оценки → 0');

-- ------------------------------------------------------------------ магазин бонусов
insert into public.bonus_transactions (user_id, amount, source_type, description)
values ('00000000-0000-0000-0000-0000000000f1', 1000, 'manual', 'стартовые');

select tests.as_user('00000000-0000-0000-0000-0000000000f1');
select tests.ok((select bonus_balance from public.profiles where user_id = auth.uid()) = 1000, 'баланс 1000 после начисления');
select tests.err($q$select public.shop_redeem('b0000000-0000-4000-8000-000000000001')$q$, 'INSUFFICIENT_BONUS', 'биогумус за 1500 при балансе 1000 — нехватка');

select tests.ok((public.shop_redeem('b0000000-0000-4000-8000-000000000005', null, 'c-1') ->> 'promo_code') = 'KAIDA-GREEN',
                'скидка партнёра выдаёт промокод');
select tests.ok((public.shop_redeem('b0000000-0000-4000-8000-000000000005', null, 'c-1') ->> 'duplicate')::boolean,
                'повтор с тем же client_id не списывает второй раз');
select tests.ok((select bonus_balance from public.profiles where user_id = auth.uid()) = 700, 'списано 300 → баланс 700');

-- частичная оплата: 500 бонусов за товар 900, остаток 400 ₸
select tests.ok((public.shop_redeem('b0000000-0000-4000-8000-000000000002', 500) -> 'details' ->> 'money')::numeric = 400,
                'частичная оплата: остаток в тенге');
select tests.ok((select bonus_balance from public.profiles where user_id = auth.uid()) = 200, 'баланс 200');
select tests.ok(jsonb_array_length(public.my_orders()) = 2, 'в «мои заказы» две покупки');
reset role;

select tests.ok((public.bonus_balance_check() ->> 'mismatches')::int = 0, 'баланс всех = сумма транзакций');

-- ------------------------------------------------------------------ пул дома
select tests.as_user('00000000-0000-0000-0000-0000000000f1');
select tests.err($q$select public.site_pool_payout()$q$, 'FORBIDDEN', 'житель не запускает выплату пула');
reset role;
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.err($q$select public.site_pool_payout(date_trunc('week', public.local_today())::date)$q$, 'VALIDATION', 'текущая неделя не закончилась');
select tests.ok(public.site_pool_payout() ? 'total', 'выплата за прошлую неделю отрабатывает');
select tests.ok((public.site_pool_payout() ->> 'residents')::int = 0, 'повторный запуск ничего не начисляет');
select tests.ok(jsonb_typeof(public.bonus_alerts()) = 'array', 'уведомления админа — список');
reset role;

-- ------------------------------------------------------------------ B2B-маркетплейс
select tests.as_user('00000000-0000-0000-0000-0000000000f1');
select tests.err($q$select public.market_create_listing('pet', 1000, 90000)$q$, 'FORBIDDEN', 'житель не создаёт объявление');
reset role;

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
create temp table g_listing on commit drop as
  select (public.market_create_listing('pet', 2000, 90000, '{}', 'Склад 1', 95, 'Чистый ПЭТ') ->> 'id')::uuid as id;
reset role;
grant select on g_listing to authenticated;

select tests.ok(exists (select 1 from jsonb_array_elements(public.market_listings('pet')) x
                         where (x ->> 'id')::uuid = (select id from g_listing)), 'объявление видно в ленте');

select tests.as_user('00000000-0000-0000-0000-0000000000f2');
select tests.err(format('select public.market_request(%L, 5000)', (select id from g_listing)), 'VALIDATION', 'заявка больше объёма');
create temp table g_order on commit drop as
  select (public.market_request((select id from g_listing), 2000, 'нужно к пятнице', 'ТОО Тест') ->> 'id')::uuid as id;
select tests.ok(((public.market_request((select id from g_listing), 2000) -> 'details' ->> 'total')::numeric) = 180000,
                'сумма заявки = цена за т × объём');
select tests.err(format('select public.market_set_status(%L, %L)', (select id from g_order), 'accepted'), 'FORBIDDEN', 'покупатель не принимает заявку');
reset role;
grant select on g_order to authenticated;

select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok(public.market_set_status((select id from g_order), 'accepted') ->> 'status' = 'accepted', 'продавец принял заявку');
select tests.ok((select status from public.listings where id = (select id from g_listing)) = 'reserved', 'объявление зарезервировано');
select tests.err(format('select public.market_set_status(%L, %L)', (select id from g_order), 'new'), 'CONFLICT', 'назад в «новую» нельзя');
select tests.ok(public.market_set_status((select id from g_order), 'done') ->> 'status' = 'done', 'сделка выполнена');
select tests.ok((select status from public.listings where id = (select id from g_listing)) = 'sold', 'весь объём продан');
select tests.ok(jsonb_array_length(public.market_my_deals() -> 'incoming') = 2, 'продавец видит обе заявки');
reset role;

rollback;

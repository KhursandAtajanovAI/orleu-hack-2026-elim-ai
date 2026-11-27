-- =============================================================================
-- База упаковок по штрихкоду: поиск, скан, прослеживание, права доступа.
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
grant execute on function tests.ok(boolean, text) to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a001', 'pkg-resident@test');
insert into public.packages (gtin, name, material, shape, ai_class, source)
values ('0000000000017', 'Вода 0,5 л', 'en:pet-polyethylene-terephthalate', 'en:bottle', 'pet_bottle', 'synthetic');

-- аноним видит справочник и правило контейнера
set local role anon;
select tests.ok((public.package_lookup('0000000000017') -> 'rule' ->> 'bin') = 'plastic', 'ПЭТ-бутылка → контейнер plastic');
select tests.ok((public.package_lookup('0000000000999') ->> 'found') = 'false', 'неизвестный штрихкод → found=false');
reset role;

-- житель сканирует: запись в истории, счётчик растёт, повтор с тем же client_id не дублирует
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
set local role authenticated;
select tests.ok((public.package_scan('0000000000017', null, 51.128, 71.430, 'c-1') ->> 'found') = 'true', 'скан найденной упаковки');
select tests.ok((public.package_scan('0000000000017', null, null, null, 'c-1') ->> 'duplicate') = 'true', 'повтор офлайн-очереди не дублирует');
select tests.ok((public.package_scan('0000000000999') ->> 'found') = 'false', 'скан неизвестной упаковки сохраняется');
select tests.ok((select count(*) from public.package_scans) = 2, 'житель видит свои 2 скана');
reset role;

select tests.ok((select scans_count from public.packages where gtin = '0000000000017') = 1, 'счётчик сканов упаковки');
select tests.ok((select bin::text from public.package_scans where client_id = 'c-1') = 'plastic', 'в скане сохранён контейнер');
select tests.ok(not exists (select 1 from public.bonus_transactions where user_id = '00000000-0000-0000-0000-00000000a001'),
                'за скан баллы не начисляются');

rollback;

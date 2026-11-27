-- =============================================================================
-- «Қайда?» · Миграция 10: бонусы (ТЗ 12) и маркетплейсы (ТЗ 13, P2)
--   site_pool_payout  — правило 2: недельный пул бонусов домовой площадки
--                       (кг вторсырья площадки × ставка × коэффициент чистоты) делится
--                       между активными жителями дома; идемпотентно по (площадка, неделя);
--   bonus_alerts      — уведомления админа о необычно больших сдачах (журнал app_logs);
--   shop_redeem       — магазин бонусов: оплата бонусами полностью или частично, промокод партнёра;
--   market_*          — B2B-маркетплейс вторсырья: объявление с происхождением (партии),
--                       заявка покупателя, статусы сделки.
-- Таблицы listings / orders / partners созданы в миграции 1; здесь — логика и демо-каталог.
-- =============================================================================

-- ------------------------------------------------------------- правило 2 (ТЗ 12)
create or replace function public.cleanliness_coef(p_score numeric) returns numeric
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((
    select (c ->> 'coef')::numeric
      from public.bonus_rules r, jsonb_array_elements(r.params -> 'cleanliness_coef') c
     where r.code = 'site_pool_rate' and r.is_active and coalesce(p_score, 0) >= (c ->> 'min')::numeric
     order by (c ->> 'min')::numeric desc limit 1), 0)
$$;

-- Вторсырьё площадки за период: доля площадки в каждой партии (правило 1 раздела 7)
-- × выход видов вторсырья, реально ушедших переработчику / покупателю / в компост.
create or replace function public.site_recycled_kg(p_site_id uuid, p_from timestamptz, p_to timestamptz) returns numeric
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(round(sum(o.weight_kg * s.share), 2), 0)
    from public.trip_site_shares s
    join public.trips t on t.id = s.trip_id
    join public.batches b on b.trip_id = t.id
    join public.batch_outputs o on o.batch_id = b.id
   where s.site_id = p_site_id and t.started_at >= p_from and t.started_at < p_to
     and public.is_real_recycled(o.output_type, o.destination)
$$;

-- Недельная выплата. p_week_start — понедельник недели (по умолчанию прошлая неделя).
create or replace function public.site_pool_payout(p_week_start date default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  wk date := coalesce(p_week_start, (date_trunc('week', public.local_today()) - interval '7 days')::date);
  t_from timestamptz := (wk::timestamp at time zone 'Asia/Almaty');
  t_to timestamptz := ((wk + 7)::timestamp at time zone 'Asia/Almaty');
  rate numeric := coalesce((select rate_per_kg from public.bonus_rules where code = 'site_pool_rate' and is_active limit 1), 0);
  s record; kg numeric; coef numeric; pool numeric; n int; share numeric;
  sites_paid int := 0; total numeric := 0; residents int := 0;
begin
  if not public.is_admin() and not public.is_privileged() then
    perform public.api_error('FORBIDDEN', 'Только администратор');
  end if;
  if wk + 7 > public.local_today() then perform public.api_error('VALIDATION', 'Неделя ещё не закончилась'); end if;
  for s in select * from public.sites where is_active loop
    kg := public.site_recycled_kg(s.id, t_from, t_to);
    coef := public.cleanliness_coef(s.cleanliness_score);
    pool := round(kg * rate * coef, 2);
    continue when pool <= 0;
    -- активные жители дома: что-то делали за 30 дней до конца недели (фото, жалоба, сдача)
    select count(*) into n from public.profiles p
     where p.home_site_id = s.id and 'resident' = any(p.roles)
       and (exists (select 1 from public.scans x where x.user_id = p.user_id and x.created_at between t_to - interval '30 days' and t_to)
         or exists (select 1 from public.reports x where x.user_id = p.user_id and x.created_at between t_to - interval '30 days' and t_to)
         or exists (select 1 from public.drop_offs x where x.user_id = p.user_id and x.created_at between t_to - interval '30 days' and t_to));
    continue when n = 0;
    share := floor(pool / n * 100) / 100;
    insert into public.bonus_transactions (user_id, amount, source_type, source_id, description, created_at)
    select p.user_id, share, 'site_pool', md5('site_pool:' || s.id || ':' || wk)::uuid,
           format('Пул дома %s за неделю с %s: %s кг × %s × %s (чистота %s) / %s жит.',
                  s.address, to_char(wk, 'DD.MM'), kg, rate, coef, coalesce(round(s.cleanliness_score), 0), n),
           least(t_to, now())
      from public.profiles p
     where p.home_site_id = s.id and 'resident' = any(p.roles)
       and (exists (select 1 from public.scans x where x.user_id = p.user_id and x.created_at between t_to - interval '30 days' and t_to)
         or exists (select 1 from public.reports x where x.user_id = p.user_id and x.created_at between t_to - interval '30 days' and t_to)
         or exists (select 1 from public.drop_offs x where x.user_id = p.user_id and x.created_at between t_to - interval '30 days' and t_to))
    on conflict do nothing;   -- повторный запуск за ту же неделю не начисляет второй раз
    get diagnostics n = row_count;
    if n > 0 then sites_paid := sites_paid + 1; residents := residents + n; total := total + share * n; end if;
  end loop;
  return jsonb_build_object('week_start', wk, 'sites', sites_paid, 'residents', residents, 'total', total);
end $$;

-- Уведомления админа: необычно большие сдачи и превышения лимита (ТЗ 12, «Защита»)
create or replace function public.bonus_alerts(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then perform public.api_error('FORBIDDEN', 'Только администратор'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'message', l.message, 'context', l.context,
           'user', (select coalesce(full_name, email) from public.profiles where user_id = l.user_id), 'created_at', l.created_at)
           order by l.created_at desc)
    from (select * from public.app_logs where source = 'api' and level = 'warn' order by created_at desc limit p_limit) l), '[]'::jsonb);
end $$;

-- Баланс всегда равен сумме транзакций (критерий ТЗ 12) — проверка для админки и тестов
create or replace function public.bonus_balance_check() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('mismatches', count(*)) from public.profiles p
   where p.bonus_balance <> coalesce((select sum(amount) from public.bonus_transactions t where t.user_id = p.user_id), 0)
$$;

-- ------------------------------------------------------------- магазин бонусов (ТЗ 13)
-- listings.kind = 'shop_product': price — цена в тенге, price_bonus — цена в бонусах.
-- Частичная оплата: p_bonus меньше price_bonus → остаток в тенге пропорционально (1 бонус = 1 ₸ по умолчанию).
create or replace function public.shop_redeem(p_listing_id uuid, p_bonus numeric default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_auth();
  l public.listings;
  bal numeric;
  pay numeric;
  o public.orders;
  promo text;
begin
  if p_client_id is not null then
    select * into o from public.orders where buyer_id = uid and details ->> 'client_id' = p_client_id;
    if o.id is not null then return to_jsonb(o) || jsonb_build_object('duplicate', true); end if;
  end if;
  select * into l from public.listings where id = p_listing_id and kind = 'shop_product' and status = 'active' for update;
  if l.id is null then perform public.api_error('NOT_FOUND', 'Товар не найден'); end if;
  select bonus_balance into bal from public.profiles where user_id = uid for update;
  pay := least(coalesce(p_bonus, l.price_bonus), l.price_bonus);
  if pay < 0 then perform public.api_error('VALIDATION', 'Сумма бонусов не может быть отрицательной'); end if;
  if pay > coalesce(bal, 0) then perform public.api_error('INSUFFICIENT_BONUS', 'Недостаточно бонусов'); end if;
  promo := (select p.terms ->> 'promo_code' from public.partners p where p.id = l.partner_id);
  insert into public.orders (listing_id, partner_id, buyer_id, kind, status, details)
  values (l.id, l.partner_id, uid, 'purchase', 'new', jsonb_build_object(
    'bonus', pay, 'money', round(coalesce(l.price, l.price_bonus) * (1 - pay / nullif(l.price_bonus, 0)), 2),
    'title', l.title, 'promo_code', promo, 'client_id', p_client_id))
  returning * into o;
  if pay > 0 then
    insert into public.bonus_transactions (user_id, amount, source_type, source_id, description)
    values (uid, -pay, 'redeem', o.id, 'Магазин: ' || l.title);
  end if;
  return to_jsonb(o) || jsonb_build_object('balance', (select bonus_balance from public.profiles where user_id = uid));
end $$;

create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
    from public.orders o where o.buyer_id = auth.uid()
$$;

-- ------------------------------------------------------------- B2B-маркетплейс вторсырья (ТЗ 13)
-- Объявление: вид, объём, чистота, происхождение (партии), цена за т, склад.
create or replace function public.market_create_listing(
  p_output_type public.output_type, p_volume_kg numeric, p_price_per_t numeric,
  p_batch_ids uuid[] default '{}', p_warehouse text default null, p_cleanliness_pct numeric default null,
  p_description text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_role('operator');
  l public.listings;
  avail numeric;
begin
  if p_volume_kg is null or p_volume_kg <= 0 then perform public.api_error('VALIDATION', 'Объём > 0'); end if;
  if cardinality(p_batch_ids) > 0 then
    -- вторсырьё этого вида в указанных партиях (и партии — объекта оператора)
    select coalesce(sum(o.weight_kg), 0) into avail from public.batch_outputs o join public.batches b on b.id = o.batch_id
     where o.batch_id = any(p_batch_ids) and o.output_type = p_output_type and (public.is_operator_of(b.facility_id) or public.is_admin());
    if avail + 0.01 < p_volume_kg then
      perform public.api_error('VALIDATION', format('В партиях только %s кг этого вида', avail));
    end if;
  end if;
  insert into public.listings (seller_id, kind, title, description, output_type, volume_kg, price, batch_ids, status)
  values (uid, 'recyclable', format('%s · %s т', p_output_type, round(p_volume_kg / 1000, 2)), p_description, p_output_type,
          p_volume_kg, p_price_per_t, coalesce(p_batch_ids, '{}'), 'active')
  returning * into l;
  update public.listings set photos = photos where id = l.id; -- updated_at
  return to_jsonb(l) || jsonb_build_object('warehouse', p_warehouse, 'cleanliness_pct', p_cleanliness_pct);
end $$;

-- Лента B2B: объявления с происхождением (объект, даты партий) и чистотой
create or replace function public.market_listings(p_output_type public.output_type default null) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) from (
    select to_jsonb(l) || jsonb_build_object(
      'price_per_t', l.price,
      'seller', (select jsonb_build_object('name', f.name, 'facility_id', f.id, 'address', f.address)
                   from public.profiles p join public.facilities f on f.id = p.facility_id where p.user_id = l.seller_id),
      'origin', (select jsonb_build_object('batches', count(*), 'from', min(b.received_at), 'to', max(b.received_at),
                   'sites', (select count(distinct s.site_id) from public.trip_site_shares s where s.trip_id = any(array_agg(b.trip_id))))
                   from public.batches b where b.id = any(l.batch_ids)),
      'cleanliness_pct', (select round(avg(100 - p.contamination_pct), 1) from public.pickups p
                           join public.batches b on b.trip_id = p.trip_id where b.id = any(l.batch_ids) and p.contamination_pct is not null),
      'requests', (select count(*) from public.orders o where o.listing_id = l.id and o.status in ('new', 'accepted'))) x
    from public.listings l
   where l.kind = 'recyclable' and l.status in ('active', 'reserved') and (p_output_type is null or l.output_type = p_output_type)
  ) t
$$;

-- Заявка покупателя
create or replace function public.market_request(p_listing_id uuid, p_amount_kg numeric, p_comment text default null, p_company text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_auth();
  l public.listings;
  o public.orders;
begin
  select * into l from public.listings where id = p_listing_id and kind = 'recyclable' and status in ('active', 'reserved');
  if l.id is null then perform public.api_error('NOT_FOUND', 'Объявление не найдено'); end if;
  if p_amount_kg is null or p_amount_kg <= 0 or p_amount_kg > l.volume_kg then
    perform public.api_error('VALIDATION', format('Объём заявки: от 1 до %s кг', l.volume_kg));
  end if;
  if l.seller_id = uid then perform public.api_error('VALIDATION', 'Это ваше объявление'); end if;
  insert into public.orders (listing_id, buyer_id, kind, amount_kg, status, details)
  values (l.id, uid, 'purchase', p_amount_kg, 'new', jsonb_build_object('comment', p_comment, 'company', p_company,
          'price_per_t', l.price, 'total', round(l.price * p_amount_kg / 1000, 2)))
  returning * into o;
  return to_jsonb(o);
end $$;

-- Статусы сделки: new → accepted → done / cancelled. Продавец (или админ) принимает и закрывает,
-- покупатель может отменить свою новую заявку. done → объявление «продано», если объём выбран.
create or replace function public.market_set_status(p_order_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := public.require_auth();
  o public.orders;
  l public.listings;
  sold numeric;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform public.api_error('NOT_FOUND', 'Заявка не найдена'); end if;
  select * into l from public.listings where id = o.listing_id;
  if not (l.seller_id = uid or public.is_admin() or (o.buyer_id = uid and p_status = 'cancelled' and o.status = 'new')) then
    perform public.api_error('FORBIDDEN', 'Нет прав на эту заявку');
  end if;
  if not ((o.status = 'new' and p_status in ('accepted', 'cancelled')) or (o.status = 'accepted' and p_status in ('done', 'cancelled'))) then
    perform public.api_error('CONFLICT', format('Переход %s → %s недопустим', o.status, p_status));
  end if;
  update public.orders set status = p_status where id = o.id returning * into o;
  if p_status = 'accepted' then update public.listings set status = 'reserved' where id = l.id and status = 'active'; end if;
  if p_status in ('done', 'cancelled') then
    select coalesce(sum(amount_kg), 0) into sold from public.orders where listing_id = l.id and status = 'done';
    update public.listings set status = case when sold >= l.volume_kg then 'sold'
                                             when exists (select 1 from public.orders where listing_id = l.id and status = 'accepted') then 'reserved'
                                             else 'active' end
     where id = l.id;
  end if;
  return to_jsonb(o);
end $$;

-- Заявки по моим объявлениям (продавец) и мои заявки (покупатель)
create or replace function public.market_my_deals() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('listing', to_jsonb(l),
                  'buyer', (select coalesce(full_name, email) from public.profiles where user_id = o.buyer_id)) order by o.created_at desc)
                  from public.orders o join public.listings l on l.id = o.listing_id
                 where l.kind = 'recyclable' and (l.seller_id = auth.uid() or public.is_admin())), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('listing', to_jsonb(l)) order by o.created_at desc)
                  from public.orders o join public.listings l on l.id = o.listing_id
                 where l.kind = 'recyclable' and o.buyer_id = auth.uid()), '[]'::jsonb))
$$;

revoke all on function public.site_pool_payout(date), public.bonus_alerts(int), public.shop_redeem(uuid, numeric, text),
  public.my_orders(), public.market_create_listing(public.output_type, numeric, numeric, uuid[], text, numeric, text),
  public.market_request(uuid, numeric, text, text), public.market_set_status(uuid, text), public.market_my_deals(),
  public.bonus_balance_check()
  from public, anon;
grant execute on function public.site_pool_payout(date), public.bonus_alerts(int), public.shop_redeem(uuid, numeric, text),
  public.my_orders(), public.market_create_listing(public.output_type, numeric, numeric, uuid[], text, numeric, text),
  public.market_request(uuid, numeric, text, text), public.market_set_status(uuid, text), public.market_my_deals(),
  public.bonus_balance_check()
  to authenticated, service_role;
grant execute on function public.market_listings(public.output_type), public.cleanliness_coef(numeric),
  public.site_recycled_kg(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;

-- ------------------------------------------------------------- демо-каталог магазина
-- «Наши продукты» и предложения партнёров (промокод). Пометка «(тест)», как у тестовых объектов.
insert into public.partners (id, name, kind, terms) values
  ('a0000000-0000-4000-8000-000000000001', 'Кафе «Жасыл» (тест)', 'restaurant',
   '{"promo_code": "KAIDA-GREEN", "discount_pct": 10, "offer_ru": "Скидка 10% на салаты из нашей зелени", "offer_kk": "Біздің көкөністен жасалған салаттарға 10% жеңілдік"}'),
  ('a0000000-0000-4000-8000-000000000002', 'Магазин «Эко-дом» (тест)', 'shop',
   '{"promo_code": "KAIDA-ECO", "discount_pct": 15, "offer_ru": "−15% на многоразовые сумки и бутылки", "offer_kk": "Көп реттік сөмкелер мен бөтелкелерге −15%"}')
on conflict (id) do nothing;

insert into public.listings (id, kind, title, description, price, price_bonus, partner_id, photos, status) values
  ('b0000000-0000-4000-8000-000000000001', 'shop_product', 'Биогумус, 5 л', 'Удобрение из органики Астаны (вермикомпост)', 1500, 1500, null, '{}', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'shop_product', 'Микрозелень, контейнер', 'Выращена на нашем биогумусе', 900, 900, null, '{}', 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'shop_product', 'Сумка-шоппер из ПЭТ-волокна', 'Ткань из переработанных бутылок', 2500, 2500, null, '{}', 'active'),
  ('b0000000-0000-4000-8000-000000000004', 'shop_product', 'Садовая плитка из пластика', '1 шт., 30×30 см, из ПНД', 1200, 1200, null, '{}', 'active'),
  ('b0000000-0000-4000-8000-000000000005', 'shop_product', 'Скидка 10% в кафе «Жасыл»', 'Промокод партнёра', 0, 300, 'a0000000-0000-4000-8000-000000000001', '{}', 'active'),
  ('b0000000-0000-4000-8000-000000000006', 'shop_product', 'Скидка 15% в «Эко-дом»', 'Промокод партнёра', 0, 500, 'a0000000-0000-4000-8000-000000000002', '{}', 'active')
on conflict (id) do nothing;

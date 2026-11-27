-- Проверки после `sim all` (CI, job «Симулятор · e2e»): критерии приёмки ТЗ 7 и 14
do $$
declare n int; bad int; s6 int;
begin
  select count(*) into n from public.trips where is_simulated and status = 'finished';
  if n < 10 then raise exception 'мало рейсов: %', n; end if;
  select count(*) into bad from public.batches b
    where b.status = 'sorted' and b.weight_kg <> (select coalesce(sum(weight_kg), 0) from public.batch_outputs o where o.batch_id = b.id);
  if bad > 0 then raise exception 'сумма итогов ≠ вес партии у % партий', bad; end if;
  select count(*) into n from public.trips where is_simulated and track is not null;
  if n = 0 then raise exception 'нет треков рейсов'; end if;
  select count(*) into n from public.trips where is_simulated and destination_facility_id is null and status = 'finished';
  if n > 0 then raise exception 'у % рейсов не определён пункт назначения (geofence)', n; end if;
  select count(*) into n from public.trips t join public.facilities f on f.id = t.destination_facility_id
    where t.is_simulated and f.type = 'landfill' and t.mixed_flag and t.deviation_flag;
  if n = 0 then raise exception 'сценарий «рейс на полигон» не дал флагов'; end if;
  select count(*) into s6 from public.sites s where (public.site_path(s.id, 7) -> 'latest' ->> 'stage')::int = 6;
  if s6 < 10 then raise exception 'путь до статуса 6 собрался только у % площадок', s6; end if;
  select count(*) into n from public.batches where parent_output_id is not null;
  if n = 0 then raise exception 'нет партий у переработчика (цепочка parent_output_id)'; end if;
  select count(*) into n from public.reports; if n = 0 then raise exception 'нет жалоб'; end if;
  select count(*) into n from public.scans;   if n = 0 then raise exception 'нет фото жителей'; end if;
  select count(*) into n from public.sites where cleanliness_score is not null;
  if n < 20 then raise exception 'рейтинг чистоты есть только у % площадок', n; end if;
  raise notice 'ok: рейсов %, площадок со статусом 6: %', (select count(*) from public.trips where is_simulated), s6;
end $$;

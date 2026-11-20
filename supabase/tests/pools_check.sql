-- Pool logic check for Phase 2 (T2.2, T2.3, T2.4, T2.5, T2.6).
-- Run in the Supabase SQL editor after 0001, 0002 and seed.sql, with at least two
-- signed-up non-admin users. Everything runs in a transaction and is rolled back.
-- Each line of output should say PASS.
--
-- T2.3 (two people taking the last seat at once) is guaranteed by join_pool's
-- SELECT ... FOR UPDATE row lock: the second call waits, then sees the pool full
-- and is waitlisted. This script checks that a full pool waitlists the next party.

begin;

create temp table _u on commit drop as
  select id, row_number() over (order by created_at) as n
  from public.profiles where role <> 'admin' limit 2;

do $$
declare
  a uuid := (select id from _u where n = 1);
  b uuid := (select id from _u where n = 2);
  p uuid;
  priv uuid;
  code text;
  ta uuid[];
  tb uuid[];
  r record;
  seats int;
  st public.member_status;
begin
  if a is null or b is null then raise exception 'Need two signed-up non-admin users'; end if;

  -- Since Phase 3, joining needs an active plan.
  insert into public.subscriptions (user_id, plan, status, starts_at, ends_at)
  values (a, 'monthly', 'active', now(), now() + interval '30 days'),
         (b, 'monthly', 'active', now(), now() + interval '30 days');

  -- A test pool with room for 4 (limits relaxed directly, bypassing create_pool's minimums).
  insert into public.pools (origin, destination, travel_date, time_window, min_seats, max_seats,
                            cut_off_at, status, market_fare_paise, target_fare_paise)
  values ('DEL', 'PAT', current_date + 60, 'evening', 3, 4, now() + interval '30 days', 'open', 1000000, 700000)
  returning id into p;

  insert into public.pools (origin, destination, travel_date, time_window, min_seats, max_seats,
                            cut_off_at, status, is_private, invite_code, created_by)
  values ('BOM', 'LKO', current_date + 60, 'morning', 3, 10, now() + interval '30 days', 'open', true, 'TESTCODE01', b)
  returning id into priv;

  -- Travellers: A has 3, B has 2.
  with ins as (
    insert into public.travellers (user_id, full_name_as_on_id, date_of_birth, gender)
    select a, 'Pool Test A' || g, '1990-01-01', 'other' from generate_series(1, 3) g returning id
  ) select array_agg(id) into ta from ins;
  with ins as (
    insert into public.travellers (user_id, full_name_as_on_id, date_of_birth, gender)
    select b, 'Pool Test B' || g, '1990-01-01', 'other' from generate_series(1, 2) g returning id
  ) select array_agg(id) into tb from ins;

  -- ---- act as A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into r from public.join_pool(p, ta);
  raise notice '% T2.2 party of 3 gets seats together (status %, seats %)',
    case when r.r_member_status = 'held' and r.r_seats_filled = 3 then 'PASS' else 'FAIL' end,
    r.r_member_status, r.r_seats_filled;
  raise notice '% min seats reached moves pool to min_reached',
    case when r.r_pool_status = 'min_reached' then 'PASS' else 'FAIL' end;

  begin
    perform public.join_pool(p, ta);
    raise notice 'FAIL joining twice was allowed';
  exception when others then
    raise notice 'PASS same travellers cannot join twice (%)', sqlerrm;
  end;

  begin
    perform public.join_pool(p, tb);
    raise notice 'FAIL A added B''s travellers';
  exception when others then
    raise notice 'PASS cannot add another user''s travellers (%)', sqlerrm;
  end;

  begin
    perform public.join_pool(priv, array[ta[1]]);
    raise notice 'FAIL T2.6 joined a private pool without the invite';
  exception when others then
    raise notice 'PASS T2.6 private pool needs the invite code (%)', sqlerrm;
  end;

  select r_member_status into st from public.join_pool(priv, array[ta[1]], 'testcode01');
  raise notice '% T2.6 invite code (any case) lets A join', case when st = 'held' then 'PASS' else 'FAIL' end;

  -- ---- act as B: 2 people, only 1 seat left -> whole party waitlisted
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into r from public.join_pool(p, tb);
  raise notice '% T2.3 full pool waitlists the next party (status %, seats %)',
    case when r.r_member_status = 'waitlisted' and r.r_seats_filled = 3 then 'PASS' else 'FAIL' end,
    r.r_member_status, r.r_seats_filled;

  -- ---- A leaves -> B's party is promoted
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into r from public.leave_pool(p);
  raise notice '% T2.5 leaving frees seats and promotes the waitlist (seats %, promoted %)',
    case when r.r_seats_filled = 2 and r.r_promoted = 2 then 'PASS' else 'FAIL' end,
    r.r_seats_filled, r.r_promoted;

  reset role;
  raise notice '% seat count matches held members',
    case when (select seats_filled from public.pools where id = p)
            = (select count(*) from public.pool_members where pool_id = p and status = 'held')
         then 'PASS' else 'FAIL' end;
  raise notice '% B notified about the opened seats',
    case when exists (select 1 from public.notifications where user_id = b) then 'PASS' else 'FAIL' end;

  -- ---- cut-off passed
  update public.pools set cut_off_at = now() - interval '1 minute' where id = p;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.join_pool(p, ta);
    raise notice 'FAIL T2.4 joined after cut-off';
  exception when others then
    raise notice 'PASS T2.4 join refused after cut-off (%)', sqlerrm;
  end;

  -- ---- direct writes are blocked
  begin
    insert into public.pool_members (pool_id, user_id, traveller_id, status) values (p, a, ta[1], 'held');
    raise notice 'FAIL inserted pool_members directly';
  exception when others then
    raise notice 'PASS seats can only change through join_pool / leave_pool';
  end;
  begin
    update public.pools set seats_filled = 0 where id = p;
    get diagnostics seats = row_count;
    raise notice '% non-admin cannot edit pool seat counts', case when seats = 0 then 'PASS' else 'FAIL' end;
  end;

  reset role;
end $$;

rollback;

-- Airline operations check for Phase 4 (T4.1, T4.3, T4.5, T4.6, T4.8).
-- Run in the Supabase SQL editor after 0001-0004 and seed.sql, with at least one
-- signed-up admin and one signed-up non-admin. Rolled back at the end. Every line should say PASS.

begin;

create temp table _who on commit drop as
  select (select id from public.profiles where role = 'admin' order by created_at limit 1) as admin_id,
         (select id from public.profiles where role <> 'admin' order by created_at limit 1) as user_id;

do $$
declare
  adm  uuid := (select admin_id from _who);
  u    uuid := (select user_id from _who);
  p    uuid;
  t    uuid[];
  j    record;
  pay  uuid;
  q1   uuid;
  q2   uuid;
  n    int;
  r    text;
  part uuid;
begin
  if adm is null or u is null then raise exception 'Need one admin and one non-admin user'; end if;
  insert into public.subscriptions (user_id, plan, status, starts_at, ends_at)
  values (u, 'monthly', 'active', now(), now() + interval '30 days');

  insert into public.pools (origin, destination, travel_date, time_window, min_seats, max_seats, cut_off_at, status, deposit_paise, target_fare_paise)
  values ('DEL', 'PAT', current_date + 60, 'evening', 2, 10, now() + interval '30 days', 'open', 150000, 945000)
  returning id into p;
  with ins as (
    insert into public.travellers (user_id, full_name_as_on_id, date_of_birth, gender)
    select u, 'Ops Test ' || g, '1990-01-01', 'other' from generate_series(1, 2) g returning id
  ) select array_agg(id) into t from ins;

  -- Member joins and pays the deposit
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into j from public.join_pool(p, t);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  part := j.r_party_id;
  insert into public.payments (user_id, pool_id, party_id, type, amount_paise, status, gateway, idempotency_key)
  values (u, p, part, 'deposit', 300000, 'created', 'mock', 'ops:dep:' || gen_random_uuid()) returning id into pay;
  perform public.complete_payment(pay, 'mock_dep', 300000);

  -- T4.1: reaching the minimum notifies admins
  raise notice '% T4.1 pool ready for fare request and admin notified',
    case when (select status from public.pools where id = p) = 'min_reached'
          and exists (select 1 from public.notifications where user_id = adm and subject like '%ready for a fare request%')
         then 'PASS' else 'FAIL' end;

  -- Non-admins are refused
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    perform public.send_rfq(p, 'Demo Air', null, null);
    raise notice 'FAIL non-admin sent a fare request';
  exception when insufficient_privilege then
    raise notice 'PASS only admins can send fare requests';
  end;

  -- Act as admin from here
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  perform public.send_rfq(p, 'Demo Air', 'groups@demoair.example', 'test');
  raise notice '% fare request logged with 2 seats; joining closed',
    case when (select status from public.pools where id = p) = 'rfq_sent'
          and (select seats from public.rfqs where pool_id = p order by sent_at desc limit 1) = 2
         then 'PASS' else 'FAIL' end;

  -- T4.8: reject, request again, quote again: history keeps both
  q1 := public.record_quote(p, 'Demo Air', 1050000, now() + interval '5 days', now() + interval '20 days', 'first');
  perform public.reject_quote(q1, 'Too high');
  raise notice '% T4.8 rejected quote returns pool to fare requested',
    case when (select status from public.pools where id = p) = 'rfq_sent' then 'PASS' else 'FAIL' end;
  perform public.send_rfq(p, 'Demo Air', null, 'again');
  q2 := public.record_quote(p, 'Demo Air', 945000, now() + interval '5 days', now() + interval '20 days', 'second');
  select count(*) into n from public.quotes where pool_id = p;
  raise notice '% T4.8 both quotes kept in history (% quotes, % fare requests)',
    case when n = 2 and (select count(*) from public.rfqs where pool_id = p) = 2 then 'PASS' else 'FAIL' end,
    n, (select count(*) from public.rfqs where pool_id = p);

  begin
    perform public.record_quote(p, 'Demo Air', 100000, now() + interval '5 days', now() + interval '20 days', null);
    raise notice 'FAIL quote below the deposit accepted';
  exception when others then
    raise notice 'PASS quote below the deposit refused';
  end;

  -- T4.3: accept -> payment due, final fare set, member notified
  n := public.accept_quote(q2, now() + interval '7 days');
  raise notice '% T4.3 quote accepted: % group asked to pay; fare % paise',
    case when n = 1 and (select status from public.pools where id = p) = 'payment_due'
          and (select final_fare_paise from public.pools where id = p) = 945000
          and exists (select 1 from public.notifications where user_id = u and subject like '%pay the balance%')
         then 'PASS' else 'FAIL' end,
    n, (select final_fare_paise from public.pools where id = p);

  -- Names can't be submitted with unpaid balances before the deadline
  begin
    perform public.submit_names(p, false);
    raise notice 'FAIL names submitted with balances outstanding';
  exception when others then
    raise notice 'PASS names wait for balances (%)', sqlerrm;
  end;

  -- Balance paid: 2 x (9450 - 1500) = 15,900 rupees
  insert into public.payments (user_id, pool_id, party_id, type, amount_paise, status, gateway, idempotency_key)
  values (u, p, part, 'balance', 1590000, 'created', 'mock', 'ops:bal:' || gen_random_uuid()) returning id into pay;
  r := public.complete_payment(pay, 'mock_bal', 1590000);
  raise notice '% balance payment marks the seats fully paid (%)',
    case when r = 'completed' and not exists (select 1 from public.pool_members where party_id = part and balance_paid_at is null)
         then 'PASS' else 'FAIL' end, r;

  n := public.submit_names(p, false);
  raise notice '% names submitted (released %)',
    case when n = 0 and (select status from public.pools where id = p) = 'names_submitted' then 'PASS' else 'FAIL' end, n;

  -- T4.5: tickets; pool becomes ticketed when every passenger has one
  begin
    perform public.set_ticket(p, t[1], 'bad pnr', null, null);
    raise notice 'FAIL bad PNR accepted';
  exception when others then
    raise notice 'PASS malformed PNR refused';
  end;
  r := public.set_ticket(p, t[1], 'AB12CD', '0981234567890', null);
  raise notice '% first ticket saved, pool not yet ticketed (%)', case when r = 'saved' then 'PASS' else 'FAIL' end, r;
  r := public.set_ticket(p, t[2], 'AB12CD', null, null);
  raise notice '% T4.5 last ticket makes the pool ticketed (%)',
    case when r = 'ticketed' and (select status from public.pools where id = p) = 'ticketed' then 'PASS' else 'FAIL' end, r;

  -- Each member sees only their own tickets
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.tickets where pool_id = p;
  reset role;
  raise notice '% T4.5 passenger sees their 2 tickets', case when n = 2 then 'PASS' else 'FAIL' end;

  -- T4.6: every admin step is in the audit log
  select count(*) into n from public.audit_log
   where entity = 'pools' and entity_id = p::text and actor_id = adm
     and action in ('send_rfq', 'record_quote', 'reject_quote', 'accept_quote', 'submit_names', 'set_ticket', 'ticketed');
  raise notice '% T4.6 admin steps audited (% entries, expected 10)', case when n = 10 then 'PASS' else 'FAIL' end, n;

  perform set_config('request.jwt.claims', '', true);
end $$;

rollback;

-- Payment rules check for Phase 3 (T3.2-T3.7).
-- Run in the Supabase SQL editor after 0001-0003 and seed.sql, with at least one
-- signed-up non-admin user. Runs in a transaction and is rolled back. Every line should say PASS.

begin;

create temp table _u on commit drop as
  select id from public.profiles where role <> 'admin' order by created_at limit 1;

do $$
declare
  u    uuid := (select id from _u);
  p    uuid;
  t    uuid[];
  pay  uuid;
  pay2 uuid;
  r    text;
  j    record;
  ids  uuid[];
  n    int;
begin
  if u is null then raise exception 'Need one signed-up non-admin user'; end if;
  delete from public.subscriptions where user_id = u;

  insert into public.pools (origin, destination, travel_date, time_window, min_seats, max_seats, cut_off_at, status, deposit_paise)
  values ('DEL', 'PAT', current_date + 60, 'evening', 2, 10, now() + interval '30 days', 'open', 150000)
  returning id into p;
  with ins as (
    insert into public.travellers (user_id, full_name_as_on_id, date_of_birth, gender)
    select u, 'Pay Test ' || g, '1990-01-01', 'other' from generate_series(1, 2) g returning id
  ) select array_agg(id) into t from ins;

  -- T3.2: no plan -> join refused
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.join_pool(p, t);
    raise notice 'FAIL T3.2 joined without a plan';
  exception when others then
    raise notice '% T3.2 join refused without a plan (%)', case when sqlerrm like '%SUBSCRIPTION_REQUIRED%' then 'PASS' else 'FAIL' end, sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- T3.1: subscription payment -> plan active, role subscriber
  insert into public.payments (user_id, type, plan, amount_paise, status, gateway, idempotency_key, gateway_order_id)
  values (u, 'subscription', 'monthly', 19900, 'created', 'mock', 'test:sub:' || gen_random_uuid(), 'mock_order_sub')
  returning id into pay;
  r := public.complete_payment(pay, 'mock_pay_sub', 19900);
  raise notice '% T3.1 plan payment completes (%)', case when r = 'completed' then 'PASS' else 'FAIL' end, r;
  raise notice '% T3.1 plan is active for 30 days',
    case when public.has_active_subscription(u)
          and exists (select 1 from public.subscriptions where user_id = u and ends_at > now() + interval '29 days')
         then 'PASS' else 'FAIL' end;

  -- T3.4: the same confirmation twice changes nothing
  r := public.complete_payment(pay, 'mock_pay_sub', 19900);
  select count(*) into n from public.subscriptions where user_id = u;
  raise notice '% T3.4 duplicate confirmation ignored (%; % plan rows)', case when r = 'already_completed' and n = 1 then 'PASS' else 'FAIL' end, r, n;
  raise notice '% T3.4 webhook event recorded once',
    case when public.record_webhook_event('test', 'evt_1') and not public.record_webhook_event('test', 'evt_1') then 'PASS' else 'FAIL' end;

  -- T3.9: wrong amount is rejected
  insert into public.payments (user_id, type, plan, amount_paise, status, gateway, idempotency_key)
  values (u, 'subscription', 'monthly', 19900, 'created', 'mock', 'test:sub2:' || gen_random_uuid()) returning id into pay2;
  r := public.complete_payment(pay2, 'mock_pay_x', 100);
  raise notice '% T3.9 amount mismatch fails the payment (%)', case when r = 'amount_mismatch' then 'PASS' else 'FAIL' end, r;

  -- T3.7: renewing early extends from the current end date
  insert into public.payments (user_id, type, plan, amount_paise, status, gateway, idempotency_key)
  values (u, 'subscription', 'monthly', 19900, 'created', 'mock', 'test:sub3:' || gen_random_uuid()) returning id into pay2;
  perform public.complete_payment(pay2, 'mock_pay_renew', 19900);
  raise notice '% T3.7 early renewal stacks (ends in ~60 days)',
    case when (select max(ends_at) from public.subscriptions where user_id = u) > now() + interval '59 days' then 'PASS' else 'FAIL' end;

  -- Join now works and holds seats for 15 minutes
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into j from public.join_pool(p, t);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise notice '% seats held with a 15-minute deadline',
    case when j.r_member_status = 'held'
          and (select bool_and(hold_expires_at between now() + interval '14 minutes' and now() + interval '16 minutes')
                 from public.pool_members where party_id = j.r_party_id)
         then 'PASS' else 'FAIL' end;

  -- T3.3: deposit confirmed (as the webhook would) -> seats confirmed
  insert into public.payments (user_id, pool_id, party_id, type, amount_paise, status, gateway, idempotency_key)
  values (u, p, j.r_party_id, 'deposit', 300000, 'created', 'mock', 'test:dep:' || gen_random_uuid()) returning id into pay;
  r := public.complete_payment(pay, 'mock_pay_dep', 300000);
  raise notice '% T3.3 deposit confirms the seats (%)',
    case when r = 'completed' and not exists (select 1 from public.pool_members where party_id = j.r_party_id and status <> 'confirmed')
         then 'PASS' else 'FAIL' end, r;

  -- T3.5: an unpaid hold is released after its deadline
  update public.pool_members set status = 'held', hold_expires_at = now() - interval '1 minute' where party_id = j.r_party_id;
  n := public.release_expired_holds();
  raise notice '% T3.5 expired holds released (% seats), pool recounted to %',
    case when n = 2 and (select seats_filled from public.pools where id = p) = 0 then 'PASS' else 'FAIL' end,
    n, (select seats_filled from public.pools where id = p);

  -- Money arriving after the hold was released must be refunded, not confirm seats
  insert into public.payments (user_id, pool_id, party_id, type, amount_paise, status, gateway, idempotency_key)
  values (u, p, j.r_party_id, 'deposit', 300000, 'created', 'mock', 'test:dep2:' || gen_random_uuid()) returning id into pay2;
  r := public.complete_payment(pay2, 'mock_pay_late', 300000);
  raise notice '% late deposit is flagged for refund (%)', case when r = 'refund_required' then 'PASS' else 'FAIL' end, r;

  -- T3.6: closing the pool returns paid deposits to refund; refunds are idempotent
  update public.pool_members set status = 'confirmed', hold_expires_at = null where party_id = j.r_party_id;
  update public.profiles set role = 'admin' where id = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  ids := public.dissolve_pool(p);
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set role = 'subscriber' where id = u;
  raise notice '% T3.6 closing the pool lists both paid deposits (%)',
    case when array_length(ids, 1) = 2 and (select status from public.pools where id = p) = 'dissolved' then 'PASS' else 'FAIL' end,
    coalesce(array_length(ids, 1), 0);
  raise notice '% T3.6 every member released',
    case when not exists (select 1 from public.pool_members where pool_id = p and status <> 'left') then 'PASS' else 'FAIL' end;

  raise notice '% refund can start once', case when public.begin_refund(pay) = 300000 and public.begin_refund(pay) = 0 then 'PASS' else 'FAIL' end;
  r := public.mark_refunded(pay, 'mock_rfnd_1');
  raise notice '% refund recorded (%), second call ignored (%)',
    case when r = 'refunded' and public.mark_refunded(pay, 'mock_rfnd_1') = 'already_refunded' then 'PASS' else 'FAIL' end,
    r, public.mark_refunded(pay, 'mock_rfnd_1');
  select count(*) into n from public.payments where refund_of = pay;
  raise notice '% exactly one refund row', case when n = 1 then 'PASS' else 'FAIL' end;

  -- T3.7: expiry drops the plan and role
  update public.subscriptions set ends_at = now() - interval '1 minute', starts_at = now() - interval '30 days' where user_id = u;
  perform public.expire_subscriptions();
  raise notice '% T3.7 expired plan no longer counts; role back to passenger',
    case when not public.has_active_subscription(u) and (select role from public.profiles where id = u) = 'passenger'
         then 'PASS' else 'FAIL' end;

  -- Clients can't call server-only functions
  set local role authenticated;
  begin
    perform public.complete_payment(pay2, 'x', 1);
    raise notice 'FAIL signed-in users can call complete_payment';
  exception when insufficient_privilege then
    raise notice 'PASS complete_payment is server-only';
  end;
  begin
    insert into public.payments (user_id, type, amount_paise, idempotency_key) values (u, 'deposit', 1, 'x');
    raise notice 'FAIL users can insert payments';
  exception when others then
    raise notice 'PASS users cannot write payment rows';
  end;
  reset role;
end $$;

rollback;

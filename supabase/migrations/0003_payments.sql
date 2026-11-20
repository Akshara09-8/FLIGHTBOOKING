-- GroupFly Phase 3: subscriptions, deposits and refunds (test mode).
-- Run after 0002_pools.sql.
--
-- Money rules:
--   * Amounts are integer paise.
--   * Payment rows are written only by the server (service role) and by the functions below.
--   * complete_payment / fail_payment / mark_refunded are idempotent: a repeated webhook changes nothing.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table public.plans (
  code         text primary key,
  name         text not null,
  description  text not null,
  price_paise  bigint not null check (price_paise > 0),
  days         int not null check (days > 0),
  active       boolean not null default true,
  sort         int not null default 0
);
alter table public.plans enable row level security;
create policy "plans: public read" on public.plans for select using (true);
create policy "plans: admin write" on public.plans for all using (public.is_admin()) with check (public.is_admin());

insert into public.plans (code, name, description, price_paise, days, sort) values
  ('monthly',  'Monthly',              'Join any pool for 30 days.',                        19900,  30, 1),
  ('festival', 'Festival season pass', '120 days: covers Diwali, Chhath and Christmas.',      49900, 120, 2);

-- ---------------------------------------------------------------------------
-- Column additions
-- ---------------------------------------------------------------------------
alter table public.pools add column deposit_paise bigint not null default 150000 check (deposit_paise >= 0);

alter table public.pool_members add column hold_expires_at timestamptz;

alter table public.payments
  add column party_id            uuid,
  add column plan                text references public.plans (code),
  add column gateway             text not null default 'mock',
  add column gateway_order_id    text unique,
  add column gateway_payment_id  text,
  add column gateway_refund_id   text,
  add column failure_reason      text,
  add column paid_at             timestamptz,
  add column refund_requested_at timestamptz,
  add column refunded_at         timestamptz,
  add column refund_of           uuid references public.payments (id);
create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_party_idx on public.payments (party_id);

alter table public.subscriptions
  add column payment_id        uuid references public.payments (id),
  add column reminder_sent_at  timestamptz;
create index subscriptions_user_idx on public.subscriptions (user_id, ends_at desc);

-- Webhook deliveries already processed (a repeated delivery is ignored).
create table public.webhook_events (
  provider     text not null,
  event_id     text not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.webhook_events enable row level security; -- no policies: server only

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------
create or replace function public.has_active_subscription(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- An early renewal starts when the current plan ends, so any active row that hasn't ended counts.
  select exists (
    select 1 from subscriptions where user_id = p_user_id and status = 'active' and ends_at > now()
  );
$$;

-- Daily: expire ended subscriptions, drop the subscriber role, send 3-day reminders.
create or replace function public.expire_subscriptions()
returns void language plpgsql security definer set search_path = public as $$
begin
  update subscriptions set status = 'expired' where status = 'active' and ends_at <= now();

  update profiles set role = 'passenger'
   where role = 'subscriber' and not has_active_subscription(id);

  with due as (
    update subscriptions s set reminder_sent_at = now()
     where s.status = 'active' and s.reminder_sent_at is null
       and s.ends_at between now() and now() + interval '3 days'
       and not exists (select 1 from subscriptions later
                        where later.user_id = s.user_id and later.status = 'active' and later.ends_at > s.ends_at)
    returning s.user_id
  )
  insert into notifications (user_id, channel, subject)
  select user_id, 'email', 'Your GroupFly plan ends in 3 days' from due;
end $$;

-- ---------------------------------------------------------------------------
-- Seat holds: a held seat must be paid for (deposit) before hold_expires_at.
-- ---------------------------------------------------------------------------

-- Recounts seats from members, moves waitlisted parties up (oldest first, whole party),
-- and sets open/min_reached. Caller must already hold the pool row lock.
create or replace function public._recount_pool(p_pool_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_pool   pools%rowtype;
  v_seats  int;
  v_party  record;
begin
  select * into v_pool from pools where id = p_pool_id for update;
  select count(*) into v_seats from pool_members where pool_id = p_pool_id and status in ('held', 'confirmed');

  if v_pool.status in ('open', 'min_reached') and now() < v_pool.cut_off_at then
    for v_party in
      select party_id, count(*)::int as n, (array_agg(user_id))[1] as owner
        from pool_members where pool_id = p_pool_id and status = 'waitlisted'
       group by party_id order by min(joined_at)
    loop
      if v_seats + v_party.n <= v_pool.max_seats then
        update pool_members
           set status = 'held', hold_expires_at = least(now() + interval '24 hours', v_pool.cut_off_at)
         where pool_id = p_pool_id and party_id = v_party.party_id and status = 'waitlisted';
        v_seats := v_seats + v_party.n;
        insert into notifications (user_id, channel, subject)
        values (v_party.owner, 'email', 'Seats opened up in your pool: pay the deposit within 24 hours');
      end if;
    end loop;
    update pools
       set seats_filled = v_seats,
           status = case when v_seats >= min_seats then 'min_reached'::pool_status else 'open'::pool_status end
     where id = p_pool_id;
  else
    update pools set seats_filled = v_seats where id = p_pool_id;
  end if;
  return v_seats;
end $$;

-- Releases unpaid holds in one pool. Caller must hold the pool row lock.
create or replace function public._release_expired(p_pool_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update pool_members set status = 'left'
   where pool_id = p_pool_id and status = 'held' and hold_expires_at is not null and hold_expires_at <= now();
  get diagnostics v_n = row_count;
  if v_n > 0 then perform _recount_pool(p_pool_id); end if;
  return v_n;
end $$;

-- Every minute (pg_cron): release unpaid holds in all pools.
create or replace function public.release_expired_holds()
returns int language plpgsql security definer set search_path = public as $$
declare v_pool uuid; v_total int := 0;
begin
  for v_pool in
    select distinct pool_id from pool_members
     where status = 'held' and hold_expires_at is not null and hold_expires_at <= now()
  loop
    perform 1 from pools where id = v_pool for update;
    v_total := v_total + _release_expired(v_pool);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- join_pool v2: needs an active plan; seats are held for 15 minutes until the deposit is paid.
-- ---------------------------------------------------------------------------
drop function public.join_pool(uuid, uuid[], text);
create function public.join_pool(
  p_pool_id        uuid,
  p_traveller_ids  uuid[],
  p_invite_code    text default null
) returns table (r_member_status public.member_status, r_seats_filled int, r_pool_status public.pool_status, r_party_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_pool    pools%rowtype;
  v_n       int := coalesce(array_length(p_traveller_ids, 1), 0);
  v_owned   int;
  v_party   uuid := gen_random_uuid();
  v_status  public.member_status;
  v_seats   int;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not is_admin() and not has_active_subscription(v_uid) then
    raise exception 'SUBSCRIPTION_REQUIRED' using errcode = '42501';
  end if;
  if v_n = 0 then raise exception 'NO_TRAVELLERS'; end if;
  if v_n > 9 then raise exception 'PARTY_TOO_LARGE'; end if;
  if (select count(distinct t) from unnest(p_traveller_ids) as t) <> v_n then
    raise exception 'DUPLICATE_TRAVELLER';
  end if;

  perform 1 from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  perform _release_expired(p_pool_id);
  select * into v_pool from pools where id = p_pool_id;

  if v_pool.is_private
     and v_pool.created_by is distinct from v_uid
     and not is_admin()
     and coalesce(upper(p_invite_code), '') <> coalesce(v_pool.invite_code, '#')
     and not exists (select 1 from pool_members m
                     where m.pool_id = p_pool_id and m.user_id = v_uid and m.status <> 'left') then
    raise exception 'POOL_NOT_FOUND';
  end if;
  if v_pool.status not in ('open', 'min_reached') then raise exception 'POOL_CLOSED'; end if;
  if now() >= v_pool.cut_off_at then raise exception 'CUT_OFF_PASSED'; end if;

  select count(*) into v_owned from travellers where id = any (p_traveller_ids) and user_id = v_uid;
  if v_owned <> v_n then raise exception 'TRAVELLER_NOT_YOURS' using errcode = '42501'; end if;

  if exists (select 1 from pool_members m
             where m.pool_id = p_pool_id and m.traveller_id = any (p_traveller_ids) and m.status <> 'left') then
    raise exception 'ALREADY_IN_POOL';
  end if;

  v_status := case when v_pool.seats_filled + v_n <= v_pool.max_seats then 'held' else 'waitlisted' end;

  insert into pool_members (pool_id, user_id, traveller_id, status, party_id, joined_at, hold_expires_at)
  select p_pool_id, v_uid, t, v_status, v_party, clock_timestamp(),
         case when v_status = 'held' then least(now() + interval '15 minutes', v_pool.cut_off_at) end
    from unnest(p_traveller_ids) as t
  on conflict (pool_id, traveller_id) do update
    set status = excluded.status, party_id = excluded.party_id, joined_at = excluded.joined_at,
        user_id = excluded.user_id, hold_expires_at = excluded.hold_expires_at;

  v_seats := _recount_pool(p_pool_id);
  select status into v_pool.status from pools where id = p_pool_id;
  return query select v_status, v_seats, v_pool.status, v_party;
end $$;

-- ---------------------------------------------------------------------------
-- leave_pool v2: also returns the paid deposits to refund.
-- ---------------------------------------------------------------------------
drop function public.leave_pool(uuid);
create function public.leave_pool(p_pool_id uuid)
returns table (r_seats_filled int, r_promoted int, r_refund_payment_ids uuid[])
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_pool    pools%rowtype;
  v_total   int;
  v_before  int;
  v_after   int;
  v_refund  uuid[];
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;

  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status not in ('open', 'min_reached') then raise exception 'POOL_LOCKED'; end if;
  if now() >= v_pool.cut_off_at then raise exception 'CUT_OFF_PASSED'; end if;

  select count(*) into v_total from pool_members where pool_id = p_pool_id and user_id = v_uid and status <> 'left';
  if v_total = 0 then raise exception 'NOT_A_MEMBER'; end if;

  update pool_members set status = 'left' where pool_id = p_pool_id and user_id = v_uid and status <> 'left';
  update payments set status = 'failed', failure_reason = 'MEMBER_LEFT'
   where pool_id = p_pool_id and user_id = v_uid and type = 'deposit' and status = 'created';

  select count(*) into v_before from pool_members where pool_id = p_pool_id and status in ('held', 'confirmed');
  v_after := _recount_pool(p_pool_id);

  select coalesce(array_agg(id), '{}') into v_refund from payments
   where pool_id = p_pool_id and user_id = v_uid and type = 'deposit' and status = 'succeeded';

  return query select v_after, v_after - v_before, v_refund;
end $$;

-- ---------------------------------------------------------------------------
-- Payment state changes (server only)
-- ---------------------------------------------------------------------------
create or replace function public.complete_payment(p_payment_id uuid, p_gateway_payment_id text, p_amount_paise bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pay   payments%rowtype;
  v_days  int;
  v_start timestamptz;
  v_held  int;
begin
  select * into v_pay from payments where id = p_payment_id for update;
  if not found then return 'not_found'; end if;
  if v_pay.status in ('succeeded', 'refunded') then return 'already_completed'; end if;
  if p_amount_paise is distinct from v_pay.amount_paise then
    update payments set status = 'failed', failure_reason = 'AMOUNT_MISMATCH', gateway_payment_id = p_gateway_payment_id
     where id = p_payment_id;
    return 'amount_mismatch';
  end if;

  update payments set status = 'succeeded', gateway_payment_id = p_gateway_payment_id, paid_at = now(), failure_reason = null
   where id = p_payment_id;

  if v_pay.type = 'subscription' then
    select days into v_days from plans where code = v_pay.plan;
    if v_days is null then raise exception 'UNKNOWN_PLAN'; end if;
    -- Renewing early extends from the current end date.
    select greatest(now(), coalesce(max(ends_at), now())) into v_start
      from subscriptions where user_id = v_pay.user_id and status = 'active' and ends_at > now();
    insert into subscriptions (user_id, plan, status, starts_at, ends_at, gateway_ref, payment_id)
    values (v_pay.user_id, v_pay.plan, 'active', v_start, v_start + make_interval(days => v_days), p_gateway_payment_id, v_pay.id);
    update profiles set role = 'subscriber' where id = v_pay.user_id and role = 'passenger';
    insert into notifications (user_id, channel, subject) values (v_pay.user_id, 'email', 'Your GroupFly plan is active');
    return 'completed';
  end if;

  if v_pay.type = 'deposit' then
    perform 1 from pools where id = v_pay.pool_id for update;
    select count(*) into v_held from pool_members where party_id = v_pay.party_id and status in ('held', 'confirmed');
    if v_held = 0 or exists (select 1 from pools where id = v_pay.pool_id and status not in ('open', 'min_reached')) then
      return 'refund_required'; -- seats were released before the money arrived
    end if;
    update pool_members set status = 'confirmed', hold_expires_at = null where party_id = v_pay.party_id and status = 'held';
    insert into notifications (user_id, channel, subject) values (v_pay.user_id, 'email', 'Deposit received: your seats are confirmed');
    return 'completed';
  end if;

  return 'completed';
end $$;

create or replace function public.fail_payment(p_payment_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
begin
  update payments set status = 'failed', failure_reason = left(coalesce(p_reason, 'FAILED'), 200)
   where id = p_payment_id and status = 'created';
  return case when found then 'failed' else 'unchanged' end;
end $$;

-- Returns the amount to refund, or 0 if not refundable / already being refunded.
create or replace function public.begin_refund(p_payment_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_pay payments%rowtype;
begin
  select * into v_pay from payments where id = p_payment_id for update;
  if not found or v_pay.status <> 'succeeded' or v_pay.type = 'refund' then return 0; end if;
  if v_pay.refund_requested_at is not null and v_pay.refund_requested_at > now() - interval '10 minutes' then return 0; end if;
  update payments set refund_requested_at = now() where id = p_payment_id;
  return v_pay.amount_paise;
end $$;

create or replace function public.mark_refunded(p_payment_id uuid, p_gateway_refund_id text)
returns text language plpgsql security definer set search_path = public as $$
declare v_pay payments%rowtype;
begin
  select * into v_pay from payments where id = p_payment_id for update;
  if not found then return 'not_found'; end if;
  if v_pay.status = 'refunded' then return 'already_refunded'; end if;
  if v_pay.status <> 'succeeded' then return 'not_refundable'; end if;

  update payments set status = 'refunded', refunded_at = now(), gateway_refund_id = p_gateway_refund_id where id = p_payment_id;
  insert into payments (user_id, pool_id, party_id, type, amount_paise, status, gateway, gateway_refund_id,
                        idempotency_key, paid_at, refund_of)
  values (v_pay.user_id, v_pay.pool_id, v_pay.party_id, 'refund', v_pay.amount_paise, 'succeeded', v_pay.gateway,
          p_gateway_refund_id, 'refund:' || v_pay.id, now(), v_pay.id)
  on conflict (idempotency_key) do nothing;
  insert into notifications (user_id, channel, subject) values (v_pay.user_id, 'email', 'Your GroupFly refund is on its way');
  return 'refunded';
end $$;

-- True the first time an event id is seen.
create or replace function public.record_webhook_event(p_provider text, p_event_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into webhook_events (provider, event_id) values (p_provider, p_event_id) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- ---------------------------------------------------------------------------
-- dissolve_pool (admin): everyone leaves, returns the paid deposits to refund.
-- ---------------------------------------------------------------------------
create or replace function public.dissolve_pool(p_pool_id uuid)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_pool    pools%rowtype;
  v_refund  uuid[];
begin
  if not is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status in ('ticketed', 'completed') then raise exception 'POOL_LOCKED'; end if;

  insert into notifications (user_id, channel, subject)
  select distinct user_id, 'email', 'Your GroupFly pool was closed: any deposit will be refunded'
    from pool_members where pool_id = p_pool_id and status <> 'left';

  update pool_members set status = 'left', hold_expires_at = null where pool_id = p_pool_id and status <> 'left';
  update pools set status = 'dissolved', seats_filled = 0 where id = p_pool_id;
  update payments set status = 'failed', failure_reason = 'POOL_DISSOLVED'
   where pool_id = p_pool_id and status = 'created';

  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'dissolve_pool', 'pools', p_pool_id::text,
          jsonb_build_object('status', v_pool.status, 'seats_filled', v_pool.seats_filled),
          jsonb_build_object('status', 'dissolved'));

  select coalesce(array_agg(id), '{}') into v_refund
    from payments where pool_id = p_pool_id and type = 'deposit' and status = 'succeeded';
  return v_refund;
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke all on function public._recount_pool(uuid) from public, anon, authenticated;
revoke all on function public._release_expired(uuid) from public, anon, authenticated;
revoke all on function public.release_expired_holds() from public, anon, authenticated;
revoke all on function public.expire_subscriptions() from public, anon, authenticated;
revoke all on function public.complete_payment(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.fail_payment(uuid, text) from public, anon, authenticated;
revoke all on function public.begin_refund(uuid) from public, anon, authenticated;
revoke all on function public.mark_refunded(uuid, text) from public, anon, authenticated;
revoke all on function public.record_webhook_event(text, text) from public, anon, authenticated;
grant execute on function public.release_expired_holds() to service_role;
grant execute on function public.expire_subscriptions() to service_role;
grant execute on function public.complete_payment(uuid, text, bigint) to service_role;
grant execute on function public.fail_payment(uuid, text) to service_role;
grant execute on function public.begin_refund(uuid) to service_role;
grant execute on function public.mark_refunded(uuid, text) to service_role;
grant execute on function public.record_webhook_event(text, text) to service_role;

revoke all on function public.join_pool(uuid, uuid[], text) from public, anon;
revoke all on function public.leave_pool(uuid) from public, anon;
revoke all on function public.dissolve_pool(uuid) from public, anon;
grant execute on function public.join_pool(uuid, uuid[], text) to authenticated;
grant execute on function public.leave_pool(uuid) to authenticated;
grant execute on function public.dissolve_pool(uuid) to authenticated;
grant execute on function public.has_active_subscription(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (pg_cron is available on Supabase; enable it under Database -> Extensions if this is skipped)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.schedule('groupfly-release-holds', '* * * * *', 'select public.release_expired_holds()');
    perform cron.schedule('groupfly-expire-subscriptions', '30 18 * * *', 'select public.expire_subscriptions()'); -- 00:00 IST
  end if;
end $$;

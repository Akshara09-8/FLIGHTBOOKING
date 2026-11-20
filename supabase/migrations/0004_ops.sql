-- GroupFly Phase 4: airline fare requests (RFQ), quotes, balances, manifest and tickets.
-- Run after 0003_payments.sql.
--
-- Pool lifecycle handled here:
--   min_reached --send_rfq--> rfq_sent --record_quote--> quoted --accept_quote--> payment_due
--   quoted --reject_quote--> rfq_sent (request again; quote history kept)
--   payment_due --submit_names--> names_submitted --set_ticket (all)--> ticketed --mark_completed--> completed
-- Every step is admin-only and writes to audit_log.

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------
create table public.rfqs (
  id                 uuid primary key default gen_random_uuid(),
  pool_id            uuid not null references public.pools (id) on delete cascade,
  airline            text not null check (char_length(airline) between 2 and 80),
  recipient_email    text,
  seats              int not null check (seats > 0),
  target_fare_paise  bigint,
  message            text,
  sent_by            uuid references public.profiles (id),
  sent_at            timestamptz not null default now()
);
create index rfqs_pool_idx on public.rfqs (pool_id, sent_at desc);
alter table public.rfqs enable row level security;
create policy "rfqs: admin only" on public.rfqs for all using (public.is_admin()) with check (public.is_admin());

alter table public.quotes
  add column seats          int check (seats > 0),
  add column notes          text,
  add column created_by     uuid references public.profiles (id),
  add column decided_at     timestamptz,
  add column decided_by     uuid references public.profiles (id),
  add column reject_reason  text;
create index quotes_pool_idx on public.quotes (pool_id, created_at desc);

alter table public.pools
  add column final_fare_paise   bigint check (final_fare_paise >= 0),
  add column accepted_quote_id  uuid references public.quotes (id),
  add column balance_due_at     timestamptz;

alter table public.pool_members add column balance_paid_at timestamptz;

alter table public.tickets
  add column ticket_number  text,
  add column uploaded_by    uuid references public.profiles (id),
  add column updated_at     timestamptz not null default now(),
  add constraint tickets_pool_traveller_key unique (pool_id, traveller_id);
create policy "tickets: admin all" on public.tickets for all using (public.is_admin()) with check (public.is_admin());

-- Private bucket for e-ticket files; only the server (service role) reads or writes it.
insert into storage.buckets (id, name, public) values ('tickets', 'tickets', false) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- _recount_pool v2: also tells admins when a pool first reaches its minimum (T4.1)
-- ---------------------------------------------------------------------------
create or replace function public._recount_pool(p_pool_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_pool   pools%rowtype;
  v_seats  int;
  v_party  record;
  v_new    pool_status;
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
    v_new := case when v_seats >= v_pool.min_seats then 'min_reached'::pool_status else 'open'::pool_status end;
    update pools set seats_filled = v_seats, status = v_new where id = p_pool_id;
    if v_pool.status = 'open' and v_new = 'min_reached' then
      insert into notifications (user_id, channel, subject)
      select id, 'email', format('Pool %s to %s on %s reached its minimum: ready for a fare request',
                                 v_pool.origin, v_pool.destination, v_pool.travel_date)
        from profiles where role = 'admin';
    end if;
  else
    update pools set seats_filled = v_seats where id = p_pool_id;
  end if;
  return v_seats;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._require_admin()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create or replace function public._audit(p_action text, p_pool_id uuid, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_action, 'pools', p_pool_id::text, p_before, p_after);
$$;

-- ---------------------------------------------------------------------------
-- send_rfq: freezes membership (unpaid holds and waitlist leave) and logs the request.
-- Can be sent again after a quote is rejected.
-- ---------------------------------------------------------------------------
create or replace function public.send_rfq(p_pool_id uuid, p_airline text, p_recipient_email text, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_admin  uuid := _require_admin();
  v_pool   pools%rowtype;
  v_seats  int;
  v_left   int := 0;
  v_id     uuid;
begin
  if coalesce(trim(p_airline), '') = '' then raise exception 'AIRLINE_REQUIRED'; end if;
  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status not in ('min_reached', 'rfq_sent') then raise exception 'NOT_READY_FOR_RFQ'; end if;

  if v_pool.status = 'min_reached' then
    insert into notifications (user_id, channel, subject)
    select distinct user_id, 'email', 'Your pool closed to new members before your place was confirmed'
      from pool_members where pool_id = p_pool_id and status in ('held', 'waitlisted');
    update pool_members set status = 'left', hold_expires_at = null
     where pool_id = p_pool_id and status in ('held', 'waitlisted');
    get diagnostics v_left = row_count;
    update payments set status = 'failed', failure_reason = 'POOL_FROZEN'
     where pool_id = p_pool_id and type = 'deposit' and status = 'created';
  end if;

  select count(*) into v_seats from pool_members where pool_id = p_pool_id and status = 'confirmed';
  if v_seats < v_pool.min_seats then raise exception 'BELOW_MINIMUM'; end if;

  update pools set status = 'rfq_sent', seats_filled = v_seats where id = p_pool_id;
  insert into rfqs (pool_id, airline, recipient_email, seats, target_fare_paise, message, sent_by)
  values (p_pool_id, trim(p_airline), nullif(trim(p_recipient_email), ''), v_seats, v_pool.target_fare_paise, p_message, v_admin)
  returning id into v_id;

  perform _audit('send_rfq', p_pool_id,
    jsonb_build_object('status', v_pool.status, 'seats', v_pool.seats_filled),
    jsonb_build_object('status', 'rfq_sent', 'seats', v_seats, 'airline', trim(p_airline), 'released_unconfirmed', v_left));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
create or replace function public.record_quote(
  p_pool_id uuid, p_airline text, p_fare_per_seat_paise bigint,
  p_valid_until timestamptz, p_name_deadline timestamptz, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_admin  uuid := _require_admin();
  v_pool   pools%rowtype;
  v_id     uuid;
begin
  if coalesce(trim(p_airline), '') = '' then raise exception 'AIRLINE_REQUIRED'; end if;
  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status not in ('rfq_sent', 'quoted') then raise exception 'NO_OPEN_RFQ'; end if;
  if p_fare_per_seat_paise < v_pool.deposit_paise then raise exception 'FARE_BELOW_DEPOSIT'; end if;
  if p_valid_until <= now() then raise exception 'QUOTE_EXPIRED'; end if;
  if p_name_deadline <= now() or p_name_deadline >= (v_pool.travel_date::timestamp at time zone 'Asia/Kolkata') then
    raise exception 'BAD_NAME_DEADLINE';
  end if;

  insert into quotes (pool_id, airline, fare_per_seat_paise, valid_until, name_deadline, seats, notes, status, created_by)
  values (p_pool_id, trim(p_airline), p_fare_per_seat_paise, p_valid_until, p_name_deadline, v_pool.seats_filled,
          nullif(trim(p_notes), ''), 'pending', v_admin)
  returning id into v_id;
  update pools set status = 'quoted' where id = p_pool_id;
  perform _audit('record_quote', p_pool_id, jsonb_build_object('status', v_pool.status),
    jsonb_build_object('status', 'quoted', 'quote_id', v_id, 'airline', trim(p_airline), 'fare_per_seat_paise', p_fare_per_seat_paise));
  return v_id;
end $$;

create or replace function public.reject_quote(p_quote_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_admin  uuid := _require_admin();
  v_q      quotes%rowtype;
  v_status pool_status;
begin
  select * into v_q from quotes where id = p_quote_id for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  perform 1 from pools where id = v_q.pool_id for update;
  if v_q.status <> 'pending' then raise exception 'QUOTE_NOT_PENDING'; end if;

  update quotes set status = 'rejected', decided_at = now(), decided_by = v_admin, reject_reason = nullif(trim(p_reason), '')
   where id = p_quote_id;
  select status into v_status from pools where id = v_q.pool_id;
  if v_status = 'quoted' and not exists (select 1 from quotes where pool_id = v_q.pool_id and status = 'pending') then
    update pools set status = 'rfq_sent' where id = v_q.pool_id;
  end if;
  perform _audit('reject_quote', v_q.pool_id, jsonb_build_object('quote_id', p_quote_id, 'status', 'pending'),
    jsonb_build_object('quote_id', p_quote_id, 'status', 'rejected', 'reason', p_reason));
end $$;

-- Accepting fixes the fare and asks every confirmed party for its balance (T4.3).
create or replace function public.accept_quote(p_quote_id uuid, p_balance_due_at timestamptz)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_admin   uuid := _require_admin();
  v_q       quotes%rowtype;
  v_pool    pools%rowtype;
  v_parties int;
begin
  select * into v_q from quotes where id = p_quote_id for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  select * into v_pool from pools where id = v_q.pool_id for update;
  if v_q.status <> 'pending' then raise exception 'QUOTE_NOT_PENDING'; end if;
  if v_q.valid_until <= now() then raise exception 'QUOTE_EXPIRED'; end if;
  if v_pool.status <> 'quoted' then raise exception 'NO_OPEN_RFQ'; end if;
  if p_balance_due_at <= now() or (v_q.name_deadline is not null and p_balance_due_at > v_q.name_deadline) then
    raise exception 'BAD_BALANCE_DEADLINE';
  end if;

  update quotes set status = 'accepted', decided_at = now(), decided_by = v_admin where id = p_quote_id;
  update quotes set status = 'rejected', decided_at = now(), decided_by = v_admin, reject_reason = 'Another quote was accepted'
   where pool_id = v_q.pool_id and status = 'pending';
  update pools
     set status = 'payment_due', final_fare_paise = v_q.fare_per_seat_paise,
         accepted_quote_id = p_quote_id, balance_due_at = p_balance_due_at
   where id = v_q.pool_id;

  insert into notifications (user_id, channel, subject)
  select distinct user_id, 'email', 'The airline confirmed your group fare: pay the balance to keep your seats'
    from pool_members where pool_id = v_q.pool_id and status = 'confirmed';
  select count(distinct party_id) into v_parties from pool_members where pool_id = v_q.pool_id and status = 'confirmed';

  perform _audit('accept_quote', v_q.pool_id, jsonb_build_object('status', v_pool.status),
    jsonb_build_object('status', 'payment_due', 'quote_id', p_quote_id, 'final_fare_paise', v_q.fare_per_seat_paise,
                       'balance_due_at', p_balance_due_at, 'parties', v_parties));
  return v_parties;
end $$;

-- ---------------------------------------------------------------------------
-- complete_payment v3: adds the fare balance
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
      return 'refund_required';
    end if;
    update pool_members set status = 'confirmed', hold_expires_at = null where party_id = v_pay.party_id and status = 'held';
    insert into notifications (user_id, channel, subject) values (v_pay.user_id, 'email', 'Deposit received: your seats are confirmed');
    return 'completed';
  end if;

  if v_pay.type = 'balance' then
    perform 1 from pools where id = v_pay.pool_id for update;
    if not exists (select 1 from pools where id = v_pay.pool_id and status = 'payment_due')
       or not exists (select 1 from pool_members where party_id = v_pay.party_id and status = 'confirmed') then
      return 'refund_required';
    end if;
    update pool_members set balance_paid_at = now() where party_id = v_pay.party_id and status = 'confirmed';
    insert into notifications (user_id, channel, subject) values (v_pay.user_id, 'email', 'Balance received: your fare is fully paid');
    return 'completed';
  end if;

  return 'completed';
end $$;

-- ---------------------------------------------------------------------------
-- submit_names: releases parties that didn't pay the balance (deposit kept, as the
-- terms say once the quote is accepted) and locks the passenger list.
-- ---------------------------------------------------------------------------
create or replace function public.submit_names(p_pool_id uuid, p_force boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_admin    uuid := _require_admin();
  v_pool     pools%rowtype;
  v_unpaid   int;
  v_released int := 0;
  v_seats    int;
begin
  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status <> 'payment_due' then raise exception 'NOT_PAYMENT_DUE'; end if;

  select count(*) into v_unpaid from pool_members
   where pool_id = p_pool_id and status = 'confirmed' and balance_paid_at is null;
  if v_unpaid > 0 and now() < v_pool.balance_due_at and not p_force then
    raise exception 'BALANCES_OUTSTANDING';
  end if;

  if v_unpaid > 0 then
    insert into notifications (user_id, channel, subject)
    select distinct user_id, 'email', 'Your balance wasn''t paid by the deadline, so your seats were released'
      from pool_members where pool_id = p_pool_id and status = 'confirmed' and balance_paid_at is null;
    update pool_members set status = 'left'
     where pool_id = p_pool_id and status = 'confirmed' and balance_paid_at is null;
    get diagnostics v_released = row_count;
    update payments set status = 'failed', failure_reason = 'NAMES_SUBMITTED'
     where pool_id = p_pool_id and type = 'balance' and status = 'created';
  end if;

  select count(*) into v_seats from pool_members where pool_id = p_pool_id and status = 'confirmed';
  if v_seats = 0 then raise exception 'NO_PAID_PASSENGERS'; end if;
  update pools set status = 'names_submitted', seats_filled = v_seats where id = p_pool_id;

  perform _audit('submit_names', p_pool_id, jsonb_build_object('status', v_pool.status, 'seats', v_pool.seats_filled),
    jsonb_build_object('status', 'names_submitted', 'seats', v_seats, 'released_unpaid', v_released, 'forced', p_force));
  return v_released;
end $$;

-- ---------------------------------------------------------------------------
-- Tickets (T4.5): one per passenger; when every passenger has one the pool is ticketed.
-- ---------------------------------------------------------------------------
create or replace function public.set_ticket(
  p_pool_id uuid, p_traveller_id uuid, p_pnr text, p_ticket_number text, p_file_path text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_admin  uuid := _require_admin();
  v_pool   pools%rowtype;
  v_member pool_members%rowtype;
  v_missing int;
begin
  if coalesce(p_pnr, '') !~ '^[A-Z0-9]{5,8}$' then raise exception 'BAD_PNR'; end if;
  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status not in ('names_submitted', 'ticketed') then raise exception 'NAMES_NOT_SUBMITTED'; end if;
  select * into v_member from pool_members where pool_id = p_pool_id and traveller_id = p_traveller_id and status = 'confirmed';
  if not found then raise exception 'NOT_A_PASSENGER'; end if;

  insert into tickets (pool_id, traveller_id, user_id, pnr, ticket_number, file_path, uploaded_by)
  values (p_pool_id, p_traveller_id, v_member.user_id, p_pnr, nullif(trim(p_ticket_number), ''), p_file_path, v_admin)
  on conflict (pool_id, traveller_id) do update
    set pnr = excluded.pnr,
        ticket_number = coalesce(excluded.ticket_number, tickets.ticket_number),
        file_path = coalesce(excluded.file_path, tickets.file_path),
        uploaded_by = excluded.uploaded_by,
        updated_at = now();

  insert into notifications (user_id, channel, subject) values (v_member.user_id, 'email', 'Your e-ticket is ready');
  perform _audit('set_ticket', p_pool_id, null,
    jsonb_build_object('traveller_id', p_traveller_id, 'pnr', p_pnr, 'has_file', p_file_path is not null));

  select count(*) into v_missing from pool_members m
   where m.pool_id = p_pool_id and m.status = 'confirmed'
     and not exists (select 1 from tickets t where t.pool_id = p_pool_id and t.traveller_id = m.traveller_id);
  if v_missing = 0 and v_pool.status = 'names_submitted' then
    update pools set status = 'ticketed' where id = p_pool_id;
    perform _audit('ticketed', p_pool_id, jsonb_build_object('status', 'names_submitted'), jsonb_build_object('status', 'ticketed'));
    return 'ticketed';
  end if;
  return 'saved';
end $$;

create or replace function public.mark_completed(p_pool_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := _require_admin(); v_pool pools%rowtype;
begin
  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status <> 'ticketed' then raise exception 'NOT_TICKETED'; end if;
  if v_pool.travel_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'NOT_TRAVELLED_YET'; end if;
  update pools set status = 'completed' where id = p_pool_id;
  perform _audit('mark_completed', p_pool_id, jsonb_build_object('status', 'ticketed'), jsonb_build_object('status', 'completed'));
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke all on function public._require_admin() from public, anon, authenticated;
revoke all on function public._audit(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.complete_payment(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.complete_payment(uuid, text, bigint) to service_role;

revoke all on function public.send_rfq(uuid, text, text, text) from public, anon;
revoke all on function public.record_quote(uuid, text, bigint, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.reject_quote(uuid, text) from public, anon;
revoke all on function public.accept_quote(uuid, timestamptz) from public, anon;
revoke all on function public.submit_names(uuid, boolean) from public, anon;
revoke all on function public.set_ticket(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.mark_completed(uuid) from public, anon;
grant execute on function public.send_rfq(uuid, text, text, text) to authenticated;
grant execute on function public.record_quote(uuid, text, bigint, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.reject_quote(uuid, text) to authenticated;
grant execute on function public.accept_quote(uuid, timestamptz) to authenticated;
grant execute on function public.submit_names(uuid, boolean) to authenticated;
grant execute on function public.set_ticket(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.mark_completed(uuid) to authenticated;

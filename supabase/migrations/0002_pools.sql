-- GroupFly Phase 2: festival search and pools.
-- Run after 0001_init.sql. Seat changes happen ONLY through the functions below,
-- which lock the pool row (SELECT ... FOR UPDATE) so two people can never take the last seat.

-- ---------------------------------------------------------------------------
-- Route catalogue
-- ---------------------------------------------------------------------------
create table public.airports (
  code    char(3) primary key check (code ~ '^[A-Z]{3}$'),
  city    text not null,
  name    text not null,
  active  boolean not null default true
);
alter table public.airports enable row level security;
create policy "airports: public read" on public.airports for select using (true);
create policy "airports: admin write" on public.airports for all
  using (public.is_admin()) with check (public.is_admin());

-- "Tell me when a pool opens" alerts from empty searches.
create table public.pool_alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  origin       char(3) not null,
  destination  char(3) not null,
  travel_date  date not null,
  created_at   timestamptz not null default now(),
  unique (user_id, origin, destination, travel_date)
);
alter table public.pool_alerts enable row level security;
create policy "pool_alerts: own rows" on public.pool_alerts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "pool_alerts: admin read" on public.pool_alerts for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Pool membership: a "party" is everyone one user added in one join.
-- ---------------------------------------------------------------------------
alter table public.pool_members add column party_id uuid not null default gen_random_uuid();
create index pool_members_pool_status_idx on public.pool_members (pool_id, status, joined_at);
create index pool_members_user_idx on public.pool_members (user_id);

-- Members can always see the pools they are in (including private ones).
create policy "pools: members read" on public.pools for select using (
  exists (
    select 1 from public.pool_members m
    where m.pool_id = pools.id and m.user_id = auth.uid() and m.status <> 'left'
  )
);

-- ---------------------------------------------------------------------------
-- create_pool: admins create public or private pools; organisers create private pools.
-- ---------------------------------------------------------------------------
create or replace function public.create_pool(
  p_festival_id        uuid,
  p_origin             text,
  p_destination        text,
  p_travel_date        date,
  p_time_window        public.time_window,
  p_min_seats          int,
  p_max_seats          int,
  p_cut_off_at         timestamptz,
  p_market_fare_paise  bigint,
  p_target_fare_paise  bigint,
  p_is_private         boolean,
  p_flight_id          uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.user_role;
  v_id    uuid;
  v_code  text;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  select role into v_role from profiles where id = v_uid;
  if v_role is null or v_role not in ('organiser', 'admin') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_role <> 'admin' and not p_is_private then
    raise exception 'ORGANISER_PRIVATE_ONLY' using errcode = '42501';
  end if;

  p_origin := upper(p_origin);
  p_destination := upper(p_destination);
  if p_origin = p_destination then raise exception 'SAME_AIRPORT'; end if;
  if (select count(*) from airports where code in (p_origin, p_destination) and active) <> 2 then
    raise exception 'UNKNOWN_AIRPORT';
  end if;
  if p_travel_date <= (now() at time zone 'Asia/Kolkata')::date then raise exception 'DATE_IN_PAST'; end if;
  if p_cut_off_at <= now() then raise exception 'CUT_OFF_IN_PAST'; end if;
  if p_cut_off_at >= (p_travel_date::timestamp at time zone 'Asia/Kolkata') then
    raise exception 'CUT_OFF_AFTER_TRAVEL';
  end if;
  if p_min_seats < 10 or p_max_seats > 60 or p_min_seats > p_max_seats then
    raise exception 'BAD_SEAT_LIMITS';
  end if;

  if p_is_private then
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
  end if;

  insert into pools (
    festival_id, flight_id, origin, destination, travel_date, time_window, min_seats, max_seats,
    seats_filled, cut_off_at, status, market_fare_paise, target_fare_paise, is_private, invite_code, created_by
  ) values (
    p_festival_id, p_flight_id, p_origin, p_destination, p_travel_date, p_time_window, p_min_seats, p_max_seats,
    0, p_cut_off_at, 'open', p_market_fare_paise, p_target_fare_paise, p_is_private, v_code, v_uid
  ) returning id into v_id;

  insert into audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'create_pool', 'pools', v_id::text,
          jsonb_build_object('origin', p_origin, 'destination', p_destination, 'date', p_travel_date, 'private', p_is_private));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- join_pool: whole party gets seats (held) or the whole party is waitlisted.
-- ---------------------------------------------------------------------------
create or replace function public.join_pool(
  p_pool_id        uuid,
  p_traveller_ids  uuid[],
  p_invite_code    text default null
) returns table (r_member_status public.member_status, r_seats_filled int, r_pool_status public.pool_status)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_pool    pools%rowtype;
  v_n       int := coalesce(array_length(p_traveller_ids, 1), 0);
  v_owned   int;
  v_party   uuid := gen_random_uuid();
  v_status  public.member_status;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if v_n = 0 then raise exception 'NO_TRAVELLERS'; end if;
  if v_n > 9 then raise exception 'PARTY_TOO_LARGE'; end if;
  if (select count(distinct t) from unnest(p_traveller_ids) as t) <> v_n then
    raise exception 'DUPLICATE_TRAVELLER';
  end if;

  -- Lock the pool row: concurrent joins for this pool now run one at a time.
  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;

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

  insert into pool_members (pool_id, user_id, traveller_id, status, party_id, joined_at)
  select p_pool_id, v_uid, t, v_status, v_party, clock_timestamp() from unnest(p_traveller_ids) as t
  on conflict (pool_id, traveller_id) do update
    set status = excluded.status, party_id = excluded.party_id,
        joined_at = excluded.joined_at, user_id = excluded.user_id;

  if v_status = 'held' then
    v_pool.seats_filled := v_pool.seats_filled + v_n;
    if v_pool.status = 'open' and v_pool.seats_filled >= v_pool.min_seats then
      v_pool.status := 'min_reached';
    end if;
    update pools set seats_filled = v_pool.seats_filled, status = v_pool.status where id = p_pool_id;
  end if;

  return query select v_status, v_pool.seats_filled, v_pool.status;
end $$;

-- ---------------------------------------------------------------------------
-- leave_pool: frees the user's seats and moves waitlisted parties up, oldest first.
-- A party is promoted only if all of it fits (families aren't split).
-- ---------------------------------------------------------------------------
create or replace function public.leave_pool(p_pool_id uuid)
returns table (r_seats_filled int, r_promoted int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_pool      pools%rowtype;
  v_freed     int;
  v_total     int;
  v_seats     int;
  v_promoted  int := 0;
  v_party     record;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;

  select * into v_pool from pools where id = p_pool_id for update;
  if not found then raise exception 'POOL_NOT_FOUND'; end if;
  if v_pool.status not in ('open', 'min_reached') then raise exception 'POOL_LOCKED'; end if;
  if now() >= v_pool.cut_off_at then raise exception 'CUT_OFF_PASSED'; end if;

  select count(*) filter (where status in ('held', 'confirmed')), count(*)
    into v_freed, v_total
    from pool_members where pool_id = p_pool_id and user_id = v_uid and status <> 'left';
  if v_total = 0 then raise exception 'NOT_A_MEMBER'; end if;

  update pool_members set status = 'left'
   where pool_id = p_pool_id and user_id = v_uid and status <> 'left';

  v_seats := v_pool.seats_filled - v_freed;

  for v_party in
    select party_id, count(*)::int as n, (array_agg(user_id))[1] as owner
      from pool_members
     where pool_id = p_pool_id and status = 'waitlisted'
     group by party_id
     order by min(joined_at)
  loop
    if v_seats + v_party.n <= v_pool.max_seats then
      update pool_members set status = 'held'
       where pool_id = p_pool_id and party_id = v_party.party_id and status = 'waitlisted';
      v_seats := v_seats + v_party.n;
      v_promoted := v_promoted + v_party.n;
      insert into notifications (user_id, channel, subject)
      values (v_party.owner, 'email', 'Seats opened up in your GroupFly pool');
    end if;
  end loop;

  update pools
     set seats_filled = v_seats,
         status = case when v_seats >= min_seats then 'min_reached'::pool_status else 'open'::pool_status end
   where id = p_pool_id;

  return query select v_seats, v_promoted;
end $$;

-- ---------------------------------------------------------------------------
-- get_invited_pool: lets someone with the invite link see a private pool before joining.
-- ---------------------------------------------------------------------------
create or replace function public.get_invited_pool(p_pool_id uuid, p_invite_code text)
returns setof public.pools
language sql stable security definer set search_path = public as $$
  select * from pools
   where id = p_pool_id and is_private and invite_code = upper(p_invite_code);
$$;

-- Only signed-in users may call the write functions.
revoke all on function public.create_pool(uuid, text, text, date, public.time_window, int, int, timestamptz, bigint, bigint, boolean, uuid) from public, anon;
revoke all on function public.join_pool(uuid, uuid[], text) from public, anon;
revoke all on function public.leave_pool(uuid) from public, anon;
grant execute on function public.create_pool(uuid, text, text, date, public.time_window, int, int, timestamptz, bigint, bigint, boolean, uuid) to authenticated;
grant execute on function public.join_pool(uuid, uuid[], text) to authenticated;
grant execute on function public.leave_pool(uuid) to authenticated;
grant execute on function public.get_invited_pool(uuid, text) to anon, authenticated;

-- Live seat counter: stream pool row changes to the browser (Supabase Realtime respects RLS).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pools;
  end if;
end $$;

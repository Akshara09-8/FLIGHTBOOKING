-- GroupFly schema v1 (Phase 1).
-- Run once in the Supabase SQL editor, or with `supabase db push`.
-- Money is stored as integer paise. Every table has row-level security (RLS) on.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('passenger', 'subscriber', 'organiser', 'admin');
create type public.gender as enum ('female', 'male', 'other', 'undisclosed');
create type public.pool_status as enum (
  'draft', 'open', 'min_reached', 'rfq_sent', 'quoted', 'payment_due',
  'names_submitted', 'ticketed', 'completed', 'dissolved'
);
create type public.time_window as enum ('morning', 'afternoon', 'evening', 'night');
create type public.member_status as enum ('held', 'confirmed', 'waitlisted', 'left');
create type public.subscription_status as enum ('active', 'expired', 'cancelled');
create type public.payment_type as enum ('subscription', 'deposit', 'balance', 'refund');
create type public.payment_status as enum ('created', 'succeeded', 'failed', 'refunded');
create type public.quote_status as enum ('pending', 'accepted', 'rejected', 'expired');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text check (full_name is null or char_length(full_name) between 2 and 100),
  phone       text check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  role        public.user_role not null default 'passenger',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- SECURITY DEFINER so RLS policies can call it without recursing into profiles' own policies.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- New sign-up -> profile row (role defaults to passenger).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), '')
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Signed-in users cannot change their own role or email through the API.
-- (Admins can; the SQL editor / service role has no auth.uid() and is also allowed.)
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change roles' using errcode = '42501';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Email is managed by sign-in' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_protect_columns before update on public.profiles
  for each row execute function public.protect_profile_columns();

create table public.travellers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  full_name_as_on_id  text not null check (char_length(full_name_as_on_id) between 2 and 100),
  date_of_birth       date not null check (date_of_birth >= date '1900-01-01'),
  gender              public.gender not null,
  is_self             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index travellers_user_id_idx on public.travellers (user_id);
create unique index travellers_one_self_per_user on public.travellers (user_id) where is_self;
create trigger travellers_updated_at before update on public.travellers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalogue (admin-managed, readable by everyone)
-- ---------------------------------------------------------------------------
create table public.festivals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  region      text,
  check (end_date >= start_date)
);

create table public.flights (
  id           uuid primary key default gen_random_uuid(),
  airline      text not null,
  flight_no    text not null,
  origin       char(3) not null,
  destination  char(3) not null,
  departs_at   timestamptz not null,
  arrives_at   timestamptz not null,
  check (arrives_at > departs_at),
  check (origin <> destination)
);
create index flights_route_idx on public.flights (origin, destination, departs_at);

create table public.pools (
  id                 uuid primary key default gen_random_uuid(),
  festival_id        uuid references public.festivals (id),
  flight_id          uuid references public.flights (id),
  origin             char(3) not null,
  destination        char(3) not null,
  travel_date        date not null,
  time_window        public.time_window not null,
  min_seats          int not null default 30 check (min_seats > 0),
  max_seats          int not null default 40 check (max_seats >= min_seats),
  seats_filled       int not null default 0 check (seats_filled >= 0),
  cut_off_at         timestamptz not null,
  status             public.pool_status not null default 'draft',
  market_fare_paise  bigint check (market_fare_paise >= 0),
  target_fare_paise  bigint check (target_fare_paise >= 0),
  is_private         boolean not null default false,
  invite_code        text unique,
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  check (seats_filled <= max_seats)
);
create index pools_search_idx on public.pools (origin, destination, travel_date, time_window);

-- ---------------------------------------------------------------------------
-- Booking tables (logic arrives in Phases 2-4; RLS set now)
-- ---------------------------------------------------------------------------
create table public.pool_members (
  id            uuid primary key default gen_random_uuid(),
  pool_id       uuid not null references public.pools (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  traveller_id  uuid not null references public.travellers (id),
  status        public.member_status not null default 'held',
  joined_at     timestamptz not null default now(),
  unique (pool_id, traveller_id)
);

create table public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  plan         text not null,
  status       public.subscription_status not null default 'active',
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  gateway_ref  text
);

create table public.quotes (
  id                   uuid primary key default gen_random_uuid(),
  pool_id              uuid not null references public.pools (id) on delete cascade,
  airline              text not null,
  fare_per_seat_paise  bigint not null check (fare_per_seat_paise >= 0),
  deposit_pct          numeric(5,2) check (deposit_pct between 0 and 100),
  name_deadline        timestamptz,
  valid_until          timestamptz,
  status               public.quote_status not null default 'pending',
  created_at           timestamptz not null default now()
);

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id),
  pool_id          uuid references public.pools (id),
  type             public.payment_type not null,
  amount_paise     bigint not null check (amount_paise >= 0),
  status           public.payment_status not null default 'created',
  gateway_ref      text,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);

create table public.tickets (
  id            uuid primary key default gen_random_uuid(),
  pool_id       uuid not null references public.pools (id),
  traveller_id  uuid not null references public.travellers (id),
  user_id       uuid not null references public.profiles (id),
  pnr           text,
  file_path     text,
  created_at    timestamptz not null default now()
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  channel     text not null check (channel in ('email', 'sms', 'whatsapp')),
  subject     text,
  status      text not null default 'queued',
  created_at  timestamptz not null default now()
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id),
  action      text not null,
  entity      text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.travellers    enable row level security;
alter table public.festivals     enable row level security;
alter table public.flights       enable row level security;
alter table public.pools         enable row level security;
alter table public.pool_members  enable row level security;
alter table public.subscriptions enable row level security;
alter table public.quotes        enable row level security;
alter table public.payments      enable row level security;
alter table public.tickets       enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log     enable row level security;

-- profiles: own row, or admin. No client inserts/deletes (trigger creates rows).
create policy "profiles: read own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles: update own or admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- travellers: owner has full control; admin can read.
create policy "travellers: read own or admin" on public.travellers
  for select using (user_id = auth.uid() or public.is_admin());
create policy "travellers: insert own" on public.travellers
  for insert with check (user_id = auth.uid());
create policy "travellers: update own" on public.travellers
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "travellers: delete own" on public.travellers
  for delete using (user_id = auth.uid());

-- catalogue: anyone reads; admins write.
create policy "festivals: public read" on public.festivals for select using (true);
create policy "festivals: admin write" on public.festivals for all
  using (public.is_admin()) with check (public.is_admin());
create policy "flights: public read" on public.flights for select using (true);
create policy "flights: admin write" on public.flights for all
  using (public.is_admin()) with check (public.is_admin());
create policy "pools: read public pools" on public.pools
  for select using (not is_private or created_by = auth.uid() or public.is_admin());
create policy "pools: admin write" on public.pools for all
  using (public.is_admin()) with check (public.is_admin());

-- booking tables: users read their own rows; writes go through server code in later phases.
create policy "pool_members: read own or admin" on public.pool_members
  for select using (user_id = auth.uid() or public.is_admin());
create policy "subscriptions: read own or admin" on public.subscriptions
  for select using (user_id = auth.uid() or public.is_admin());
create policy "payments: read own or admin" on public.payments
  for select using (user_id = auth.uid() or public.is_admin());
create policy "tickets: read own or admin" on public.tickets
  for select using (user_id = auth.uid() or public.is_admin());
create policy "notifications: read own or admin" on public.notifications
  for select using (user_id = auth.uid() or public.is_admin());
create policy "quotes: admin only" on public.quotes for all
  using (public.is_admin()) with check (public.is_admin());
create policy "audit_log: admin read" on public.audit_log
  for select using (public.is_admin());
create policy "audit_log: admin writes own entries" on public.audit_log
  for insert with check (public.is_admin() and actor_id = auth.uid());

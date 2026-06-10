-- LACC Sign-In — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query) once.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per person. Linked to an auth user when they log in on their phone.
-- Members can also exist kiosk-only (user_id null) and be claimed later.
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users (id) on delete set null,
  full_name   text not null,
  role        text not null default 'member',     -- 'member' | 'admin'
  pin         text,                                -- optional 4-digit PIN for kiosk tap-in
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Clock in / clock out records. An "open" shift has signed_out_at = null.
create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members (id) on delete cascade,
  signed_in_at  timestamptz not null default now(),
  signed_out_at timestamptz,
  source        text not null default 'phone',     -- 'phone' | 'kiosk'
  created_at    timestamptz not null default now()
);

-- At most one open shift per member.
create unique index if not exists shifts_one_open_per_member
  on public.shifts (member_id)
  where signed_out_at is null;

create index if not exists shifts_member_idx on public.shifts (member_id);

-- ---------------------------------------------------------------------------
-- Auto-create a member row when someone signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.members (user_id, full_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
--   Phone flow runs as the logged-in user (RLS enforced below).
--   Kiosk flow runs server-side with the service-role key (bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.members enable row level security;
alter table public.shifts  enable row level security;

-- Members can read and update their own profile.
drop policy if exists "members read own" on public.members;
create policy "members read own"
  on public.members for select
  using (user_id = auth.uid());

drop policy if exists "members update own" on public.members;
create policy "members update own"
  on public.members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Members can read / create / close their own shifts.
drop policy if exists "shifts read own" on public.shifts;
create policy "shifts read own"
  on public.shifts for select
  using (member_id in (select id from public.members where user_id = auth.uid()));

drop policy if exists "shifts insert own" on public.shifts;
create policy "shifts insert own"
  on public.shifts for insert
  with check (member_id in (select id from public.members where user_id = auth.uid()));

drop policy if exists "shifts update own" on public.shifts;
create policy "shifts update own"
  on public.shifts for update
  using (member_id in (select id from public.members where user_id = auth.uid()))
  with check (member_id in (select id from public.members where user_id = auth.uid()));

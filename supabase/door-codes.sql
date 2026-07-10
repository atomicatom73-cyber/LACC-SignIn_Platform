-- Door codes — standalone, idempotent migration.
-- Safe to run in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Relies on the is_officer() / my_role() helpers already defined by schema.sql.

create table if not exists public.door_codes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  code       text not null,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists door_codes_created_idx on public.door_codes (created_at);

alter table public.door_codes enable row level security;

-- Read: any officer, or any *active* member (deactivated members excluded).
drop policy if exists "door codes read active members" on public.door_codes;
create policy "door codes read active members"
  on public.door_codes for select
  using (
    public.is_officer()
    or exists (
      select 1 from public.members m
      where m.user_id = auth.uid() and m.active
    )
  );

-- Manage: president / vice president only.
drop policy if exists "door codes manage admins" on public.door_codes;
create policy "door codes manage admins"
  on public.door_codes for all
  using (public.my_role() in ('president', 'vice_president'))
  with check (public.my_role() in ('president', 'vice_president'));

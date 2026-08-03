-- 2026-08-03 — Sign-in conflicts: queued taps whose direction the studio's
-- record contradicts.
--
-- A device that is offline cannot know what happened on any other device. Its
-- cards are as old as the last time it had signal, so someone can walk up to an
-- offline tablet reading "Tap to sign in" when they signed in on their phone
-- hours ago and only want to go home. The tablet queues a sign-*in*.
--
-- Guessing what they meant would write fiction into the log sheet, so the sync
-- refuses to apply a tap the database contradicts and files it here instead.
-- An officer sees it on /officer/logs and fixes the day by hand. The log sheet
-- is left alone until they do.
--
-- Run in the Supabase SQL Editor (Dashboard → SQL → New query). Idempotent.
-- The same statements are folded into supabase/schema.sql for fresh projects.
-- Apply this BEFORE deploying the code that writes to it — the sync treats a
-- missing table as "couldn't file it" and keeps the tap queued rather than
-- dropping it, but nobody sees the conflict until the table exists.

create table if not exists public.signin_conflicts (
  id          uuid primary key default gen_random_uuid(),
  -- Null once the member is deleted; member_name keeps the row readable.
  member_id   uuid references public.members (id) on delete set null,
  member_name text not null,
  -- 'shift-in' or 'shift-out' — the direction the device queued.
  kind        text not null,
  -- The moment of the tap, not the moment it synced. This is the time an
  -- officer needs in order to correct the day.
  tapped_at   timestamptz not null,
  -- 'kiosk' or 'phone', so the officer knows which device to trust.
  via         text not null,
  -- A finished sentence for the officer: what was tapped, what the record said.
  reason      text not null,
  -- The queued event's id. Unique, so replaying the same event after a lost
  -- response can never file the same conflict twice.
  event_id    uuid not null,
  resolved_at timestamptz,
  resolved_by uuid references public.members (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.signin_conflicts
  drop constraint if exists signin_conflicts_kind_check;
alter table public.signin_conflicts add constraint signin_conflicts_kind_check
  check (kind in ('shift-in', 'shift-out'));

create unique index if not exists signin_conflicts_event_idx
  on public.signin_conflicts (event_id);

-- The officer page's query: anything still open, newest tap first.
create index if not exists signin_conflicts_open_idx
  on public.signin_conflicts (tapped_at desc)
  where resolved_at is null;

-- Officers holding the sign-in-logs permission can see and clear these. The
-- sync writes them with the service role, which bypasses RLS entirely — no
-- insert policy is needed or wanted (nothing client-side may file one).
alter table public.signin_conflicts enable row level security;

drop policy if exists "signin conflicts read" on public.signin_conflicts;
create policy "signin conflicts read"
  on public.signin_conflicts for select
  using (public.has_permission('logs'));

drop policy if exists "signin conflicts resolve" on public.signin_conflicts;
create policy "signin conflicts resolve"
  on public.signin_conflicts for update
  using (public.has_permission('logs'))
  with check (public.has_permission('logs'));

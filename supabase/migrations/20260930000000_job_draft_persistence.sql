-- 2026-09-30 — Penciled job drafts that survive leaving the app.
--
-- Until now the monthly draft lived only in the coordinator's browser: moving
-- a name, then closing the tab or switching months, threw the whole thing away
-- and the next "Draft assignments" re-ran the algorithm from scratch. And a
-- date/time could only be set on a real assignment, so laying out open-studio
-- sessions meant assigning members first — which emails them immediately.
--
-- Two tables fix both: a draft is saved server-side as it's edited, carries a
-- date/time per penciled name (with or without a name yet), and tells nobody
-- until an officer publishes it.
--
-- Run in the Supabase SQL Editor (Dashboard → SQL → New query). Idempotent.
-- The same statements are folded into supabase/schema.sql for fresh projects.

-- ---------------------------------------------------------------------------
-- 1. The draft itself — one per month, shared by every officer with the jobs
--    permission. The row existing IS the draft being open, so a draft that's
--    been emptied out still reopens empty instead of silently re-running the
--    algorithm. `updated_by`/`updated_at` drive the "saved 2:14pm by Vicki"
--    stamp, so two officers editing can see each other's work.
-- ---------------------------------------------------------------------------

create table if not exists public.chore_drafts (
  month      date primary key,
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. One penciled line: a job, optionally a member, optionally when.
--
--    member_id null = a slot with a time but nobody on it yet ("Oct 3, 10am —
--    TBD"), so open-studio sessions can be laid out before names are known.
--    scheduled_at null = penciled in with no time yet. Either may come first.
--
--    Deleting the draft row takes its entries with it, so discarding or
--    publishing a month leaves nothing behind.
-- ---------------------------------------------------------------------------

create table if not exists public.chore_draft_entries (
  id           uuid primary key default gen_random_uuid(),
  month        date not null references public.chore_drafts (month) on delete cascade,
  chore_id     uuid not null references public.chores (id) on delete cascade,
  member_id    uuid references public.members (id) on delete cascade,
  scheduled_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Nobody is penciled onto the same job twice in a month. Partial, so any
-- number of unnamed slots can sit on one job.
create unique index if not exists chore_draft_entries_member_uniq
  on public.chore_draft_entries (month, chore_id, member_id)
  where member_id is not null;

create index if not exists chore_draft_entries_month_idx
  on public.chore_draft_entries (month);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — officers only, on both tables.
--
--    Members have no read policy at all, which is the point: a penciled name
--    must not reach /me (or anywhere else) before it's published. The jobs
--    permission is what lets an officer edit one.
-- ---------------------------------------------------------------------------

alter table public.chore_drafts        enable row level security;
alter table public.chore_draft_entries enable row level security;

drop policy if exists "job drafts read officers" on public.chore_drafts;
create policy "job drafts read officers"
  on public.chore_drafts for select
  using (public.is_officer());

drop policy if exists "job drafts manage officers" on public.chore_drafts;
create policy "job drafts manage officers"
  on public.chore_drafts for all
  using (public.has_permission('jobs'))
  with check (public.has_permission('jobs'));

drop policy if exists "job draft entries read officers" on public.chore_draft_entries;
create policy "job draft entries read officers"
  on public.chore_draft_entries for select
  using (public.is_officer());

drop policy if exists "job draft entries manage officers" on public.chore_draft_entries;
create policy "job draft entries manage officers"
  on public.chore_draft_entries for all
  using (public.has_permission('jobs'))
  with check (public.has_permission('jobs'));

-- ---------------------------------------------------------------------------
-- 4. Every edit stamps the draft, so the "last saved" line is never stale and
--    no server action has to remember to touch two tables.
-- ---------------------------------------------------------------------------

create or replace function public.touch_chore_draft()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target date := coalesce(new.month, old.month);
begin
  update public.chore_drafts
     set updated_at = now(),
         updated_by = coalesce(public.my_member_id(), updated_by)
   where month = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists chore_draft_entries_touch on public.chore_draft_entries;
create trigger chore_draft_entries_touch
  after insert or update or delete on public.chore_draft_entries
  for each row execute function public.touch_chore_draft();

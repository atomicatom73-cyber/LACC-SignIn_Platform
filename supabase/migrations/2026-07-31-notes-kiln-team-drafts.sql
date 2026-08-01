-- 2026-07-31 — Member job notes, kiln team status, message drafts/scheduling.
--
-- Three additions, all idempotent (safe to re-run):
--   1. public.job_notes — a member's note to the volunteer coordinator, either
--      hung off a job they hold or standing on its own.
--   2. members.kiln_team — sits out the job draft, and a message audience.
--   3. public.message_drafts — saved drafts and scheduled sends, private to
--      the officer account that wrote them.
--
-- Run in the Supabase SQL Editor (Dashboard → SQL → New query). The same
-- statements are folded into supabase/schema.sql for fresh projects.

-- ---------------------------------------------------------------------------
-- 1. Job notes
-- ---------------------------------------------------------------------------

-- A note a member leaves for the volunteer coordinator: "the shelf brackets
-- are cracked", "I'm away in August, can I swap?". `assignment_id` and
-- `chore_id` are set when the note came off a specific job and stay null for a
-- standalone note. Both are `on delete set null` so republishing a month (which
-- deletes and recreates assignments) never destroys what someone wrote —
-- chore_id keeps the job's name readable after the assignment is gone.
create table if not exists public.job_notes (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members (id) on delete cascade,
  assignment_id uuid references public.chore_assignments (id) on delete set null,
  chore_id      uuid references public.chores (id) on delete set null,
  body          text not null,
  -- Null until the coordinator clears it off their dashboard.
  handled_at    timestamptz,
  handled_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The dashboard's query: open notes, newest first.
create index if not exists job_notes_open_idx
  on public.job_notes (created_at desc)
  where handled_at is null;

create index if not exists job_notes_member_idx
  on public.job_notes (member_id, created_at desc);

create index if not exists job_notes_assignment_idx
  on public.job_notes (assignment_id)
  where assignment_id is not null;

-- Is the logged-in user the volunteer coordinator? Covers both the classic
-- shared login (role = 'volunteer_coordinator') and a president-created custom
-- officer account titled "Volunteer Coordinator" — otherwise a studio that
-- runs the job with a custom account would never see a single note. Mirrors
-- isVolunteerCoordinator in src/lib/roles.ts — keep the two in sync.
create or replace function public.is_volunteer_coordinator()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select m.role = 'volunteer_coordinator'
         or (m.role = 'officer'
             and lower(trim(coalesce(m.officer_title, ''))) = 'volunteer coordinator')
     from public.members m
     where m.user_id = auth.uid()),
    false
  );
$$;

-- Notes are deliberately NOT visible to the president or the other officers —
-- the studio wanted a private line to the coordinator. Authors can see (and
-- edit) their own until it's handled.
alter table public.job_notes enable row level security;

drop policy if exists "job notes read own or coordinator" on public.job_notes;
create policy "job notes read own or coordinator"
  on public.job_notes for select
  using (member_id = public.my_member_id() or public.is_volunteer_coordinator());

drop policy if exists "job notes insert own" on public.job_notes;
create policy "job notes insert own"
  on public.job_notes for insert
  with check (member_id = public.my_member_id());

-- The author may reword an unhandled note; the coordinator may mark any note
-- handled. Column-level guard lives in protect_job_note_update below.
drop policy if exists "job notes update own or coordinator" on public.job_notes;
create policy "job notes update own or coordinator"
  on public.job_notes for update
  using (
    (member_id = public.my_member_id() and handled_at is null)
    or public.is_volunteer_coordinator()
  )
  with check (
    member_id = public.my_member_id() or public.is_volunteer_coordinator()
  );

drop policy if exists "job notes delete own or coordinator" on public.job_notes;
create policy "job notes delete own or coordinator"
  on public.job_notes for delete
  using (member_id = public.my_member_id() or public.is_volunteer_coordinator());

-- Authors edit their wording and nothing else — without this, a member could
-- mark their own note handled and quietly take it off the coordinator's
-- dashboard, or re-point it at someone else's job.
create or replace function public.protect_job_note_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_volunteer_coordinator() then
    if new.handled_at    is distinct from old.handled_at
    or new.handled_by    is distinct from old.handled_by
    or new.member_id     is distinct from old.member_id
    or new.assignment_id is distinct from old.assignment_id
    or new.chore_id      is distinct from old.chore_id then
      raise exception 'Only the volunteer coordinator can file a note.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_notes_protect on public.job_notes;
create trigger job_notes_protect
  before update on public.job_notes
  for each row execute function public.protect_job_note_update();

-- ---------------------------------------------------------------------------
-- 2. Kiln team
-- ---------------------------------------------------------------------------

-- Kiln team members sit out the monthly job draft (their kiln work *is* their
-- contribution) and can be messaged as a group. Independent of officer status
-- and of active/inactive — someone can be both. Set by any officer holding the
-- 'members' permission, written server-side with the service role (see the
-- guard trigger below), and never mirrored to the roster Google Sheet.
alter table public.members
  add column if not exists kiln_team boolean not null default false;

-- Same shape as protect_role_change, extended to kiln_team: a member must not
-- be able to exempt themselves from jobs by updating their own row.
create or replace function public.protect_role_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
  or new.officer_title is distinct from old.officer_title
  or new.officer_status is distinct from old.officer_status
  or new.kiln_team is distinct from old.kiln_team
  or new.permissions is distinct from old.permissions then
    if auth.uid() is not null then
      raise exception 'Roles and permissions are managed by the president.';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Message drafts and scheduled sends
-- ---------------------------------------------------------------------------

-- Announcements now support 'kiln_team' as an audience, and remember whether
-- the officer hand-edited the group's recipient list before sending.
alter table public.messages drop constraint if exists messages_audience_check;
alter table public.messages add constraint messages_audience_check
  check (audience in ('all', 'selected', 'active', 'inactive', 'everyone', 'kiln_team'));

alter table public.messages
  add column if not exists audience_edited boolean not null default false;

-- Unsent work: a saved draft (scheduled_for null) or a scheduled send. Kept
-- out of public.messages entirely so an unsent announcement can never surface
-- in anyone's inbox. `recipient_ids` is null while the draft simply means
-- "whoever is in the audience group at send time", and holds the explicit list
-- once the officer edits it by hand.
create table if not exists public.message_drafts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.members (id) on delete cascade,
  subject       text not null default '',
  body          text not null default '',
  audience      text not null default 'active',
  recipient_ids uuid[],
  -- Drives the "Active members · edited" label once it sends.
  edited        boolean not null default false,
  -- Null = plain draft; a timestamp = send it at or after this moment.
  scheduled_for timestamptz,
  -- Set by the flush once it goes out; the row is kept as an audit crumb.
  sent_at       timestamptz,
  message_id    uuid references public.messages (id) on delete set null,
  -- Last failure from the flush, so a scheduled send can't fail silently.
  send_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.message_drafts drop constraint if exists message_drafts_audience_check;
alter table public.message_drafts add constraint message_drafts_audience_check
  check (audience in ('active', 'inactive', 'everyone', 'selected', 'kiln_team'));

-- The flush's query: anything due and not yet sent.
create index if not exists message_drafts_due_idx
  on public.message_drafts (scheduled_for)
  where sent_at is null and scheduled_for is not null;

create index if not exists message_drafts_author_idx
  on public.message_drafts (author_id, updated_at desc);

create or replace function public.touch_message_draft()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists message_drafts_touch on public.message_drafts;
create trigger message_drafts_touch
  before update on public.message_drafts
  for each row execute function public.touch_message_draft();

-- Drafts are private to the officer account that wrote them (a shared login
-- means everyone holding that login shares its drafts — that's the same
-- privacy boundary the account itself has). The scheduled-send flush runs with
-- the service role and bypasses these.
alter table public.message_drafts enable row level security;

drop policy if exists "drafts own only" on public.message_drafts;
create policy "drafts own only"
  on public.message_drafts for all
  using (author_id = public.my_member_id() and public.has_permission('messages'))
  with check (author_id = public.my_member_id() and public.has_permission('messages'));

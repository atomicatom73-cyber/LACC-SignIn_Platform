-- Los Alamos Community Ceramics (LACC) — Supabase schema
-- Idempotent: safe to run in the Supabase SQL Editor on a fresh project OR on
-- top of the original sign-in-only schema. Run the whole file once
-- (Dashboard → SQL → New query), and re-run it after pulling schema updates.

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

-- One row per person (and one per shared officer account). Linked to an auth
-- user when they log in; kiosk-only members can exist with user_id null.
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users (id) on delete set null,
  full_name   text not null,
  role        text not null default 'member',
  pin         text,                                -- optional 4-digit PIN for kiosk tap-in
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Roles: 'member' plus the three shared officer accounts. Officer accounts are
-- handed to whoever currently holds the role; officers also keep a personal
-- member account under their own email.
update public.members
   set role = 'member'
 where role not in ('member', 'president', 'vice_president', 'volunteer_coordinator');

alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('member', 'president', 'vice_president', 'volunteer_coordinator'));

-- Officer recovery link: an officer (shared login) may point their account at
-- their own personal member account, so a forgotten officer password can be
-- reset by proving that member account's password or PIN. Set on the officer's
-- member row; null for everyone else. `on delete set null` so deleting the
-- linked member account simply drops the link.
alter table public.members
  add column if not exists recovery_member_id uuid
    references public.members (id) on delete set null;

-- Real email (optional, additive). Lets a member sign in and recover their
-- password with their own address, and get an email when a new announcement
-- lands in their inbox. Stored as an ALIAS alongside the synthetic
-- @member.lacc.local login identity — sign-in and reset resolve this back to
-- the existing account, so name + PIN sign-in keeps working untouched.
-- `notify_by_email` is an opt-out; only members with an email on file are ever
-- emailed. Until laccsignin.com is verified in Resend, mail only reaches the
-- Resend account owner's own inbox (fine for the pre-domain demo).
alter table public.members
  add column if not exists email text;
alter table public.members
  add column if not exists notify_by_email boolean not null default true;
create unique index if not exists members_email_key
  on public.members (lower(email))
  where email is not null;

-- Roster sync from the studio's "LACC Member session sign-ups/fees" Google
-- sheet (src/lib/members-sheet.ts). The sheet is the source of truth for who
-- is active: every sync re-applies the sheet's Active column to members it can
-- match (in_sheet = true) and imports unknown rows as kiosk-only members, so
-- in-app status edits for synced members only last until the next sync.
-- The sheet_* columns mirror the sheet's bookkeeping cells verbatim (free
-- text, officer-facing, edited in the sheet — never written by the app).
alter table public.members
  add column if not exists in_sheet boolean not null default false;
alter table public.members
  add column if not exists sheet_paid text;
alter table public.members
  add column if not exists sheet_payment_type text;
alter table public.members
  add column if not exists sheet_policy text;
alter table public.members
  add column if not exists sheet_photos text;
alter table public.members
  add column if not exists sheet_comments text;

-- ---------------------------------------------------------------------------
-- Shifts (studio sign-in / sign-out)
-- ---------------------------------------------------------------------------

create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members (id) on delete cascade,
  signed_in_at  timestamptz not null default now(),
  signed_out_at timestamptz,
  source        text not null default 'phone',     -- 'phone' | 'kiosk'
  created_at    timestamptz not null default now()
);

create unique index if not exists shifts_one_open_per_member
  on public.shifts (member_id)
  where signed_out_at is null;

create index if not exists shifts_member_idx on public.shifts (member_id);
create index if not exists shifts_signed_in_idx on public.shifts (signed_in_at);

-- Guests: a signed-in member brings a visitor, reminded to pay at sign-in.
-- Shows in the officer sign-in logs. Guests are signed out automatically when
-- their host signs out (or by close_stale_shifts at end of day).
create table if not exists public.guest_signins (
  id             uuid primary key default gen_random_uuid(),
  host_member_id uuid not null references public.members (id) on delete cascade,
  guest_name     text not null,
  signed_in_at   timestamptz not null default now()
);

alter table public.guest_signins
  add column if not exists signed_out_at timestamptz;

create index if not exists guest_signins_time_idx
  on public.guest_signins (signed_in_at);

-- Students: attendees sign in with their name + class label (e.g. "wednesday
-- night class"). Class rows are presence-only; open-studio visitors
-- (session_type = 'open_studio') sign themselves out from the kiosk.
create table if not exists public.student_signins (
  id           uuid primary key default gen_random_uuid(),
  student_name text not null,
  class_label  text not null,
  signed_in_at timestamptz not null default now()
);

alter table public.student_signins
  add column if not exists session_type text not null default 'class';
alter table public.student_signins
  add column if not exists signed_out_at timestamptz;

alter table public.student_signins drop constraint if exists student_signins_session_type_check;
alter table public.student_signins add constraint student_signins_session_type_check
  check (session_type in ('class', 'open_studio'));

create index if not exists student_signins_time_idx
  on public.student_signins (signed_in_at);

-- ---------------------------------------------------------------------------
-- Chores
-- ---------------------------------------------------------------------------

-- The studio's chore catalog. `slots` is how many people the monthly
-- reassignment algorithm should give this chore (0 = assign manually only).
-- One-off month-to-month chores are just rows the coordinator adds and later
-- deactivates.
create table if not exists public.chores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  slots       integer not null default 1 check (slots >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- A chore given to a member for a calendar month (`month` = first of month).
-- Completed chores fall off the member's profile once the month ends;
-- incomplete ones keep showing until they're done.
create table if not exists public.chore_assignments (
  id           uuid primary key default gen_random_uuid(),
  chore_id     uuid not null references public.chores (id) on delete cascade,
  member_id    uuid not null references public.members (id) on delete cascade,
  month        date not null,
  status       text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at timestamptz,
  assigned_by  uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (chore_id, member_id, month)
);

create index if not exists chore_assignments_member_idx
  on public.chore_assignments (member_id, month);
create index if not exists chore_assignments_month_idx
  on public.chore_assignments (month);

-- Chore credits: one row = one credit = one month exempt from chores.
-- `used_month` null means still available; set when the monthly assignment
-- run (or the coordinator) spends it.
create table if not exists public.chore_credits (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  note       text,
  granted_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  used_month date
);

create index if not exists chore_credits_member_idx on public.chore_credits (member_id);

-- Absence for a month: exempts the member that month, kept as history.
-- Can be added retroactively.
create table if not exists public.absences (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  month      date not null,
  note       text,
  marked_by  uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (member_id, month)
);

create index if not exists absences_member_idx on public.absences (member_id);

-- ---------------------------------------------------------------------------
-- Studio calendar
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  category    text not null default 'other'
              check (category in ('class', 'workshop', 'party', 'camp', 'meeting', 'other')),
  location    text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  created_by  uuid references public.members (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists events_starts_idx on public.events (starts_at);

-- Recurring events: the row is the first occurrence; the app expands
-- occurrences (daily/weekly/monthly) when rendering the calendar grid.
-- (Legacy: Google-sourced rows are pre-expanded to 'none' by the sync.)
alter table public.events add column if not exists recurrence text not null default 'none';
alter table public.events drop constraint if exists events_recurrence_check;
alter table public.events add constraint events_recurrence_check
  check (recurrence in ('none', 'daily', 'weekly', 'monthly'));

-- The studio's public Google calendar is the single source of truth for
-- events: a cron job (app/api/calendar-sync) mirrors it into this table with
-- source = 'google'. 'native' rows are legacy — the in-app editor was removed.
alter table public.events add column if not exists source text not null default 'native';
alter table public.events drop constraint if exists events_source_check;
alter table public.events add constraint events_source_check
  check (source in ('native', 'google'));

-- All-day events (Google `start.date`) render without a clock. `ends_at` holds
-- the exclusive end (the morning after the last day) so a multi-day span like a
-- camp expands across every day it covers.
alter table public.events add column if not exists all_day boolean not null default false;

-- Stable key for upserting Google events (one row per expanded instance). Null
-- for native rows; Postgres treats nulls as distinct, so the unique constraint
-- allows many of them.
alter table public.events add column if not exists google_event_id text;
alter table public.events drop constraint if exists events_google_event_id_key;
alter table public.events add constraint events_google_event_id_key
  unique (google_event_id);

-- ---------------------------------------------------------------------------
-- Sync state
-- ---------------------------------------------------------------------------

-- One marker row per sync so the calendar page can throttle its on-demand
-- Google pull (Vercel Hobby cron can't run more than daily). The page syncs at
-- most once per throttle window; the daily cron is the backstop. Written only
-- by the service-role sync, so RLS stays locked with no policy.
create table if not exists public.sync_state (
  key            text primary key,
  last_synced_at timestamptz not null default now()
);

-- Human-facing summary of the last run (tab name, row counts, skipped rows…).
-- Written by the members-sheet sync; the officer members page displays it.
alter table public.sync_state
  add column if not exists detail jsonb;

-- ---------------------------------------------------------------------------
-- Announcements / messages
-- ---------------------------------------------------------------------------

-- Officers compose like an email; members read from an inbox. Recipient rows
-- are materialized at send time (even for "all members") so read receipts work
-- and new members don't inherit old announcements.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid references public.members (id) on delete set null,
  sender_role text not null,
  subject     text not null,
  body        text not null,
  audience    text not null default 'selected' check (audience in ('all', 'selected')),
  created_at  timestamptz not null default now()
);

-- Audience filters: 'active' / 'inactive' / 'everyone' target by membership
-- status ('all' is the legacy value for old rows — it meant active members).
alter table public.messages drop constraint if exists messages_audience_check;
alter table public.messages add constraint messages_audience_check
  check (audience in ('all', 'selected', 'active', 'inactive', 'everyone'));

create table if not exists public.message_recipients (
  message_id uuid not null references public.messages (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete cascade,
  read_at    timestamptz,
  primary key (message_id, member_id)
);

create index if not exists message_recipients_member_idx
  on public.message_recipients (member_id, read_at);

-- ---------------------------------------------------------------------------
-- Door codes
-- ---------------------------------------------------------------------------

-- Studio door/lock access codes. President/VP maintain the list; every active
-- member can read them, so deactivated members immediately lose access to the
-- codes (RLS below). `title` names the door or lock, `code` is the combination.
create table if not exists public.door_codes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  code       text not null,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists door_codes_created_idx on public.door_codes (created_at);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so RLS policies can consult members
-- without recursing into members' own policies)
-- ---------------------------------------------------------------------------

create or replace function public.my_member_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.members where user_id = auth.uid();
$$;

create or replace function public.my_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.members where user_id = auth.uid();
$$;

create or replace function public.is_officer()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    public.my_role() in ('president', 'vice_president', 'volunteer_coordinator'),
    false
  );
$$;

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
-- Guard triggers
-- ---------------------------------------------------------------------------

-- Roles are permanently fixed: the three officer roles belong to the shared
-- officer accounts and everyone else is a member. No client session may
-- change any role — only the server-side service role (auth.uid() is null),
-- which the one-time bootstrap script uses.
create or replace function public.protect_role_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if auth.uid() is not null then
      raise exception 'Roles are fixed and cannot be changed.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists members_protect_role on public.members;
create trigger members_protect_role
  before update on public.members
  for each row execute function public.protect_role_change();

-- Members may only tick their own chore off (status / completed_at); every
-- other column is officer-only.
create or replace function public.protect_assignment_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_officer() then
    if new.chore_id    is distinct from old.chore_id
    or new.member_id   is distinct from old.member_id
    or new.month       is distinct from old.month
    or new.assigned_by is distinct from old.assigned_by then
      raise exception 'Members can only update chore status.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists chore_assignments_protect on public.chore_assignments;
create trigger chore_assignments_protect
  before update on public.chore_assignments
  for each row execute function public.protect_assignment_update();

-- ---------------------------------------------------------------------------
-- Forgotten sign-outs: close open member shifts, guest visits, and open-studio
-- student visits from previous studio days at 23:59:59 local (America/Denver)
-- time of the day they signed in.
-- Called opportunistically from the app; optionally schedule with pg_cron.
-- ---------------------------------------------------------------------------

create or replace function public.close_stale_shifts()
returns void
language sql security definer
set search_path = public
as $$
  update public.shifts
     set signed_out_at =
           (((signed_in_at at time zone 'America/Denver')::date + 1)::timestamp
             at time zone 'America/Denver') - interval '1 second'
   where signed_out_at is null
     and (signed_in_at at time zone 'America/Denver')::date
         < (now() at time zone 'America/Denver')::date;

  update public.guest_signins
     set signed_out_at =
           (((signed_in_at at time zone 'America/Denver')::date + 1)::timestamp
             at time zone 'America/Denver') - interval '1 second'
   where signed_out_at is null
     and (signed_in_at at time zone 'America/Denver')::date
         < (now() at time zone 'America/Denver')::date;

  -- Class students are presence-only; only open-studio visits get an out time.
  update public.student_signins
     set signed_out_at =
           (((signed_in_at at time zone 'America/Denver')::date + 1)::timestamp
             at time zone 'America/Denver') - interval '1 second'
   where signed_out_at is null
     and session_type = 'open_studio'
     and (signed_in_at at time zone 'America/Denver')::date
         < (now() at time zone 'America/Denver')::date;
$$;

grant execute on function public.close_stale_shifts() to authenticated;

-- Optional (requires the pg_cron extension, Dashboard → Database → Extensions):
-- select cron.schedule('close-stale-shifts', '5 0 * * *', $$select public.close_stale_shifts()$$);

-- ---------------------------------------------------------------------------
-- Row Level Security
--   Phone/member flows run as the logged-in user (policies below).
--   The kiosk runs server-side with the service-role key (bypasses RLS).
-- ---------------------------------------------------------------------------

alter table public.members            enable row level security;
alter table public.shifts             enable row level security;
alter table public.guest_signins      enable row level security;
alter table public.student_signins    enable row level security;
alter table public.chores             enable row level security;
alter table public.chore_assignments  enable row level security;
alter table public.chore_credits      enable row level security;
alter table public.absences           enable row level security;
alter table public.events             enable row level security;
alter table public.sync_state         enable row level security;
alter table public.messages           enable row level security;
alter table public.message_recipients enable row level security;
alter table public.door_codes         enable row level security;

-- members ---------------------------------------------------------------

drop policy if exists "members read own" on public.members;
create policy "members read own"
  on public.members for select
  using (user_id = auth.uid() or public.is_officer());

drop policy if exists "members update own" on public.members;
create policy "members update own"
  on public.members for update
  using (user_id = auth.uid() or public.my_role() in ('president', 'vice_president'))
  with check (user_id = auth.uid() or public.my_role() in ('president', 'vice_president'));

drop policy if exists "members insert by admins" on public.members;
create policy "members insert by admins"
  on public.members for insert
  with check (public.my_role() in ('president', 'vice_president'));

-- shifts ----------------------------------------------------------------

drop policy if exists "shifts read own" on public.shifts;
create policy "shifts read own"
  on public.shifts for select
  using (
    member_id in (select id from public.members where user_id = auth.uid())
    or public.is_officer()
  );

drop policy if exists "shifts insert own" on public.shifts;
create policy "shifts insert own"
  on public.shifts for insert
  with check (member_id in (select id from public.members where user_id = auth.uid()));

drop policy if exists "shifts update own" on public.shifts;
create policy "shifts update own"
  on public.shifts for update
  using (member_id in (select id from public.members where user_id = auth.uid()))
  with check (member_id in (select id from public.members where user_id = auth.uid()));

-- guest / student sign-ins ------------------------------------------------
-- Written server-side with the service role (kiosk + member flows); officers
-- read them in the sign-in logs.

drop policy if exists "guest signins read officers" on public.guest_signins;
create policy "guest signins read officers"
  on public.guest_signins for select
  using (public.is_officer());

drop policy if exists "student signins read officers" on public.student_signins;
create policy "student signins read officers"
  on public.student_signins for select
  using (public.is_officer());

-- chores ----------------------------------------------------------------

drop policy if exists "chores read all" on public.chores;
create policy "chores read all"
  on public.chores for select
  using (auth.uid() is not null);

drop policy if exists "chores manage officers" on public.chores;
create policy "chores manage officers"
  on public.chores for all
  using (public.is_officer())
  with check (public.is_officer());

-- chore_assignments -------------------------------------------------------

drop policy if exists "assignments read own or officer" on public.chore_assignments;
create policy "assignments read own or officer"
  on public.chore_assignments for select
  using (member_id = public.my_member_id() or public.is_officer());

drop policy if exists "assignments insert officers" on public.chore_assignments;
create policy "assignments insert officers"
  on public.chore_assignments for insert
  with check (public.is_officer());

drop policy if exists "assignments update own or officer" on public.chore_assignments;
create policy "assignments update own or officer"
  on public.chore_assignments for update
  using (member_id = public.my_member_id() or public.is_officer())
  with check (member_id = public.my_member_id() or public.is_officer());

drop policy if exists "assignments delete officers" on public.chore_assignments;
create policy "assignments delete officers"
  on public.chore_assignments for delete
  using (public.is_officer());

-- chore_credits -----------------------------------------------------------

drop policy if exists "credits read own or officer" on public.chore_credits;
create policy "credits read own or officer"
  on public.chore_credits for select
  using (member_id = public.my_member_id() or public.is_officer());

drop policy if exists "credits manage officers" on public.chore_credits;
create policy "credits manage officers"
  on public.chore_credits for all
  using (public.is_officer())
  with check (public.is_officer());

-- absences ----------------------------------------------------------------

drop policy if exists "absences read own or officer" on public.absences;
create policy "absences read own or officer"
  on public.absences for select
  using (member_id = public.my_member_id() or public.is_officer());

drop policy if exists "absences manage officers" on public.absences;
create policy "absences manage officers"
  on public.absences for all
  using (public.is_officer())
  with check (public.is_officer());

-- events ------------------------------------------------------------------

drop policy if exists "events read all" on public.events;
create policy "events read all"
  on public.events for select
  using (auth.uid() is not null);

-- Events are written only by the Google Calendar sync, which runs with the
-- service role and bypasses RLS. No client session writes events, so there is
-- no manage policy (the old president/VP editor was removed).
drop policy if exists "events manage admins" on public.events;

-- messages ------------------------------------------------------------------

drop policy if exists "messages read recipients or officers" on public.messages;
create policy "messages read recipients or officers"
  on public.messages for select
  using (
    public.is_officer()
    or exists (
      select 1 from public.message_recipients r
      where r.message_id = id and r.member_id = public.my_member_id()
    )
  );

drop policy if exists "messages send officers" on public.messages;
create policy "messages send officers"
  on public.messages for insert
  with check (public.is_officer() and sender_id = public.my_member_id());

drop policy if exists "messages delete admins" on public.messages;
create policy "messages delete admins"
  on public.messages for delete
  using (public.my_role() in ('president', 'vice_president'));

-- message_recipients ---------------------------------------------------------

drop policy if exists "recipients read own or officer" on public.message_recipients;
create policy "recipients read own or officer"
  on public.message_recipients for select
  using (member_id = public.my_member_id() or public.is_officer());

drop policy if exists "recipients insert officers" on public.message_recipients;
create policy "recipients insert officers"
  on public.message_recipients for insert
  with check (public.is_officer());

drop policy if exists "recipients mark read own" on public.message_recipients;
create policy "recipients mark read own"
  on public.message_recipients for update
  using (member_id = public.my_member_id())
  with check (member_id = public.my_member_id());

drop policy if exists "recipients delete officers" on public.message_recipients;
create policy "recipients delete officers"
  on public.message_recipients for delete
  using (public.is_officer());

-- door_codes ----------------------------------------------------------------
-- Read: any officer, or any *active* member (deactivated members are excluded,
-- so losing active status immediately hides the codes). Manage: president/VP.

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

drop policy if exists "door codes manage admins" on public.door_codes;
create policy "door codes manage admins"
  on public.door_codes for all
  using (public.my_role() in ('president', 'vice_president'))
  with check (public.my_role() in ('president', 'vice_president'));

-- ---------------------------------------------------------------------------
-- Seed: the studio's standing chore catalog (edit freely in the app)
-- ---------------------------------------------------------------------------

insert into public.chores (name, description, slots) values
  ('Reclaim & recycle clay',   'Process the reclaim buckets and bag recycled clay.', 2),
  ('Mop studio floors',        'Full mop of the main studio floor (dust-safe wet mop only).', 2),
  ('Clean glaze station',      'Wipe glaze buckets and lids, stir glazes, tidy the glaze bench.', 1),
  ('Wipe down wheels',         'Clean all pottery wheels, splash pans, and stools.', 2),
  ('Empty trash & recycling',  'Take out studio trash and recycling bins.', 1),
  ('Clean sinks & clay traps', 'Scrub the sinks and empty the clay traps.', 1),
  ('Kiln room tidy-up',        'Sweep kiln room, organize shelves, check for stray posts.', 1),
  ('Organize community shelves', 'Straighten ware boards and community shelving.', 1),
  ('Wipe work tables',         'Clear and wipe down all shared work tables.', 1),
  ('Restock & supplies check', 'Check paper towels, sponges, soap; report what''s low.', 1)
on conflict (name) do nothing;

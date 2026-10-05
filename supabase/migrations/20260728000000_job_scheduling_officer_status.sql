-- Two additive job features. Delta applied live 2026-07-28; schema.sql carries
-- the same statements.
--
--  1. Per-job scheduling: a job can invite whoever holds it to say WHEN they'll
--     do it (chores.scheduling_enabled), and each assignment carries that
--     appointment (chore_assignments.scheduled_at). Members set it from /me;
--     officers can set or clear it from the jobs board.
--  2. Officer status on a member account (members.officer_status): board
--     members keep a normal member account but sit out the auto-job draft.

-- Opt-in per job — most jobs are "whenever this month", so it defaults off.
alter table public.chores
  add column if not exists scheduling_enabled boolean not null default false;

-- When the member plans to do this job. Stored UTC, entered and displayed on
-- the studio wall clock (America/Denver — see src/lib/studio.ts).
alter table public.chore_assignments
  add column if not exists scheduled_at timestamptz;

-- Board officers: exempt from the monthly draft (no credit spent, back in the
-- rotation the moment the president unticks it). Manual assignment still works,
-- so an officer who wants a job can still be given one.
alter table public.members
  add column if not exists officer_status boolean not null default false;

-- President-managed like roles and permissions: writable only server-side
-- (auth.uid() is null under the service role), so no member session can grant
-- itself an exemption through the "members update own" policy.
create or replace function public.protect_role_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
  or new.officer_title is distinct from old.officer_title
  or new.officer_status is distinct from old.officer_status
  or new.permissions is distinct from old.permissions then
    if auth.uid() is not null then
      raise exception 'Roles and permissions are managed by the president.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists members_protect_role on public.members;
create trigger members_protect_role
  before update on public.members
  for each row execute function public.protect_role_change();

-- Members may only tick their own job off (status / completed_at) and say when
-- they'll do it (scheduled_at); every other column stays officer-only.
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

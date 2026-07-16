-- Officer permission-set RLS delta (2026-07-16). Idempotent — safe to re-run.
-- Everything here also lives in schema.sql; this file is just the pieces that
-- changed for president-managed officer accounts, for pasting into the
-- Supabase SQL editor.

-- Columns + role constraint (no-ops where already applied) -------------------

alter table public.members
  add column if not exists officer_title text;
alter table public.members
  add column if not exists permissions jsonb;

update public.members
   set role = 'member'
 where role not in ('member', 'president', 'vice_president', 'volunteer_coordinator', 'officer');

alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('member', 'president', 'vice_president', 'volunteer_coordinator', 'officer'));

-- Helper functions ------------------------------------------------------------

create or replace function public.is_officer()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    public.my_role() in ('president', 'vice_president', 'volunteer_coordinator', 'officer'),
    false
  );
$$;

create or replace function public.has_permission(perm text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select case
       when m.role = 'president' then true
       when m.role not in ('vice_president', 'volunteer_coordinator', 'officer') then false
       when m.permissions is not null then coalesce((m.permissions ->> perm)::boolean, false)
       when m.role = 'vice_president' then true
       when m.role = 'volunteer_coordinator' then perm in ('jobs', 'messages')
       else false
     end
     from public.members m
     where m.user_id = auth.uid()),
    false
  );
$$;

-- Guard trigger: titles and permission sets are server-side-only writes ------

create or replace function public.protect_role_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
  or new.officer_title is distinct from old.officer_title
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

-- Permission-gated policies ----------------------------------------------------

drop policy if exists "members update own" on public.members;
create policy "members update own"
  on public.members for update
  using (user_id = auth.uid() or public.has_permission('members'))
  with check (user_id = auth.uid() or public.has_permission('members'));

drop policy if exists "members insert by admins" on public.members;
create policy "members insert by admins"
  on public.members for insert
  with check (public.has_permission('members'));

drop policy if exists "chores manage officers" on public.chores;
create policy "chores manage officers"
  on public.chores for all
  using (public.has_permission('jobs'))
  with check (public.has_permission('jobs'));

drop policy if exists "assignments insert officers" on public.chore_assignments;
create policy "assignments insert officers"
  on public.chore_assignments for insert
  with check (public.has_permission('jobs'));

drop policy if exists "assignments update own or officer" on public.chore_assignments;
create policy "assignments update own or officer"
  on public.chore_assignments for update
  using (member_id = public.my_member_id() or public.has_permission('jobs'))
  with check (member_id = public.my_member_id() or public.has_permission('jobs'));

drop policy if exists "assignments delete officers" on public.chore_assignments;
create policy "assignments delete officers"
  on public.chore_assignments for delete
  using (public.has_permission('jobs'));

drop policy if exists "credits manage officers" on public.chore_credits;
create policy "credits manage officers"
  on public.chore_credits for all
  using (public.has_permission('jobs'))
  with check (public.has_permission('jobs'));

drop policy if exists "absences manage officers" on public.absences;
create policy "absences manage officers"
  on public.absences for all
  using (public.has_permission('jobs'))
  with check (public.has_permission('jobs'));

drop policy if exists "messages send officers" on public.messages;
create policy "messages send officers"
  on public.messages for insert
  with check (public.has_permission('messages') and sender_id = public.my_member_id());

drop policy if exists "messages delete admins" on public.messages;
create policy "messages delete admins"
  on public.messages for delete
  using (public.has_permission('messages'));

drop policy if exists "recipients insert officers" on public.message_recipients;
create policy "recipients insert officers"
  on public.message_recipients for insert
  with check (public.has_permission('messages'));

drop policy if exists "recipients delete officers" on public.message_recipients;
create policy "recipients delete officers"
  on public.message_recipients for delete
  using (public.has_permission('messages'));

drop policy if exists "door codes manage admins" on public.door_codes;
create policy "door codes manage admins"
  on public.door_codes for all
  using (public.has_permission('door_codes'))
  with check (public.has_permission('door_codes'));

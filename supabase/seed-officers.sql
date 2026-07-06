-- Officer account bootstrap — run AFTER schema.sql.
-- (Prefer scripts/create-officers.mjs, which does all of this automatically.)
--
-- The three officer accounts are SHARED, NAME-BASED logins (not tied to a
-- person): they get handed to whoever currently holds the role. The
-- @lacc.local addresses are synthetic — Supabase auth needs an email-shaped
-- identifier, but nobody reads these inboxes and no email is ever sent. The
-- login form shows role names and maps them to these addresses
-- (OFFICER_ACCOUNTS in src/lib/roles.ts). Officers keep a personal member
-- account under their own real email.
--
-- Step 1 (Dashboard): Authentication → Users → "Add user" → "Create new user"
--   Create three users with "Auto confirm user" checked:
--     • president@lacc.local
--     • vice.president@lacc.local
--     • volunteer.coordinator@lacc.local
--
-- Step 2: run this file in the SQL Editor. It promotes the auto-created
--   member rows to their roles and keeps the shared accounts off the kiosk
--   roster / chore rotation (officer-role rows are excluded from both by the
--   app).

update public.members
   set role = 'president', full_name = 'President', active = false
 where user_id = (select id from auth.users where email = 'president@lacc.local');

update public.members
   set role = 'vice_president', full_name = 'Vice President', active = false
 where user_id = (select id from auth.users where email = 'vice.president@lacc.local');

update public.members
   set role = 'volunteer_coordinator', full_name = 'Volunteer Coordinator', active = false
 where user_id = (select id from auth.users where email = 'volunteer.coordinator@lacc.local');

-- Sanity check: should list the three officer rows with their roles.
select full_name, role, active from public.members where role <> 'member';

-- Officer account bootstrap — run AFTER schema.sql.
--
-- The three officer accounts are SHARED logins (not tied to a person):
-- they get handed to whoever currently holds the role. Officers also keep a
-- personal member account under their own email.
--
-- Step 1 (Dashboard): Authentication → Users → "Add user" → "Create new user"
--   Create three users with email + password and "Auto confirm user" checked:
--     • president@your-domain        (e.g. lacc.president@gmail.com)
--     • vice.president@your-domain
--     • volunteer.coordinator@your-domain
--   (Any real or alias emails work — password login doesn't need the inbox.)
--
-- Step 2: edit the three emails below to match, then run this file in the
--   SQL Editor. It promotes the auto-created member rows to their roles and
--   keeps the shared accounts off the kiosk roster / chore rotation
--   (officer-role rows are excluded from both by the app).

update public.members
   set role = 'president', full_name = 'President', active = false
 where user_id = (select id from auth.users where email = 'president@example.com');

update public.members
   set role = 'vice_president', full_name = 'Vice President', active = false
 where user_id = (select id from auth.users where email = 'vice.president@example.com');

update public.members
   set role = 'volunteer_coordinator', full_name = 'Volunteer Coordinator', active = false
 where user_id = (select id from auth.users where email = 'volunteer.coordinator@example.com');

-- Sanity check: should list the three officer rows with their roles.
select full_name, role, active from public.members where role <> 'member';

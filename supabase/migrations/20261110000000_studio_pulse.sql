-- studio_pulse(): the heartbeat open screens ask Supabase for directly, so an
-- idle kiosk costs the Vercel project nothing.
--
-- Why it exists: the kiosk tablet sits on /kiosk around the clock, and it used
-- to re-render the whole page from Vercel every 20 seconds (plus re-prefetch
-- every link on it, plus two /api/now pings), whether or not anyone had signed
-- in. That ran about 1,800 function calls an hour, all night, and on
-- 2026-11-08 used up the studio's free Hobby allowance of Fluid Active CPU,
-- which disabled the site for 30 days. The tablet now polls this instead, and
-- only asks Vercel for a fresh page when `roster` changes.
--
-- Returns:
--   now    - the database clock, which the offline queue uses to correct a
--            device's clock drift (it used to come from /api/now).
--   roster - a fingerprint of exactly what the kiosk cards show: active
--            members (role 'member'), their names, whether they have a PIN and
--            a login, and when their open shift started. The studio date
--            (America/Denver) is mixed in so the cards also refresh just after
--            midnight, when close_stale_shifts() sweeps forgotten sign-outs.
--
-- Only a hash and a timestamp leave the database, so anon may call it.
-- The kiosk page reads the same function before it reads the roster, so a
-- change that lands mid-render shows up as a mismatch and the screen catches
-- up on the next poll, never the other way round.

create or replace function public.studio_pulse()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    -- Millisecond ISO in UTC; Postgres's own timestamptz text carries
    -- microseconds, which older iPad Safari won't Date.parse.
    'now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'roster', md5(
      (now() at time zone 'America/Denver')::date::text || '|' ||
      coalesce((
        select string_agg(
                 m.id::text || ':' || m.full_name || ':' ||
                 (coalesce(m.pin, '') <> '')::text || ':' ||
                 (m.user_id is not null)::text || ':' ||
                 coalesce(s.signed_in_at::text, ''),
                 ',' order by m.id
               )
          from public.members m
          left join public.shifts s
            on s.member_id = m.id
           and s.signed_out_at is null
         where m.active
           and m.role = 'member'
      ), '')
    )
  );
$$;

revoke all on function public.studio_pulse() from public;
grant execute on function public.studio_pulse() to anon, authenticated, service_role;

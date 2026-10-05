-- Forgotten sign-outs: mark the rows close_stale_shifts() force-closes at end
-- of day with `auto_closed = true`, so the sign-in log sheet can show
-- "Forgot to sign out" instead of the synthetic 23:59:59 out-time (which would
-- otherwise read like a real sign-out). Delta applied live 2026-07-17;
-- schema.sql carries the same statements. Apply this BEFORE deploying the code
-- that selects auto_closed — the column is backward-compatible, so old code
-- keeps working once it exists.

alter table public.shifts
  add column if not exists auto_closed boolean not null default false;
alter table public.guest_signins
  add column if not exists auto_closed boolean not null default false;
alter table public.student_signins
  add column if not exists auto_closed boolean not null default false;

-- Re-create the sweeper so each force-close also stamps auto_closed = true.
create or replace function public.close_stale_shifts()
returns void
language sql security definer
set search_path = public
as $$
  update public.shifts
     set signed_out_at =
           (((signed_in_at at time zone 'America/Denver')::date + 1)::timestamp
             at time zone 'America/Denver') - interval '1 second',
         auto_closed = true
   where signed_out_at is null
     and (signed_in_at at time zone 'America/Denver')::date
         < (now() at time zone 'America/Denver')::date;

  update public.guest_signins
     set signed_out_at =
           (((signed_in_at at time zone 'America/Denver')::date + 1)::timestamp
             at time zone 'America/Denver') - interval '1 second',
         auto_closed = true
   where signed_out_at is null
     and (signed_in_at at time zone 'America/Denver')::date
         < (now() at time zone 'America/Denver')::date;

  -- Class students are presence-only; only open-studio visits get an out time.
  update public.student_signins
     set signed_out_at =
           (((signed_in_at at time zone 'America/Denver')::date + 1)::timestamp
             at time zone 'America/Denver') - interval '1 second',
         auto_closed = true
   where signed_out_at is null
     and session_type = 'open_studio'
     and (signed_in_at at time zone 'America/Denver')::date
         < (now() at time zone 'America/Denver')::date;
$$;

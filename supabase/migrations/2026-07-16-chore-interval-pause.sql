-- Jobs get an interval (full month / first half / second half) that drives
-- due dates + reminder timing, and a paused flag that parks them out of the
-- auto-assign until unpaused. Delta applied live 2026-07-16; schema.sql
-- carries the same statements.

alter table public.chores
  add column if not exists paused boolean not null default false;

-- "interval" is quoted everywhere: unquoted, Postgres can parse it as the
-- start of an INTERVAL literal inside expressions.
alter table public.chores
  add column if not exists "interval" text not null default 'month';

alter table public.chores drop constraint if exists chores_interval_check;
alter table public.chores add constraint chores_interval_check
  check ("interval" in ('month', 'first_half', 'second_half'));

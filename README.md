# LACC Studio

The member app for **Los Alamos Community Ceramics**: studio sign-in, monthly
chores, the studio calendar, and announcements — all in one installable web
app.

Built with **Next.js 16** (App Router), **React 19**, **Supabase**
(Postgres + Auth), and **Tailwind CSS v4**.

## What's inside

| Area | Route | Who | What |
| ---- | ----- | --- | ---- |
| Quick sign in | `/kiosk` | Everyone | PIN-unlocked studio tablet (or any device): type/tap your name to sign in or out. Forgot to sign out? The shift closes automatically at the end of that day. |
| My account | `/me` | Members | Clock in/out, **my chores** (with mark-done), chore credits, hours, upcoming events, and a *very* loud banner when there are unread announcements. |
| Inbox | `/me/inbox` | Members | Announcements from the officers, unread-first. |
| Calendar | `/calendar` | Everyone signed in | Classes, workshops, parties, camps. President & VP can add/edit events inline. |
| Officer dashboard | `/officer` | Officers | Overview stats + tabs for Chores, Members, Messages. |
| Chores | `/officer/chores` | Officers (Volunteer Coordinator's home) | Master view of every member's chores per month, the chore catalog, manual assignment, and the **monthly reshuffle draft** (credit-aware, no repeats). |
| Members | `/officer/members` | Officers | Roster admin, chore credits, absence marking (retroactive OK), history. Roles are fixed — no role changes, by design. |
| Messages | `/officer/messages` | Officers | Compose announcements to all members or a hand-picked list; see who's read what. |

### Accounts and roles

- **No emails anywhere.** Everyone signs in with a name + password; behind
  the scenes each account gets a synthetic identifier (`*@lacc.local` for
  officers, `*@member.lacc.local` for members) because Supabase auth needs an
  email-shaped string. No verification emails are ever sent.
- **Members** self-serve: "Create an account" on `/login` with their name and
  a password. A member profile is created automatically.
- **Officer accounts are shared logins**, not people: `president`,
  `vice_president`, and `volunteer_coordinator`. On the login screen officers
  just tap their role and enter its password. They're created once (below)
  and the password is handed to whoever currently holds the role. Officers
  also keep their own personal member account.
- Permissions: the **President** and **Vice President** manage members and
  the calendar; the **Volunteer Coordinator** runs chores, credits, and
  absences. **Roles are permanently fixed** — there is no role-change UI and
  the database trigger rejects role updates from any client session.

### The chore system

- Chores live in a catalog (name, description, monthly `slots`). One-off
  chores are just catalog entries you deactivate later.
- Assignments are per member per month. **Completed chores disappear from the
  member's profile when the month ends; incomplete ones stick around** until
  done. The coordinator's month view keeps full history either way.
- **Chore credits**: 1 credit = 1 month exempt. Granted on a member's profile;
  the monthly reshuffle spends one automatically when it would otherwise have
  assigned that member a chore.
- **Absences**: exempt the member for a month (no credit spent) and stay on
  their history. Both credits and absences can be added retroactively.
- **Monthly reshuffle**: one click drafts next month's assignments — skips
  absent members, spends credits, avoids giving anyone the chore they had last
  month, spreads work by recent load — then the coordinator reviews, edits,
  and publishes.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project and load the schema

In the [Supabase dashboard](https://supabase.com/dashboard), create a project,
then open **SQL Editor → New query**, paste all of
[`supabase/schema.sql`](supabase/schema.sql), and run it. It's idempotent —
re-run it whenever the schema file changes. It creates every table, the
signup trigger, Row Level Security policies, the role-change guard, the
end-of-day shift closer, and seeds a starter chore catalog.

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

| Variable | Where to find it | Notes |
| -------- | ---------------- | ----- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` public key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret key | **Server only** — powers the kiosk |
| `KIOSK_PIN` | Any string you choose | Unlocks the studio tablet |

### 4. Create the three officer accounts

Pick one:

- **Script** (easiest): put the three `OFFICER_PASSWORD_*` values in
  `.env.local`, then `node scripts/create-officers.mjs`.
- **Dashboard**: Authentication → Users → *Add user* (auto-confirm) for the
  three `@lacc.local` accounts listed in
  [`supabase/seed-officers.sql`](supabase/seed-officers.sql), then run that
  file in the SQL Editor.

Hand each login to the current officeholder. When a role changes hands, just
change the account password and hand it over again.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Log in as an officer
(Officer tab on the login screen) to set up the chore catalog and calendar;
members onboard themselves with name + password.

## Adding members

Members appear automatically when they create an account. For kiosk-only
folks (no smartphone), officers can add them by name on
**Officer → Members → Add member**; only `active` members show on the kiosk
roster.

## Project layout

```
src/
  app/
    page.tsx              Landing (my account vs. quick sign-in)
    login/                Name + password login (members and shared officer roles)
    auth/confirm/         OTP-link callback (kept for tooling/debug links)
    me/                   Member home: clock in/out, chores, inbox link, events
    me/inbox/             Announcements inbox (loud unread banner)
    kiosk/                PIN-gated quick sign-in roster with search
    calendar/             Studio calendar (president/VP can edit inline)
    officer/              Officer shell + overview
    officer/chores/       Month view, catalog, assignment, monthly reshuffle
    officer/members/      Roster admin, credits, absences
    officer/messages/     Compose announcements + read receipts
  components/             Brand, announcements banner
  lib/
    auth.ts               requireMember / requireOfficer guards
    roles.ts              Role + permission helpers
    studio.ts             Studio-timezone (America/Denver) & month helpers
    chore-algorithm.ts    Deterministic monthly reshuffle draft
    supabase/             Browser, server (RLS), and admin (service-role) clients
  proxy.ts                Session refresh + auth guard for /me, /officer, /calendar
supabase/
  schema.sql              Tables, triggers, RLS — run in the SQL editor
  seed-officers.sql       Promote the three officer accounts
scripts/
  create-officers.mjs     Scripted officer-account bootstrap
```

## Deploying

Deploy to [Vercel](https://vercel.com/new): add the four environment variables
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `KIOSK_PIN`) under **Project → Settings →
Environment Variables** — a missing pair is what makes the login button hang,
so double-check them — and set Supabase **Auth → URL Configuration** Site URL
to your deployed domain. Optionally enable `pg_cron` in Supabase and schedule
`select public.close_stale_shifts();` nightly — the app also does this lazily
on page loads, so cron is belt-and-suspenders.

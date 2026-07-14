# LACC Studio — Developer Guide

This is the technical handbook for the LACC member app (sign-in kiosk, chores, calendar, announcements, door codes). It's written for a future club member with programming experience who needs to fix bugs, add features, or hand the project to someone else — without breaking what already works.

Read this whole document once before changing anything. The [README](README.md) covers what the app *does* and how to set it up; this guide covers how it's *built* and how to change it safely.

---

## 1. The stack at a glance

| Layer | Technology | Notes |
| ----- | ---------- | ----- |
| Framework | **Next.js 16** (App Router) | ⚠️ Next 16 has breaking changes vs. older tutorials. Read `node_modules/next/dist/docs/` before trusting anything you find online (or that an AI tells you). Notably: `middleware.ts` is now `proxy.ts`. |
| UI | **React 19** + **Tailwind CSS v4** | Tailwind v4 is configured through `postcss.config.mjs` and `src/app/globals.css` — there is **no** `tailwind.config.js`. |
| Database + Auth | **Supabase** (Postgres + Supabase Auth) | Schema lives in `supabase/schema.sql`. Row Level Security (RLS) is the real permission system. |
| Email | **Resend** (plain HTTP API, no SDK) | `src/lib/email.ts`. Degrades gracefully when unconfigured. |
| Calendar source | **Google Calendar** (public, read-only API key) | Mirrored into the `events` table by `src/lib/google-calendar.ts`. |
| Hosting | **Vercel** | Cron config in `vercel.json`. |
| Language | **TypeScript** throughout | `npx tsc --noEmit` must pass before you ship. |

There is no separate backend server. Everything server-side runs as Next.js Server Components, Server Actions, and one API route, deployed on Vercel.

---

## 2. Local development setup

You need Node.js 20+ and a Supabase project (free tier is fine — the club's real project already exists; for experiments, make your own throwaway project so you can't hurt production data).

```bash
git clone https://github.com/atomicatom73-cyber/LACC-SignIn_Platform.git
cd LACC-SignIn_Platform
npm install
cp .env.local.example .env.local   # then fill in the values (see below)
npm run dev                        # http://localhost:3000
```

### Environment variables

All of them are documented inline in `.env.local.example` — read that file, it's the source of truth. Summary:

| Variable | Public? | What breaks without it |
| -------- | ------- | ---------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Everything — the app can't reach the database. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Same. A missing/wrong pair is the classic "login button hangs" bug. |
| `SUPABASE_SERVICE_ROLE_KEY` | **NO — server only** | Kiosk, guest/student sign-in, calendar sync, officer account scripts. |
| `KIOSK_PIN` | server only | Unlocking the kiosk screen. |
| `RESEND_API_KEY` | server only | Email notifications & password-reset emails. App still works without it — email is skipped with a console warning. |
| `NEXT_PUBLIC_SITE_URL` | yes | Links inside emails point to the wrong place. |
| `GOOGLE_CALENDAR_ID` / `GOOGLE_CALENDAR_API_KEY` | server only | Google Calendar sync (calendar page still shows native events). |
| `CRON_SECRET` | server only | Guards `/api/calendar-sync` in production. Leave unset locally so you can trigger it by hand. |

**Never** put `SUPABASE_SERVICE_ROLE_KEY` in any file or variable whose name starts with `NEXT_PUBLIC_`. `NEXT_PUBLIC_` variables are bundled into the browser JavaScript that every visitor downloads. The service-role key bypasses ALL database security.

### Database setup

Open the Supabase dashboard → SQL Editor → New query, paste the entire contents of `supabase/schema.sql`, and run it. The file is **idempotent** — written with `create table if not exists`, `create or replace function`, `drop policy if exists` etc. — so re-running it is always safe and is the standard way to apply schema updates. `supabase/door-codes.sql` is a standalone add-on migration in the same style (already folded into schema.sql; kept for reference).

Officer accounts: set the three `OFFICER_PASSWORD_*` values in `.env.local` and run `node scripts/create-officers.mjs`, or follow the manual dashboard route described in the README using `supabase/seed-officers.sql`.

---

## 3. Project structure

```
src/
  proxy.ts                     Auth middleware (Next 16 name for middleware.ts).
                               Refreshes the Supabase session cookie and redirects
                               logged-out visitors to /login. Matcher covers
                               /me/* and /officer/* only.
  app/                         All routes (Next.js App Router — folders = URLs)
    layout.tsx                 Root layout: fonts, global CSS, <SessionKeeper>
    page.tsx                   Landing page (choose "my account" vs kiosk)
    globals.css                Tailwind v4 entry + design tokens
    manifest.ts, icon.tsx,
    apple-icon.tsx, icons/     PWA manifest + generated app icons
    login/                     Name+password login. LoginForm.tsx (client),
                               actions.ts (server actions: login, signup)
    auth/confirm/route.ts      Verifies emailed OTP/recovery links
    reset-password/            Sets a new password after a recovery link
    me/                        MEMBER AREA (auth required)
      page.tsx                 Dashboard: clock in/out, chores, hours, events
      actions.ts               Member server actions
      inbox/                   Announcements inbox + mark-as-read
      account/                 Email, password, PIN, notification settings
      guest/                   "I brought a guest" from the member's own phone
      door-codes/              Read-only door code list for active members
    kiosk/                     SHARED TABLET (no user session; PIN-gated)
      page.tsx, RosterGrid.tsx Tap-your-name roster
      actions.ts               Kiosk server actions (service-role powered)
      guest/, student/         Guest and class/open-studio student sign-in
    calendar/                  Studio calendar (public to signed-in users;
                               president/VP edit inline; Google sync on load)
    officer/                   OFFICER AREA (auth + officer role required)
      layout.tsx               Officer shell + nav; calls requireOfficer()
                               (individual pages/actions still re-check,
                               especially role-restricted ones)
      page.tsx                 Overview stats
      chores/                  Chore board, catalog, monthly reshuffle, print view
      members/                 Roster admin, credits, absences, history
      messages/                Compose announcements + read receipts
      door-codes/              Manage door codes (president/VP)
      logs/                    Sign-in logs: members, guests, students by day
      account/                 Officer password change + recovery link
    api/calendar-sync/route.ts Daily Google Calendar sync endpoint (Vercel Cron)
  components/                  Shared client components (banner, brand, month
                               grid, password input, install prompt, session
                               keeper, logout button, skeletons)
  lib/
    auth.ts                    requireMember() / requireOfficer() — THE auth
                               guards. Every protected page and action uses one.
    roles.ts                   Role type, permission helpers (canManageMembers,
                               canManageChores, ...), synthetic email mapping
    studio.ts                  ALL studio-timezone (America/Denver) date logic.
                               Never do date math anywhere else. See §6.
    time.ts                    Shift duration/hours formatting
    events.ts                  Recurring/multi-day event expansion for the grid
    chore-algorithm.ts         Pure, deterministic monthly chore draft. No
                               framework imports — easy to test in isolation.
    member-credentials.ts      Verify a member by name + (password | PIN)
    session-persistence.ts     iOS PWA session backup via localStorage
    email.ts                   Resend wrapper (fail-safe when unconfigured)
    google-calendar.ts         Google → events table mirror (windowed upsert)
    supabase/
      client.ts                Browser client (client components)
      server.ts                Cookie-session server client — RLS ENFORCED
      admin.ts                 Service-role client — BYPASSES RLS, server only
supabase/
  schema.sql                   The entire database, idempotent. Single source
                               of truth for tables, triggers, functions, RLS.
  seed-officers.sql            Promote the three officer accounts
  door-codes.sql               Standalone door-codes migration (historical)
scripts/
  create-officers.mjs          One-time officer account bootstrap
vercel.json                    Cron: /api/calendar-sync daily at 13:00 UTC
```

---

## 4. Architecture: how a request actually flows

Understanding this section prevents 90% of possible mistakes.

### Server Components by default, Client Components by exception

Every `page.tsx` is a **Server Component**: it runs on the server, fetches data with the RLS-scoped Supabase client, and renders HTML. Interactive pieces (forms, buttons, tap targets) are **Client Components** — files with `"use client"` at the top, usually named `SomethingForm.tsx` or `SomethingCard.tsx` next to the page that uses them.

Mutations never happen from the browser directly against Supabase. They go through **Server Actions**: functions in `actions.ts` files marked `"use server"`. The pattern in every actions.ts is:

```ts
"use server";

export async function doThing(args): Promise<{ ok: true } | { error: string }> {
  const { supabase, member } = await requireOfficer();   // 1. re-check auth
  // 2. validate inputs
  // 3. read/write via the RLS-scoped client (or admin client if justified)
  revalidatePath("/officer/whatever");                    // 4. refresh cached pages
  return { ok: true };                                    // 5. structured result, no throws
}
```

Server Actions must **always re-check auth themselves** (step 1). The proxy only guards page navigation; a crafted POST can hit an action directly.

### The three Supabase clients — pick the right one

| Client | File | Security | Use when |
| ------ | ---- | -------- | -------- |
| Browser | `lib/supabase/client.ts` | RLS enforced, user's session | Client components that need live data (rare here) |
| Server | `lib/supabase/server.ts` | RLS enforced, user's cookie session | **Default.** Pages and server actions for logged-in members/officers |
| Admin | `lib/supabase/admin.ts` | **Bypasses RLS entirely** | Kiosk flows (no user session exists), calendar sync, credential verification. Server-side only, and only when RLS genuinely can't express the operation |

Rule of thumb: if you find yourself reaching for `createAdminClient()` inside a member- or officer-facing feature, stop — you probably need an RLS policy instead (see §7). Every admin-client call site must do its own authorization check in code, because the database won't do it for you.

### Auth guards

`requireMember()` loads the logged-in user's `members` row or redirects to `/login`. `requireOfficer(roles?)` additionally redirects non-officers to `/me`, and officers whose role isn't in `roles` back to `/officer`. Call one of these at the top of **every** protected page and **every** server action (a few actions in `app/me/actions.ts` check `supabase.auth.getUser()` directly instead — equivalent, but prefer the helpers for new code). Note the documented quirk: `member` can be `null` for an instant right after signup, so handle that case.

### Route protection map

| Route | Guarded by |
| ----- | ---------- |
| `/me/*`, `/officer/*` | `src/proxy.ts` (session) **plus** `requireMember`/`requireOfficer` in each page/action |
| `/calendar` | Public-ish: does its own optional auth check; edit controls only for president/VP |
| `/kiosk/*` | No user session at all. `KIOSK_PIN` unlocks the screen; per-member 4-digit PINs gate individual tap-ins; server actions use the admin client |
| `/api/calendar-sync` | `CRON_SECRET` bearer token when set |
| `/login`, `/`, `/reset-password` | Public |

---

## 5. The database

`supabase/schema.sql` is the single source of truth. It is idempotent by design: every statement is written so the whole file can be re-run safely on a live database. **Keep it that way** — this is how schema changes are deployed (paste, run, done; no migration tooling).

### Tables

| Table | What it holds |
| ----- | ------------- |
| `members` | One row per person and per shared officer account. `user_id` links to Supabase Auth (null for kiosk-only members). Also: optional 4-digit `pin`, optional real `email` alias, `notify_by_email`, `recovery_member_id` (officer password recovery link), `active`, `role`. |
| `shifts` | Sign-in/out records. `source` is `'phone'` or `'kiosk'`. A partial unique index guarantees **at most one open shift per member**. |
| `guest_signins` | Visitors brought by a member. Auto-signed-out when the host signs out. |
| `student_signins` | Class attendees and open-studio visitors (`session_type`: `'class'` \| `'open_studio'`). |
| `chores` | The chore catalog: name, description, monthly `slots`, `active`. One-off chores are catalog entries you deactivate later. |
| `chore_assignments` | Per member, per month (`month` = `"YYYY-MM-01"`). Status/completion tracked here. |
| `chore_credits` | 1 credit = 1 month exempt. The reshuffle spends them automatically. |
| `absences` | Month exemptions that don't spend a credit; stay on history. |
| `events` | Calendar events. `source` = `'native'` (created in-app) or `'google'` (mirrored). Google rows carry a unique `google_event_id` used for upserts. |
| `sync_state` | Bookkeeping for the Google Calendar sync throttle. |
| `messages` / `message_recipients` | Announcements and per-recipient read receipts. |
| `door_codes` | Studio door codes. Readable by active members; managed by president/VP. |

### Functions and triggers — the safety net

These live at the bottom of schema.sql and are load-bearing. Do not remove or weaken them:

- `handle_new_user()` + `on_auth_user_created` trigger — auto-creates a `members` row when someone signs up. This is why signup "just works."
- `protect_role_change()` + trigger — **rejects any role update from a client session.** Roles are permanently fixed by design; there is deliberately no role-change UI or action. Don't add one.
- `protect_assignment_update()` + trigger — limits what members can change on their own chore assignments (mark done, essentially).
- `close_stale_shifts()` — signs out anyone still "in" at the end of the studio-local day. Called lazily on page loads and optionally by `pg_cron` nightly.
- `my_member_id()`, `my_role()`, `is_officer()` — SQL helpers the RLS policies are built on.

### Row Level Security is the real permission system

Every table has RLS enabled with explicit policies (members read own rows, officers read all, etc.). The TypeScript permission helpers in `lib/roles.ts` (`canManageMembers`, `canManageChores`, `canManageDoorCodes`, ...) control what the **UI shows**; RLS controls what the **database allows**. They must stay in agreement — when you change one, change the other. UI checks alone protect nothing.

### Making a schema change, step by step

1. Edit `supabase/schema.sql` — additively and idempotently. New column: `alter table ... add column if not exists ...`. Changed constraint: `drop constraint if exists` then `add constraint`. New table: `create table if not exists` + `enable row level security` + policies (`drop policy if exists "name"` before each `create policy` so re-runs work).
2. Write RLS policies for the new table **before** writing any app code against it. No policies = nobody can read it through the normal clients (and if you "fix" that with the admin client, you've bypassed security).
3. Run the whole file in the SQL Editor of your **test** Supabase project. Run it twice — the second run proves idempotency.
4. Update `src/lib/types.ts` and build the feature.
5. When merging: run the file on the production Supabase project, then deploy the code. (Schema first, code second — new code must never hit a database that lacks its tables.)

---

## 6. Subsystem notes — what to know before touching each area

### Time and dates: always `lib/studio.ts`

The studio runs on Los Alamos wall-clock time (`America/Denver`); the servers run on UTC. Every "what day/month is it" decision — chore months, end-of-day sign-outs, calendar days, log grouping — must go through the helpers in `studio.ts` (`monthKey`, `studioDayKey`, `studioToUtcIso`, ...). **Never** use `new Date().getMonth()` or similar raw local-time math; it will be wrong on the server, or wrong twice a year at DST changes. Month keys are strings shaped `"YYYY-MM-01"` and sort lexicographically on purpose.

### The chore reshuffle: `lib/chore-algorithm.ts`

Pure function, zero framework imports, **deterministic**: the PRNG is seeded from the target month, so regenerating the same month always yields the same draft. The rules it implements: skip absent members, auto-spend one credit for credit-holders, never give someone the same chore they had last month, balance by recent load. If you change the rules, preserve determinism (seeded PRNG, pre-sorted inputs) — the coordinator relies on "regenerate" not scrambling the draft. This file is the best candidate in the repo for unit tests.

Related behavior elsewhere: completed chores disappear from the member's view when the month ends, incomplete ones persist; the officer month view keeps full history.

### The kiosk: runs without a user

The kiosk is a shared tablet with no logged-in user, so its server actions (`app/kiosk/actions.ts`) use the **admin client**. Security model: `KIOSK_PIN` unlocks the screen, members with a personal PIN must enter it to tap in/out, and the actions validate everything server-side. When a member signs out, their open guests are signed out with them. If you add kiosk features, keep every check in the server action — nothing on the kiosk client can be trusted.

### Calendar: Google is the source of truth

Events flow one way: the studio's **public** Google calendar → `syncGoogleCalendar()` → upsert into `events` (matched on `google_event_id`, rolling window ~1 month back / 6 ahead). Sync triggers on calendar page load (throttled via `sync_state`) with a once-daily Vercel Cron backstop (`vercel.json` → `/api/calendar-sync`, guarded by `CRON_SECRET`). Google-sourced rows get overwritten on the next sync — **don't build features that edit `source = 'google'` events in-app**; edit them in Google Calendar. Native events (president/VP create inline on `/calendar`) are untouched by sync. Recurrence expansion for the month grid lives in `lib/events.ts`.

### Email: optional by design

`lib/email.ts` talks to Resend over plain HTTP. If `RESEND_API_KEY` is unset it logs and returns `{ ok: false, skipped: true }` instead of throwing — announcement sending must keep succeeding when email is off. Preserve this: any new email call site must tolerate a skipped/failed send.

The flip side of that resilience is that **email fails silently** — nothing surfaces in the UI. Two env vars have to be right in *every* environment, Vercel included:

- `RESEND_API_KEY` — unset means every send is skipped.
- `EMAIL_FROM` — must be on the club's verified Resend domain, `laccstudio.org` (e.g. `LACC Studio <noreply@laccstudio.org>`). Unset falls back to Resend's shared `onboarding@resend.dev` sandbox, which only delivers to the Resend account owner — everyone else 403s, silently.

If mail "isn't sending," check those two in the Vercel dashboard before debugging anything else. Also note there is **no signup email** — `registerMember()` pre-confirms the account (`email_confirm: true`), so the only mail the app ever sends is the password-reset link and announcement notifications.

### Accounts: the synthetic-email trick

Nobody logs in with a real email. Supabase Auth requires an email-shaped identifier, so `lib/roles.ts` maps names to synthetic ones: officers get `president@lacc.local` etc., members get `first.last@member.lacc.local` via `memberLoginEmail()` (accent-stripping slug — keep it stable, changing it strands existing accounts). A member may attach a *real* email as an alias for reset links and notifications; sign-in resolves it back to the same account. Officer accounts are **shared role logins** handed to whoever holds the role; officers can link a `recovery_member_id` so a lost officer password can be reset by proving their personal account.

### PWA & iOS sessions

The app is installable (manifest + generated icons in `app/`). iOS wipes cookies for installed PWAs when closed, so `lib/session-persistence.ts` mirrors session tokens into localStorage; `<SessionKeeper>` (mounted in the root layout) restores them on boot and `LogoutButton` clears them. If login "randomly stops persisting on iPads," start here.

---

## 7. Recipes: adding things without breaking things

### Add a new page for members

1. Create `src/app/me/yourpage/page.tsx`, an async Server Component starting with `const { supabase, member } = await requireMember();`.
2. Fetch with that `supabase` client (RLS applies automatically).
3. Interactive bits: a `"use client"` component in the same folder, receiving data as props.
4. Mutations: `actions.ts` in the folder, following the pattern in §4 (re-check auth, validate, write, `revalidatePath`, return `{ error }` on failure).
5. `/me/*` is already covered by the proxy matcher — no proxy changes needed. Add a link from `src/app/me/page.tsx`.

An officer page is identical but under `app/officer/`, using `requireOfficer()` — pass a role list (e.g. `requireOfficer(["president", "vice_president"])`) if it's not for all officers, and add the corresponding `can...()` helper to `lib/roles.ts` so the nav can hide it from the wrong officers.

### Add a new database-backed feature

Follow §5's schema-change steps first (table + RLS in schema.sql, tested on a throwaway project), then build the pages/actions on top. Order matters: schema → types → server code → UI.

### Add a field to an existing form

Column in schema.sql (additive, idempotent) → run in SQL Editor → add to the `select` in the page → add to the form component → handle in the server action → update `lib/types.ts`. Grep for other places the table is selected (`grep -r "from(\"members\")" src/`) to see what else might need the field.

### Change chore rules

Edit only `lib/chore-algorithm.ts` (see §6). The publishing/DB side lives in `app/officer/chores/actions.ts` and shouldn't need to change for rule tweaks.

---

## 8. Conventions and gotchas (the "don't break anything" list)

1. **Next.js 16 ≠ the Next.js in tutorials.** When an API surprises you, check `node_modules/next/dist/docs/` first. `proxy.ts` is the new `middleware.ts`; don't create a `middleware.ts`, it won't run.
2. **Never expose the service-role key**, never prefix a secret with `NEXT_PUBLIC_`, never import `lib/supabase/admin.ts` (or `email.ts`, `google-calendar.ts`, `member-credentials.ts`) into a client component. If the build starts complaining about server-only code in the client bundle, you've crossed this line.
3. **Every server action re-checks auth.** No exceptions, even if the page already did.
4. **UI permission checks and RLS policies move together.** Changing one without the other creates either a lockout or a hole.
5. **All date/month logic goes through `lib/studio.ts`.** DST bugs are silent for six months and then ruin a chore month.
6. **`supabase/schema.sql` stays idempotent.** Test every change by running the file twice on a scratch project.
7. **Roles are fixed forever.** The role-change prohibition (trigger + no UI) is a deliberate product decision, not a missing feature.
8. **Don't edit Google-sourced events in-app** — the next sync overwrites them.
9. **Pages that must always be fresh** (logs, sync endpoint) declare `export const dynamic = "force-dynamic"`. Mutating actions call `revalidatePath()` for every page whose data they changed — a "stale page after save" bug is almost always a missing revalidate.
10. **Return errors, don't throw them,** from server actions — the forms expect `{ error: string }` and render it inline.
11. **No test suite exists yet.** Your safety net is: `npx tsc --noEmit`, `npm run lint`, `npm run build`, and clicking through the affected flows (member + officer + kiosk) before deploying. If you add tests, start with `chore-algorithm.ts` and `studio.ts` — they're pure functions.
12. **Small commits with plain-English messages**, matching the existing history style ("Fix multi-day calendar events…"). Future-you at the studio at 9pm will be grateful.

---

## 9. Deployment

Production runs on **Vercel**, auto-deploying from the GitHub repo (`atomicatom73-cyber/LACC-SignIn_Platform`, `main` branch).

1. **Verify locally**: `npx tsc --noEmit && npm run lint && npm run build` — all clean.
2. **Schema first**: if you changed schema.sql, run it on the production Supabase project *before* pushing code.
3. **Push to `main`** — Vercel builds and deploys automatically. Watch the build in the Vercel dashboard.
4. **Environment variables** live in Vercel → Project → Settings → Environment Variables (all of §2's table, plus `NEXT_PUBLIC_SITE_URL` set to the deployed domain). A missing Supabase pair = login hangs. After adding/changing a variable, redeploy.
5. **Supabase Auth config**: Dashboard → Auth → URL Configuration → Site URL must be the deployed domain, or emailed links point to localhost.
6. **Cron**: `vercel.json` schedules `/api/calendar-sync` daily at 13:00 UTC (Hobby plan allows one/day). `CRON_SECRET` must match between Vercel env and your expectation — Vercel sends it as `Authorization: Bearer <CRON_SECRET>` automatically.
7. Optionally, in Supabase enable `pg_cron` and schedule `select public.close_stale_shifts();` nightly. The app also runs this lazily on page loads, so this is belt-and-suspenders.

Rollback: Vercel dashboard → Deployments → promote a previous deployment. Schema changes are additive, so old code keeps working against a newer schema — another reason to keep them additive.

---

## 10. Troubleshooting

| Symptom | First things to check |
| ------- | --------------------- |
| Login button hangs forever | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing or wrong (locally in `.env.local`, on Vercel in project settings). |
| "Member not found" / blank dashboard right after signup | Known timing window: `handle_new_user` trigger row not yet visible. Callers of `requireMember()` must handle `member === null`. |
| Page shows stale data after a save | Missing `revalidatePath()` in the server action, or a page that needs `force-dynamic`. |
| A query returns nothing but the data exists | RLS. Check the policies on that table against the role you're logged in as. Test in the Supabase SQL editor with and without RLS to confirm. |
| Emails not arriving | `RESEND_API_KEY` unset (check server logs for `[email] … skipped`), or domain not verified in Resend (delivers only to the account owner until then). |
| Calendar missing Google events | `GOOGLE_CALENDAR_API_KEY`/`GOOGLE_CALENDAR_ID` unset, calendar not public, or sync throttled — hit `/api/calendar-sync` manually (no `CRON_SECRET` set locally) and read the JSON response. |
| iPad PWA keeps logging out | `SessionKeeper` / `lib/session-persistence.ts` (iOS cookie wiping). |
| Chore reshuffle produced a weird draft | It's deterministic — reproduce it by feeding the same month's inputs to `generateMonthlyDraft` and read the `warnings` it returns. |
| Wrong day/month on chores or logs | Someone did raw date math instead of using `lib/studio.ts`. |
| Build error about server-only imports | A client component imports admin/email/google-calendar code. Move the logic into a server action. |

---

## 11. Handing this off

When the next technical member takes over, they need: access to the **GitHub repo**, the **Vercel project**, the **Supabase project** (dashboard invite), the **Resend account**, the **Google Cloud** API key console, and the contents of the production environment variables. Officer passwords rotate by simply changing the shared account's password. Keep this guide updated when the architecture changes — it's the map; the code is the territory.


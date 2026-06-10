# LACC Sign-In

Studio member sign-in and shift tracking for the **Los Angeles Creative Collective**. Members clock in when they arrive and clock out when they leave — either from their own phone or by tapping their name on the shared studio iPad.

Built with **Next.js 16** (App Router), **React 19**, **Supabase** (Postgres + Auth), and **Tailwind CSS v4**.

## Two ways to sign in

| Flow | Route | How it works |
| ---- | ----- | ------------ |
| **On my phone** | `/login` → `/me` | Passwordless magic-link email. Runs as the logged-in user with Row Level Security enforced. |
| **Studio iPad** | `/kiosk` | Shared device unlocked with a studio PIN, then anyone taps their name to toggle their shift. Runs server-side with the Supabase service role. |

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project and load the schema

In the [Supabase dashboard](https://supabase.com/dashboard), create a project, then open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it once. This creates the `members` and `shifts` tables, the "auto-create a member on signup" trigger, and the Row Level Security policies.

### 3. Configure environment variables

Copy the example file and fill in the values from **Supabase → Project Settings → API**:

```bash
cp .env.local.example .env.local
```

| Variable | Where to find it | Notes |
| -------- | ---------------- | ----- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` public key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret key | **Server only** — bypasses RLS; powers the kiosk roster |
| `KIOSK_PIN` | Any string you choose | Unlocks the studio iPad kiosk |

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Adding members

New phone users get a `members` row automatically on first login (via the `handle_new_user` trigger). For kiosk-only people, add rows directly in the Supabase **Table Editor** → `members` (set `full_name`, leave `user_id` null). Only `active = true` members appear on the kiosk roster.

## Project layout

```
src/
  app/
    page.tsx            Landing page (phone vs. kiosk)
    login/              Magic-link sign-in
    auth/confirm/       Magic-link callback (verifies the token)
    me/                 Personal dashboard: clock in/out, weekly + all-time hours
    kiosk/              PIN-gated shared roster with tap-to-toggle
    manifest.ts         Installable web-app manifest
    icon.tsx            Generated favicon / app icons
  components/Brand.tsx  Logo + wordmark
  lib/
    supabase/           Browser, server (RLS), and admin (service-role) clients
    time.ts             Duration / hours formatting helpers
  proxy.ts              Refreshes the auth session and guards /me
supabase/schema.sql     Database schema, trigger, and RLS policies
```

## Deploying

Deploy to [Vercel](https://vercel.com/new). Add the four environment variables above in the project settings, and set Supabase's **Site URL** / redirect allow-list to your deployed domain so magic links resolve correctly.

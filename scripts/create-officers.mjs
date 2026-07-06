/**
 * One-time officer account bootstrap (alternative to supabase/seed-officers.sql).
 *
 * 1. Edit the OFFICERS list below (emails + strong passwords).
 * 2. Make sure .env.local has NEXT_PUBLIC_SUPABASE_URL and
 *    SUPABASE_SERVICE_ROLE_KEY filled in.
 * 3. Run:  node scripts/create-officers.mjs
 *
 * Creates the three shared officer logins (email + password, pre-confirmed)
 * and promotes their member rows. Re-running is safe: existing users are
 * skipped, roles are re-applied.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const OFFICERS = [
  { email: "president@example.com", password: "CHANGE-ME-president", role: "president", name: "President" },
  { email: "vice.president@example.com", password: "CHANGE-ME-vp", role: "vice_president", name: "Vice President" },
  { email: "volunteer.coordinator@example.com", password: "CHANGE-ME-vc", role: "volunteer_coordinator", name: "Volunteer Coordinator" },
];

// --- read .env.local ---------------------------------------------------
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const officer of OFFICERS) {
  if (officer.password.startsWith("CHANGE-ME")) {
    console.error(`Set a real password for ${officer.email} before running.`);
    process.exit(1);
  }

  let userId;
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: officer.email,
    password: officer.password,
    email_confirm: true,
    user_metadata: { full_name: officer.name },
  });

  if (error) {
    if (`${error.message}`.toLowerCase().includes("already")) {
      const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      userId = list?.users.find((u) => u.email === officer.email)?.id;
      console.log(`• ${officer.email} already exists — updating role only.`);
    } else {
      console.error(`✗ ${officer.email}: ${error.message}`);
      process.exit(1);
    }
  } else {
    userId = created.user.id;
    console.log(`✓ created ${officer.email}`);
  }

  if (!userId) {
    console.error(`✗ could not resolve user id for ${officer.email}`);
    process.exit(1);
  }

  // The handle_new_user trigger already made a member row; promote it.
  // active=false keeps shared accounts off the kiosk roster and chore rotation.
  const { error: upErr } = await supabase
    .from("members")
    .update({ role: officer.role, full_name: officer.name, active: false })
    .eq("user_id", userId);
  if (upErr) {
    console.error(`✗ role update for ${officer.email}: ${upErr.message}`);
    process.exit(1);
  }
  console.log(`  → role set to ${officer.role}`);
}

console.log("\nDone. Hand each login to the person holding that role.");

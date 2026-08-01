"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import {
  readAltSession,
  writeAltSession,
  type AltSession,
} from "@/lib/alt-session";
import { isOfficer, memberLoginEmail, officerTitle } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export type SwitchState = { error?: string; success?: string } | null;

/**
 * Sign in to a SECOND account without disturbing the one already signed in.
 *
 * The trick is the bare client: `persistSession: false` means it mints a
 * session and hands us the tokens instead of writing the auth cookies, so the
 * current session stays exactly where it is and the new one goes into the
 * parked cookie (see lib/alt-session).
 */
export async function addAccount(
  _prev: SwitchState,
  formData: FormData,
): Promise<SwitchState> {
  // Must already be signed in as somebody — this adds a second account, it
  // isn't another way in.
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const mode = String(formData.get("mode") ?? "member");
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Enter the password." };

  let loginEmail: string | null = null;
  if (mode === "officer") {
    const officerId = String(formData.get("officer_id") ?? "");
    if (!officerId) return { error: "Pick an officer account." };
    loginEmail = await officerAuthEmail(officerId);
    if (!loginEmail) return { error: "That officer account no longer exists." };
  } else {
    const identifier = String(formData.get("identifier") ?? "").trim();
    if (!identifier) return { error: "Enter your name or email." };
    loginEmail = identifier.includes("@")
      ? ((await loginEmailForAlias(identifier)) ?? identifier.toLowerCase())
      : memberLoginEmail(identifier);
    if (!loginEmail) return { error: "Enter your name or email." };
  }

  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await bare.auth.signInWithPassword({
    email: loginEmail,
    password,
  });
  if (error || !data.session) {
    return { error: error?.message ?? "That didn't work — check the password." };
  }

  if (data.user.id === user.id) {
    return { error: "That's the account you're already using." };
  }

  const profile = await describeAccount(data.user.id);
  if (!profile) return { error: "That account has no member profile." };

  await writeAltSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    ...profile,
  });

  // Adding parks the account, it doesn't switch to it — so go back to the one
  // they're actually using. The switcher now offers the new one.
  const current = await describeAccount(user.id);
  redirect(current?.home ?? "/me");
}

/**
 * Swap the active and parked sessions. setSession() rewrites Supabase's auth
 * cookies to the parked account, and the one being replaced takes its place in
 * the parked cookie — so the switcher flips back and forth indefinitely
 * without ever asking for a password again.
 */
export async function switchAccount(): Promise<{ error: string } | never> {
  const parked = await readAltSession();
  if (!parked) return { error: "No second account on this device yet." };

  const supabase = await createSessionClient();
  const {
    data: { session: current },
  } = await supabase.auth.getSession();
  if (!current) redirect("/login");

  const outgoing = await describeAccount(current.user.id);

  const { error } = await supabase.auth.setSession({
    access_token: parked.access_token,
    refresh_token: parked.refresh_token,
  });
  if (error) {
    // The parked session died (password changed, token revoked). Drop it
    // rather than leaving a switcher button that always fails.
    await writeAltSession(null);
    return {
      error: "That account needs signing in again — its session expired.",
    };
  }

  await writeAltSession(
    outgoing
      ? {
          access_token: current.access_token,
          refresh_token: current.refresh_token,
          ...outgoing,
        }
      : null,
  );

  redirect(parked.home);
}

/** Forget the parked account (the active session is untouched). */
export async function removeAccount(): Promise<null> {
  await writeAltSession(null);
  return null;
}

/** Name, kind, and landing page for an account, for the switcher's labels. */
async function describeAccount(
  userId: string,
): Promise<Pick<AltSession, "label" | "kind" | "home"> | null> {
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("members")
    .select("full_name, role, officer_title")
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return null;

  const officer = isOfficer(member.role);
  return {
    label: officer ? officerTitle(member) : member.full_name,
    kind: officer ? "officer" : "member",
    home: officer ? "/officer" : "/me",
  };
}

/** Resolve an officer member-row id to its auth login address, or null. */
async function officerAuthEmail(officerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("members")
    .select("user_id, role")
    .eq("id", officerId)
    .maybeSingle();
  if (!row?.user_id || !isOfficer(row.role)) return null;

  const { data } = await admin.auth.admin.getUserById(row.user_id);
  return data?.user?.email ?? null;
}

/** Given a real email alias, return the account's actual login address. */
async function loginEmailForAlias(aliasEmail: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("members")
    .select("user_id")
    .ilike("email", aliasEmail)
    .not("user_id", "is", null)
    .maybeSingle();
  if (!member?.user_id) return null;

  const { data } = await admin.auth.admin.getUserById(member.user_id);
  return data?.user?.email ?? null;
}

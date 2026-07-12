"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import {
  isOfficer,
  memberLoginEmail,
  OFFICER_ACCOUNTS,
  OFFICER_ROLES,
} from "@/lib/roles";
import { verifyMemberCredential } from "@/lib/member-credentials";
import { renderResetEmail, sendEmail, siteUrl } from "@/lib/email";

export type RegisterResult = { error: string } | { email: string };

/**
 * Sign in on the server so Supabase writes the auth cookies via the HTTP
 * Set-Cookie header. Those are durable first-party cookies that survive
 * closing the app. Signing in with the browser client instead writes the
 * session through document.cookie, which iOS/WebKit treats as short-lived
 * under ITP and can drop when a home-screen PWA is closed — silently signing
 * the person out. Every sign-in path (login, password/PIN reset, officer
 * recovery) routes through here so the session sticks to the device.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Member sign-in by EITHER their name (the classic synthetic-address login) OR
 * a real email they've added to their account. An email is resolved back to the
 * account's actual login address — the real email is only an alias stored on
 * the member row, so name/PIN sign-in is unaffected. Falls through to treating
 * the typed value as a literal login email if no alias matches, so nothing
 * regresses. Signs in server-side (see signIn) so the cookie is durable.
 */
export async function signInMember(
  identifierRaw: string,
  password: string,
): Promise<{ error: string } | { ok: true }> {
  const identifier = identifierRaw.trim();
  if (!identifier) return { error: "Enter your name or email." };

  let loginEmail: string | null;
  if (identifier.includes("@")) {
    loginEmail = (await loginEmailForAlias(identifier)) ?? identifier.toLowerCase();
  } else {
    loginEmail = memberLoginEmail(identifier);
  }
  if (!loginEmail) return { error: "Enter your name or email." };

  return signIn(loginEmail, password);
}

/**
 * Given a real email alias, return the account's actual (synthetic) login
 * address, or null if no member has claimed that alias. Service-role lookup.
 */
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

/**
 * Create a member account from a name + password + kiosk PIN. The synthetic
 * @member.lacc.local address is derived from the name (see memberLoginEmail);
 * the account is pre-confirmed so no verification email is ever involved.
 * The handle_new_user trigger creates the member row from the metadata name;
 * the PIN is what they tap in with on the studio quick sign-in screen.
 */
export async function registerMember(
  fullNameRaw: string,
  password: string,
  pin: string,
): Promise<RegisterResult> {
  const fullName = fullNameRaw.trim().replace(/\s+/g, " ");
  if (fullName.length < 2) return { error: "Enter your full name." };
  if (fullName.length > 80) return { error: "That name is too long." };

  const email = memberLoginEmail(fullName);
  if (!email) return { error: "Please use letters or numbers in your name." };

  if (password.length < 8) {
    return { error: "Password needs at least 8 characters." };
  }
  if (!/^\d{4}$/.test(pin)) {
    return { error: "Pick a 4-digit PIN for the studio sign-in screen." };
  }

  const supabase = createAdminClient();
  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    if (`${error.message}`.toLowerCase().includes("already")) {
      return {
        error:
          "That name is already registered. Log in instead — or if that's someone else, add a middle name or initial.",
      };
    }
    return { error: error.message };
  }

  // The handle_new_user trigger has already made the member row; stamp the
  // kiosk PIN on it.
  const { error: pinError } = await supabase
    .from("members")
    .update({ pin })
    .eq("user_id", created.user.id);
  if (pinError) {
    // The account still works — the kiosk just won't ask for a PIN yet.
    console.error("Failed to save kiosk PIN:", pinError.message);
  }

  return { email };
}

/**
 * Find the member-account row whose name maps to the same login address as
 * `fullName`. Only role='member' accounts qualify — officer logins are shared
 * and recover by handing over the password.
 */
async function findMemberByName(fullName: string) {
  const email = memberLoginEmail(fullName);
  if (!email) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("members")
    .select("id, user_id, full_name, pin, role")
    .eq("role", "member")
    .not("user_id", "is", null);

  return (
    (data ?? []).find((m) => memberLoginEmail(m.full_name) === email) ?? null
  );
}

/**
 * Self-service "forgot my password": prove it's you with your studio PIN,
 * then choose a new password. Returns the login email so the client can sign
 * straight in with the new password.
 */
export async function resetPasswordWithPin(
  fullName: string,
  pin: string,
  newPassword: string,
): Promise<{ error: string } | { email: string }> {
  if (!/^\d{4}$/.test(pin)) {
    return { error: "Enter your 4-digit studio PIN." };
  }
  if (newPassword.length < 8) {
    return { error: "New password needs at least 8 characters." };
  }

  const member = await findMemberByName(fullName);
  // One generic message whether the name or the PIN is wrong — don't help
  // someone probe which names exist.
  if (!member || !member.pin || member.pin !== pin) {
    return {
      error:
        "That name and PIN don't match. If you've forgotten both, ask the president for help.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(member.user_id!, {
    password: newPassword,
  });
  if (error) return { error: error.message };

  return { email: memberLoginEmail(member.full_name)! };
}

/**
 * Self-service "forgot my PIN": prove it's you with your password, then
 * choose a new 4-digit PIN.
 */
export async function resetPinWithPassword(
  fullName: string,
  password: string,
  newPin: string,
): Promise<{ error: string } | { success: true }> {
  if (!/^\d{4}$/.test(newPin)) {
    return { error: "Pick a 4-digit PIN." };
  }

  const email = memberLoginEmail(fullName);
  if (!email) return { error: "Please use letters or numbers in your name." };

  // Verify the password with a throwaway client that never persists a
  // session — this action runs without (and must not create) auth cookies.
  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error: signInError } = await bare.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !data.user) {
    return {
      error:
        "That name and password don't match. If you've forgotten both, ask the president for help.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("members")
    .update({ pin: newPin })
    .eq("user_id", data.user.id)
    .eq("role", "member");
  if (error) return { error: error.message };

  return { success: true };
}

/**
 * Reset a forgotten SHARED officer password by proving the personal member
 * account the officer linked from their account page (see linkRecoveryMember).
 * Identity is proven with that member account's password or 4-digit PIN.
 * Returns the officer login email so the client can sign straight in.
 */
export async function resetOfficerPasswordViaMember(
  role: string,
  memberName: string,
  credential: string,
  newPassword: string,
): Promise<{ error: string } | { email: string }> {
  if (!isOfficer(role)) return { error: "Pick a valid officer role." };
  if (newPassword.length < 8) {
    return { error: "New password needs at least 8 characters." };
  }

  // One generic failure whether no member is linked, the name is wrong, or the
  // credential is wrong — don't reveal which role has a link set up.
  const genericFail = {
    error:
      "That doesn't match the member account linked to this role. If no account is linked, ask whoever holds the role to hand over the password.",
  };

  const admin = createAdminClient();
  const { data: officerRow } = await admin
    .from("members")
    .select("user_id, recovery_member_id")
    .eq("role", role)
    .not("user_id", "is", null)
    .maybeSingle();
  if (!officerRow?.user_id || !officerRow.recovery_member_id) {
    return genericFail;
  }

  const match = await verifyMemberCredential(memberName, credential);
  if (!match || match.id !== officerRow.recovery_member_id) {
    return genericFail;
  }

  const { error } = await admin.auth.admin.updateUserById(officerRow.user_id, {
    password: newPassword,
  });
  if (error) return { error: error.message };

  return {
    email: OFFICER_ACCOUNTS[role as (typeof OFFICER_ROLES)[number]],
  };
}

/**
 * Self-service "email me a reset link". Additive to the PIN-based reset — a
 * member who's added their email can get a one-click recovery link instead.
 *
 * Always resolves to { ok: true } regardless of whether the email is on file,
 * so this can't be used to probe which addresses are registered. The recovery
 * token is generated for the account's real login address, but the email is
 * delivered to the member's chosen alias; the link lands on /auth/confirm,
 * which verifies it and forwards to /reset-password.
 */
export async function sendPasswordResetEmail(
  emailRaw: string,
): Promise<{ ok: true }> {
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) return { ok: true };

  const loginEmail = (await loginEmailForAlias(email)) ?? email;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: loginEmail,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { ok: true };

  const link = `${siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=recovery&next=${encodeURIComponent("/reset-password")}`;

  await sendEmail({
    to: email,
    subject: "Reset your LACC Studio password",
    text: `Someone asked to reset the password for your LACC Studio account.\n\nReset it here (the link expires in about an hour and can be used once):\n${link}\n\nIf this wasn't you, you can ignore this email — your password won't change.\n`,
    html: renderResetEmail({ link }),
  });

  return { ok: true };
}

/**
 * Set a new password for the session opened by a recovery link. The /auth/confirm
 * route verifies the emailed token and starts a short-lived recovery session;
 * this runs on the /reset-password page inside that session and updates the
 * password on the session-bound client so the cookies refresh in place.
 */
export async function setNewPassword(
  newPassword: string,
): Promise<{ error: string } | { ok: true }> {
  if (newPassword.length < 8) {
    return { error: "New password needs at least 8 characters." };
  }

  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error:
        "That reset link expired or was already used. Request a new one from the sign-in screen.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}

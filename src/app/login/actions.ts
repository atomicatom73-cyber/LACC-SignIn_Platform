"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isOfficer,
  memberLoginEmail,
  OFFICER_ACCOUNTS,
  OFFICER_ROLES,
} from "@/lib/roles";
import { verifyMemberCredential } from "@/lib/member-credentials";

export type RegisterResult = { error: string } | { email: string };

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

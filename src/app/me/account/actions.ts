"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberLoginEmail } from "@/lib/roles";

/** Loose email shape check — good enough to catch typos before we store it. */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Self-service account editing for a personal member account. Every action
 * re-derives the member from the session (never a client-supplied id) and only
 * touches role='member' rows — the shared officer logins manage themselves from
 * the officer account page.
 */

/**
 * Change your own display name. Like the officer roster rename, this moves the
 * name-based login to match (the synthetic @member.lacc.local address is
 * derived from the name), so you sign in with the new name afterwards. The
 * current session keeps working — only the login identifier changes.
 */
export async function updateMemberName(
  newNameRaw: string,
): Promise<{ error: string } | { name: string }> {
  const { user, member } = await requireMember();
  if (!member || member.role !== "member") {
    return { error: "No member profile found." };
  }

  const newName = newNameRaw.trim().replace(/\s+/g, " ");
  if (newName.length < 2) return { error: "Enter your full name." };
  if (newName.length > 80) return { error: "That name is too long." };

  const loginEmail = memberLoginEmail(newName);
  if (!loginEmail) {
    return { error: "Please use letters or numbers in your name." };
  }

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
    email: loginEmail,
    email_confirm: true,
    user_metadata: { full_name: newName },
  });
  if (authError) {
    if (`${authError.message}`.toLowerCase().includes("already")) {
      return {
        error:
          "Another account already uses that name — add a middle name or initial.",
      };
    }
    return { error: authError.message };
  }

  const { error } = await admin
    .from("members")
    .update({ full_name: newName })
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/me/account");
  revalidatePath("/me");
  return { name: newName };
}

/** Set or change the real email (login alias / recovery / notifications). */
export async function updateMemberEmail(
  newEmailRaw: string,
): Promise<{ error: string } | { email: string }> {
  const { user, member } = await requireMember();
  if (!member || member.role !== "member") {
    return { error: "No member profile found." };
  }

  const email = newEmailRaw.trim().toLowerCase();
  if (!isEmail(email)) return { error: "Enter a valid email address." };

  const admin = createAdminClient();
  const { data: taken } = await admin
    .from("members")
    .select("id")
    .ilike("email", email)
    .neq("user_id", user.id)
    .maybeSingle();
  if (taken) return { error: "That email is already on another account." };

  const { error } = await admin
    .from("members")
    .update({ email })
    .eq("user_id", user.id);
  if (error) {
    if (error.code === "23505") {
      return { error: "That email is already on another account." };
    }
    return { error: error.message };
  }

  revalidatePath("/me/account");
  return { email };
}

/** Change your 4-digit kiosk PIN. */
export async function updateMemberPin(
  newPinRaw: string,
): Promise<{ error: string } | { pin: string }> {
  const { user, member } = await requireMember();
  if (!member || member.role !== "member") {
    return { error: "No member profile found." };
  }

  const pin = newPinRaw.trim();
  if (!/^\d{4}$/.test(pin)) return { error: "Pick a 4-digit PIN." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("members")
    .update({ pin })
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/me/account");
  return { pin };
}

/**
 * Change your password. Requires the current one (proven with a throwaway
 * sign-in client) so a walk-up on an already-signed-in phone can't take the
 * account over. The update runs on the session client so this device stays
 * logged in.
 */
export async function updateMemberPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ error: string } | { success: true }> {
  const { supabase, user, member } = await requireMember();
  if (!member || member.role !== "member") {
    return { error: "No member profile found." };
  }
  if (!user.email) return { error: "This account has no login on file." };
  if (newPassword.length < 8) {
    return { error: "New password needs at least 8 characters." };
  }
  if (currentPassword === newPassword) {
    return { error: "Pick a password different from your current one." };
  }

  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error: signInError } = await bare.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError || !data.user) {
    return { error: "That current password is wrong." };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { success: true };
}

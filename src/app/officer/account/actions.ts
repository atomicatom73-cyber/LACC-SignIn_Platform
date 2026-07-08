"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMemberCredential } from "@/lib/member-credentials";

/**
 * Change the shared officer login's password from inside the officer's
 * account. The current password is required (proven with a throwaway sign-in
 * client) so a walk-up on an already-signed-in device can't silently take it
 * over.
 *
 * The update runs through the session-bound client (updateUser), not the admin
 * API: that refreshes THIS session's cookies so the officer stays logged in,
 * while other devices holding the old shared password are signed out — exactly
 * the right behavior for a shared credential.
 */
export async function changeOfficerPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ error: string } | { success: true }> {
  const { supabase, user } = await requireOfficer();
  if (!user.email) return { error: "This account has no login on file." };

  if (newPassword.length < 8) {
    return { error: "New password needs at least 8 characters." };
  }
  if (currentPassword === newPassword) {
    return { error: "Pick a password different from the current one." };
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

/**
 * Link this officer login to a personal member account. Proving that member
 * account's password or PIN confirms it's the officer's own account — from
 * then on, a forgotten officer password can be reset from the login screen by
 * proving the same member credential.
 */
export async function linkRecoveryMember(
  memberName: string,
  credential: string,
): Promise<{ error: string } | { name: string }> {
  const { member } = await requireOfficer();

  const target = await verifyMemberCredential(memberName, credential);
  if (!target) {
    return {
      error:
        "That member name and password/PIN don't match an account. Use your own personal member account.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("members")
    .update({ recovery_member_id: target.id })
    .eq("id", member.id);
  if (error) return { error: error.message };

  revalidatePath("/officer/account");
  return { name: target.full_name };
}

/** Drop the officer→member recovery link. */
export async function unlinkRecoveryMember(): Promise<
  { error: string } | { success: true }
> {
  const { member } = await requireOfficer();

  const admin = createAdminClient();
  const { error } = await admin
    .from("members")
    .update({ recovery_member_id: null })
    .eq("id", member.id);
  if (error) return { error: error.message };

  revalidatePath("/officer/account");
  return { success: true };
}

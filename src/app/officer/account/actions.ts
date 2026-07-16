"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMemberCredential } from "@/lib/member-credentials";
import { listOfficerAccounts } from "@/lib/officer-accounts";
import {
  isOfficer,
  officerLoginEmail,
  officerTitle,
  PERMISSIONS,
  type Permission,
} from "@/lib/roles";

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

// ---------------------------------------------------------------------------
// Officer account management — president only. These all run through the
// admin client because roles, titles, and permission sets are locked to
// server-side writes (see protect_role_change in supabase/schema.sql).
// ---------------------------------------------------------------------------

const NOT_PRESIDENT = "Only the president can manage officer accounts.";

async function requirePresident(): Promise<{ error: string } | { ok: true }> {
  const { member } = await requireOfficer();
  if (member.role !== "president") return { error: NOT_PRESIDENT };
  return { ok: true };
}

/** Keep only known permission keys, coerced to booleans. */
function sanitizePermissions(input: unknown): Record<Permission, boolean> {
  const source =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(
    PERMISSIONS.map((p) => [p.key, source[p.key] === true]),
  ) as Record<Permission, boolean>;
}

function validateTitle(raw: string): { error: string } | { title: string } {
  const title = raw.trim().replace(/\s+/g, " ");
  if (title.length < 2) return { error: "Give the account a title." };
  if (title.length > 60) return { error: "Keep the title under 60 characters." };
  if (!officerLoginEmail(title)) {
    return { error: "Use letters or numbers in the title." };
  }
  return { title };
}

/** Case-insensitive display-title collision against every officer account. */
async function titleTaken(title: string, excludeId?: string): Promise<boolean> {
  const officers = await listOfficerAccounts();
  const wanted = title.toLowerCase();
  return officers.some(
    (o) => o.id !== excludeId && officerTitle(o).toLowerCase() === wanted,
  );
}

/**
 * Create a shared officer login: a title ("Treasurer"), a password to hand to
 * whoever holds the job, and a permission set. The synthetic login address is
 * derived from the title; the person signs in by picking the title on the
 * officer login screen.
 */
export async function createOfficer(input: {
  title: string;
  password: string;
  permissions: Record<string, boolean>;
}): Promise<{ error: string } | { title: string }> {
  const guard = await requirePresident();
  if ("error" in guard) return guard;

  const checked = validateTitle(input.title);
  if ("error" in checked) return checked;
  const { title } = checked;
  if (input.password.length < 8) {
    return { error: "Password needs at least 8 characters." };
  }
  if (await titleTaken(title)) {
    return { error: "There's already an officer account with that title." };
  }

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: officerLoginEmail(title)!,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: title },
  });
  if (error) {
    if (`${error.message}`.toLowerCase().includes("already")) {
      return { error: "There's already an officer account with that title." };
    }
    return { error: error.message };
  }

  // The handle_new_user trigger already made a members row for the login —
  // promote it to a custom officer with its title and permission set.
  const { error: promoteError } = await admin
    .from("members")
    .update({
      role: "officer",
      officer_title: title,
      permissions: sanitizePermissions(input.permissions),
      pin: null,
    })
    .eq("user_id", created.user.id);
  if (promoteError) {
    // Don't leave a half-made login behind as a phantom member.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: promoteError.message };
  }

  revalidatePath("/officer/account");
  return { title };
}

/** Load an editable (non-president) officer row, or explain why not. */
async function loadEditableOfficer(officerId: string): Promise<
  | { error: string }
  | {
      admin: ReturnType<typeof createAdminClient>;
      target: {
        id: string;
        user_id: string | null;
        role: string;
        full_name: string;
        officer_title: string | null;
      };
    }
> {
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("members")
    .select("id, user_id, role, full_name, officer_title")
    .eq("id", officerId)
    .maybeSingle();
  if (!target || !isOfficer(target.role)) {
    return { error: "That officer account no longer exists." };
  }
  if (target.role === "president") {
    return { error: "The president account is fixed — it can't be edited." };
  }
  return { admin, target };
}

/**
 * Save an officer account's title and permission set. Works for custom
 * officers and the classic VP / volunteer coordinator alike (an explicit
 * permission set overrides the classic defaults). Renaming never changes the
 * login: officers sign in by picking the title from a list, which resolves to
 * the account behind it.
 */
export async function updateOfficer(
  officerId: string,
  input: { title: string; permissions: Record<string, boolean> },
): Promise<{ error: string } | { title: string }> {
  const guard = await requirePresident();
  if ("error" in guard) return guard;

  const loaded = await loadEditableOfficer(officerId);
  if ("error" in loaded) return loaded;
  const { admin, target } = loaded;

  const checked = validateTitle(input.title);
  if ("error" in checked) return checked;
  const { title } = checked;
  if (await titleTaken(title, target.id)) {
    return { error: "There's already an officer account with that title." };
  }

  const { error } = await admin
    .from("members")
    .update({
      officer_title: title,
      full_name: title,
      permissions: sanitizePermissions(input.permissions),
    })
    .eq("id", target.id);
  if (error) return { error: error.message };

  revalidatePath("/officer/account");
  return { title };
}

/**
 * Set a fresh password on an officer account — for handing the login to a new
 * board member, or when the current holder forgot it. Signs out anyone still
 * holding the old shared password.
 */
export async function setOfficerPassword(
  officerId: string,
  newPassword: string,
): Promise<{ error: string } | { success: true }> {
  const guard = await requirePresident();
  if ("error" in guard) return guard;

  if (newPassword.length < 8) {
    return { error: "Password needs at least 8 characters." };
  }

  const loaded = await loadEditableOfficer(officerId);
  if ("error" in loaded) return loaded;
  const { admin, target } = loaded;
  if (!target.user_id) return { error: "That account has no login." };

  const { error } = await admin.auth.admin.updateUserById(target.user_id, {
    password: newPassword,
  });
  if (error) return { error: error.message };

  return { success: true };
}

/**
 * Delete an officer account (login + member row). Their sent announcements
 * survive — sender links just go blank. The president account can never be
 * deleted, so there's always someone who can manage the board.
 */
export async function deleteOfficer(
  officerId: string,
): Promise<{ error: string } | { success: true }> {
  const guard = await requirePresident();
  if ("error" in guard) return guard;

  const loaded = await loadEditableOfficer(officerId);
  if ("error" in loaded) return loaded;
  const { admin, target } = loaded;

  if (target.user_id) {
    const { error } = await admin.auth.admin.deleteUser(target.user_id);
    if (error) return { error: error.message };
  }

  const { error } = await admin.from("members").delete().eq("id", target.id);
  if (error) return { error: error.message };

  revalidatePath("/officer/account");
  return { success: true };
}

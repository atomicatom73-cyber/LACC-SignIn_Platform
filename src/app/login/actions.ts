"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { memberLoginEmail } from "@/lib/roles";

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

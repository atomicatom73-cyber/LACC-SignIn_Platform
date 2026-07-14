"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { memberLoginEmail } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthLabel } from "@/lib/studio";

/** Result shape shared by the useActionState forms on this page. */
export type FormState = { error?: string; success?: string } | null;

/** Grant one chore credit to a member (any officer). */
export async function grantCredit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, member } = await requireOfficer();

  const memberId = String(formData.get("member_id") ?? "").trim();
  if (!memberId) return { error: "Missing member." };
  const note = String(formData.get("note") ?? "").trim();

  const { error } = await supabase.from("chore_credits").insert({
    member_id: memberId,
    note: note || null,
    granted_by: member.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return { success: "Credit granted." };
}

/** Delete an unspent credit. Spent credits are history and stay put. */
export async function revokeCredit(
  creditId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer();

  if (!creditId) return { error: "Missing credit." };

  const { data: credit, error: fetchError } = await supabase
    .from("chore_credits")
    .select("id, used_month")
    .eq("id", creditId)
    .maybeSingle();
  if (fetchError) return { error: fetchError.message };
  if (!credit) return { error: "Credit not found." };
  if (credit.used_month !== null) {
    return { error: "That credit was already spent — it can't be revoked." };
  }

  const { error } = await supabase
    .from("chore_credits")
    .delete()
    .eq("id", creditId)
    .is("used_month", null);
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return null;
}

/** Mark a member absent for a month ("YYYY-MM" from a month input). */
export async function markAbsence(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, member } = await requireOfficer();

  const memberId = String(formData.get("member_id") ?? "").trim();
  if (!memberId) return { error: "Missing member." };

  const ym = String(formData.get("month") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return { error: "Pick a month." };
  const month = `${ym}-01`;
  const note = String(formData.get("note") ?? "").trim();

  const { error } = await supabase.from("absences").insert({
    member_id: memberId,
    month,
    note: note || null,
    marked_by: member.id,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: `Already marked absent for ${monthLabel(month)}.` };
    }
    return { error: error.message };
  }

  revalidatePath("/officer/members");
  return { success: `Marked absent for ${monthLabel(month)}.` };
}

/** Remove an absence row (any officer). */
export async function removeAbsence(
  absenceId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer();

  if (!absenceId) return { error: "Missing absence." };

  const { error } = await supabase
    .from("absences")
    .delete()
    .eq("id", absenceId);
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return null;
}

/** Activate/deactivate a member (president + VP). History is kept. */
export async function setActive(
  memberId: string,
  active: boolean,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer(["president", "vice_president"]);

  if (!memberId) return { error: "Missing member." };

  const { error } = await supabase
    .from("members")
    .update({ active })
    .eq("id", memberId);
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return null;
}

const PW_WORDS = [
  "kiln", "glaze", "mesa", "adobe", "raku", "bisque", "terra", "slip",
  "wedge", "ember", "canyon", "aspen", "pinon", "clay", "wheel", "fire",
];

/**
 * President/VP: set a fresh random password on a member's account when
 * they've forgotten theirs. Nobody can see the old password — Supabase only
 * stores a hash — so a reset is the only recovery path. The new password is
 * shown once; the officer hands it to the member. (Members who still know
 * their PIN can also reset it themselves from the login screen.)
 */
export async function resetMemberPassword(
  memberId: string,
): Promise<{ error: string } | { password: string }> {
  const { supabase } = await requireOfficer(["president", "vice_president"]);

  if (!memberId) return { error: "Missing member." };

  const { data: target } = await supabase
    .from("members")
    .select("user_id, role")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return { error: "Member not found." };
  if (target.role !== "member") {
    return { error: "Officer passwords are managed by handing over the shared login." };
  }
  if (!target.user_id) {
    return { error: "They don't have an account yet — nothing to reset." };
  }

  const pick = () => PW_WORDS[Math.floor(Math.random() * PW_WORDS.length)];
  let a = pick();
  let b = pick();
  while (b === a) b = pick();
  const password = `${a}-${b}-${Math.floor(10 + Math.random() * 90)}`;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(target.user_id, {
    password,
  });
  if (error) return { error: error.message };

  return { password };
}

/**
 * President/VP: set a fresh random kiosk PIN on a member when they've
 * forgotten theirs. Shown once, handed over in person. (Members who still
 * know their password can also reset it themselves from the login screen.)
 */
export async function resetMemberPin(
  memberId: string,
): Promise<{ error: string } | { pin: string }> {
  const { supabase } = await requireOfficer(["president", "vice_president"]);

  if (!memberId) return { error: "Missing member." };

  const { data: target } = await supabase
    .from("members")
    .select("id, role")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return { error: "Member not found." };
  if (target.role !== "member") {
    return { error: "Officer accounts don't use kiosk PINs." };
  }

  const pin = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");

  const { error } = await supabase
    .from("members")
    .update({ pin })
    .eq("id", memberId);
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return { pin };
}

/**
 * President/VP: fix a mistyped name. Renames the roster row and, when the
 * member has an account, moves their name-based login to match — they sign
 * in with the corrected name afterwards.
 */
export async function renameMember(
  memberId: string,
  newNameRaw: string,
): Promise<{ error: string } | { name: string }> {
  await requireOfficer(["president", "vice_president"]);

  if (!memberId) return { error: "Missing member." };
  const newName = newNameRaw.trim().replace(/\s+/g, " ");
  if (newName.length < 2) return { error: "Enter the full name." };
  if (newName.length > 80) return { error: "That name is too long." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("members")
    .select("id, user_id, full_name, role")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return { error: "Member not found." };
  if (target.role !== "member") {
    return { error: "Officer accounts can't be renamed." };
  }

  if (target.user_id) {
    const email = memberLoginEmail(newName);
    if (!email) return { error: "Please use letters or numbers in the name." };
    const { error } = await admin.auth.admin.updateUserById(target.user_id, {
      email,
      email_confirm: true,
      user_metadata: { full_name: newName },
    });
    if (error) {
      if (`${error.message}`.toLowerCase().includes("already")) {
        return {
          error:
            "Another account already uses that name — add a middle name or initial.",
        };
      }
      return { error: error.message };
    }
  }

  const { error } = await admin
    .from("members")
    .update({ full_name: newName })
    .eq("id", memberId);
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return { name: newName };
}

/**
 * President/VP: permanently delete a member — their login and their whole
 * history (shifts, jobs, credits, absences, messages) via FK cascades. The
 * escape hatch for someone who forgot both password and PIN: delete the
 * account and let them create a fresh one.
 */
export async function deleteMemberAccount(
  memberId: string,
): Promise<{ error: string } | null> {
  await requireOfficer(["president", "vice_president"]);

  if (!memberId) return { error: "Missing member." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return { error: "Member not found." };
  if (target.role !== "member") {
    return { error: "Officer accounts can't be deleted." };
  }

  if (target.user_id) {
    const { error } = await admin.auth.admin.deleteUser(target.user_id);
    if (error) return { error: error.message };
  }

  const { error } = await admin.from("members").delete().eq("id", memberId);
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return null;
}

/**
 * Add a kiosk-only member (president + VP). With an email they're on the
 * announcement list right away; registering with that email (or the same
 * name) later claims this row automatically.
 */
export async function addMember(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase } = await requireOfficer(["president", "vice_president"]);

  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return { error: "Enter the member's full name." };

  const pin = String(formData.get("pin") ?? "").trim();
  if (pin && !/^\d{4}$/.test(pin)) {
    return { error: "PIN must be exactly 4 digits (or leave it blank)." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email doesn't look right (or leave it blank)." };
  }
  if (email) {
    const { data: taken } = await supabase
      .from("members")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (taken) return { error: "That email is already on another member." };
  }

  const { error } = await supabase.from("members").insert({
    full_name: fullName,
    pin: pin || null,
    email: email || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return { success: `${fullName} added to the roster.` };
}

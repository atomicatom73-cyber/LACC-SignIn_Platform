"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
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
 * President-only: set a fresh random password on a member's account when
 * they've forgotten theirs. Nobody can see the old password — Supabase only
 * stores a hash — so a reset is the only recovery path. The new password is
 * shown once; the president hands it to the member.
 */
export async function resetMemberPassword(
  memberId: string,
): Promise<{ error: string } | { password: string }> {
  const { supabase } = await requireOfficer(["president"]);

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

/** Add a kiosk-only member (president + VP). They can claim it later. */
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

  const { error } = await supabase.from("members").insert({
    full_name: fullName,
    pin: pin || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/officer/members");
  return { success: `${fullName} added to the roster.` };
}

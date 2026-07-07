"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Toggle a member's shift from the shared kiosk. Members who set a 4-digit
 * PIN must enter it; members without one (added by an officer, or from
 * before PINs existed) tap straight through.
 */
export async function toggleKioskShift(
  memberId: string,
  pin: string,
): Promise<{ nowIn: boolean; name: string } | { error: string }> {
  const supabase = createAdminClient();

  const { data: member, error: memberErr } = await supabase
    .from("members")
    .select("id, full_name, pin")
    .eq("id", memberId)
    .single();
  if (memberErr || !member) return { error: "Member not found." };

  if (member.pin && member.pin !== pin.trim()) {
    return { error: "Wrong PIN. Try again." };
  }

  const { data: openShift } = await supabase
    .from("shifts")
    .select("id")
    .eq("member_id", memberId)
    .is("signed_out_at", null)
    .maybeSingle();

  if (openShift) {
    await supabase
      .from("shifts")
      .update({ signed_out_at: new Date().toISOString() })
      .eq("id", openShift.id);
    revalidatePath("/kiosk");
    return { nowIn: false, name: member.full_name };
  }

  await supabase
    .from("shifts")
    .insert({ member_id: memberId, source: "kiosk" });
  revalidatePath("/kiosk");
  return { nowIn: true, name: member.full_name };
}

export type SignInFormState =
  | { error: string }
  | { success: true; name: string }
  | null;

/**
 * Sign a guest in under a host member picked on the kiosk. The host must
 * currently be signed in — guests always come in with a member.
 */
export async function kioskGuestSignIn(
  _prev: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const hostMemberId = String(formData.get("host_member_id") ?? "").trim();
  const guestName = String(formData.get("guest_name") ?? "").trim();
  if (!hostMemberId) return { error: "Pick which member is bringing you in." };
  if (!guestName) return { error: "Enter the guest's name." };
  if (guestName.length > 80) return { error: "That name is too long." };

  const supabase = createAdminClient();

  const { data: openShift } = await supabase
    .from("shifts")
    .select("id")
    .eq("member_id", hostMemberId)
    .is("signed_out_at", null)
    .maybeSingle();
  if (!openShift) {
    return { error: "That member isn't signed in — sign in first, then bring your guest." };
  }

  const { error } = await supabase
    .from("guest_signins")
    .insert({ host_member_id: hostMemberId, guest_name: guestName });
  if (error) return { error: error.message };

  return { success: true, name: guestName };
}

/** Sign a class student in by name + class label (e.g. "wednesday night class"). */
export async function studentSignIn(
  _prev: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const studentName = String(formData.get("student_name") ?? "").trim();
  const classLabel = String(formData.get("class_label") ?? "").trim();
  if (!studentName) return { error: "Enter your name." };
  if (!classLabel) return { error: "Enter which class you're here for." };
  if (studentName.length > 80 || classLabel.length > 80) {
    return { error: "Keep the name and class under 80 characters." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("student_signins")
    .insert({ student_name: studentName, class_label: classLabel });
  if (error) return { error: error.message };

  return { success: true, name: studentName };
}

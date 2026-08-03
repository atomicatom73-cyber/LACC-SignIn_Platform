"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestSigninLogExport } from "@/lib/signin-log-sheet";

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
    .select("id, full_name, pin, user_id")
    .eq("id", memberId)
    .single();
  if (memberErr || !member) return { error: "Member not found." };

  // Quick sign-in is for members with an app account — the roster UI walks
  // account-less members to signup, and this backstops stale clients.
  if (!member.user_id) {
    return { error: "Create an account first — then you can sign in here." };
  }

  if (member.pin && member.pin !== pin.trim()) {
    return { error: "Wrong PIN. Try again." };
  }

  const { data: openShift } = await supabase
    .from("shifts")
    .select("id, signed_in_at")
    .eq("member_id", memberId)
    .is("signed_out_at", null)
    .maybeSingle();

  if (openShift) {
    const now = new Date().toISOString();
    const { error: signOutErr } = await supabase
      .from("shifts")
      .update({ signed_out_at: now })
      .eq("id", openShift.id);
    // Never report a sign-out that didn't happen: someone who walks away
    // believing they're clocked out is the failure that costs them hours.
    if (signOutErr) {
      return { error: "That didn't save — please try again." };
    }
    // Guests come in with their host, so they leave with them too — close any
    // guest rows from this shift so the logs show an out time.
    await supabase
      .from("guest_signins")
      .update({ signed_out_at: now })
      .eq("host_member_id", memberId)
      .is("signed_out_at", null)
      .gte("signed_in_at", openShift.signed_in_at);
    revalidatePath("/kiosk");
    after(requestSigninLogExport);
    return { nowIn: false, name: member.full_name };
  }

  const { error: signInErr } = await supabase
    .from("shifts")
    .insert({ member_id: memberId, source: "kiosk" });
  // `shifts_one_open_per_member` means a shift opened between the read above
  // and this insert — their phone's queue draining, or a tap on another screen.
  // They're signed in either way, which is what this tap asked for.
  if (signInErr && !isUniqueViolation(signInErr)) {
    return { error: "That didn't save — please try again." };
  }
  revalidatePath("/kiosk");
  after(requestSigninLogExport);
  return { nowIn: true, name: member.full_name };
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === "23505";
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

  after(requestSigninLogExport);
  return { success: true, name: guestName };
}

export type StudentFormState =
  | { error: string }
  | { success: true; name: string; openStudio: boolean }
  | null;

/**
 * Sign a student in — for a class (presence-only) or for open studio time
 * (they sign out from the kiosk later). Both say which class: the one
 * they're here for, or the one their open-studio time comes with.
 */
export async function studentSignIn(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const openStudio = formData.get("session_type") === "open_studio";
  const studentName = String(formData.get("student_name") ?? "").trim();
  const classLabel = String(formData.get("class_label") ?? "").trim();
  if (!studentName) return { error: "Enter your name." };
  if (!classLabel) {
    return {
      error: openStudio
        ? "Enter which class you did."
        : "Enter which class you're here for.",
    };
  }
  if (studentName.length > 80 || classLabel.length > 80) {
    return { error: "Keep the name and class under 80 characters." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("student_signins").insert({
    student_name: studentName,
    class_label: classLabel,
    session_type: openStudio ? "open_studio" : "class",
  });
  if (error) return { error: error.message };

  revalidatePath("/kiosk/student");
  after(requestSigninLogExport);
  return { success: true, name: studentName, openStudio };
}

/** Sign an open-studio student out from the kiosk. */
export async function studentSignOut(
  signinId: string,
): Promise<{ name: string } | { error: string }> {
  if (!signinId) return { error: "Missing sign-in." };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("student_signins")
    .update({ signed_out_at: new Date().toISOString() })
    .eq("id", signinId)
    .eq("session_type", "open_studio")
    .is("signed_out_at", null)
    .select("student_name")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Already signed out — you're all set." };

  revalidatePath("/kiosk/student");
  after(requestSigninLogExport);
  return { name: data.student_name };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSchedule } from "@/lib/chores";
import { requestSigninLogExport } from "@/lib/signin-log-sheet";

/** Toggle the current user's shift: clock in if out, clock out if in. */
export async function toggleShift() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!member) throw new Error("No member profile found.");

  const { data: openShift } = await supabase
    .from("shifts")
    .select("id, signed_in_at")
    .eq("member_id", member.id)
    .is("signed_out_at", null)
    .maybeSingle();

  if (openShift) {
    const now = new Date().toISOString();
    await supabase
      .from("shifts")
      .update({ signed_out_at: now })
      .eq("id", openShift.id);
    // Guests leave with their host. Service role: members can't update
    // guest_signins rows under RLS.
    await createAdminClient()
      .from("guest_signins")
      .update({ signed_out_at: now })
      .eq("host_member_id", member.id)
      .is("signed_out_at", null)
      .gte("signed_in_at", openShift.signed_in_at);
  } else {
    await supabase
      .from("shifts")
      .insert({ member_id: member.id, source: "phone" });
  }

  revalidatePath("/me");
  after(requestSigninLogExport);
}

/** Mark one of the current user's chores done (or back to pending). */
export async function toggleMyChore(assignmentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!member) return { error: "No member profile found." };

  const { data: assignment } = await supabase
    .from("chore_assignments")
    .select("id, status")
    .eq("id", assignmentId)
    .eq("member_id", member.id)
    .maybeSingle();
  if (!assignment) return { error: "Job not found." };

  const completing = assignment.status === "pending";
  const { error } = await supabase
    .from("chore_assignments")
    .update({
      status: completing ? "completed" : "pending",
      completed_at: completing ? new Date().toISOString() : null,
    })
    .eq("id", assignment.id);
  if (error) return { error: error.message };

  revalidatePath("/me");
  return null;
}

/**
 * Say when you'll do one of your jobs (jobs whose `scheduling_enabled` is on).
 * A blank date clears it. RLS + protect_assignment_update keep this to the
 * member's own rows and to the scheduled_at column.
 */
export async function setMyChoreSchedule(
  assignmentId: string,
  date: string,
  time: string,
): Promise<{ error: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!member) return { error: "No member profile found." };

  const scheduled = parseSchedule(date, time);
  if (typeof scheduled !== "string" && scheduled !== null) return scheduled;

  const { error } = await supabase
    .from("chore_assignments")
    .update({ scheduled_at: scheduled })
    .eq("id", assignmentId)
    .eq("member_id", member.id);
  if (error) return { error: error.message };

  revalidatePath("/me");
  return null;
}

export type GuestFormState =
  | { error: string }
  | { success: true; name: string }
  | null;

/**
 * Sign a guest in under the logged-in member. Only works while the member
 * is clocked in — guests always come in with a member.
 */
export async function myGuestSignIn(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!member) return { error: "No member profile found." };

  const guestName = String(formData.get("guest_name") ?? "").trim();
  if (!guestName) return { error: "Enter the guest's name." };
  if (guestName.length > 80) return { error: "That name is too long." };

  const { data: openShift } = await supabase
    .from("shifts")
    .select("id")
    .eq("member_id", member.id)
    .is("signed_out_at", null)
    .maybeSingle();
  if (!openShift) {
    return { error: "Clock in first — guests come in with a signed-in member." };
  }

  // Insert with the service role: members only have RLS access to their own
  // rows, and guest records belong to the studio, not the member.
  const admin = createAdminClient();
  const { error } = await admin
    .from("guest_signins")
    .insert({ host_member_id: member.id, guest_name: guestName });
  if (error) return { error: error.message };

  after(requestSigninLogExport);
  return { success: true, name: guestName };
}

export async function signOutAuth() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

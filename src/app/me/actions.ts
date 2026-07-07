"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id")
    .eq("member_id", member.id)
    .is("signed_out_at", null)
    .maybeSingle();

  if (openShift) {
    await supabase
      .from("shifts")
      .update({ signed_out_at: new Date().toISOString() })
      .eq("id", openShift.id);
  } else {
    await supabase
      .from("shifts")
      .insert({ member_id: member.id, source: "phone" });
  }

  revalidatePath("/me");
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

  return { success: true, name: guestName };
}

export async function signOutAuth() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

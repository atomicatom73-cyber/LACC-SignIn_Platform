"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

export async function signOutAuth() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

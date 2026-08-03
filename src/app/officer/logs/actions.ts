"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { requestSigninLogExport } from "@/lib/signin-log-sheet";
import { after } from "next/server";

/**
 * Clear a sign-in conflict once an officer has settled the day.
 *
 * Settling it means editing the shift itself if it needs editing — this only
 * takes the reminder off the page. Nothing about the log changes here, which is
 * the point: the app never guessed, and the officer's correction (if any) is
 * the only thing that reaches the sheet.
 */
export async function resolveSigninConflict(id: string) {
  const { supabase, member } = await requireOfficer("logs");

  const { error } = await supabase
    .from("signin_conflicts")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: member!.id,
    })
    .eq("id", id)
    .is("resolved_at", null);
  if (error) return { error: error.message };

  revalidatePath("/officer/logs");
  // An officer who fixed a shift by hand before clearing this wants the sheet
  // to catch up now, not on the next sign-in.
  after(requestSigninLogExport);
  return { success: true };
}

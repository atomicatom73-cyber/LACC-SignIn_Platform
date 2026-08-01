"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { isVolunteerCoordinator } from "@/lib/roles";

/**
 * Clear a member's note off the coordinator's dashboard. The note itself is
 * kept (it stays visible to whoever wrote it) — this just files it.
 *
 * Only the volunteer coordinator can do this, matching who can see notes at
 * all; the job_notes policies and protect_job_note_update enforce the same
 * rule in the database.
 */
export async function markNoteHandled(
  noteId: string,
): Promise<{ error: string } | null> {
  const { supabase, member } = await requireOfficer();
  if (!isVolunteerCoordinator(member)) {
    return { error: "Only the volunteer coordinator can file notes." };
  }

  const { error } = await supabase
    .from("job_notes")
    .update({ handled_at: new Date().toISOString(), handled_by: member.id })
    .eq("id", noteId);
  if (error) return { error: error.message };

  revalidatePath("/officer");
  return null;
}

/** Put a filed note back on the dashboard. */
export async function reopenNote(
  noteId: string,
): Promise<{ error: string } | null> {
  const { supabase, member } = await requireOfficer();
  if (!isVolunteerCoordinator(member)) {
    return { error: "Only the volunteer coordinator can file notes." };
  }

  const { error } = await supabase
    .from("job_notes")
    .update({ handled_at: null, handled_by: null })
    .eq("id", noteId);
  if (error) return { error: error.message };

  revalidatePath("/officer");
  return null;
}

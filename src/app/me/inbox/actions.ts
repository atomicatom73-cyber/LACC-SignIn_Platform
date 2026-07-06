"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";

/** Mark one of the current member's announcements read (first open only). */
export async function markRead(
  messageId: string,
): Promise<{ error: string } | null> {
  const { supabase, member } = await requireMember();
  if (!member) return { error: "No member profile found." };
  if (!messageId) return { error: "Missing message id." };

  const { error } = await supabase
    .from("message_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .eq("member_id", member.id)
    .is("read_at", null);

  if (error) return { error: error.message };

  revalidatePath("/me/inbox");
  revalidatePath("/me"); // the /me banner shows the unread count
  return null;
}

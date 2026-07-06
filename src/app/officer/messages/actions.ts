"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";

export type SendMessageState = { error?: string; success?: string } | null;

/**
 * Compose an announcement: insert the message row, then materialize one
 * recipient row per member so read receipts work.
 */
export async function sendMessage(
  _prev: SendMessageState,
  formData: FormData,
): Promise<SendMessageState> {
  const { supabase, member } = await requireOfficer();

  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const audienceRaw = String(formData.get("audience") ?? "");
  const audience =
    audienceRaw === "all" || audienceRaw === "selected" ? audienceRaw : null;

  if (!subject) return { error: "Add a subject." };
  if (!body) return { error: "Write a message body." };
  if (!audience) return { error: "Pick an audience." };

  let recipientIds: string[];
  if (audience === "all") {
    const { data, error } = await supabase
      .from("members")
      .select("id")
      .eq("role", "member")
      .eq("active", true);
    if (error) return { error: error.message };
    recipientIds = (data ?? []).map((m: { id: string }) => m.id);
  } else {
    const picked = formData.getAll("recipients").map(String).filter(Boolean);
    if (picked.length === 0) {
      return { error: "Choose at least one member." };
    }
    // Only send to real, active members — silently drops stale ids.
    const { data, error } = await supabase
      .from("members")
      .select("id")
      .in("id", picked)
      .eq("role", "member")
      .eq("active", true);
    if (error) return { error: error.message };
    recipientIds = (data ?? []).map((m: { id: string }) => m.id);
  }

  if (recipientIds.length === 0) {
    return { error: "No active members to send to." };
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      sender_id: member.id,
      sender_role: member.role,
      subject,
      body,
      audience,
    })
    .select("id")
    .single();
  if (messageError || !message) {
    return { error: messageError?.message ?? "Couldn't send the message." };
  }

  const { error: recipientsError } = await supabase
    .from("message_recipients")
    .insert(
      recipientIds.map((member_id) => ({
        message_id: message.id,
        member_id,
      })),
    );
  if (recipientsError) {
    // Best-effort cleanup so a message with no recipients doesn't linger
    // (RLS may block delete for the volunteer coordinator — that's fine).
    await supabase.from("messages").delete().eq("id", message.id);
    return { error: `Couldn't add recipients: ${recipientsError.message}` };
  }

  revalidatePath("/officer/messages");
  return {
    success: `Sent to ${recipientIds.length} member${
      recipientIds.length === 1 ? "" : "s"
    }.`,
  };
}

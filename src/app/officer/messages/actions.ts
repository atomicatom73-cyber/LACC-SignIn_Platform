"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderAnnouncementEmail, sendEmail, siteUrl } from "@/lib/email";

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
  const audience = (
    ["active", "inactive", "everyone", "selected"] as const
  ).find((a) => a === audienceRaw);

  if (!subject) return { error: "Add a subject." };
  if (!body) return { error: "Write a message body." };
  if (!audience) return { error: "Pick an audience." };

  let recipientIds: string[];
  if (audience === "selected") {
    const picked = formData.getAll("recipients").map(String).filter(Boolean);
    if (picked.length === 0) {
      return { error: "Choose at least one member." };
    }
    // Only send to real members — silently drops stale ids. Inactive members
    // are fine here: picking one by hand is explicit enough.
    const { data, error } = await supabase
      .from("members")
      .select("id")
      .in("id", picked)
      .eq("role", "member");
    if (error) return { error: error.message };
    recipientIds = (data ?? []).map((m: { id: string }) => m.id);
  } else {
    // Status filters: 'active' / 'inactive' / 'everyone'. Account-less
    // members (imported from the roster sheet or officer-added) count too —
    // they can't read the in-app inbox yet, but the email step below still
    // reaches anyone with an address on file.
    let query = supabase.from("members").select("id").eq("role", "member");
    if (audience === "active") query = query.eq("active", true);
    if (audience === "inactive") query = query.eq("active", false);
    const { data, error } = await query;
    if (error) return { error: error.message };
    recipientIds = (data ?? []).map((m: { id: string }) => m.id);
  }

  if (recipientIds.length === 0) {
    return { error: "No members match that audience." };
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

  // Email the announcement to recipients who have an address on file and
  // haven't opted out. Best-effort and non-blocking to the outcome: a mail
  // hiccup (or missing Resend key) must never fail a sent announcement. Uses
  // the admin client so the lookup doesn't depend on the officer's RLS view.
  await notifyByEmail(recipientIds, subject, body);

  revalidatePath("/officer/messages");
  return {
    success: `Sent to ${recipientIds.length} member${
      recipientIds.length === 1 ? "" : "s"
    }.`,
  };
}

async function notifyByEmail(
  recipientIds: string[],
  subject: string,
  body: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("members")
      .select("full_name, email")
      .in("id", recipientIds)
      .eq("notify_by_email", true)
      .not("email", "is", null);

    const targets = (data ?? []).filter(
      (m): m is { full_name: string; email: string } => Boolean(m.email),
    );
    if (targets.length === 0) return;

    const url = `${siteUrl()}/me/inbox`;
    await Promise.allSettled(
      targets.map((m) =>
        sendEmail({
          to: m.email,
          subject: `New announcement: ${subject}`,
          text: `Hi ${m.full_name.split(" ")[0] || m.full_name},\n\nYou have a new announcement from the LACC officers:\n\n${subject}\n\n${body}\n\nOpen your inbox: ${url}\n`,
          html: renderAnnouncementEmail({
            name: m.full_name,
            subject,
            body,
            url,
          }),
        }),
      ),
    );
  } catch (err) {
    console.error("[messages] email notification step failed:", err);
  }
}

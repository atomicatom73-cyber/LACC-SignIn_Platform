"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import {
  deliverMessage,
  isComposeAudience,
  resolveAudienceIds,
  sendDraft,
  validateRecipientIds,
} from "@/lib/messages";
import { officerTitle } from "@/lib/roles";
import { studioToUtcIso } from "@/lib/studio";

export type SendMessageState = {
  error?: string;
  success?: string;
  /** Tells the composer to clear itself (a send) or just re-read its draft id. */
  cleared?: boolean;
  draftId?: string;
} | null;

/**
 * One action behind all three composer buttons — Send, Save draft, and
 * Schedule — because they share every field and all the validation. The
 * clicked button contributes `intent` to the form data.
 */
export async function submitCompose(
  _prev: SendMessageState,
  formData: FormData,
): Promise<SendMessageState> {
  const { supabase, member } = await requireOfficer("messages");

  const intent = String(formData.get("intent") ?? "send");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const audienceRaw = String(formData.get("audience") ?? "");
  const draftId = String(formData.get("draft_id") ?? "").trim() || null;
  // The composer sets this when the officer added or removed anyone from the
  // group's list, which decides whether the recipients are pinned or resolved
  // fresh at send time.
  const edited = String(formData.get("edited") ?? "") === "1";
  const picked = formData.getAll("recipients").map(String).filter(Boolean);

  if (!isComposeAudience(audienceRaw)) return { error: "Pick an audience." };
  const audience = audienceRaw;

  // A draft is allowed to be half-finished; anything that sends is not.
  if (intent !== "draft") {
    if (!subject) return { error: "Add a subject." };
    if (!body) return { error: "Write a message body." };
  }

  // Pin the list when it's hand-picked or hand-edited; otherwise leave it null
  // so the group is resolved when the message actually goes out.
  const pinned = audience === "selected" || edited ? picked : null;

  if (intent === "draft" || intent === "schedule") {
    let scheduledFor: string | null = null;
    if (intent === "schedule") {
      const date = String(formData.get("send_date") ?? "").trim();
      const time = String(formData.get("send_time") ?? "").trim();
      if (!date) return { error: "Pick a date to send it." };
      scheduledFor = studioToUtcIso(date, time || "09:00");
      if (new Date(scheduledFor).getTime() < Date.now() - 60_000) {
        return { error: "That time has already passed." };
      }
      if (pinned !== null && pinned.length === 0) {
        return { error: "Choose at least one member." };
      }
    }

    const row = {
      author_id: member.id,
      subject,
      body,
      audience,
      recipient_ids: pinned,
      edited,
      scheduled_for: scheduledFor,
      send_error: null,
    };

    const saved = draftId
      ? await supabase
          .from("message_drafts")
          .update(row)
          .eq("id", draftId)
          .is("sent_at", null)
          .select("id")
          .maybeSingle()
      : await supabase.from("message_drafts").insert(row).select("id").single();

    if (saved.error) return { error: saved.error.message };
    if (!saved.data) return { error: "That draft has already been sent." };

    revalidatePath("/officer/messages");
    return {
      success:
        intent === "schedule"
          ? `Scheduled for ${formatWhen(scheduledFor!)}.`
          : "Draft saved.",
      cleared: true,
    };
  }

  // --- Send now ------------------------------------------------------------

  let recipientIds: string[];
  if (pinned !== null) {
    if (pinned.length === 0) return { error: "Choose at least one member." };
    // Only send to real members — silently drops stale ids. Inactive members
    // are fine here: picking one by hand is explicit enough.
    const checked = await validateRecipientIds(supabase, pinned);
    if ("error" in checked) return { error: checked.error };
    recipientIds = checked.ids;
  } else {
    const resolved = await resolveAudienceIds(supabase, audience);
    if ("error" in resolved) return { error: resolved.error };
    recipientIds = resolved.ids;
  }

  const result = await deliverMessage({
    client: supabase,
    senderId: member.id,
    // Classic accounts store their role; custom officers store their title
    // ("Treasurer") so the inbox shows who it came from even if the officer
    // account is later renamed or deleted.
    senderRole: member.role === "officer" ? officerTitle(member) : member.role,
    subject,
    body,
    audience,
    audienceEdited: edited,
    recipientIds,
  });
  if ("error" in result) return { error: result.error };

  // Sending a draft retires it — the sent list is where it lives now.
  if (draftId) {
    await supabase.from("message_drafts").delete().eq("id", draftId);
  }

  revalidatePath("/officer/messages");
  return {
    success: `Sent to ${result.recipients} member${
      result.recipients === 1 ? "" : "s"
    }.`,
    cleared: true,
  };
}

/** Bin a draft (or a scheduled send that hasn't gone yet). */
export async function deleteDraft(
  draftId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("messages");
  const { error } = await supabase
    .from("message_drafts")
    .delete()
    .eq("id", draftId);
  if (error) return { error: error.message };
  revalidatePath("/officer/messages");
  return null;
}

/** Send a saved draft as-is, without loading it back into the composer. */
export async function sendDraftNow(
  draftId: string,
): Promise<{ error: string } | { success: string }> {
  const { supabase } = await requireOfficer("messages");

  const { data: draft, error } = await supabase
    .from("message_drafts")
    .select("id, author_id, subject, body, audience, recipient_ids, edited")
    .eq("id", draftId)
    .is("sent_at", null)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!draft) return { error: "That draft has already been sent." };

  const result = await sendDraft(supabase, draft);
  if ("error" in result) return { error: result.error };

  await supabase.from("message_drafts").delete().eq("id", draftId);
  revalidatePath("/officer/messages");
  return {
    success: `Sent to ${result.recipients} member${
      result.recipients === 1 ? "" : "s"
    }.`,
  };
}

/**
 * Fire any scheduled messages that have come due. Called from page loads (see
 * lib/messages.ts for why) — never awaited by the render.
 */
export async function flushScheduledMessages(): Promise<void> {
  const { flushDueMessages } = await import("@/lib/messages");
  try {
    const result = await flushDueMessages();
    if (result.sent > 0 || result.failed > 0) {
      console.log("[messages] scheduled flush", result);
      revalidatePath("/officer/messages");
    }
  } catch (err) {
    console.error("[messages] scheduled flush failed:", err);
  }
}

/** Local (non-exported — "use server" only exports async functions). */
function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

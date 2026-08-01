/**
 * Announcement delivery, shared by the compose action and the scheduled-send
 * flush so a message that goes out at 3pm on Tuesday is assembled exactly like
 * one sent by hand.
 *
 * SERVER ONLY — the flush uses the service role.
 */

import {
  renderAnnouncementEmail,
  type SentBy,
  sendEmail,
  siteUrl,
} from "@/lib/email";
import { officerTitle, roleOrTitleLabel } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageAudience } from "@/lib/types";

/** Audiences an officer can pick in the composer ('all' is legacy-only). */
export const COMPOSE_AUDIENCES = [
  "active",
  "inactive",
  "kiln_team",
  "everyone",
  "selected",
] as const;

export type ComposeAudience = (typeof COMPOSE_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<ComposeAudience, string> = {
  active: "Active members",
  inactive: "Inactive members",
  kiln_team: "Kiln team",
  everyone: "Everyone",
  selected: "Chosen members",
};

export function isComposeAudience(value: string): value is ComposeAudience {
  return (COMPOSE_AUDIENCES as readonly string[]).includes(value);
}

/** Minimal Supabase client shape these helpers need (session or service role). */
type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * Who is in an audience group right now. Deliberately resolved at send time
 * (not when a message is composed or scheduled) so a member who joins between
 * writing and sending still gets it. Account-less members count: they can't
 * read the in-app inbox yet, but the email step still reaches anyone with an
 * address on file.
 */
export async function resolveAudienceIds(
  client: Client,
  audience: ComposeAudience,
): Promise<{ ids: string[] } | { error: string }> {
  let query = client.from("members").select("id").eq("role", "member");
  if (audience === "active") query = query.eq("active", true);
  if (audience === "inactive") query = query.eq("active", false);
  // The kiln team is a standing group of people who are here — an inactive
  // member on it isn't someone you're trying to reach.
  if (audience === "kiln_team") {
    query = query.eq("kiln_team", true).eq("active", true);
  }
  const { data, error } = await query;
  if (error) return { error: error.message };
  return { ids: (data ?? []).map((m: { id: string }) => m.id) };
}

/** Drop ids that aren't real member rows (stale picks, deleted people). */
export async function validateRecipientIds(
  client: Client,
  ids: string[],
): Promise<{ ids: string[] } | { error: string }> {
  if (ids.length === 0) return { ids: [] };
  const { data, error } = await client
    .from("members")
    .select("id")
    .in("id", ids)
    .eq("role", "member");
  if (error) return { error: error.message };
  return { ids: (data ?? []).map((m: { id: string }) => m.id) };
}

/**
 * Insert the message and materialize one recipient row per member (so read
 * receipts work), then email whoever has an address on file.
 */
export async function deliverMessage(args: {
  client: Client;
  senderId: string;
  senderRole: string;
  subject: string;
  body: string;
  audience: MessageAudience;
  audienceEdited: boolean;
  recipientIds: string[];
}): Promise<{ error: string } | { messageId: string; recipients: number }> {
  const { client, recipientIds } = args;
  if (recipientIds.length === 0) {
    return { error: "No members match that audience." };
  }

  const { data: message, error: messageError } = await client
    .from("messages")
    .insert({
      sender_id: args.senderId,
      sender_role: args.senderRole,
      subject: args.subject,
      body: args.body,
      audience: args.audience,
      audience_edited: args.audienceEdited,
    })
    .select("id")
    .single();
  if (messageError || !message) {
    return { error: messageError?.message ?? "Couldn't send the message." };
  }

  const { error: recipientsError } = await client
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
    await client.from("messages").delete().eq("id", message.id);
    return { error: `Couldn't add recipients: ${recipientsError.message}` };
  }

  await notifyByEmail(recipientIds, args.subject, args.body, {
    senderId: args.senderId,
    senderRole: args.senderRole,
  });

  return { messageId: message.id as string, recipients: recipientIds.length };
}

/**
 * Name and title of the officer behind an announcement, for the "Sent by" line
 * and the no-reply footnote. Best-effort: a lookup that fails just means the
 * footnote says "an officer" instead of naming them.
 */
async function resolveSender(
  admin: ReturnType<typeof createAdminClient>,
  sender: { senderId: string; senderRole: string },
): Promise<SentBy | null> {
  const { data } = await admin
    .from("members")
    .select("full_name")
    .eq("id", sender.senderId)
    .maybeSingle();
  if (!data?.full_name) return null;
  // senderRole already holds the display title for custom officers; the
  // classic roles are stored as keys and need the label lookup.
  return { name: data.full_name, title: roleOrTitleLabel(sender.senderRole) };
}

/**
 * Email the announcement to recipients who have an address on file and haven't
 * opted out. Best-effort and non-blocking to the outcome: a mail hiccup (or a
 * missing Resend key) must never fail a sent announcement. Uses the admin
 * client so the lookup doesn't depend on the officer's RLS view.
 */
async function notifyByEmail(
  recipientIds: string[],
  subject: string,
  body: string,
  sender: { senderId: string; senderRole: string },
): Promise<void> {
  try {
    const admin = createAdminClient();
    const sentBy = await resolveSender(admin, sender);
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
          text: `Hi ${m.full_name.split(" ")[0] || m.full_name},\n\nYou have a new announcement from the LACC officers:\n\n${subject}\n\n${body}\n\nOpen your inbox: ${url}\n${
            sentBy ? `\nSent by ${sentBy.name}${sentBy.title ? `, ${sentBy.title}` : ""}\n` : ""
          }`,
          html: renderAnnouncementEmail({
            name: m.full_name,
            subject,
            body,
            url,
            sentBy,
          }),
          sentBy,
        }),
      ),
    );
  } catch (err) {
    console.error("[messages] email notification step failed:", err);
  }
}

/**
 * Send every scheduled message that has come due.
 *
 * Vercel Hobby allows two cron jobs (both spoken for) and only daily ones, so
 * this can't be a minute-by-minute worker. Instead it runs opportunistically on
 * page loads — cheap, because the partial index means "nothing due" is an empty
 * index scan — with the daily members-sync cron as the backstop. In practice a
 * scheduled message goes out within minutes of its time, and by the next
 * morning at the latest.
 *
 * Runs with the service role: the author isn't around to lend their session.
 */
export async function flushDueMessages(): Promise<{
  sent: number;
  failed: number;
}> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin
    .from("message_drafts")
    .select(
      "id, author_id, subject, body, audience, recipient_ids, edited, scheduled_for",
    )
    .is("sent_at", null)
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(25);

  if (error || !due || due.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const draft of due) {
    // Claim it first: two page loads can race into this function, and a
    // double-sent announcement is worse than a late one. The `is null` guard
    // means only one of them gets the row.
    const { data: claimed } = await admin
      .from("message_drafts")
      .update({ sent_at: nowIso })
      .eq("id", draft.id)
      .is("sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const result = await sendDraft(admin, draft);
    if ("error" in result) {
      failed++;
      // Hand it back so the officer can see what went wrong and retry.
      await admin
        .from("message_drafts")
        .update({ sent_at: null, send_error: result.error })
        .eq("id", draft.id);
    } else {
      sent++;
      await admin
        .from("message_drafts")
        .update({ message_id: result.messageId, send_error: null })
        .eq("id", draft.id);
    }
  }

  return { sent, failed };
}

type DraftRow = {
  id: string;
  author_id: string;
  subject: string;
  body: string;
  audience: string;
  recipient_ids: string[] | null;
  edited: boolean;
};

/**
 * Turn one draft row into a sent announcement. Shared by the flush and the
 * "send now" button on a saved draft.
 */
export async function sendDraft(
  client: Client,
  draft: DraftRow,
): Promise<{ error: string } | { messageId: string; recipients: number }> {
  if (!draft.subject.trim()) return { error: "The draft has no subject." };
  if (!draft.body.trim()) return { error: "The draft has no message body." };

  const audience = isComposeAudience(draft.audience)
    ? draft.audience
    : "active";

  // A hand-edited list was pinned when the officer edited it; a plain group
  // resolves now, so it reaches whoever is in that group today.
  let recipientIds: string[];
  if (draft.recipient_ids && draft.recipient_ids.length > 0) {
    const checked = await validateRecipientIds(client, draft.recipient_ids);
    if ("error" in checked) return { error: checked.error };
    recipientIds = checked.ids;
  } else {
    const resolved = await resolveAudienceIds(client, audience);
    if ("error" in resolved) return { error: resolved.error };
    recipientIds = resolved.ids;
  }

  const { data: author } = await client
    .from("members")
    .select("id, role, officer_title")
    .eq("id", draft.author_id)
    .maybeSingle();
  if (!author) return { error: "The officer who wrote this no longer exists." };

  return deliverMessage({
    client,
    senderId: author.id,
    senderRole:
      author.role === "officer" ? officerTitle(author) : author.role,
    subject: draft.subject.trim(),
    body: draft.body.trim(),
    audience,
    audienceEdited: draft.edited,
    recipientIds,
  });
}

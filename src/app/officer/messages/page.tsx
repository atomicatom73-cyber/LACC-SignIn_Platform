import { after } from "next/server";
import { requireOfficer } from "@/lib/auth";
import { isComposeAudience } from "@/lib/messages";
import type { Role } from "@/lib/roles";
import type { MessageAudience } from "@/lib/types";
import { flushScheduledMessages } from "./actions";
import { type PickerMember } from "./ComposeForm";
import { type DraftSummary } from "./DraftList";
import { MessagesWorkspace } from "./MessagesWorkspace";
import { type SentMessage } from "./SentList";

export const dynamic = "force-dynamic";

/** Raw row shape for the messages + recipients join below. */
type MessageRow = {
  id: string;
  sender_role: Role;
  subject: string;
  body: string;
  audience: MessageAudience;
  audience_edited: boolean;
  created_at: string;
  message_recipients: {
    member_id: string;
    read_at: string | null;
    members: { full_name: string } | null;
  }[];
};

type DraftRow = {
  id: string;
  subject: string;
  body: string;
  audience: string;
  recipient_ids: string[] | null;
  scheduled_for: string | null;
  send_error: string | null;
  updated_at: string;
};

export default async function OfficerMessagesPage() {
  const { supabase, member } = await requireOfficer("messages");

  // Anything scheduled that has come due goes out now — after the response, so
  // it never slows the page down (see lib/messages.ts for why it lives here).
  after(flushScheduledMessages);

  const [messagesRes, membersRes, draftsRes] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id, sender_role, subject, body, audience, audience_edited, created_at, message_recipients(member_id, read_at, members(full_name))",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("members")
      .select("id, full_name, active, kiln_team, officer_status, email")
      .eq("role", "member")
      .order("active", { ascending: false })
      .order("full_name", { ascending: true }),
    // Drafts are private to this officer account; RLS enforces it, and the
    // explicit filter keeps that obvious here.
    supabase
      .from("message_drafts")
      .select(
        "id, subject, body, audience, recipient_ids, scheduled_for, send_error, updated_at",
      )
      .eq("author_id", member.id)
      .is("sent_at", null)
      .order("updated_at", { ascending: false }),
  ]);

  const pickerMembers: PickerMember[] = (
    (membersRes.data ?? []) as {
      id: string;
      full_name: string;
      active: boolean;
      kiln_team: boolean;
      officer_status: boolean;
      email: string | null;
    }[]
  ).map((m) => ({
    id: m.id,
    full_name: m.full_name,
    active: m.active,
    kilnTeam: m.kiln_team,
    officerStatus: m.officer_status,
    hasEmail: Boolean(m.email),
  }));

  const drafts: DraftSummary[] = ((draftsRes.data ?? []) as DraftRow[]).map(
    (d) => ({
      id: d.id,
      subject: d.subject,
      body: d.body,
      audience: isComposeAudience(d.audience) ? d.audience : "active",
      recipientIds: d.recipient_ids,
      recipientCount: d.recipient_ids?.length ?? null,
      scheduledFor: d.scheduled_for,
      sendError: d.send_error,
      updatedAt: d.updated_at,
    }),
  );

  const messages: SentMessage[] = (
    (messagesRes.data ?? []) as unknown as MessageRow[]
  ).map((row) => ({
    id: row.id,
    sender_role: row.sender_role,
    subject: row.subject,
    body: row.body,
    audience: row.audience,
    audience_edited: row.audience_edited,
    created_at: row.created_at,
    recipients: (row.message_recipients ?? [])
      .map((r) => ({
        member_id: r.member_id,
        read_at: r.read_at,
        full_name: r.members?.full_name ?? "Unknown member",
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name)),
  }));

  return (
    <main className="anim-fade">
      <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
      <p className="mt-1 text-muted">
        Send studio news to members and track who has read it.
      </p>

      <MessagesWorkspace
        members={pickerMembers}
        drafts={drafts}
        messages={messages}
      />
    </main>
  );
}

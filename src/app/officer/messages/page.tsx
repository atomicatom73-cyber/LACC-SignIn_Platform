import { requireOfficer } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { ComposeForm, type PickerMember } from "./ComposeForm";
import { SentList, type SentMessage } from "./SentList";

export const dynamic = "force-dynamic";

/** Raw row shape for the messages + recipients join below. */
type MessageRow = {
  id: string;
  sender_role: Role;
  subject: string;
  body: string;
  audience: "all" | "selected";
  created_at: string;
  message_recipients: {
    member_id: string;
    read_at: string | null;
    members: { full_name: string } | null;
  }[];
};

export default async function OfficerMessagesPage() {
  const { supabase } = await requireOfficer();

  const [messagesRes, membersRes] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id, sender_role, subject, body, audience, created_at, message_recipients(member_id, read_at, members(full_name))",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("members")
      .select("id, full_name")
      .eq("role", "member")
      .eq("active", true)
      .order("full_name", { ascending: true }),
  ]);

  const pickerMembers: PickerMember[] = (membersRes.data ?? []) as PickerMember[];

  const messages: SentMessage[] = (
    (messagesRes.data ?? []) as unknown as MessageRow[]
  ).map(
    (row) => ({
      id: row.id,
      sender_role: row.sender_role,
      subject: row.subject,
      body: row.body,
      audience: row.audience,
      created_at: row.created_at,
      recipients: (row.message_recipients ?? [])
        .map((r) => ({
          member_id: r.member_id,
          read_at: r.read_at,
          full_name: r.members?.full_name ?? "Unknown member",
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    }),
  );

  return (
    <main className="anim-fade">
      <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
      <p className="mt-1 text-muted">
        Send studio news to members and track who has read it.
      </p>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Compose
        </h2>
        <ComposeForm members={pickerMembers} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Sent
        </h2>
        <SentList messages={messages} />
      </section>
    </main>
  );
}

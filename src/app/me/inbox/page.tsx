import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { InboxList, type InboxItem } from "./InboxList";

export const dynamic = "force-dynamic";

/** Raw row shape for the recipients + message join below. */
type RecipientRow = {
  read_at: string | null;
  messages: {
    id: string;
    sender_role: Role;
    subject: string;
    body: string;
    created_at: string;
  } | null;
};

export default async function InboxPage() {
  const { supabase, member } = await requireMember();
  if (!member) redirect("/me");

  const { data } = await supabase
    .from("message_recipients")
    .select("read_at, messages(id, sender_role, subject, body, created_at)")
    .eq("member_id", member.id);

  const items: InboxItem[] = ((data ?? []) as unknown as RecipientRow[])
    .flatMap((row) =>
      row.messages ? [{ ...row.messages, read_at: row.read_at }] : [],
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const unread = items.filter((item) => item.read_at === null).length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Link href="/me" className="inline-block text-sm text-muted">
        ← Back
      </Link>

      <header className="mt-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
        {unread > 0 && (
          <span className="announce-badge flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-accent px-2 text-sm font-bold tabular-nums text-background">
            {unread}
          </span>
        )}
      </header>
      <p className="mt-1 text-sm text-muted">
        {unread > 0
          ? `${unread} unread announcement${unread === 1 ? "" : "s"}.`
          : "You're all caught up."}
      </p>

      <section className="mt-6 flex-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted">
            No announcements yet — studio news will land here.
          </p>
        ) : (
          <InboxList items={items} />
        )}
      </section>
    </main>
  );
}

import Link from "next/link";
import { requireOfficer } from "@/lib/auth";
import { formatStudioDateTime, monthKey, monthLabel } from "@/lib/studio";

export const dynamic = "force-dynamic";

export default async function OfficerOverviewPage() {
  const { supabase, member } = await requireOfficer();
  const month = monthKey();

  const [membersRes, inStudioRes, assignmentsRes, eventRes] =
    await Promise.all([
      supabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .eq("role", "member"),
      supabase
        .from("shifts")
        .select("id", { count: "exact", head: true })
        .is("signed_out_at", null),
      supabase
        .from("chore_assignments")
        .select("id, status")
        .eq("month", month),
      supabase
        .from("events")
        .select("id, title, starts_at")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(1),
    ]);

  const memberCount = membersRes.count ?? 0;
  const inStudio = inStudioRes.count ?? 0;
  const assignments = assignmentsRes.data ?? [];
  const done = assignments.filter((a) => a.status === "completed").length;
  const nextEvent = eventRes.data?.[0] ?? null;

  const firstName = member.full_name.split(" ")[0];

  return (
    <main className="anim-fade">
      <h1 className="text-2xl font-bold tracking-tight">
        Welcome, {firstName}
      </h1>
      <p className="mt-1 text-muted">
        Officer dashboard — {monthLabel(month)}.
      </p>

      <div className="anim-stagger mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Active members" value={String(memberCount)} />
        <Stat label="In the studio now" value={String(inStudio)} />
        <Stat
          label="Chores this month"
          value={`${done}/${assignments.length}`}
        />
        <Stat
          label="Next event"
          value={nextEvent ? formatStudioDateTime(nextEvent.starts_at) : "—"}
          small
        />
      </div>

      <div className="anim-stagger mt-8 grid gap-4 sm:grid-cols-2">
        <QuickLink
          href="/officer/chores"
          title="Chores"
          description="Assign this month's chores, track statuses, run the monthly reshuffle."
        />
        <QuickLink
          href="/officer/members"
          title="Members"
          description="Roster, roles, chore credits, and absence history."
        />
        <QuickLink
          href="/officer/messages"
          title="Messages"
          description="Send an announcement to everyone or a hand-picked group."
        />
        <QuickLink
          href="/calendar"
          title="Calendar"
          description="Classes, parties, and camps on the studio calendar."
        />
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-1 font-bold tabular-nums ${small ? "text-sm leading-snug" : "text-2xl"}`}
      >
        {value}
      </div>
    </div>
  );
}

function QuickLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-border bg-surface px-5 py-4 transition hover:border-accent/50 active:scale-[0.99]"
    >
      <div className="text-base font-semibold">{title}</div>
      <div className="mt-1 text-sm text-muted">{description}</div>
    </Link>
  );
}

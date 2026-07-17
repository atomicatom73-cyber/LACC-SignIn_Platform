import Link from "next/link";
import { requireOfficer } from "@/lib/auth";
import { addMonths, monthKey, monthLabel } from "@/lib/studio";
import type { Chore } from "@/lib/types";
import { AddJobForm } from "./AddJobForm";
import { ChoreBoard, type BoardChore, type PickerMember } from "./ChoreBoard";
import { ReshuffleCard } from "./ReshuffleCard";

export const dynamic = "force-dynamic";

/** Raw row shape for the assignments + member-name join below. */
type AssignmentRow = {
  id: string;
  chore_id: string;
  member_id: string;
  status: "pending" | "completed";
  members: { full_name: string } | null;
};

export default async function OfficerChoresPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { supabase } = await requireOfficer("jobs");

  const { month: rawMonth } = await searchParams;
  const currentMonth = monthKey();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth ?? "")
    ? `${rawMonth}-01`
    : currentMonth;

  const [choresRes, assignmentsRes, membersRes, absencesRes] =
    await Promise.all([
      supabase
        .from("chores")
        .select("id, name, description, slots, active, paused, interval, created_at")
        .order("name", { ascending: true }),
      supabase
        .from("chore_assignments")
        // members!…: both member_id and assigned_by reference members, so the
        // embed must name its FK or PostgREST rejects it as ambiguous.
        .select(
          "id, chore_id, member_id, status, members!chore_assignments_member_id_fkey(full_name)",
        )
        .eq("month", month)
        .order("created_at", { ascending: true }),
      supabase
        .from("members")
        .select("id, full_name")
        .eq("role", "member")
        .eq("active", true)
        .order("full_name", { ascending: true }),
      supabase
        .from("absences")
        .select("member_id, members!absences_member_id_fkey(full_name)")
        .eq("month", month),
    ]);

  const chores = (choresRes.data ?? []) as Chore[];
  const assignments = (assignmentsRes.data ?? []) as unknown as AssignmentRow[];
  const members = (membersRes.data ?? []) as PickerMember[];
  const absences = (absencesRes.data ?? []) as unknown as {
    member_id: string;
    members: { full_name: string } | null;
  }[];

  const assigneesByChore = new Map<string, BoardChore["assignees"]>();
  for (const a of assignments) {
    const list = assigneesByChore.get(a.chore_id) ?? [];
    list.push({
      assignmentId: a.id,
      memberId: a.member_id,
      memberName: a.members?.full_name ?? "Unknown member",
      status: a.status,
    });
    assigneesByChore.set(a.chore_id, list);
  }

  // The board shows every active chore (paused ones included, so they can be
  // resumed) plus any retired one that still has assignments this month (so
  // history months render completely).
  const boardChores: BoardChore[] = chores
    .filter((c) => c.active || assigneesByChore.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      slots: c.slots,
      active: c.active,
      paused: c.paused,
      interval: c.interval,
      assignees: assigneesByChore.get(c.id) ?? [],
    }));

  const absentNames = absences
    .map((a) => a.members?.full_name ?? "Unknown member")
    .sort((a, b) => a.localeCompare(b));

  const prev = addMonths(month, -1).slice(0, 7);
  const next = addMonths(month, 1).slice(0, 7);

  return (
    <main className="anim-fade">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        <Link
          href={`/officer/chores/print?month=${month.slice(0, 7)}`}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-muted transition active:scale-[0.98]"
        >
          🖨️ Printable view
        </Link>
      </div>
      <p className="mt-1 text-muted">
        The studio&apos;s jobs, this month&apos;s assignments, and the monthly
        reshuffle.
      </p>

      <div className="mt-5">
        <AddJobForm />
      </div>

      <nav className="mt-5 flex items-center gap-3">
        <Link
          href={`/officer/chores?month=${prev}`}
          aria-label={`Show ${monthLabel(`${prev}-01`)}`}
          className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-muted transition active:scale-[0.97]"
        >
          ←
        </Link>
        <span className="flex-1 text-center text-sm font-semibold">
          {monthLabel(month)}
          {month === currentMonth && (
            <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              now
            </span>
          )}
        </span>
        <Link
          href={`/officer/chores?month=${next}`}
          aria-label={`Show ${monthLabel(`${next}-01`)}`}
          className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-muted transition active:scale-[0.97]"
        >
          →
        </Link>
      </nav>

      {month >= currentMonth && (
        <div className="mt-5">
          <ReshuffleCard key={month} month={month} />
        </div>
      )}

      {absentNames.length > 0 && (
        <p className="mt-5 text-sm text-muted">
          <span className="font-medium text-foreground">
            Absent {monthLabel(month)}:
          </span>{" "}
          {absentNames.join(", ")}
        </p>
      )}

      <section className="mt-5">
        <ChoreBoard month={month} chores={boardChores} members={members} />
      </section>
    </main>
  );
}

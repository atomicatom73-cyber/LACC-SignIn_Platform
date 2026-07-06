import { requireOfficer } from "@/lib/auth";
import { canManageMembers } from "@/lib/roles";
import { monthKey } from "@/lib/studio";
import type { Absence, ChoreCredit, Member } from "@/lib/types";
import type { MemberSummary, ThisMonthChip } from "./MemberDetail";
import { AddMemberForm } from "./AddMemberForm";
import { MembersList, type MemberGroup } from "./MembersList";

export const dynamic = "force-dynamic";

export default async function OfficerMembersPage() {
  const { supabase, member: viewer } = await requireOfficer();
  const month = monthKey();

  const [membersRes, creditsRes, absencesRes, assignmentsRes] =
    await Promise.all([
      supabase
        .from("members")
        .select("id, user_id, full_name, role, pin, active, created_at")
        .order("full_name", { ascending: true }),
      supabase
        .from("chore_credits")
        .select("id, member_id, note, granted_by, created_at, used_month")
        .order("created_at", { ascending: false }),
      supabase
        .from("absences")
        .select("id, member_id, month, note, marked_by, created_at")
        .order("month", { ascending: false }),
      supabase
        .from("chore_assignments")
        .select("member_id, status")
        .eq("month", month),
    ]);

  const members = (membersRes.data ?? []) as Member[];
  const credits = (creditsRes.data ?? []) as ChoreCredit[];
  const absences = (absencesRes.data ?? []) as Absence[];
  const assignments = (assignmentsRes.data ?? []) as {
    member_id: string;
    status: "pending" | "completed";
  }[];

  const creditsByMember = new Map<string, ChoreCredit[]>();
  for (const c of credits) {
    const list = creditsByMember.get(c.member_id) ?? [];
    list.push(c);
    creditsByMember.set(c.member_id, list);
  }
  const absencesByMember = new Map<string, Absence[]>();
  for (const a of absences) {
    const list = absencesByMember.get(a.member_id) ?? [];
    list.push(a);
    absencesByMember.set(a.member_id, list);
  }
  const assignmentsByMember = new Map<string, { done: number; total: number }>();
  for (const a of assignments) {
    const tally = assignmentsByMember.get(a.member_id) ?? { done: 0, total: 0 };
    tally.total += 1;
    if (a.status === "completed") tally.done += 1;
    assignmentsByMember.set(a.member_id, tally);
  }

  const summarize = (m: Member): MemberSummary => {
    const memberCredits = creditsByMember.get(m.id) ?? [];
    const memberAbsences = absencesByMember.get(m.id) ?? [];
    const tally = assignmentsByMember.get(m.id);
    const absentThisMonth = memberAbsences.some((a) => a.month === month);

    let chip: ThisMonthChip;
    if (m.role !== "member") {
      chip = { label: "Officer account", tone: "info" };
    } else if (absentThisMonth) {
      chip = { label: "Absent this month", tone: "info" };
    } else if (!tally || tally.total === 0) {
      chip = { label: "No chore", tone: "muted" };
    } else if (tally.done === tally.total) {
      chip = { label: "Chores done", tone: "success" };
    } else {
      chip = { label: `${tally.done}/${tally.total} chores done`, tone: "accent" };
    }

    return {
      id: m.id,
      full_name: m.full_name,
      role: m.role,
      active: m.active,
      created_at: m.created_at,
      availableCredits: memberCredits.filter((c) => c.used_month === null).length,
      chip,
      credits: memberCredits,
      absences: memberAbsences,
    };
  };

  const groups: MemberGroup[] = [
    {
      title: "Members",
      members: members
        .filter((m) => m.role === "member" && m.active)
        .map(summarize),
    },
    {
      title: "Officer accounts",
      members: members.filter((m) => m.role !== "member").map(summarize),
    },
    {
      title: "Deactivated",
      members: members
        .filter((m) => m.role === "member" && !m.active)
        .map(summarize),
    },
  ];

  return (
    <main>
      <h1 className="text-2xl font-bold tracking-tight">Members</h1>
      <p className="mt-1 text-muted">
        Roster, chore credits, absences, and roles.
      </p>

      {canManageMembers(viewer.role) && (
        <div className="mt-6">
          <AddMemberForm />
        </div>
      )}

      <div className="mt-6">
        <MembersList groups={groups} viewerRole={viewer.role} />
      </div>
    </main>
  );
}

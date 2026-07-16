import { requireOfficer } from "@/lib/auth";
import {
  membersSheetConfigured,
  membersSheetSyncStatus,
  syncMembersSheetThrottled,
} from "@/lib/members-sheet";
import { hasPermission } from "@/lib/roles";
import { formatStudioDateTime, monthKey } from "@/lib/studio";
import type { Absence, ChoreCredit, Member } from "@/lib/types";
import type { MemberSummary, ThisMonthChip } from "./MemberDetail";
import { AddMemberForm } from "./AddMemberForm";
import { MembersList, type MemberGroup } from "./MembersList";

export const dynamic = "force-dynamic";

/**
 * ", wrote back 2 emails + 1 name + 3 new rows" — or "" when the last sync
 * pushed nothing (or predates the write-back feature and has no counts).
 */
function describeWriteBack(
  pushed: { emails: number; names: number; added: number } | undefined,
): string {
  if (!pushed) return "";
  const parts = [
    pushed.emails > 0 && `${pushed.emails} email${pushed.emails === 1 ? "" : "s"}`,
    pushed.names > 0 && `${pushed.names} name${pushed.names === 1 ? "" : "s"}`,
    pushed.added > 0 && `${pushed.added} new row${pushed.added === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length > 0 ? `, wrote back ${parts.join(" + ")}` : "";
}

export default async function OfficerMembersPage() {
  const { supabase, member: viewer } = await requireOfficer();
  const month = monthKey();

  // Mirror the roster sheet before reading — throttled, and never allowed to
  // take the page down with it (a Google hiccup just shows yesterday's data).
  if (membersSheetConfigured()) {
    try {
      await syncMembersSheetThrottled();
    } catch (err) {
      console.error("[members] sheet sync failed:", err);
    }
  }

  const [membersRes, creditsRes, absencesRes, assignmentsRes, choresRes] =
    await Promise.all([
      supabase
        .from("members")
        .select(
          "id, user_id, full_name, role, officer_title, pin, active, created_at, email, in_sheet, sheet_paid, sheet_payment_type, sheet_policy, sheet_photos, sheet_comments",
        )
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
        .select("id, member_id, status, chores(name)")
        .eq("month", month),
      supabase
        .from("chores")
        .select("id, name")
        .eq("active", true)
        .order("name", { ascending: true }),
    ]);

  const members = (membersRes.data ?? []) as Member[];
  const credits = (creditsRes.data ?? []) as ChoreCredit[];
  const absences = (absencesRes.data ?? []) as Absence[];
  const assignments = (assignmentsRes.data ?? []) as unknown as {
    id: string;
    member_id: string;
    status: "pending" | "completed";
    chores: { name: string } | null;
  }[];
  const jobCatalog = (choresRes.data ?? []) as { id: string; name: string }[];

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
  const assignmentsByMember = new Map<
    string,
    { assignmentId: string; name: string; status: "pending" | "completed" }[]
  >();
  for (const a of assignments) {
    const list = assignmentsByMember.get(a.member_id) ?? [];
    list.push({
      assignmentId: a.id,
      name: a.chores?.name ?? "Unknown job",
      status: a.status,
    });
    assignmentsByMember.set(a.member_id, list);
  }

  const summarize = (m: Member): MemberSummary => {
    const memberCredits = creditsByMember.get(m.id) ?? [];
    const memberAbsences = absencesByMember.get(m.id) ?? [];
    const jobs = assignmentsByMember.get(m.id) ?? [];
    const done = jobs.filter((j) => j.status === "completed").length;
    const absentThisMonth = memberAbsences.some((a) => a.month === month);

    let chip: ThisMonthChip;
    if (m.role !== "member") {
      chip = { label: "Officer account", tone: "info" };
    } else if (absentThisMonth) {
      chip = { label: "Absent this month", tone: "info" };
    } else if (jobs.length === 0) {
      chip = { label: "No job", tone: "muted" };
    } else if (done === jobs.length) {
      chip = { label: "Jobs done", tone: "success" };
    } else {
      chip = { label: `${done}/${jobs.length} jobs done`, tone: "accent" };
    }

    return {
      id: m.id,
      full_name: m.full_name,
      role: m.role,
      officerTitle: m.officer_title,
      active: m.active,
      created_at: m.created_at,
      hasAccount: m.user_id !== null,
      email: m.email,
      inSheet: m.in_sheet,
      sheet: m.in_sheet
        ? {
            paid: m.sheet_paid,
            paymentType: m.sheet_payment_type,
            policy: m.sheet_policy,
            photos: m.sheet_photos,
            comments: m.sheet_comments,
          }
        : null,
      availableCredits: memberCredits.filter((c) => c.used_month === null).length,
      chip,
      credits: memberCredits,
      absences: memberAbsences,
      jobs,
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
      title: "Inactive",
      members: members
        .filter((m) => m.role === "member" && !m.active)
        .map(summarize),
    },
  ];

  const syncStatus = membersSheetConfigured()
    ? await membersSheetSyncStatus()
    : null;

  return (
    <main className="anim-fade">
      <h1 className="text-2xl font-bold tracking-tight">Members</h1>
      <p className="mt-1 text-muted">
        Roster, job credits, and absences.
      </p>

      {hasPermission(viewer, "members") && (
        <div className="mt-6">
          <AddMemberForm />
        </div>
      )}

      {syncStatus && (
        <div className="mt-6 rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
          <p className="text-muted">
            Roster synced from sheet tab &ldquo;{syncStatus.tab}&rdquo; ·{" "}
            {formatStudioDateTime(syncStatus.syncedAt)} · {syncStatus.totalRows}{" "}
            rows ({syncStatus.matched} matched, {syncStatus.created} new
            {describeWriteBack(syncStatus.pushed)}). Active status and sheet
            details follow the sheet — edit them there. Name and email changes
            made in the app, and members added here, are written back to the
            sheet.
          </p>
          {syncStatus.flagged.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-muted">
                {syncStatus.flagged.length === 1
                  ? "1 row needs attention"
                  : `${syncStatus.flagged.length} rows need attention`}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
                {syncStatus.flagged.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="mt-6">
        <MembersList
          groups={groups}
          viewerCanManage={hasPermission(viewer, "members")}
          viewerCanJobs={hasPermission(viewer, "jobs")}
          month={month}
          jobCatalog={jobCatalog}
        />
      </div>
    </main>
  );
}

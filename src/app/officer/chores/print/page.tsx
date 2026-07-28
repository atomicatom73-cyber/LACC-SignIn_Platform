import Link from "next/link";
import { requireOfficer } from "@/lib/auth";
import { dueLabel } from "@/lib/chores";
import { formatStudioDateTime, monthKey, monthLabel } from "@/lib/studio";
import type { ChoreInterval } from "@/lib/types";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

type AssignmentRow = {
  status: "pending" | "completed";
  scheduled_at: string | null;
  chores: {
    id: string;
    name: string;
    description: string | null;
    interval: ChoreInterval;
  } | null;
  members: { full_name: string } | null;
};

/**
 * Printable view of a month's published job assignments — white paper,
 * black ink, one row per job. Any officer can print and pin it up.
 */
export default async function PrintAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { supabase } = await requireOfficer("jobs");

  const { month: rawMonth } = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth ?? "")
    ? `${rawMonth}-01`
    : monthKey();

  const { data } = await supabase
    .from("chore_assignments")
    // members!…: member_id and assigned_by both reference members; the embed
    // must name its FK or PostgREST rejects it as ambiguous.
    .select(
      "status, scheduled_at, chores(id, name, description, interval), members!chore_assignments_member_id_fkey(full_name)",
    )
    .eq("month", month);

  const rows = (data ?? []) as unknown as AssignmentRow[];

  const byJob = new Map<
    string,
    {
      name: string;
      description: string | null;
      interval: ChoreInterval;
      members: string[];
    }
  >();
  for (const row of rows) {
    if (!row.chores) continue;
    const entry = byJob.get(row.chores.id) ?? {
      name: row.chores.name,
      description: row.chores.description,
      interval: row.chores.interval,
      members: [],
    };
    // Scheduled jobs print the appointment next to the name, so the sheet on
    // the wall says who's coming when.
    const name = row.members?.full_name ?? "Unknown member";
    entry.members.push(
      row.scheduled_at
        ? `${name} (${formatStudioDateTime(row.scheduled_at)})`
        : name,
    );
    byJob.set(row.chores.id, entry);
  }
  const jobs = [...byJob.values()]
    .map((j) => ({ ...j, members: j.members.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="anim-fade mx-auto min-h-dvh w-full max-w-2xl bg-white px-8 py-8 text-black print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <Link href="/officer/chores" className="text-sm text-neutral-500">
          ← Back to jobs
        </Link>
        <PrintButton />
      </div>

      <h1 className="text-2xl font-bold">
        LACC Studio Jobs — {monthLabel(month)}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        Los Alamos Community Ceramics · monthly job assignments
      </p>

      {jobs.length === 0 ? (
        <p className="mt-8 text-neutral-600">
          Nothing has been published for {monthLabel(month)} yet.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2 pr-4 font-bold">Job</th>
              <th className="py-2 font-bold">Assigned to</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.name} className="border-b border-neutral-300 align-top">
                <td className="py-2.5 pr-4">
                  <div className="font-semibold">
                    {job.name}
                    <span className="ml-2 text-xs font-normal text-neutral-500">
                      {dueLabel(job.interval)}
                    </span>
                  </div>
                  {job.description && (
                    <div className="mt-0.5 text-xs text-neutral-600">
                      {job.description}
                    </div>
                  )}
                </td>
                <td className="py-2.5">{job.members.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-8 text-xs text-neutral-500">
        Done with your job? Mark it complete in the LACC Studio app.
      </p>
    </main>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import { canManageMembers, type Role } from "@/lib/roles";
import { formatStudioDate, monthKey, monthLabel } from "@/lib/studio";
import type { Absence, ChoreCredit } from "@/lib/types";
import {
  grantCredit,
  markAbsence,
  removeAbsence,
  resetMemberPassword,
  revokeCredit,
  setActive,
} from "./actions";
import { assignChore, removeAssignment } from "../chores/actions";

export type ChipTone = "muted" | "accent" | "success" | "danger" | "info";

export type ThisMonthChip = { label: string; tone: ChipTone };

export type MemberJob = {
  assignmentId: string;
  name: string;
  status: "pending" | "completed";
};

/** Everything the members page precomputes for one role='member' row. */
export type MemberSummary = {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
  hasAccount: boolean;
  availableCredits: number;
  chip: ThisMonthChip;
  credits: ChoreCredit[];
  absences: Absence[];
  jobs: MemberJob[];
};

export function MemberDetail({
  member,
  viewerRole,
  month,
  jobCatalog,
}: {
  member: MemberSummary;
  viewerRole: Role;
  month: string;
  jobCatalog: { id: string; name: string }[];
}) {
  const [grantState, grantAction, grantPending] = useActionState(
    grantCredit,
    null,
  );
  const [absenceState, absenceAction, absencePending] = useActionState(
    markAbsence,
    null,
  );
  const [assignState, assignAction, assignPending] = useActionState(
    assignChore,
    null,
  );
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error: string } | null>) =>
    startTransition(async () => {
      const result = await fn();
      setRowError(result?.error ?? null);
    });

  const assignedNames = new Set(member.jobs.map((j) => j.name));
  const jobCandidates = jobCatalog.filter((j) => !assignedNames.has(j.name));

  return (
    <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-2">
      {member.role === "member" && (
        <section className="sm:col-span-2">
          <h3 className="text-xs uppercase tracking-wide text-muted">
            Jobs this month
          </h3>
          {member.jobs.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No job assigned.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {member.jobs.map((job) => (
                <li
                  key={job.assignmentId}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                    job.status === "completed"
                      ? "border-success/40 bg-success/10"
                      : "border-border bg-surface-2"
                  }`}
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {job.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`text-xs ${
                        job.status === "completed"
                          ? "text-success"
                          : "text-muted"
                      }`}
                    >
                      {job.status === "completed" ? "completed" : "pending"}
                    </span>
                    <button
                      onClick={() => run(() => removeAssignment(job.assignmentId))}
                      disabled={pending}
                      title="Remove this assignment"
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-danger transition active:scale-[0.98] disabled:opacity-60"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {jobCandidates.length > 0 && (
            <form action={assignAction} className="mt-3 flex gap-2">
              <input type="hidden" name="member_id" value={member.id} />
              <input type="hidden" name="month" value={month} />
              <select
                name="chore_id"
                required
                defaultValue=""
                className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              >
                <option value="" disabled>
                  Assign a job…
                </option>
                {jobCandidates.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={assignPending}
                className="shrink-0 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm font-semibold text-accent transition active:scale-[0.98] disabled:opacity-60"
              >
                {assignPending ? "…" : "Assign"}
              </button>
            </form>
          )}
          {assignState?.error && (
            <p className="mt-2 text-sm text-danger">{assignState.error}</p>
          )}
        </section>
      )}
      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted">
          Job credits
        </h3>
        {member.credits.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No credits yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {member.credits.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm">
                    {c.used_month ? (
                      <span className="text-muted">
                        Used {monthLabel(c.used_month)}
                      </span>
                    ) : (
                      <span className="font-medium text-success">
                        Available
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    Granted {formatStudioDate(c.created_at)}
                    {c.note ? ` · ${c.note}` : ""}
                  </div>
                </div>
                {c.used_month === null && (
                  <button
                    onClick={() => run(() => revokeCredit(c.id))}
                    disabled={pending}
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-danger transition active:scale-[0.98] disabled:opacity-60"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form action={grantAction} className="mt-3 flex gap-2">
          <input type="hidden" name="member_id" value={member.id} />
          <input
            name="note"
            autoComplete="off"
            placeholder="Note (optional)"
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={grantPending}
            className="shrink-0 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {grantPending ? "…" : "Grant credit"}
          </button>
        </form>
        {grantState?.error && (
          <p className="mt-2 text-sm text-danger">{grantState.error}</p>
        )}
        {grantState?.success && (
          <p className="mt-2 text-sm text-success">{grantState.success}</p>
        )}
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted">
          Absences
        </h3>
        {member.absences.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No absences recorded.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {member.absences.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {monthLabel(a.month)}
                  </div>
                  {a.note && <div className="text-xs text-muted">{a.note}</div>}
                </div>
                <button
                  onClick={() => run(() => removeAbsence(a.id))}
                  disabled={pending}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-danger transition active:scale-[0.98] disabled:opacity-60"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form action={absenceAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="member_id" value={member.id} />
          <input
            type="month"
            name="month"
            required
            defaultValue={monthKey().slice(0, 7)}
            className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <input
            name="note"
            autoComplete="off"
            placeholder="Note (optional)"
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={absencePending}
            className="shrink-0 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {absencePending ? "…" : "Mark absent"}
          </button>
        </form>
        {absenceState?.error && (
          <p className="mt-2 text-sm text-danger">{absenceState.error}</p>
        )}
        {absenceState?.success && (
          <p className="mt-2 text-sm text-success">{absenceState.success}</p>
        )}
      </section>

      {canManageMembers(viewerRole) && member.role === "member" && (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-2 px-3 py-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {member.active ? "Active member" : "Deactivated"}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Deactivated members leave the kiosk roster and job rotation
                but keep their history.
              </p>
            </div>
            <button
              onClick={() => run(() => setActive(member.id, !member.active))}
              disabled={pending}
              className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60 ${
                member.active ? "bg-danger" : "bg-success"
              }`}
            >
              {member.active ? "Deactivate" : "Reactivate"}
            </button>
          </div>

          {viewerRole === "president" && member.hasAccount && (
            <PasswordReset memberId={member.id} />
          )}
        </section>
      )}

      {rowError && (
        <p className="text-sm text-danger sm:col-span-2">{rowError}</p>
      )}
    </div>
  );
}

/**
 * President-only forgot-password recovery. Existing passwords can't be
 * viewed (only a hash is stored) — the president sets a fresh one and hands
 * it to the member.
 */
function PasswordReset({ memberId }: { memberId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleReset = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const res = await resetMemberPassword(memberId);
      if ("error" in res) {
        setError(res.error);
      } else {
        setError(null);
        setResult(res.password);
      }
    });
  };

  if (result) {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-3">
        <div className="text-sm font-medium">New password set</div>
        <div className="mt-1 select-all font-mono text-lg font-bold tracking-wide">
          {result}
        </div>
        <p className="mt-1 text-xs text-muted">
          Give this to the member now — it won&apos;t be shown again. They can
          ask you to reset it any time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">Forgot their password?</div>
        <p className="mt-0.5 text-xs text-muted">
          Passwords can&apos;t be viewed, only replaced. Resetting shows a new
          one to hand over.
        </p>
      </div>
      <button
        onClick={handleReset}
        disabled={pending}
        className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
          confirming
            ? "bg-danger text-background"
            : "border border-border text-muted"
        }`}
      >
        {pending
          ? "Resetting…"
          : confirming
            ? "Tap again to reset"
            : "Reset password"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

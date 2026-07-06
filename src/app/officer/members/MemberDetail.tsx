"use client";

import { useActionState, useState, useTransition } from "react";
import { canManageMembers, canManageRoles, type Role } from "@/lib/roles";
import { formatStudioDate, monthKey, monthLabel } from "@/lib/studio";
import type { Absence, ChoreCredit } from "@/lib/types";
import {
  grantCredit,
  markAbsence,
  removeAbsence,
  revokeCredit,
  setActive,
} from "./actions";
import { RoleSelect } from "./RoleSelect";

export type ChipTone = "muted" | "accent" | "success" | "danger" | "info";

export type ThisMonthChip = { label: string; tone: ChipTone };

/** Everything the members page precomputes for one role='member' row. */
export type MemberSummary = {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
  availableCredits: number;
  chip: ThisMonthChip;
  credits: ChoreCredit[];
  absences: Absence[];
};

export function MemberDetail({
  member,
  viewerRole,
}: {
  member: MemberSummary;
  viewerRole: Role;
}) {
  const [grantState, grantAction, grantPending] = useActionState(
    grantCredit,
    null,
  );
  const [absenceState, absenceAction, absencePending] = useActionState(
    markAbsence,
    null,
  );
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error: string } | null>) =>
    startTransition(async () => {
      const result = await fn();
      setRowError(result?.error ?? null);
    });

  return (
    <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-2">
      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted">
          Chore credits
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

      {(canManageMembers(viewerRole) || canManageRoles(viewerRole)) && (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-2 px-3 py-3 sm:col-span-2">
          {canManageMembers(viewerRole) && (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {member.active ? "Active member" : "Deactivated"}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Deactivated members leave the kiosk roster and chore rotation
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
          )}

          {canManageRoles(viewerRole) && (
            <RoleSelect memberId={member.id} currentRole={member.role} />
          )}
        </section>
      )}

      {rowError && (
        <p className="text-sm text-danger sm:col-span-2">{rowError}</p>
      )}
    </div>
  );
}

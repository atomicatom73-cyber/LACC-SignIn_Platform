"use client";

import { useActionState, useState, useTransition } from "react";
import type { Role } from "@/lib/roles";
import { formatStudioDate, monthKey, monthLabel } from "@/lib/studio";
import type { Absence, ChoreCredit } from "@/lib/types";
import {
  deleteMemberAccount,
  grantCredit,
  markAbsence,
  removeAbsence,
  renameMember,
  resetMemberPassword,
  resetMemberPin,
  revokeCredit,
  setActive,
  setOfficerStatus,
} from "./actions";
import { assignChore, removeAssignment } from "../chores/actions";

export type ChipTone = "muted" | "accent" | "success" | "danger" | "info";

export type ThisMonthChip = { label: string; tone: ChipTone };

export type MemberJob = {
  assignmentId: string;
  name: string;
  status: "pending" | "completed";
};

/** Bookkeeping cells mirrored from the roster sheet (officer-facing text). */
export type SheetInfo = {
  paid: string | null;
  paymentType: string | null;
  policy: string | null;
  photos: string | null;
  comments: string | null;
};

/** Everything the members page precomputes for one role='member' row. */
export type MemberSummary = {
  id: string;
  full_name: string;
  role: Role;
  /** Custom officer accounts carry their display title; null otherwise. */
  officerTitle: string | null;
  active: boolean;
  /** Board officer — exempt from the monthly job draft. President-managed. */
  officerStatus: boolean;
  created_at: string;
  hasAccount: boolean;
  email: string | null;
  inSheet: boolean;
  sheet: SheetInfo | null;
  availableCredits: number;
  chip: ThisMonthChip;
  credits: ChoreCredit[];
  absences: Absence[];
  jobs: MemberJob[];
};

/** Sheet cells are free text; just make bare Y/N read like words. */
function sheetValue(value: string | null): string {
  if (!value) return "—";
  if (/^y(es)?$/i.test(value)) return "Yes";
  if (/^no?$/i.test(value)) return "No";
  return value;
}

export function MemberDetail({
  member,
  viewerCanManage,
  viewerCanJobs,
  viewerIsPresident,
  month,
  jobCatalog,
}: {
  member: MemberSummary;
  viewerCanManage: boolean;
  /** Jobs permission: assign jobs, grant credits, mark absences. */
  viewerCanJobs: boolean;
  /** Officer status is the president's call alone (see setOfficerStatus). */
  viewerIsPresident: boolean;
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
    // grid-cols-1 matters: without an explicit column the implicit track
    // min-sizes to its widest child and the whole card overflows a phone
    // screen (Tailwind's grid-cols-N = minmax(0, 1fr) tracks).
    <div className="grid grid-cols-1 gap-4 border-t border-border px-4 py-4 sm:grid-cols-2">
      {member.role === "member" && (
        <section className="sm:col-span-2">
          <h3 className="text-xs uppercase tracking-wide text-muted">
            Roster info
          </h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Email</dt>
            <dd className="min-w-0 break-words">
              {member.email ?? <span className="text-muted">none on file</span>}
            </dd>
            <dt className="text-muted">Account</dt>
            <dd>
              {member.hasAccount ? (
                "Has an app account"
              ) : (
                <span className="text-muted">
                  No account yet — announcements still reach their email
                </span>
              )}
            </dd>
            {member.sheet && (
              <>
                <dt className="text-muted">Paid</dt>
                <dd>{sheetValue(member.sheet.paid)}</dd>
                <dt className="text-muted">Payment type</dt>
                <dd>{sheetValue(member.sheet.paymentType)}</dd>
                <dt className="text-muted">Policy signed</dt>
                <dd>{sheetValue(member.sheet.policy)}</dd>
                <dt className="text-muted">OK with photos</dt>
                <dd>{sheetValue(member.sheet.photos)}</dd>
                {member.sheet.comments && (
                  <>
                    <dt className="text-muted">Comments</dt>
                    <dd className="min-w-0 break-words">
                      {member.sheet.comments}
                    </dd>
                  </>
                )}
              </>
            )}
          </dl>
          {member.inSheet && (
            <p className="mt-2 text-xs text-muted">
              Synced from the studio&apos;s sign-ups sheet — edit these there.
            </p>
          )}
        </section>
      )}

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
                    {viewerCanJobs && (
                      <button
                        onClick={() =>
                          run(() => removeAssignment(job.assignmentId))
                        }
                        disabled={pending}
                        title="Remove this assignment"
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-danger transition active:scale-[0.98] disabled:opacity-60"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {viewerCanJobs && jobCandidates.length > 0 && (
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

      {viewerIsPresident && member.role === "member" && (
        <section className="sm:col-span-2">
          <h3 className="text-xs uppercase tracking-wide text-muted">
            Officer status
          </h3>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {member.officerStatus
                  ? "On the board — exempt from jobs"
                  : "Not on the board"}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Officers sit out the monthly draft without spending a credit.
                You can still assign them a job by hand above.
              </p>
            </div>
            <button
              onClick={() =>
                run(async () => {
                  const res = await setOfficerStatus(
                    [member.id],
                    !member.officerStatus,
                  );
                  return "error" in res ? res : null;
                })
              }
              disabled={pending}
              className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
                member.officerStatus
                  ? "border border-border text-muted"
                  : "border border-accent/40 bg-accent/10 text-accent"
              }`}
            >
              {member.officerStatus ? "Remove" : "Grant"}
            </button>
          </div>
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
                {viewerCanJobs && c.used_month === null && (
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

        {viewerCanJobs && (
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
        )}
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
                {viewerCanJobs && (
                  <button
                    onClick={() => run(() => removeAbsence(a.id))}
                    disabled={pending}
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-danger transition active:scale-[0.98] disabled:opacity-60"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {viewerCanJobs && (
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
        )}
        {absenceState?.error && (
          <p className="mt-2 text-sm text-danger">{absenceState.error}</p>
        )}
        {absenceState?.success && (
          <p className="mt-2 text-sm text-success">{absenceState.success}</p>
        )}
      </section>

      {viewerCanManage && member.role === "member" && (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-2 px-3 py-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {member.active ? "Active member" : "Inactive"}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Inactive members leave the quick sign-in roster and job
                rotation but keep their history.
                {member.inSheet &&
                  " This member's status follows the studio sheet — a change here lasts only until the next sync."}
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

          <NameEdit memberId={member.id} currentName={member.full_name} />

          {member.hasAccount && <PasswordReset memberId={member.id} />}

          <PinReset memberId={member.id} />

          <DeleteMember memberId={member.id} name={member.full_name} />
        </section>
      )}

      {rowError && (
        <p className="text-sm text-danger sm:col-span-2">{rowError}</p>
      )}
    </div>
  );
}

/**
 * President/VP: fix a mistyped account name. The member's name-based login
 * moves with it, so they sign in with the corrected spelling afterwards.
 */
function NameEdit({
  memberId,
  currentName,
}: {
  memberId: string;
  currentName: string;
}) {
  const [name, setName] = useState(currentName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim().replace(/\s+/g, " ") !== currentName;

  const handleSave = () => {
    startTransition(async () => {
      const res = await renameMember(memberId, name);
      if ("error" in res) {
        setError(res.error);
        setMessage(null);
      } else {
        setError(null);
        setName(res.name);
        setMessage(`Renamed to ${res.name}. They now log in with that name.`);
      }
    });
  };

  return (
    <div>
      <div className="text-sm font-medium">Account name</div>
      <p className="mt-0.5 text-xs text-muted">
        Fix typos or stray spaces — their name-based login updates to match.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setMessage(null);
          }}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={handleSave}
          disabled={pending || !dirty}
          className="shrink-0 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {message && <p className="mt-2 text-xs text-success">{message}</p>}
    </div>
  );
}

/**
 * President/VP forgot-password recovery. Existing passwords can't be
 * viewed (only a hash is stored) — the officer sets a fresh one and hands
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

/**
 * President/VP forgot-PIN recovery — mirrors the password reset: a fresh
 * random 4-digit PIN, shown once, handed over in person.
 */
function PinReset({ memberId }: { memberId: string }) {
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
      const res = await resetMemberPin(memberId);
      if ("error" in res) {
        setError(res.error);
      } else {
        setError(null);
        setResult(res.pin);
      }
    });
  };

  if (result) {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-3">
        <div className="text-sm font-medium">New studio PIN set</div>
        <div className="mt-1 select-all font-mono text-lg font-bold tracking-[0.3em]">
          {result}
        </div>
        <p className="mt-1 text-xs text-muted">
          Give this to the member now — it&apos;s what they tap on the quick
          sign-in screen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">Forgot their PIN?</div>
        <p className="mt-0.5 text-xs text-muted">
          Resetting shows a new 4-digit PIN to hand over.
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
            : "Reset PIN"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * President/VP: permanently delete a member and their history. The escape
 * hatch when someone forgot both password and PIN — delete, then they
 * create a fresh account.
 */
function DeleteMember({ memberId, name }: { memberId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const res = await deleteMemberAccount(memberId);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-danger">Delete account</div>
        <p className="mt-0.5 text-xs text-muted">
          Removes {name} and all their history — for good. If they forgot
          both password and PIN, delete and have them start fresh.
        </p>
      </div>
      <button
        onClick={handleDelete}
        disabled={pending}
        className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
          confirming
            ? "bg-danger text-background"
            : "border border-danger/40 bg-danger/10 text-danger"
        }`}
      >
        {pending
          ? "Deleting…"
          : confirming
            ? "Tap again to delete"
            : "Delete"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

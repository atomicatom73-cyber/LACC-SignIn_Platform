"use client";

import { useState, useTransition } from "react";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { setRole } from "./actions";

const ROLES = Object.keys(ROLE_LABELS) as Role[];

/**
 * President-only role picker with a two-tap confirm. The DB trigger enforces
 * president-only role changes server-side; its error surfaces below.
 */
export function RoleSelect({
  memberId,
  currentRole,
}: {
  memberId: string;
  currentRole: Role;
}) {
  const [selected, setSelected] = useState<Role>(currentRole);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = selected !== currentRole;

  const confirm = () =>
    startTransition(async () => {
      const result = await setRole(memberId, selected);
      setError(result?.error ?? null);
    });

  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">Role</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value as Role);
            setError(null);
          }}
          disabled={pending}
          className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {dirty && (
          <>
            <button
              onClick={confirm}
              disabled={pending}
              className="rounded-xl bg-danger px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? "Saving…" : `Confirm: ${ROLE_LABELS[selected]}`}
            </button>
            <button
              onClick={() => {
                setSelected(currentRole);
                setError(null);
              }}
              disabled={pending}
              className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted transition active:scale-[0.98] disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {dirty && !error && (
        <p className="mt-2 text-xs text-muted">
          Tap confirm to apply the role change.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { addMember } from "./actions";

/** President/VP-only form for adding a kiosk-only member to the roster. */
export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMember, null);

  return (
    <form
      action={action}
      className="rounded-2xl border border-border bg-surface px-4 py-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        Add a member
      </h2>
      <p className="mt-1 text-xs text-muted">
        They appear on the kiosk right away. If they later create an account
        with the same name, ask an officer to tidy any duplicate row.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          name="full_name"
          required
          autoComplete="off"
          placeholder="Full name"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <div className="w-40">
          <PasswordInput
            name="pin"
            autoComplete="off"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            placeholder="PIN (optional)"
            className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {state?.error && (
        <p className="mt-2 text-sm text-danger">{state.error}</p>
      )}
      {state?.success && (
        <p className="mt-2 text-sm text-success">{state.success}</p>
      )}
    </form>
  );
}

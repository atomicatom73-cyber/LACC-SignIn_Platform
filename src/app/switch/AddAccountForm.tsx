"use client";

import { useActionState, useState } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { addAccount } from "./actions";

type Mode = "member" | "officer";

/**
 * Sign in to the second account. Mirrors the login screen's two shapes: a
 * member types their name (or email), an officer picks their shared account
 * from the list — the login address itself stays server-side.
 */
export function AddAccountForm({
  defaultMode,
  officers,
}: {
  defaultMode: Mode;
  officers: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState(addAccount, null);
  const [mode, setMode] = useState<Mode>(defaultMode);

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-border bg-surface px-4 py-4"
    >
      <input type="hidden" name="mode" value={mode} />

      <div className="flex gap-2">
        {(["member", "officer"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
              mode === option
                ? "bg-accent text-background"
                : "border border-border bg-surface-2 text-muted"
            }`}
          >
            {option === "member" ? "Member account" : "Officer account"}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {mode === "member" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted">
              Your name or email
            </span>
            <input
              type="text"
              name="identifier"
              autoComplete="username"
              placeholder="Sarah Beckett"
              className="rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted">
              Officer account
            </span>
            <select
              name="officer_id"
              defaultValue=""
              className="rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
            >
              <option value="" disabled>
                Pick an account…
              </option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">
            Password
          </span>
          <PasswordInput
            name="password"
            autoComplete="current-password"
            className="rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add account"}
        </button>

        {state?.error && (
          <p className="text-center text-sm text-danger">{state.error}</p>
        )}
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { chooseRosterTab } from "./actions";

/**
 * Points the roster sync at one tab of the board's sheet. The board opens a
 * fresh tab each trimester and the sync reads exactly one, so without this the
 * app keeps mirroring last trimester — which looks identical to working.
 */
export function RosterTabPicker({
  tabs,
  current,
}: {
  tabs: string[];
  current: string;
}) {
  const [state, action, pending] = useActionState(chooseRosterTab, null);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <label htmlFor="roster-tab" className="text-xs font-medium text-muted">
        Read the roster from
      </label>
      <select
        id="roster-tab"
        name="tab"
        defaultValue={current}
        className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent sm:flex-none"
      >
        {tabs.map((tab) => (
          <option key={tab} value={tab}>
            {tab}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Switching…" : "Switch"}
      </button>
      {state?.error && (
        <p className="w-full text-sm text-danger">{state.error}</p>
      )}
      {state?.success && (
        <p className="w-full text-sm text-success">{state.success}</p>
      )}
    </form>
  );
}

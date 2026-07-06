"use client";

import { useActionState, useState, useTransition } from "react";
import type { Chore } from "@/lib/types";
import { createChore, setChoreActive, updateChore } from "./actions";

/** The chore catalog: add, edit, retire. Retired chores keep their history. */
export function CatalogManager({ chores }: { chores: Chore[] }) {
  const [addState, addAction, addPending] = useActionState(createChore, null);

  const active = chores.filter((c) => c.active);
  const retired = chores.filter((c) => !c.active);

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <form action={addAction} className="flex flex-wrap gap-2">
        <input
          name="name"
          required
          autoComplete="off"
          placeholder="New chore name"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <input
          name="slots"
          type="number"
          min={0}
          max={50}
          defaultValue={1}
          required
          title="How many members it needs each month"
          className="w-20 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={addPending}
          className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {addPending ? "Adding…" : "Add"}
        </button>
        <input
          name="description"
          autoComplete="off"
          placeholder="Description (optional)"
          className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
      </form>
      {addState?.error && (
        <p className="mt-2 text-sm text-danger">{addState.error}</p>
      )}
      {addState?.success && (
        <p className="mt-2 text-sm text-success">{addState.success}</p>
      )}

      {chores.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          The catalog is empty — add the studio&apos;s recurring chores above.
        </p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {active.map((chore) => (
              <CatalogRow key={chore.id} chore={chore} />
            ))}
          </ul>
          {retired.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
                Retired
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {retired.map((chore) => (
                  <CatalogRow key={chore.id} chore={chore} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CatalogRow({ chore }: { chore: Chore }) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState(
    updateChore,
    null,
  );
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleActive = () =>
    startTransition(async () => {
      const result = await setChoreActive(chore.id, !chore.active);
      setToggleError(result?.error ?? null);
    });

  return (
    <li className="rounded-xl border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className={`text-sm font-medium ${chore.active ? "" : "text-muted"}`}>
            {chore.name}
          </span>
          <span className="ml-2 text-xs tabular-nums text-muted">
            ×{chore.slots}
          </span>
          {chore.description && !editing && (
            <div className="mt-0.5 truncate text-xs text-muted">
              {chore.description}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition active:scale-[0.97]"
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            onClick={toggleActive}
            disabled={pending}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition active:scale-[0.97] disabled:opacity-60 ${
              chore.active
                ? "border-border text-danger"
                : "border-success/40 text-success"
            }`}
          >
            {chore.active ? "Retire" : "Restore"}
          </button>
        </div>
      </div>

      {editing && (
        <form action={editAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="chore_id" value={chore.id} />
          <input
            name="name"
            required
            autoComplete="off"
            defaultValue={chore.name}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <input
            name="slots"
            type="number"
            min={0}
            max={50}
            required
            defaultValue={chore.slots}
            className="w-20 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={editPending}
            className="shrink-0 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {editPending ? "…" : "Save"}
          </button>
          <input
            name="description"
            autoComplete="off"
            defaultValue={chore.description ?? ""}
            placeholder="Description (optional)"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
        </form>
      )}
      {editState?.error && (
        <p className="mt-2 text-sm text-danger">{editState.error}</p>
      )}
      {editState?.success && (
        <p className="mt-2 text-sm text-success">{editState.success}</p>
      )}
      {toggleError && <p className="mt-2 text-sm text-danger">{toggleError}</p>}
    </li>
  );
}

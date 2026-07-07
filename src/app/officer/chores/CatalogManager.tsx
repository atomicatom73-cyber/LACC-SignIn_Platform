"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { Chore } from "@/lib/types";
import { createChore, deleteChore, updateChore } from "./actions";

/** The job catalog: add, edit, delete. */
export function CatalogManager({ chores }: { chores: Chore[] }) {
  const [addState, addAction, addPending] = useActionState(createChore, null);

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <form action={addAction} className="flex flex-wrap gap-2">
        <input
          name="name"
          required
          autoComplete="off"
          placeholder="New job name"
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
          The catalog is empty — add the studio&apos;s recurring jobs above.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {chores.map((chore) => (
            <CatalogRow key={chore.id} chore={chore} />
          ))}
        </ul>
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
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Confirm state times out so a stray first tap doesn't linger.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const result = await deleteChore(chore.id);
      setDeleteError(result?.error ?? null);
    });
  };

  return (
    <li className="rounded-xl border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">{chore.name}</span>
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
            onClick={handleDelete}
            disabled={pending}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition active:scale-[0.97] disabled:opacity-60 ${
              confirming
                ? "bg-danger text-background"
                : "border border-border text-danger"
            }`}
          >
            {pending
              ? "…"
              : confirming
                ? "Tap again to delete"
                : "Delete"}
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
      {deleteError && <p className="mt-2 text-sm text-danger">{deleteError}</p>}
    </li>
  );
}

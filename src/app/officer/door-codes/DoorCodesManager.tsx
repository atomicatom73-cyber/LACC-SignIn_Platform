"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { DoorCode } from "@/lib/types";
import { addDoorCode, deleteDoorCode, updateDoorCode } from "./actions";

/** President/VP: add, edit, and delete studio door codes. */
export function DoorCodesManager({ codes }: { codes: DoorCode[] }) {
  const [addState, addAction, addPending] = useActionState(addDoorCode, null);

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <form action={addAction} className="flex flex-wrap gap-2">
        <input
          name="title"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Door or lock (e.g. Front door)"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <input
          name="code"
          required
          maxLength={60}
          autoComplete="off"
          placeholder="Code"
          className="w-32 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={addPending}
          className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {addPending ? "Adding…" : "Add"}
        </button>
      </form>
      {addState?.error && (
        <p className="mt-2 text-sm text-danger">{addState.error}</p>
      )}
      {addState?.success && (
        <p className="mt-2 text-sm text-success">{addState.success}</p>
      )}

      {codes.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No door codes yet — add the studio&apos;s doors and locks above.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {codes.map((code) => (
            <CodeRow key={code.id} code={code} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CodeRow({ code }: { code: DoorCode }) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState(
    updateDoorCode,
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
      const result = await deleteDoorCode(code.id);
      setDeleteError(result?.error ?? null);
    });
  };

  return (
    <li className="rounded-xl border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">{code.title}</span>
          {!editing && (
            <span className="ml-2 font-mono text-sm tracking-wider text-accent">
              {code.code}
            </span>
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
          <input type="hidden" name="door_code_id" value={code.id} />
          <input
            name="title"
            required
            maxLength={80}
            autoComplete="off"
            defaultValue={code.title}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <input
            name="code"
            required
            maxLength={60}
            autoComplete="off"
            defaultValue={code.code}
            className="w-32 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={editPending}
            className="shrink-0 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {editPending ? "…" : "Save"}
          </button>
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

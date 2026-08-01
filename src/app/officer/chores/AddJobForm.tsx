"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { RichTextInput } from "@/components/RichTextInput";
import { INTERVAL_OPTIONS } from "@/lib/chores";
import { SchedulingToggle } from "./SchedulingToggle";
import { createChore } from "./actions";

/** "＋ Add a job" at the top of the jobs page — expands into the form. */
export function AddJobForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createChore, null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // A successful add clears the fields so the next job can be typed straight
  // in; the success line below confirms what landed.
  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      nameRef.current?.focus();
    }
  }, [state]);

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div>
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-sm font-semibold text-muted transition active:scale-[0.99]"
        >
          ＋ Add a job
        </button>
        {state?.success && (
          <p className="mt-2 text-sm text-success">{state.success}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Add a job
        </h2>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition active:scale-[0.97]"
        >
          Close
        </button>
      </div>
      <form ref={formRef} action={action} className="mt-3 flex flex-wrap gap-2">
        <input
          ref={nameRef}
          name="name"
          required
          autoComplete="off"
          placeholder="Job name"
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
        <select
          name="interval"
          defaultValue="month"
          className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          {INTERVAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <RichTextInput
          name="description"
          placeholder="Description (optional) — what needs doing, and how?"
        />
        <SchedulingToggle />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add job"}
        </button>
      </form>
      {state?.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
      {state?.success && (
        <p className="mt-2 text-sm text-success">{state.success}</p>
      )}
    </div>
  );
}

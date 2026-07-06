"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { sendMessage } from "./actions";

export type PickerMember = { id: string; full_name: string };

export function ComposeForm({ members }: { members: PickerMember[] }) {
  const [state, formAction, pending] = useActionState(sendMessage, null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "selected">("all");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Clear the form after a successful send.
  useEffect(() => {
    if (state?.success) {
      setSubject("");
      setBody("");
      setFilter("");
      setSelected(new Set());
    }
  }, [state]);

  const query = filter.trim().toLowerCase();
  const visibleIds = useMemo(() => {
    if (!query) return new Set(members.map((m) => m.id));
    return new Set(
      members
        .filter((m) => m.full_name.toLowerCase().includes(query))
        .map((m) => m.id),
    );
  }, [members, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-border bg-surface px-4 py-4"
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">
            Subject
          </span>
          <input
            type="text"
            name="subject"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Kiln unloading this Saturday"
            className="rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">
            Message
          </span>
          <textarea
            name="body"
            required
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should everyone know?"
            className="resize-y rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
          />
        </label>

        <fieldset>
          <legend className="mb-2 text-xs uppercase tracking-wide text-muted">
            Audience
          </legend>
          <div className="flex gap-2">
            {(
              [
                { value: "all", label: "All members" },
                { value: "selected", label: "Choose members" },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-full px-4 py-2 text-sm font-medium transition ${
                  audience === option.value
                    ? "bg-accent text-background"
                    : "border border-border bg-surface-2 text-muted"
                }`}
              >
                <input
                  type="radio"
                  name="audience"
                  value={option.value}
                  checked={audience === option.value}
                  onChange={() => setAudience(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {audience === "selected" && (
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter members…"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <span className="shrink-0 text-xs text-muted">
                {selected.size} selected
              </span>
            </div>
            {members.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No active members yet.</p>
            ) : (
              <ul className="mt-2 max-h-56 overflow-y-auto">
                {members.map((m) => (
                  <li key={m.id} className={visibleIds.has(m.id) ? "" : "hidden"}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition hover:bg-surface">
                      <input
                        type="checkbox"
                        name="recipients"
                        value={m.id}
                        checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)}
                        className="h-5 w-5 shrink-0 accent-accent"
                      />
                      {m.full_name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send announcement"}
        </button>

        {state?.error && (
          <p className="text-center text-sm text-danger">{state.error}</p>
        )}
        {state?.success && (
          <p className="text-center text-sm text-success">{state.success}</p>
        )}
      </div>
    </form>
  );
}

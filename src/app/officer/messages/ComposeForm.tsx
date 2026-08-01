"use client";

import { useActionState, useMemo, useState } from "react";
import {
  AUDIENCE_LABELS,
  COMPOSE_AUDIENCES,
  type ComposeAudience,
} from "@/lib/messages";
import { submitCompose } from "./actions";

export type PickerMember = {
  id: string;
  full_name: string;
  active: boolean;
  kilnTeam: boolean;
  officerStatus: boolean;
  hasEmail: boolean;
};

/** What a loaded draft (or a resend) drops into the form. */
export type ComposeInitial = {
  draftId: string | null;
  subject: string;
  body: string;
  audience: ComposeAudience;
  /** Explicit recipients; null means "just the audience group". */
  recipientIds: string[] | null;
};

export const BLANK_COMPOSE: ComposeInitial = {
  draftId: null,
  subject: "",
  body: "",
  audience: "active",
  recipientIds: null,
};

/** Everyone who qualifies for a group, in the order the list renders. */
function groupIds(members: PickerMember[], audience: ComposeAudience): string[] {
  if (audience === "selected") return [];
  return members
    .filter((m) => {
      if (audience === "active") return m.active;
      if (audience === "inactive") return !m.active;
      if (audience === "kiln_team") return m.kilnTeam && m.active;
      return true; // everyone
    })
    .map((m) => m.id);
}

export function ComposeForm({
  members,
  initial = BLANK_COMPOSE,
}: {
  members: PickerMember[];
  initial?: ComposeInitial;
}) {
  const [state, formAction, pending] = useActionState(submitCompose, null);
  const [draftId, setDraftId] = useState(initial.draftId);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [audience, setAudience] = useState<ComposeAudience>(initial.audience);
  const [filter, setFilter] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(initial.recipientIds ?? groupIds(members, initial.audience)),
  );

  // Clear the form after a send / save. State is adjusted during render (not
  // in an effect): each submit returns a fresh `state` object, so this runs
  // exactly once per success and React re-renders before painting.
  const [clearedFor, setClearedFor] = useState<typeof state>(null);
  if (state?.cleared && state !== clearedFor) {
    setClearedFor(state);
    setDraftId(null);
    setSubject("");
    setBody("");
    setFilter("");
    setShowSchedule(false);
    setAudience("active");
    setSelected(new Set(groupIds(members, "active")));
  }

  // The group as it stands right now, to spot hand edits.
  const group = useMemo(
    () => groupIds(members, audience),
    [members, audience],
  );
  const edited = useMemo(() => {
    if (audience === "selected") return true;
    if (group.length !== selected.size) return true;
    return group.some((id) => !selected.has(id));
  }, [audience, group, selected]);

  const query = filter.trim().toLowerCase();
  const visibleIds = useMemo(() => {
    if (!query) return new Set(members.map((m) => m.id));
    return new Set(
      members
        .filter((m) => m.full_name.toLowerCase().includes(query))
        .map((m) => m.id),
    );
  }, [members, query]);

  const pickAudience = (next: ComposeAudience) => {
    setAudience(next);
    // Switching groups re-checks that group's people; "Choose members" starts
    // from nobody so it's an explicit build-up.
    setSelected(new Set(groupIds(members, next)));
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const skipOfficers = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of members) if (m.officerStatus) next.delete(m.id);
      return next;
    });
  };

  const officersIn = members.filter(
    (m) => m.officerStatus && selected.has(m.id),
  ).length;

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-border bg-surface px-4 py-4"
    >
      {draftId && <input type="hidden" name="draft_id" value={draftId} />}
      <input type="hidden" name="edited" value={edited ? "1" : "0"} />

      <div className="flex flex-col gap-4">
        {draftId && (
          <p className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
            Editing a saved draft — sending it will take it out of your drafts.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">
            Subject
          </span>
          <input
            type="text"
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="“Kiln unloading this Saturday”"
            className="rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">
            Message
          </span>
          <textarea
            name="body"
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
          <div className="flex flex-wrap gap-2">
            {COMPOSE_AUDIENCES.map((option) => (
              <label
                key={option}
                className={`cursor-pointer rounded-full px-4 py-2 text-sm font-medium transition ${
                  audience === option
                    ? "bg-accent text-background"
                    : "border border-border bg-surface-2 text-muted"
                }`}
              >
                <input
                  type="radio"
                  name="audience"
                  value={option}
                  checked={audience === option}
                  onChange={() => pickAudience(option)}
                  className="sr-only"
                />
                {AUDIENCE_LABELS[option]}
              </label>
            ))}
          </div>
        </fieldset>

        {/* The group's people, pre-ticked and fully editable — add anyone who
            doesn't qualify, drop anyone who does. */}
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Recipients
            </span>
            <span className="text-xs text-muted">
              {selected.size} selected
              {edited && audience !== "selected" && " · edited"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter members…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={skipOfficers}
              disabled={officersIn === 0}
              title="Remove every member with officer status from this message"
              className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-muted transition active:scale-[0.97] disabled:opacity-40"
            >
              Skip officers{officersIn > 0 ? ` (${officersIn})` : ""}
            </button>
            {edited && audience !== "selected" && (
              <button
                type="button"
                onClick={() => setSelected(new Set(group))}
                className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-muted transition active:scale-[0.97]"
              >
                Reset
              </button>
            )}
          </div>

          {members.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No members yet.</p>
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
                    <span className="min-w-0 truncate">{m.full_name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted">
                      {m.officerStatus && <span>officer</span>}
                      {m.kilnTeam && <span>kiln team</span>}
                      {!m.active && <span>inactive</span>}
                      {!m.hasEmail && <span>no email</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showSchedule && (
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Send later
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="date"
                name="send_date"
                required
                aria-label="Date to send"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <input
                type="time"
                name="send_time"
                defaultValue="09:00"
                aria-label="Time to send"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Goes out within a few minutes of that time whenever anyone is
              using the app, and by the next morning at the latest.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="intent"
            value="send"
            disabled={pending}
            className="min-w-[10rem] flex-1 rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "Working…" : "Send announcement"}
          </button>
          {showSchedule ? (
            <button
              type="submit"
              name="intent"
              value="schedule"
              disabled={pending}
              className="rounded-2xl border border-accent/40 bg-accent/10 px-4 py-4 text-sm font-semibold text-accent transition active:scale-[0.98] disabled:opacity-60"
            >
              Schedule it
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowSchedule(true)}
              className="rounded-2xl border border-border px-4 py-4 text-sm font-medium text-muted transition active:scale-[0.98]"
            >
              🗓 Send later
            </button>
          )}
          <button
            type="submit"
            name="intent"
            value="draft"
            disabled={pending}
            className="rounded-2xl border border-border px-4 py-4 text-sm font-medium text-muted transition active:scale-[0.98] disabled:opacity-60"
          >
            Save draft
          </button>
        </div>

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

"use client";

import { useActionState, useEffect } from "react";
import { studioDateTimeParts } from "@/lib/studio";
import type { EventCategory, StudioEvent } from "@/lib/types";
import { createEvent, updateEvent } from "./actions";

const CATEGORY_OPTIONS: { value: EventCategory; label: string }[] = [
  { value: "class", label: "Class" },
  { value: "workshop", label: "Workshop" },
  { value: "party", label: "Party" },
  { value: "camp", label: "Camp" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

const inputClass =
  "w-full rounded-2xl border border-border bg-surface-2 px-4 py-3 text-base outline-none focus:border-accent";

/**
 * Create/edit form for a calendar event. Pass `event` to edit (fields are
 * prefilled in studio-local time); omit it to create. `onDone` fires after a
 * successful save and on cancel.
 */
export function EventForm({
  event,
  onDone,
}: {
  event?: StudioEvent;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    event ? updateEvent : createEvent,
    null,
  );

  useEffect(() => {
    if (state && "success" in state) onDone();
  }, [state, onDone]);

  const error = state && "error" in state ? state.error : null;
  const start = event ? studioDateTimeParts(event.starts_at) : null;
  const endTime = event?.ends_at ? studioDateTimeParts(event.ends_at).time : "";

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-border bg-surface px-4 py-4"
    >
      <h3 className="text-base font-semibold">
        {event ? "Edit event" : "Add event"}
      </h3>

      {event && <input type="hidden" name="id" value={event.id} />}

      <div className="mt-4 flex flex-col gap-4">
        <Field label="Title">
          <input
            type="text"
            name="title"
            required
            defaultValue={event?.title ?? ""}
            placeholder="Raku firing night"
            className={inputClass}
          />
        </Field>

        <Field label="Category">
          <select
            name="category"
            defaultValue={event?.category ?? "class"}
            className={inputClass}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date">
          <input
            type="date"
            name="date"
            required
            defaultValue={start?.date ?? ""}
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <input
              type="time"
              name="start_time"
              required
              defaultValue={start?.time ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="End time (optional)">
            <input
              type="time"
              name="end_time"
              defaultValue={endTime}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Location (optional)">
          <input
            type="text"
            name="location"
            defaultValue={event?.location ?? ""}
            placeholder="Main studio"
            className={inputClass}
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            name="description"
            rows={3}
            defaultValue={event?.description ?? ""}
            placeholder="What should members know?"
            className={inputClass}
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-2xl bg-accent px-6 py-3 text-base font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Saving…" : event ? "Save changes" : "Add event"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-2xl border border-border bg-surface-2 px-6 py-3 text-base font-semibold text-muted transition active:scale-[0.98] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

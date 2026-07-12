"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { studioToUtcIso } from "@/lib/studio";
import type { EventCategory, EventRecurrence } from "@/lib/types";

export type EventFormState = { error: string } | { success: true } | null;

const CATEGORIES: readonly EventCategory[] = [
  "class",
  "workshop",
  "party",
  "camp",
  "meeting",
  "other",
];

const RECURRENCES: readonly EventRecurrence[] = [
  "none",
  "daily",
  "weekly",
  "monthly",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

type EventValues = {
  title: string;
  description: string | null;
  category: EventCategory;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  recurrence: EventRecurrence;
};

/** Validate the shared event form and convert studio-local inputs to UTC. */
function parseEventForm(
  formData: FormData,
): { error: string } | { values: EventValues } {
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "");
  const date = String(formData.get("date") ?? "").trim();
  // <input type="time"> can include seconds in some browsers — keep HH:MM.
  const startTime = String(formData.get("start_time") ?? "").trim().slice(0, 5);
  const endTime = String(formData.get("end_time") ?? "").trim().slice(0, 5);
  const location = String(formData.get("location") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const recurrence = String(formData.get("recurrence") ?? "none");

  if (!title) return { error: "Give the event a title." };
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return { error: "Pick a category." };
  }
  if (!(RECURRENCES as readonly string[]).includes(recurrence)) {
    return { error: "Pick how the event repeats." };
  }
  if (!DATE_RE.test(date)) return { error: "Pick a date." };
  if (!TIME_RE.test(startTime)) return { error: "Pick a start time." };
  if (endTime && !TIME_RE.test(endTime)) {
    return { error: "End time looks wrong — use HH:MM." };
  }

  const starts_at = studioToUtcIso(date, startTime);
  const ends_at = endTime ? studioToUtcIso(date, endTime) : null;
  if (ends_at && ends_at <= starts_at) {
    return { error: "End time must be after the start time." };
  }

  return {
    values: {
      title,
      description: description || null,
      category: category as EventCategory,
      location: location || null,
      starts_at,
      ends_at,
      recurrence: recurrence as EventRecurrence,
    },
  };
}

/** Create a calendar event (president / vice president only). */
export async function createEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const { supabase, member } = await requireOfficer([
    "president",
    "vice_president",
  ]);

  const parsed = parseEventForm(formData);
  if ("error" in parsed) return parsed;

  const { error } = await supabase
    .from("events")
    .insert({ ...parsed.values, created_by: member.id });
  if (error) return { error: error.message };

  revalidatePath("/calendar");
  return { success: true };
}

/** Update a calendar event (president / vice president only). */
export async function updateEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const { supabase } = await requireOfficer(["president", "vice_president"]);

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing event id." };

  const parsed = parseEventForm(formData);
  if ("error" in parsed) return parsed;

  const { error } = await supabase
    .from("events")
    .update(parsed.values)
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/calendar");
  return { success: true };
}

/** Delete a calendar event (president / vice president only). */
export async function deleteEvent(
  eventId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer(["president", "vice_president"]);

  if (!eventId) return { error: "Missing event id." };

  const { error } = await supabase.from("events").delete().eq("id", eventId);
  if (error) return { error: error.message };

  revalidatePath("/calendar");
  return null;
}

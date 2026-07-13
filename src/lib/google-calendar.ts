/**
 * Google Calendar sync. The studio's public Google calendar is the single
 * source of truth for events; we mirror it into the `events` table so the
 * existing calendar UI renders it unchanged.
 *
 * Freshness comes primarily from an on-demand pull: the calendar page calls
 * `syncGoogleCalendarThrottled()` on load, so whoever opens it sees near-live
 * data without a paid cron plan. A once-daily Vercel Cron hit to
 * app/api/calendar-sync is the backstop for days nobody visits (Vercel's Hobby
 * plan caps cron at once per day).
 *
 * Read-only: we use a public API key against a public calendar, so there is no
 * OAuth. Recurrence is expanded by Google (`singleEvents=true`), so every row we
 * store is a one-off (`recurrence = 'none'`).
 */

import { createAdminClient } from "./supabase/admin";
import { studioToUtcIso } from "./studio";

const API_BASE = "https://www.googleapis.com/calendar/v3/calendars";

/** Rolling window to mirror, in months either side of "now". */
const WINDOW_BACK_MONTHS = 1;
const WINDOW_AHEAD_MONTHS = 6;

/** Shape we upsert into `public.events`. */
type EventRow = {
  google_event_id: string;
  source: "google";
  title: string;
  description: string | null;
  location: string | null;
  category: "other";
  recurrence: "none";
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  created_by: null;
};

/** The subset of the Google Calendar `events.list` item we read. */
type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

function mapEvent(item: GoogleEvent): EventRow | null {
  if (!item.id || item.status === "cancelled" || !item.start) return null;

  let starts_at: string;
  let ends_at: string | null;
  let all_day: boolean;

  if (item.start.date) {
    // All-day: Google gives bare calendar dates. Treat them as studio-local
    // days. `end.date` is exclusive (the morning after the last day).
    all_day = true;
    starts_at = studioToUtcIso(item.start.date, "00:00");
    ends_at = item.end?.date ? studioToUtcIso(item.end.date, "00:00") : null;
  } else if (item.start.dateTime) {
    // Timed: dateTime carries a UTC offset, so it parses straight to the
    // instant regardless of the calendar's timezone.
    all_day = false;
    starts_at = new Date(item.start.dateTime).toISOString();
    ends_at = item.end?.dateTime
      ? new Date(item.end.dateTime).toISOString()
      : null;
  } else {
    return null;
  }

  return {
    google_event_id: item.id,
    source: "google",
    title: (item.summary ?? "(untitled)").slice(0, 300),
    description: item.description ?? null,
    location: item.location ?? null,
    category: "other",
    recurrence: "none",
    starts_at,
    ends_at,
    all_day,
    created_by: null,
  };
}

async function fetchGoogleEvents(
  timeMin: string,
  timeMax: string,
): Promise<EventRow[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!calendarId || !apiKey) {
    throw new Error(
      "GOOGLE_CALENDAR_ID and GOOGLE_CALENDAR_API_KEY must be set.",
    );
  }

  const rows: EventRow[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${API_BASE}/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("singleEvents", "true"); // expand recurrence for us
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Google Calendar API ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      const row = mapEvent(item);
      if (row) rows.push(row);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return rows;
}

/**
 * Mirror the Google calendar into `public.events` for a rolling window: upsert
 * everything currently in the feed, then delete any Google rows in the window
 * that have since disappeared (deleted or moved out). Native rows are never
 * touched.
 */
export async function syncGoogleCalendar(): Promise<{
  synced: number;
  deleted: number;
}> {
  const now = new Date();
  const min = new Date(now);
  min.setMonth(min.getMonth() - WINDOW_BACK_MONTHS);
  const max = new Date(now);
  max.setMonth(max.getMonth() + WINDOW_AHEAD_MONTHS);
  const minIso = min.toISOString();
  const maxIso = max.toISOString();

  const rows = await fetchGoogleEvents(minIso, maxIso);
  const admin = createAdminClient();

  if (rows.length > 0) {
    const { error } = await admin
      .from("events")
      .upsert(rows, { onConflict: "google_event_id" });
    if (error) throw new Error(`Upsert failed: ${error.message}`);
  }

  // Prune Google rows whose start falls in the window but that are no longer in
  // the feed. Bounding by start keeps events outside the horizon untouched.
  const seen = new Set(rows.map((r) => r.google_event_id));
  const { data: existing, error: readErr } = await admin
    .from("events")
    .select("id, google_event_id")
    .eq("source", "google")
    .gte("starts_at", minIso)
    .lt("starts_at", maxIso);
  if (readErr) throw new Error(`Read failed: ${readErr.message}`);

  const stale = (existing ?? [])
    .filter((r) => r.google_event_id && !seen.has(r.google_event_id))
    .map((r) => r.id);

  if (stale.length > 0) {
    const { error } = await admin.from("events").delete().in("id", stale);
    if (error) throw new Error(`Delete failed: ${error.message}`);
  }

  return { synced: rows.length, deleted: stale.length };
}

/** Key for the sync marker row in `public.sync_state`. */
const SYNC_STATE_KEY = "google_calendar";

/**
 * On-demand pull throttle: a burst of page loads should trigger at most one
 * Google fetch per this window. Kept short so the calendar feels live.
 */
const THROTTLE_MS = 60_000;

/**
 * Entry point for the calendar page. Runs {@link syncGoogleCalendar} only if the
 * last run was more than {@link THROTTLE_MS} ago. Claims the window (writes the
 * marker) *before* syncing so simultaneous loads see it as fresh and skip —
 * worst case two loads race and both sync, which is harmless since upserts are
 * idempotent. Returns whether a sync actually ran.
 */
export async function syncGoogleCalendarThrottled(): Promise<
  | { ran: false }
  | { ran: true; synced: number; deleted: number }
> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sync_state")
    .select("last_synced_at")
    .eq("key", SYNC_STATE_KEY)
    .maybeSingle();

  const last = data?.last_synced_at
    ? new Date(data.last_synced_at).getTime()
    : 0;
  if (Date.now() - last < THROTTLE_MS) return { ran: false };

  await admin
    .from("sync_state")
    .upsert(
      { key: SYNC_STATE_KEY, last_synced_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  const result = await syncGoogleCalendar();
  return { ran: true, ...result };
}

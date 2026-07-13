import Link from "next/link";
import Form from "next/form";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOfficer } from "@/lib/roles";
import {
  addMonths,
  dayLabel,
  formatStudioClock,
  monthKey,
  studioDayKey,
  studioToUtcIso,
} from "@/lib/studio";
import { occurrencesByDay } from "@/lib/events";
import { syncGoogleCalendarThrottled } from "@/lib/google-calendar";
import type { StudioEvent } from "@/lib/types";
import { Wordmark } from "@/components/Brand";
import { MonthGrid, type DayMarker } from "@/components/MonthGrid";
import { EventCard } from "./EventCard";

export const dynamic = "force-dynamic";

const EVENT_COLUMNS =
  "id, title, description, category, location, starts_at, ends_at, recurrence, all_day, source, google_event_id, created_by, created_at";

/** "2026-07-14" → "Mon 14" for the agenda rail. */
function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "2026-07-14" → "Jul 14" (calendar date, timezone-free). */
function monthDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string; q?: string }>;
}) {
  // The calendar is public — anyone with the link (or the home-page button)
  // can read it. A logged-in session only adds the right back-link and, for
  // president/VP, the manage controls.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let role: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("members")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    role = data?.role ?? null;
  }

  const { month: rawMonth, day: rawDay, q: rawQ } = await searchParams;
  const currentMonth = monthKey();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth ?? "")
    ? `${rawMonth}-01`
    : currentMonth;
  const ym = month.slice(0, 7);
  // PostgREST `or=` syntax breaks on commas/parens; strip them from searches.
  const query = (rawQ ?? "").replace(/[,()]/g, " ").trim().slice(0, 80);

  const todayKey = studioDayKey();
  const selectedDay =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDay ?? "") && rawDay!.startsWith(ym)
      ? rawDay!
      : month === currentMonth
        ? todayKey
        : `${ym}-01`;

  // Events are public info, and anonymous visitors have no session that RLS
  // would let through — read them with the server-side service role.
  const admin = createAdminClient();

  // Keep the calendar live: pull the latest from Google whenever someone opens
  // the page (throttled to one fetch per minute). This is the primary sync — a
  // failure must never break the page, so swallow and render whatever is stored.
  try {
    await syncGoogleCalendarThrottled();
  } catch (error) {
    console.error("[calendar] on-demand sync failed", error);
  }

  // Events that can put an occurrence in this month: anything recurring that
  // started before month end, one-offs starting inside the month, and multi-day
  // all-day spans (e.g. camps) that started earlier but end inside it.
  const startUtc = studioToUtcIso(`${ym}-01`, "00:00");
  const endUtc = studioToUtcIso(`${addMonths(month, 1).slice(0, 7)}-01`, "00:00");
  const { data } = await admin
    .from("events")
    .select(EVENT_COLUMNS)
    .lt("starts_at", endUtc)
    .or(`recurrence.neq.none,starts_at.gte.${startUtc},ends_at.gte.${startUtc}`)
    .order("starts_at", { ascending: true });

  const events: StudioEvent[] = data ?? [];
  const backHref = role === null ? "/" : isOfficer(role) ? "/officer" : "/me";

  // Search spans ALL events (any month), not just the visible one.
  let results: StudioEvent[] = [];
  if (query) {
    const pattern = `%${query}%`;
    const { data: found } = await admin
      .from("events")
      .select(EVENT_COLUMNS)
      .or(
        `title.ilike.${pattern},description.ilike.${pattern},location.ilike.${pattern}`,
      )
      .order("starts_at", { ascending: true })
      .limit(30);
    results = found ?? [];
  }

  const byDay = occurrencesByDay(events, month);
  const markers: Record<string, DayMarker> = {};
  for (const [key, list] of byDay) {
    markers[key] = {
      dots: list.length,
      labels: list.map((occ) => occ.event.title),
    };
  }
  const dayOccurrences = byDay.get(selectedDay) ?? [];
  const monthDays = [...byDay.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  // "This month at a glance" lists one row per event, not per day: a multi-day
  // span (e.g. a week-long camp) still marks every day on the grid above, but
  // here it appears once — on its first day in the month — as a date range.
  const seenMultiDay = new Set<string>();
  const glanceDays = monthDays
    .map(([dayKey, occs]) => {
      const visible = occs.filter((occ) => {
        if (!occ.isMultiDay) return true;
        if (seenMultiDay.has(occ.event.id)) return false;
        seenMultiDay.add(occ.event.id);
        return true;
      });
      return [dayKey, visible] as const;
    })
    .filter(([, occs]) => occs.length > 0);

  const prev = addMonths(month, -1).slice(0, 7);
  const next = addMonths(month, 1).slice(0, 7);

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <Link href={backHref} className="text-sm text-muted">
          ← Back
        </Link>
      </header>

      <div className="mt-8">
        <h1 className="text-2xl font-bold tracking-tight">Studio calendar</h1>
        <p className="mt-1 text-sm text-muted">
          Classes, workshops, parties, and everything else at the studio.
        </p>
      </div>

      <Form action="/calendar" className="mt-5 flex gap-2">
        <input type="hidden" name="month" value={ym} />
        <input
          type="search"
          name="q"
          defaultValue={query}
          autoComplete="off"
          placeholder="Search events…"
          className="min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-muted transition active:scale-[0.98]"
        >
          Search
        </button>
      </Form>

      {query ? (
        <section className="mt-6 flex-1">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {results.length === 0
                ? `Nothing matches “${query}”`
                : `${results.length} match${results.length === 1 ? "" : "es"} for “${query}”`}
            </h2>
            <Link
              href={`/calendar?month=${ym}`}
              className="shrink-0 text-sm text-accent"
            >
              Clear search
            </Link>
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-muted">
              Try a shorter word — search covers titles, descriptions, and
              locations.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {results.map((event) => (
                <li key={event.id}>
                  <EventCard event={event} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <div className="mt-5">
            <MonthGrid
              month={month}
              markers={markers}
              selectedDay={selectedDay}
              hrefForDay={(d) => `/calendar?month=${ym}&day=${d}`}
              prevHref={`/calendar?month=${prev}`}
              nextHref={`/calendar?month=${next}`}
            />
          </div>

          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              {dayLabel(selectedDay)}
              {selectedDay === todayKey && (
                <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  today
                </span>
              )}
            </h2>

            {dayOccurrences.length === 0 ? (
              <p className="text-sm text-muted">Nothing on this day.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {dayOccurrences.map((occ) => (
                  <li key={`${occ.event.id}-${occ.dayKey}`}>
                    <EventCard event={occ.event} occursAtIso={occ.startsAtIso} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8 flex-1">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              This month at a glance
            </h2>
            {glanceDays.length === 0 ? (
              <p className="text-sm text-muted">No events this month.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {glanceDays.map(([dayKey, occs]) => (
                  <li key={dayKey}>
                    <Link
                      href={`/calendar?month=${ym}&day=${dayKey}`}
                      className={`flex gap-3 rounded-xl border px-3 py-2.5 transition active:scale-[0.99] ${
                        dayKey === todayKey
                          ? "border-accent/50 bg-accent/5"
                          : "border-border bg-surface"
                      }`}
                    >
                      <span
                        className={`w-16 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wide ${
                          dayKey === todayKey ? "text-accent" : "text-muted"
                        }`}
                      >
                        {shortDay(dayKey)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        {occs.map((occ) => (
                          <span
                            key={`${occ.event.id}-${occ.dayKey}`}
                            className="flex min-w-0 items-baseline gap-2 text-sm"
                          >
                            <span className="shrink-0 text-xs tabular-nums text-muted">
                              {occ.isMultiDay
                                ? `${monthDay(occ.spanStartKey)} – ${monthDay(occ.spanEndKey)}`
                                : occ.event.all_day
                                  ? "All day"
                                  : formatStudioClock(occ.startsAtIso)}
                            </span>
                            <span className="truncate font-medium">
                              {occ.event.title}
                            </span>
                          </span>
                        ))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

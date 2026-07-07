import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { canManageCalendar, isOfficer } from "@/lib/roles";
import {
  addMonths,
  dayLabel,
  monthKey,
  studioDayKey,
  studioToUtcIso,
} from "@/lib/studio";
import { occurrencesByDay } from "@/lib/events";
import type { StudioEvent } from "@/lib/types";
import { Wordmark } from "@/components/Brand";
import { MonthGrid, type DayMarker } from "@/components/MonthGrid";
import { AddEvent } from "./AddEvent";
import { EventCard } from "./EventCard";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string }>;
}) {
  const { supabase, member } = await requireMember();
  if (!member) redirect("/me"); // /me shows the profile-setup hint

  const { month: rawMonth, day: rawDay } = await searchParams;
  const currentMonth = monthKey();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth ?? "")
    ? `${rawMonth}-01`
    : currentMonth;
  const ym = month.slice(0, 7);

  const todayKey = studioDayKey();
  const selectedDay =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDay ?? "") && rawDay!.startsWith(ym)
      ? rawDay!
      : month === currentMonth
        ? todayKey
        : `${ym}-01`;

  // Events that can put an occurrence in this month: anything recurring that
  // started before month end, plus one-offs starting inside the month.
  const startUtc = studioToUtcIso(`${ym}-01`, "00:00");
  const endUtc = studioToUtcIso(`${addMonths(month, 1).slice(0, 7)}-01`, "00:00");
  const { data } = await supabase
    .from("events")
    .select(
      "id, title, description, category, location, starts_at, ends_at, recurrence, created_by, created_at",
    )
    .lt("starts_at", endUtc)
    .or(`recurrence.neq.none,starts_at.gte.${startUtc}`)
    .order("starts_at", { ascending: true });

  const events: StudioEvent[] = data ?? [];
  const canManage = canManageCalendar(member.role);
  const backHref = isOfficer(member.role) ? "/officer" : "/me";

  const byDay = occurrencesByDay(events, month);
  const markers: Record<string, DayMarker> = {};
  for (const [key, list] of byDay) {
    markers[key] = { dots: list.length };
  }
  const dayOccurrences = byDay.get(selectedDay) ?? [];

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

      {canManage && (
        <div className="mt-5">
          <AddEvent />
        </div>
      )}

      <section className="mt-6 flex-1">
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
                <EventCard
                  event={occ.event}
                  occursAtIso={occ.startsAtIso}
                  canManage={canManage}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

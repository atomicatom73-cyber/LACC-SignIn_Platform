import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { canManageCalendar, isOfficer } from "@/lib/roles";
import { monthKey, monthLabel } from "@/lib/studio";
import type { StudioEvent } from "@/lib/types";
import { Wordmark } from "@/components/Brand";
import { AddEvent } from "./AddEvent";
import { EventCard } from "./EventCard";

export const dynamic = "force-dynamic";

type MonthGroup = { key: string; label: string; events: StudioEvent[] };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ past?: string }>;
}) {
  const { supabase, member } = await requireMember();
  if (!member) redirect("/me"); // /me shows the profile-setup hint

  const { past } = await searchParams;
  const showPast = past === "1";
  const nowIso = new Date().toISOString();

  const query = supabase
    .from("events")
    .select(
      "id, title, description, category, location, starts_at, ends_at, created_by, created_at",
    );

  // "Upcoming" means the event hasn't ended yet: ends_at ?? starts_at >= now.
  const { data } = showPast
    ? await query
        .or(`and(ends_at.is.null,starts_at.lt.${nowIso}),ends_at.lt.${nowIso}`)
        .order("starts_at", { ascending: false })
        .limit(50)
    : await query
        .or(`starts_at.gte.${nowIso},ends_at.gte.${nowIso}`)
        .order("starts_at", { ascending: true });

  const events: StudioEvent[] = data ?? [];
  const canManage = canManageCalendar(member.role);
  const backHref = isOfficer(member.role) ? "/officer" : "/me";

  // Group upcoming events by studio-local month (already sorted ascending).
  const groups: MonthGroup[] = [];
  if (!showPast) {
    for (const event of events) {
      const key = monthKey(new Date(event.starts_at));
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.events.push(event);
      else groups.push({ key, label: monthLabel(key), events: [event] });
    }
  }

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

      <nav className="mt-5 flex gap-2 text-sm font-medium">
        <Link href="/calendar" className={pillClass(!showPast)}>
          Upcoming
        </Link>
        <Link href="/calendar?past=1" className={pillClass(showPast)}>
          Past
        </Link>
      </nav>

      {canManage && (
        <div className="mt-5">
          <AddEvent />
        </div>
      )}

      <section className="mt-6 flex-1">
        {events.length === 0 ? (
          <p className="text-sm text-muted">
            {showPast
              ? "No past events yet."
              : "No upcoming events — check back soon."}
          </p>
        ) : showPast ? (
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} canManage={canManage} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map((group) => (
              <div key={group.key}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                  {group.label}
                </h2>
                <ul className="flex flex-col gap-3">
                  {group.events.map((event) => (
                    <li key={event.id}>
                      <EventCard event={event} canManage={canManage} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function pillClass(active: boolean): string {
  return `shrink-0 rounded-full px-4 py-2 transition ${
    active
      ? "bg-accent text-background"
      : "border border-border bg-surface text-muted"
  }`;
}

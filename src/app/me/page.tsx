import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { flushDueMessages } from "@/lib/messages";
import { isOfficer } from "@/lib/roles";
import {
  formatStudioDateTime,
  monthKey,
} from "@/lib/studio";
import {
  formatClock,
  formatDay,
  formatDuration,
  formatHours,
  shiftDurationMs,
  startOfWeek,
  totalHours,
  type Shift,
} from "@/lib/time";
import type { ChoreInterval } from "@/lib/types";
import { readAltSession } from "@/lib/alt-session";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { Wordmark } from "@/components/Brand";
import { AnnouncementsBanner } from "@/components/AnnouncementsBanner";
import { LogoutButton } from "@/components/LogoutButton";
import { ServerClock } from "@/components/ServerClock";
import { ClockCard } from "./ClockCard";
import { ChoresCard, type MyChore } from "./ChoresCard";
import { ProfileSetup } from "./ProfileSetup";
import { signOutAuth } from "./actions";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id, full_name, role, active")
    .eq("user_id", user.id)
    .single();

  if (!member) {
    return <ProfileSetup />;
  }
  // Shared officer logins get the officer dashboard instead.
  if (isOfficer(member.role)) redirect("/officer");

  // Forgot to sign out yesterday? Shifts close at end of that studio day.
  await supabase.rpc("close_stale_shifts");

  // The officer account parked on this device, if any (see lib/alt-session).
  const parked = await readAltSession();

  // Members open this page all day, which is what makes a scheduled
  // announcement land close to its time on a plan with no minute-level cron.
  // Runs after the response and never affects it.
  after(async () => {
    try {
      await flushDueMessages();
    } catch (err) {
      console.error("[messages] flush from /me failed:", err);
    }
  });

  const month = monthKey();

  const [shiftsRes, choresRes, creditsRes, absenceRes, unreadRes, eventsRes] =
    await Promise.all([
      supabase
        .from("shifts")
        .select("id, member_id, signed_in_at, signed_out_at, source")
        .eq("member_id", member.id)
        .order("signed_in_at", { ascending: false }),
      supabase
        .from("chore_assignments")
        .select(
          "id, month, status, completed_at, scheduled_at, chores(name, description, interval, scheduling_enabled)",
        )
        .eq("member_id", member.id)
        .or(`month.eq.${month},status.eq.pending`)
        .order("month", { ascending: false }),
      supabase
        .from("chore_credits")
        .select("id", { count: "exact", head: true })
        .eq("member_id", member.id)
        .is("used_month", null),
      supabase
        .from("absences")
        .select("id")
        .eq("member_id", member.id)
        .eq("month", month)
        .maybeSingle(),
      supabase
        .from("message_recipients")
        .select("message_id", { count: "exact", head: true })
        .eq("member_id", member.id)
        .is("read_at", null),
      supabase
        .from("events")
        .select("id, title, category, starts_at")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(3),
    ]);

  const shifts: Shift[] = shiftsRes.data ?? [];
  const open = shifts.find((s) => s.signed_out_at === null) ?? null;

  const weekStart = startOfWeek().getTime();
  const weekShifts = shifts.filter(
    (s) => new Date(s.signed_in_at).getTime() >= weekStart,
  );

  type ChoreRow = {
    id: string;
    month: string;
    status: "pending" | "completed";
    completed_at: string | null;
    scheduled_at: string | null;
    chores: {
      name: string;
      description: string | null;
      interval: ChoreInterval;
      scheduling_enabled: boolean;
    } | null;
  };
  const chores: MyChore[] = ((choresRes.data ?? []) as unknown as ChoreRow[]).map(
    (a) => ({
      id: a.id,
      month: a.month,
      status: a.status,
      choreName: a.chores?.name ?? "Job",
      choreDescription: a.chores?.description ?? null,
      choreInterval: a.chores?.interval ?? "month",
      choreScheduling: a.chores?.scheduling_enabled ?? false,
      scheduledAt: a.scheduled_at,
    }),
  );

  const creditsAvailable = creditsRes.count ?? 0;
  const absentThisMonth = absenceRes.data !== null;
  const unread = unreadRes.count ?? 0;
  const events = eventsRes.data ?? [];

  const firstName = member.full_name.split(" ")[0];

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      {/* Measures phone-vs-server clock drift so a queued tap is stamped right. */}
      <ServerClock />
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <div className="flex items-center gap-3">
          <AccountSwitcher
            current={{ label: member.full_name, kind: "member" }}
            parked={parked ? { label: parked.label, kind: parked.kind } : null}
          />
          <form action={signOutAuth} className="shrink-0">
            {/* nowrap: with the switcher beside it, "Log out" otherwise breaks
                across two lines in the phone-width header. */}
            <LogoutButton className="whitespace-nowrap text-sm text-muted" />
          </form>
        </div>
      </header>

      <div className="mt-6">
        <AnnouncementsBanner count={unread} />
      </div>

      <div className="mt-6">
        <h1 className="text-2xl font-bold tracking-tight">Hi, {firstName} 👋</h1>
      </div>

      <div className="mt-5">
        <ClockCard
          openSince={open ? open.signed_in_at : null}
          memberId={member.id}
          memberName={member.full_name}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-center text-sm font-semibold">
        {open ? (
          <Link
            href="/me/guest"
            className="rounded-2xl border border-border bg-surface px-4 py-3 transition active:scale-[0.98]"
          >
            🍰 Bring a guest
          </Link>
        ) : (
          <span
            title="Clock in first to bring a guest"
            className="cursor-not-allowed rounded-2xl border border-border bg-surface px-4 py-3 opacity-50"
          >
            🍰 Bring a guest
          </span>
        )}
        <Link
          href="/kiosk/student?from=me"
          className="rounded-2xl border border-border bg-surface px-4 py-3 transition active:scale-[0.98]"
        >
          🎓 Sign in as student
        </Link>
      </div>

      <div className="mt-5">
        <ChoresCard
          chores={chores}
          currentMonth={month}
          creditsAvailable={creditsAvailable}
          absentThisMonth={absentThisMonth}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Link
          href="/me/inbox"
          className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-4 transition active:scale-[0.98]"
        >
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              Inbox
            </div>
            <div className="mt-1 text-lg font-bold">📥 Messages</div>
          </div>
          {unread > 0 && (
            <span className="announce-badge flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-background">
              {unread}
            </span>
          )}
        </Link>
        <Link
          href="/calendar"
          className="rounded-2xl border border-border bg-surface px-4 py-4 transition active:scale-[0.98]"
        >
          <div className="text-xs uppercase tracking-wide text-muted">
            Studio
          </div>
          <div className="mt-1 text-lg font-bold">📅 Calendar</div>
        </Link>
      </div>

      {member.active && (
        <div className="mt-4">
          <Link
            href="/me/door-codes"
            className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-4 transition active:scale-[0.98]"
          >
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Studio access
              </div>
              <div className="mt-1 text-lg font-bold">🔑 Door codes</div>
            </div>
            <span className="text-xl text-muted" aria-hidden>
              →
            </span>
          </Link>
        </div>
      )}

      <div className="mt-4">
        <Link
          href="/me/account"
          className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-4 transition active:scale-[0.98]"
        >
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              Your profile
            </div>
            <div className="mt-1 text-lg font-bold">⚙️ Account</div>
          </div>
          <span className="text-xl text-muted" aria-hidden>
            →
          </span>
        </Link>
      </div>

      {events.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Coming up
          </h2>
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  href="/calendar"
                  className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 transition active:scale-[0.99]"
                >
                  <span className="text-sm font-medium">{e.title}</span>
                  <span className="text-xs text-muted">
                    {formatStudioDateTime(e.starts_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Stat label="This week" value={`${formatHours(totalHours(weekShifts))} h`} />
        <Stat label="All time" value={`${formatHours(totalHours(shifts))} h`} />
      </div>

      <section className="mt-8 flex-1">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Recent visits
        </h2>
        {shifts.length === 0 ? (
          <p className="text-sm text-muted">
            No visits yet — sign in when you get to the studio.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shifts.slice(0, 6).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">
                    {formatDay(s.signed_in_at)}
                  </div>
                  <div className="text-xs text-muted">
                    {formatClock(s.signed_in_at)} –{" "}
                    {s.signed_out_at ? formatClock(s.signed_out_at) : "now"}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {s.signed_out_at ? (
                    formatDuration(shiftDurationMs(s))
                  ) : (
                    <span className="text-success">open</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDuration } from "@/lib/time";
import { PasswordInput } from "@/components/PasswordInput";
import { useOfflineQueue } from "@/components/OfflineQueueSync";
import { lastCheckedLabel, useConnection } from "@/lib/connectivity";
import {
  enqueue,
  newEventId,
  serverReachable,
  studioNowIso,
} from "@/lib/offline-queue";
import { toggleKioskShift } from "./actions";
import { applyQueuedShifts, type RosterMember } from "./queued-roster";

export type { RosterMember };

/**
 * How often the tablet re-asks the server who's in the studio.
 *
 * Nothing pushes a sign-in from someone's phone to this tablet, and the kiosk
 * screen is left open all day — so without a poll these cards drift as far out
 * of date as the last time anybody touched them. That gap is what sends someone
 * to a card reading "Tap to sign in" when they're already signed in and only
 * want to go home.
 */
const ROSTER_POLL_MS = 20_000;

type Toast = { text: string; ms: number };

/**
 * The wall-clock time a tap taken right now would be stamped with — corrected
 * for tablet clock drift, so it matches what actually lands in the log rather
 * than what the tablet's own clock says.
 */
function formatNowClock(): string {
  return new Date(studioNowIso()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RosterGrid({ members }: { members: RosterMember[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [query, setQuery] = useState("");
  const [accountFor, setAccountFor] = useState<RosterMember | null>(null);
  const [pinFor, setPinFor] = useState<RosterMember | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [staleFor, setStaleFor] = useState<RosterMember | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const { pending: queued, refresh: refreshQueue } = useOfflineQueue();
  // Whether the studio actually answers — not `navigator.onLine`, which reads
  // true on the studio's own wifi with a dead uplink. See lib/connectivity.
  const { offline, isRisky, lastCheckedAt } = useConnection();

  // Taps taken while offline aren't in the roster the server sent — and when
  // the page is served from the service worker cache, that roster can be hours
  // stale. Lay the queue over the top so whoever is signed in *according to
  // this tablet* is what the cards show, even across an offline reload.
  const roster = applyQueuedShifts(members, queued);

  // Cards flip the moment they're tapped; the server round-trip (and the
  // roster refresh it triggers) settles the real state behind the scenes,
  // and a failed toggle just snaps back.
  const [optimisticMembers, flipOptimistic] = useOptimistic(
    roster,
    (current, memberId: string) =>
      current.map((m) =>
        m.id === memberId
          ? { ...m, openSince: m.openSince ? null : new Date().toISOString() }
          : m,
      ),
  );

  const visible = optimisticMembers.filter((m) =>
    m.full_name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function say(text: string, ms = 2500) {
    setToast({ text, ms });
  }

  // Re-ask the server on a slow loop, so a sign-in from someone's phone reaches
  // these cards without anyone reloading the tablet. Held off while a tap is in
  // flight or a dialog is open — see the effect below.
  const interacting =
    pending || pinFor !== null || accountFor !== null || staleFor !== null;
  const interactingRef = useRef(false);
  useEffect(() => {
    interactingRef.current = interacting;
  }, [interacting]);

  // Read inside the poll below, which is set up once and must not close over a
  // stale value — a refresh fired while cut off is the expensive mistake here.
  const offlineRef = useRef(false);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  useEffect(() => {
    const sync = () => {
      // Mid-tap the grid would reshuffle under a finger, and a hidden tab has
      // nobody to show it to. Cut off, a failed RSC fetch turns into a full
      // browser navigation — which on a captive portal hands the tablet to the
      // portal's own page — and the queue overlay already covers this tablet's
      // own taps, which are the only ones it can know about while cut off.
      if (document.visibilityState !== "visible") return;
      if (interactingRef.current || offlineRef.current) return;
      router.refresh();
    };

    const id = setInterval(sync, ROSTER_POLL_MS);
    const onVisible = () => {
      // A tablet waking from sleep is the longest gap of all.
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", sync);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", sync);
    };
  }, [router]);

  /**
   * Save a tap on the tablet for later. Keeps the direction the card was
   * showing, so a replay can't flip someone the wrong way, and stamps the
   * moment of the tap rather than the moment the wifi returns.
   */
  async function queueTap(
    member: RosterMember,
    pinValue: string,
    goingIn: boolean,
  ) {
    const saved = await enqueue({
      kind: goingIn ? "shift-in" : "shift-out",
      id: newEventId(),
      at: studioNowIso(),
      memberId: member.id,
      memberName: member.full_name,
      via: "kiosk",
      pin: pinValue,
    });
    // Pull the queue into state before the transition ends, or the optimistic
    // flip is dropped a frame before its replacement arrives and the card
    // visibly bounces.
    await refreshQueue();

    const first = member.full_name.split(" ")[0];
    if (!saved) {
      // No network *and* no storage to fall back on: say so plainly instead of
      // showing a checkmark for something that is about to be lost.
      say("Can't reach the studio and can't save here — use paper. ✍️", 5000);
    } else {
      say(
        goingIn
          ? `Saved on the tablet — welcome, ${first}! 👋`
          : `Saved on the tablet — see you, ${first}! ✌️`,
      );
    }
    setPinFor(null);
    setPin("");
    setPinError(null);
  }

  /** Show a failure where the person is actually looking: in the open PIN
   *  dialog if there is one, otherwise as a toast. */
  function showFailure(message: string) {
    if (pinFor) {
      setPinError(message);
      setPin("");
      pinInputRef.current?.focus();
    } else {
      say(message, 5000);
    }
  }

  function run(member: RosterMember, pinValue: string) {
    // The card's own state is the intent: tapping a signed-in card means out.
    const goingIn = member.openSince === null;
    setBusyId(member.id);
    startTransition(async () => {
      flipOptimistic(member.id);
      try {
        // Skip a request that can't land — cut off, this is instant instead of
        // waiting out a timeout with a finger on the screen.
        if (offlineRef.current) {
          await queueTap(member, pinValue, goingIn);
          return;
        }
        // The server action calls revalidatePath("/kiosk"), which refreshes
        // the roster automatically — no router.refresh() needed.
        const res = await toggleKioskShift(member.id, pinValue);
        if ("error" in res) {
          showFailure(res.error);
          return;
        }
        const first = res.name.split(" ")[0];
        // The server flips the real shift, not the one this card was showing.
        // When the two disagree — someone signed in on their phone since the
        // last refresh — say so instead of leaving a bare "See you" under a
        // card that read "Tap to sign in". That contradiction is what makes
        // people tap a second time, which signs them right back in.
        if (res.nowIn === goingIn) {
          say(res.nowIn ? `Welcome, ${first}! 👋` : `See you, ${first}! ✌️`);
        } else {
          say(
            res.nowIn
              ? `You weren't signed in yet — now you are. Welcome, ${first}! 👋`
              : `You were already signed in — signed you out. See you, ${first}! ✌️`,
            5000,
          );
        }
        setPinFor(null);
        setPin("");
        setPinError(null);
      } catch {
        // A rejected action means either the request never left the building or
        // the server threw — indistinguishable from the error in production, so
        // ask whether the server is answering before deciding what to tell them.
        if (await serverReachable()) {
          // It's up and it refused. Queueing would show a checkmark for a tap
          // that will keep failing, so surface it now instead.
          showFailure("The studio's system had a problem — please try again.");
        } else {
          await queueTap(member, pinValue, goingIn);
        }
      } finally {
        setBusyId(null);
      }
    });
  }

  /** The rest of a tap, once any staleness warning has been acknowledged. */
  function proceed(member: RosterMember) {
    if (member.hasPin) {
      setPinFor(member);
      setPin("");
      setPinError(null);
    } else {
      run(member, "");
    }
  }

  function handleTap(member: RosterMember) {
    if (!member.hasAccount) {
      // No login account (imported from the sheet or officer-added): quick
      // sign-in is members-with-accounts only — walk them to signup instead.
      setAccountFor(member);
      return;
    }
    // Cut off, and cut off long enough that this card could have been
    // overtaken by someone's phone. Say so before taking the tap rather than
    // after: a sign-in queued on top of a shift that's already open can't be
    // settled here and ends up waiting on an officer.
    if (isRisky()) {
      setStaleFor(member);
      return;
    }
    proceed(member);
  }

  useEffect(() => {
    if (pinFor) pinInputRef.current?.focus();
  }, [pinFor]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.ms);
    return () => clearTimeout(id);
  }, [toast]);

  if (members.length === 0) {
    return (
      <p className="mt-12 text-center text-muted">
        No active members yet. Create an account or ask an officer to add you.
      </p>
    );
  }

  return (
    <>
      <input
        type="search"
        inputMode="search"
        placeholder="Type your name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-border bg-surface px-5 py-3 text-lg outline-none focus:border-accent"
      />

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-muted">
          No one matches “{query}”.{" "}
          <Link
            href="/login?create=1"
            className="text-accent underline underline-offset-2"
          >
            Create an account
          </Link>{" "}
          to join the roster.
        </p>
      ) : (
        <div className="anim-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((m) => (
            <RosterCard
              key={m.id}
              member={m}
              busy={pending && busyId === m.id}
              offline={offline}
              onTap={() => handleTap(m)}
            />
          ))}
        </div>
      )}

      {accountFor && (
        <div className="scrim fixed inset-0 z-40 flex items-center justify-center px-6 backdrop-blur-sm">
          <div className="anim-fade w-full max-w-xs rounded-3xl border border-border bg-surface p-6 text-center">
            <div className="text-lg font-semibold">{accountFor.full_name}</div>
            <p className="mt-1 text-sm text-muted">
              You need an account to use quick sign in. It only takes a minute
              — then you can tap in here.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                href={`/login?create=1&name=${encodeURIComponent(
                  accountFor.full_name,
                )}`}
                className="rounded-2xl bg-accent px-4 py-3 font-semibold text-background transition active:scale-[0.98]"
              >
                Create my account
              </Link>
              <button
                type="button"
                onClick={() => setAccountFor(null)}
                className="rounded-2xl border border-border px-4 py-3 text-muted transition active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {staleFor && (
        <div className="scrim fixed inset-0 z-40 flex items-center justify-center px-6 backdrop-blur-sm">
          <div className="anim-fade w-full max-w-sm rounded-3xl border border-border bg-surface p-6 text-center">
            <div className="text-3xl" aria-hidden>
              📡
            </div>
            <div className="mt-2 text-lg font-semibold">
              This tablet is offline
            </div>
            <p className="mt-2 text-sm text-muted">
              {lastCheckedLabel(lastCheckedAt)
                ? `It last reached the studio at ${lastCheckedLabel(lastCheckedAt)}, so this screen may be out of date.`
                : "It hasn't reached the studio since this page opened, so this screen may be out of date."}{" "}
              If {staleFor.full_name.split(" ")[0]} signed{" "}
              {staleFor.openSince ? "out" : "in"} on a phone since then, this
              won&apos;t match and an officer will have to fix it.
            </p>
            <p className="mt-3 text-sm font-medium">
              Saving this as{" "}
              <span className="font-semibold">
                {staleFor.openSince ? "signing out" : "signing in"}
              </span>{" "}
              at {formatNowClock()}.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const member = staleFor;
                  setStaleFor(null);
                  proceed(member);
                }}
                className="rounded-2xl bg-accent px-4 py-3 font-semibold text-background transition active:scale-[0.98]"
              >
                Save it anyway
              </button>
              <button
                type="button"
                onClick={() => setStaleFor(null)}
                className="rounded-2xl border border-border px-4 py-3 text-muted transition active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pinFor && (
        <div className="scrim fixed inset-0 z-40 flex items-center justify-center px-6 backdrop-blur-sm">
          <div className="anim-fade w-full max-w-xs rounded-3xl border border-border bg-surface p-6 text-center">
            <div className="text-lg font-semibold">{pinFor.full_name}</div>
            <p className="mt-1 text-sm text-muted">
              Enter your 4-digit PIN to{" "}
              {pinFor.openSince ? "sign out" : "sign in"}.
            </p>
            {offline && (
              // Last chance to see it before committing: the PIN box is the
              // only thing on screen at this point.
              <p className="mt-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium">
                📡 Offline — this will be saved on the tablet and uploaded when
                the wifi is back.
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (pin.length === 4) run(pinFor, pin);
              }}
            >
              <div className="mt-4">
                <PasswordInput
                  ref={pinInputRef}
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ""));
                    setPinError(null);
                  }}
                  placeholder="••••"
                  className="rounded-2xl border border-border bg-surface-2 px-5 py-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-accent"
                />
              </div>
              {pinError && (
                <p className="mt-2 text-sm text-danger">{pinError}</p>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  type="submit"
                  disabled={pending || pin.length !== 4}
                  className="flex-1 rounded-2xl bg-accent px-4 py-3 font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
                >
                  {pending ? "…" : pinFor.openSince ? "Sign out" : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => setPinFor(null)}
                  disabled={pending}
                  className="rounded-2xl border border-border px-4 py-3 text-muted transition active:scale-[0.98]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-4"
      >
        {toast && (
          <div className="max-w-md rounded-3xl bg-foreground px-6 py-3 text-center text-lg font-semibold text-background shadow-lg">
            {toast.text}
          </div>
        )}
      </div>
    </>
  );
}

function RosterCard({
  member,
  busy,
  offline,
  onTap,
}: {
  member: RosterMember;
  busy: boolean;
  /** The studio can't be reached, so this tap will be saved here for later. */
  offline: boolean;
  onTap: () => void;
}) {
  const isIn = member.openSince !== null;
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!member.openSince) return;
    const start = new Date(member.openSince).getTime();
    const tick = () => setElapsed(formatDuration(Date.now() - start));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [member.openSince]);

  const initials = member.full_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <button
      onClick={onTap}
      disabled={busy}
      className={`relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition active:scale-[0.97] disabled:opacity-50 ${
        // Dashed while cut off: the card is still tappable, but what it says
        // came from this tablet's memory rather than from the studio.
        offline ? "border-dashed" : ""
      } ${
        isIn
          ? "border-success/50 bg-success/10"
          : "border-border bg-surface"
      }`}
    >
      {offline && (
        <span
          className="absolute right-2 top-2 text-xs leading-none"
          title="Offline — this tap is saved on the tablet"
          aria-hidden
        >
          📡
        </span>
      )}
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold ${
          isIn ? "bg-success text-background" : "bg-surface-2 text-foreground"
        }`}
      >
        {initials}
      </div>
      <div className="line-clamp-2 text-sm font-medium leading-tight">
        {member.full_name}
      </div>
      <div className="text-xs text-muted">
        {busy
          ? "…"
          : isIn
            ? `In · ${elapsed || "0m"}`
            : member.hasAccount
              ? "Tap to sign in"
              : "Needs an account"}
      </div>
      {offline && member.hasAccount && !busy && (
        // Says what the tap will do before it's made, which the banner at the
        // top of the screen can't do per-person.
        <div className="text-[10px] font-medium leading-tight text-accent">
          Saved here · uploads later
        </div>
      )}
    </button>
  );
}

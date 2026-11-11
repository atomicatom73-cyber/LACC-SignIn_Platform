"use client";

import { useCallback, useEffect, useState } from "react";
import { isOffline, rememberServerTime } from "./offline-queue";

/**
 * Whether the studio can actually be reached, and how long since it last could.
 *
 * `navigator.onLine` is not enough to put in front of someone about to sign in.
 * It reports "online" whenever there is *a* network — the studio's wifi with a
 * dead uplink, a captive portal, a phone showing one bar that passes nothing.
 * Those are exactly the situations where a tap gets queued and the person walks
 * away believing the studio has them. So this asks, and believes the answer.
 *
 * The second half — `verifiedAt` — matters as much as the first. A device that
 * cannot reach the studio also cannot learn what other devices did, so its
 * cards are frozen at the last moment it had signal. How long ago that was is
 * the honest measure of how much its screen can be trusted, and it's what
 * decides whether a tap is worth interrupting someone over.
 *
 * WHO IT ASKS: Supabase's `studio_pulse()` RPC, straight from the browser — not
 * an app route. The kiosk sits open around the clock, and when this probe (and
 * the roster refresh) went to Vercel every 20s, it used up the studio's free
 * Fluid Active CPU allowance and the site was disabled for a month (Nov 2026).
 * Supabase doesn't bill per request, and it's where every sign-in lands anyway,
 * so it's a fair stand-in for "the studio". The one case it misses is the app
 * itself being down while the database is up; the tap paths cover that by
 * checking `/api/now` via `serverReachable()` before deciding to queue.
 *
 * The answer also carries the database clock (for the offline queue's drift
 * correction) and a fingerprint of the kiosk roster, which RosterGrid compares
 * with its own to decide when a fresh page is actually needed.
 *
 * One shared poll serves every component on the page: the banner, the roster
 * and the clock card all read the same reading. It runs only while at least one
 * mounted caller asks for it (see `poll` below) and the tab is visible.
 */

/** How often to re-ask while a sign-in screen is open and visible. */
const PROBE_MS = 20_000;

/**
 * Past this long without confirmation, a card is old enough that someone could
 * plausibly have signed in or out elsewhere — the point where a tap is worth a
 * confirmation step rather than a quiet notice.
 */
export const STALE_MS = 5 * 60_000;

const PULSE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/studio_pulse`;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Connection = {
  /** null before the first answer — assume reachable rather than cry wolf. */
  reachable: boolean | null;
  /** Device clock at the last probe that answered, or null if none has. */
  verifiedAt: number | null;
  /** studio_pulse()'s roster fingerprint from the last answer. */
  roster: string | null;
};

let state: Connection = { reachable: null, verifiedAt: null, roster: null };
const listeners = new Set<() => void>();
let inFlight: Promise<boolean> | null = null;

function publish(next: Connection) {
  if (
    next.reachable === state.reachable &&
    next.verifiedAt === state.verifiedAt &&
    next.roster === state.roster
  ) {
    return;
  }
  state = next;
  for (const fn of listeners) fn();
}

/**
 * Ask the studio whether it's there. Concurrent callers share one request.
 *
 * A successful probe doubles as a clock reading: taking the skew from the
 * midpoint of the round trip keeps a queued tap stamped correctly.
 */
export function probeConnection(): Promise<boolean> {
  if (inFlight) return inFlight;

  // A definitive no from the browser — no point spending a request on it.
  if (isOffline()) {
    publish({ ...state, reachable: false });
    return Promise.resolve(false);
  }

  inFlight = (async () => {
    const startedAt = Date.now();
    try {
      const res = await fetch(PULSE_URL, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        cache: "no-store",
      });
      if (!res.ok) {
        publish({ ...state, reachable: false });
        return false;
      }
      const body = (await res.json()) as { now?: string; roster?: string };
      if (body?.now) {
        rememberServerTime(body.now, startedAt + (Date.now() - startedAt) / 2);
      }
      publish({
        reachable: true,
        verifiedAt: Date.now(),
        roster: body?.roster ?? state.roster,
      });
      return true;
    } catch {
      publish({ ...state, reachable: false });
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// ---------------------------------------------------------------------------
// The shared poll — one timer however many components want it.
// ---------------------------------------------------------------------------

let pollers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function pollOnce() {
  // Nobody is looking at a hidden tab, and a sleeping tablet shouldn't be
  // waking itself to poll.
  if (document.visibilityState !== "visible") return;
  void probeConnection();
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") pollOnce();
}

function startPolling() {
  pollers += 1;
  if (pollers > 1) return;
  // Take the first reading off the synchronous effect path so the server
  // render and the first client render still agree.
  queueMicrotask(pollOnce);
  timer = setInterval(pollOnce, PROBE_MS);
  // The browser's own signals are still the fastest hint that something
  // changed — they just aren't trusted on their own.
  window.addEventListener("online", pollOnce);
  window.addEventListener("offline", pollOnce);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopPolling() {
  pollers = Math.max(0, pollers - 1);
  if (pollers > 0) return;
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener("online", pollOnce);
  window.removeEventListener("offline", pollOnce);
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

export type ConnectionState = {
  /** Confident the studio can't be reached. Optimistic until proven otherwise. */
  offline: boolean;
  /** Wall-clock time of the last answer, for "last checked 2:14 PM". */
  lastCheckedAt: number | null;
  /** The roster fingerprint from the last answer (see studio_pulse). */
  roster: string | null;
  /**
   * Offline *and* out of date enough that this screen may be contradicted by
   * another device — the case worth stopping someone for. Read at tap time so
   * the decision uses the real elapsed time, not the last render's.
   */
  isRisky: () => boolean;
  /** Re-ask now (used after a tap fails, and when the tab is woken). */
  recheck: () => Promise<boolean>;
};

/**
 * Subscribe to the shared reading. With `poll` (the default) this caller keeps
 * the 20s probe running while it's mounted; pass `poll: false` to just read
 * whatever the last probe found without asking for more.
 */
export function useConnection({
  poll = true,
}: { poll?: boolean } = {}): ConnectionState {
  const [snapshot, setSnapshot] = useState<Connection>(state);
  // Staleness grows without any event firing, so re-render on a slow tick to
  // keep "last checked" and the risky threshold current on screen.
  const [, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setSnapshot(state);
    listeners.add(onChange);
    const tick = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => {
      listeners.delete(onChange);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (!poll) return;
    startPolling();
    return stopPolling;
  }, [poll]);

  const { reachable, verifiedAt, roster } = snapshot;
  const offline = reachable === false;

  const isRisky = useCallback(() => {
    if (state.reachable !== false) return false;
    // Never confirmed in this page's life: the page itself may have come from
    // the service worker cache, so there is no floor on how old it is.
    if (state.verifiedAt === null) return true;
    return Date.now() - state.verifiedAt > STALE_MS;
  }, []);

  return {
    offline,
    lastCheckedAt: verifiedAt,
    roster,
    isRisky,
    recheck: probeConnection,
  };
}

/** "2:14 PM", or null when the studio hasn't answered on this page yet. */
export function lastCheckedLabel(at: number | null): string | null {
  if (at === null) return null;
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

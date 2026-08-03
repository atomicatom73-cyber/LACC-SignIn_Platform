"use client";

import { useCallback, useEffect, useState } from "react";
import { isOffline, rememberServerTime } from "./offline-queue";

/**
 * Whether the studio's server is actually answering, and how long it has been
 * since it last did.
 *
 * `navigator.onLine` is not enough to put in front of someone about to sign in.
 * It reports "online" whenever there is *a* network — the studio's wifi with a
 * dead uplink, a captive portal, a phone showing one bar that passes nothing,
 * or the app itself being down all read as connected. Those are exactly the
 * situations where a tap gets queued and the person walks away believing the
 * studio has them. So this asks `/api/now` and believes the answer.
 *
 * The second half — `verifiedAt` — matters as much as the first. A device that
 * cannot reach the studio also cannot learn what other devices did, so its
 * cards are frozen at the last moment it had signal. How long ago that was is
 * the honest measure of how much its screen can be trusted, and it's what
 * decides whether a tap is worth interrupting someone over.
 *
 * One probe is shared by every component on the page: the roster, the clock
 * card and the banner all read the same reading rather than each polling.
 */

/** How often to re-ask while a sign-in screen is open and visible. */
const PROBE_MS = 20_000;

/**
 * Past this long without confirmation, a card is old enough that someone could
 * plausibly have signed in or out elsewhere — the point where a tap is worth a
 * confirmation step rather than a quiet notice.
 */
export const STALE_MS = 5 * 60_000;

type Connection = {
  /** null before the first answer — assume reachable rather than cry wolf. */
  reachable: boolean | null;
  /** Device clock at the last probe that answered, or null if none has. */
  verifiedAt: number | null;
};

let state: Connection = { reachable: null, verifiedAt: null };
const listeners = new Set<() => void>();
let inFlight: Promise<boolean> | null = null;

function publish(next: Connection) {
  if (
    next.reachable === state.reachable &&
    next.verifiedAt === state.verifiedAt
  ) {
    return;
  }
  state = next;
  for (const fn of listeners) fn();
}

/**
 * Ask the studio whether it's there. Concurrent callers share one request.
 *
 * A successful probe doubles as a clock reading: `/api/now` exists for the
 * offline queue's timestamps, and taking the skew from the midpoint of the
 * round trip keeps a queued tap stamped correctly. Free, and it keeps the two
 * from drifting apart.
 */
export function probeConnection(): Promise<boolean> {
  if (inFlight) return inFlight;

  // A definitive no from the browser — no point spending a request on it.
  if (isOffline()) {
    publish({ reachable: false, verifiedAt: state.verifiedAt });
    return Promise.resolve(false);
  }

  inFlight = (async () => {
    const startedAt = Date.now();
    try {
      const res = await fetch("/api/now", { cache: "no-store" });
      if (!res.ok) {
        publish({ reachable: false, verifiedAt: state.verifiedAt });
        return false;
      }
      const body = (await res.json()) as { now?: string };
      if (body?.now) {
        rememberServerTime(body.now, startedAt + (Date.now() - startedAt) / 2);
      }
      publish({ reachable: true, verifiedAt: Date.now() });
      return true;
    } catch {
      publish({ reachable: false, verifiedAt: state.verifiedAt });
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export type ConnectionState = {
  /** Confident the studio can't be reached. Optimistic until proven otherwise. */
  offline: boolean;
  /** Wall-clock time of the last answer, for "last checked 2:14 PM". */
  lastCheckedAt: number | null;
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
 * Subscribe to the shared reading. Mounting this starts the poll; the last
 * component to unmount stops it.
 */
export function useConnection(): ConnectionState {
  const [snapshot, setSnapshot] = useState<Connection>(state);
  // Staleness grows without any event firing, so re-render on a slow tick to
  // keep "last checked" and the risky threshold current on screen.
  const [, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setSnapshot(state);
    listeners.add(onChange);

    const run = () => {
      // Nobody is looking at a hidden tab, and a sleeping tablet shouldn't be
      // waking itself to poll.
      if (document.visibilityState !== "visible") return;
      void probeConnection();
    };

    // Take the first reading off the synchronous effect path so the server
    // render and the first client render still agree.
    queueMicrotask(run);

    const interval = setInterval(run, PROBE_MS);
    const tick = setInterval(() => setTick((n) => n + 1), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    // The browser's own signals are still the fastest hint that something
    // changed — they just aren't trusted on their own.
    window.addEventListener("online", run);
    window.addEventListener("offline", run);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      listeners.delete(onChange);
      clearInterval(interval);
      clearInterval(tick);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const { reachable, verifiedAt } = snapshot;
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

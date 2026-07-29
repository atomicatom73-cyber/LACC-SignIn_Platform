"use client";

import { useEffect } from "react";
import { rememberServerTime } from "@/lib/offline-queue";

/**
 * Measures the tablet's clock against the server's, so the offline queue can
 * stamp a tap with the true studio time.
 *
 * Mounted on the kiosk screens — the ones that queue — and only ever succeeds
 * while online, which is exactly right: the reading it stores is reused when the
 * network drops, and real clock drift over a few offline hours is milliseconds.
 *
 * Deliberately a live fetch rather than a timestamp rendered into the page. A
 * rendered one is as old as the page, and the page can come from the service
 * worker cache — that made every queued sign-in look hours early.
 *
 * Renders nothing.
 */
export function ServerClock() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const sentAt = Date.now();
        const response = await fetch("/api/now", { cache: "no-store" });
        const receivedAt = Date.now();
        if (!response.ok || cancelled) return;

        const { now } = (await response.json()) as { now: string };
        // The server read its clock somewhere between the request leaving and
        // the reply landing; the midpoint is the best estimate we have, and it
        // keeps a slow connection from being mistaken for a wrong clock.
        rememberServerTime(now, (sentAt + receivedAt) / 2);
      } catch {
        // Offline, or the route is unreachable. The last reading taken while
        // online still stands, which is what the queue should use anyway.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

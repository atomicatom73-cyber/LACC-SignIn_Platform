"use client";

import { useEffect } from "react";
import { probeConnection } from "@/lib/connectivity";

/**
 * Measures the tablet's clock against the studio's, so the offline queue can
 * stamp a tap with the true studio time.
 *
 * Mounted on the kiosk screens and /me — the ones that queue — and only ever
 * succeeds while online, which is exactly right: the reading it stores is reused
 * when the network drops, and real clock drift over a few offline hours is
 * milliseconds.
 *
 * Deliberately a live reading rather than a timestamp rendered into the page. A
 * rendered one is as old as the page, and the page can come from the service
 * worker cache — that made every queued sign-in look hours early.
 *
 * The reading itself comes from the connection probe (the database clock in
 * studio_pulse(), see lib/connectivity), which shares a request with any probe
 * already in flight. This used to fetch /api/now on its own.
 *
 * Renders nothing.
 */
export function ServerClock() {
  useEffect(() => {
    void probeConnection();
  }, []);

  return null;
}

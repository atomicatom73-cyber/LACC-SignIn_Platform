import { NextResponse } from "next/server";
import { syncOfflineEvents } from "@/app/kiosk/sync-actions";
import type { QueuedEvent } from "@/lib/offline-queue";

/**
 * The service worker's way into the offline replay.
 *
 * The page calls `syncOfflineEvents` directly as a Server Action; a worker
 * woken by Background Sync has no React runtime to do that with, so it posts
 * here instead and gets the same outcomes back. Both routes run identical
 * code — this handler only unwraps the request.
 *
 * No auth of its own, deliberately: the action behind it is already reachable
 * by anyone (like the kiosk itself) and proves every event on its own terms —
 * a phone tap against the caller's session, a kiosk tap against the PIN. See
 * `verifyMember`. Cookies ride along because the worker's fetch is same-origin.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const events = (payload as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) {
    return NextResponse.json({ error: "Expected an event list." }, { status: 400 });
  }

  // Every element is shape-checked inside the action; anything unrecognized
  // comes back rejected rather than throwing the whole batch away.
  const outcomes = await syncOfflineEvents(events as QueuedEvent[]);
  return NextResponse.json({ outcomes });
}

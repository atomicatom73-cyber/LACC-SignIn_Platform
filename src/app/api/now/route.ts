import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The server's clock, for the offline sign-in queue.
 *
 * A queued sign-in is only worth keeping if its timestamp is right, so the kiosk
 * measures how far the tablet's clock is off and corrects for it (see
 * ClockSync). This can't come from a server-rendered timestamp in the page: when
 * the page is served from the service worker cache that value is however old the
 * cache entry is, which would backdate every queued tap by hours.
 */
export async function GET() {
  return NextResponse.json(
    { now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

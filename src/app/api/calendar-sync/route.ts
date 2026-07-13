import { NextResponse } from "next/server";
import { syncGoogleCalendar } from "@/lib/google-calendar";

// Writes to the DB on every hit, so it must never be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * Pulls the studio's public Google calendar into Supabase. This is the daily
 * backstop (see vercel.json) — the primary sync is on-demand when the calendar
 * page loads. Vercel signs cron requests with `Authorization: Bearer
 * $CRON_SECRET`; when that env var is set we require it, so the endpoint can't
 * be run by anyone who finds the URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await syncGoogleCalendar();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[calendar-sync]", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

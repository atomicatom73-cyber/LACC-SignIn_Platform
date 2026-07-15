import { NextResponse } from "next/server";
import { syncMembersSheet } from "@/lib/members-sheet";
import {
  exportSigninLogs,
  signinLogSheetConfigured,
} from "@/lib/signin-log-sheet";

// Writes to the DB on every hit, so it must never be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * Daily Google-sheet reconciliation (see vercel.json): pulls the member
 * roster sheet into Supabase, then pushes the sign-in logs out to the log
 * sheet. Both live on this one route because Vercel Hobby allows only two
 * cron jobs and the calendar sync holds the other slot. The primary syncs
 * are on-demand (page loads for the roster, sign-in/out actions for the
 * logs); this is the backstop. Vercel signs cron requests with
 * `Authorization: Bearer $CRON_SECRET`; when that env var is set we require
 * it, so the endpoint can't be run by anyone who finds the URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Each sync runs regardless of the other's outcome.
  const run = async (job: () => Promise<unknown>) => {
    try {
      return await job();
    } catch (error) {
      console.error("[members-sync]", error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const members = await run(syncMembersSheet);
  const signinLogs = signinLogSheetConfigured()
    ? await run(exportSigninLogs)
    : { skipped: "GOOGLE_SIGNIN_LOG_SHEET_ID not set" };

  const failed =
    (members as { error?: string }).error ||
    (signinLogs as { error?: string }).error;
  return NextResponse.json(
    { ok: !failed, members, signinLogs },
    { status: failed ? 500 : 200 },
  );
}

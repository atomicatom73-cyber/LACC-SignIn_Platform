import { NextResponse } from "next/server";
import { sendDueJobReminders } from "@/lib/job-reminders";
import { syncMembersSheet } from "@/lib/members-sheet";
import { flushDueMessages } from "@/lib/messages";
import {
  exportSigninLogs,
  signinLogSheetConfigured,
} from "@/lib/signin-log-sheet";

// Writes to the DB on every hit, so it must never be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * Daily Google-sheet reconciliation (see vercel.json): pulls the member
 * roster sheet into Supabase, pushes the sign-in logs out to the log sheet,
 * and fires any due job reminders. All three live on this one route because
 * Vercel Hobby allows only two cron jobs and the calendar sync holds the
 * other slot. The sheet syncs are also on-demand (page loads for the roster,
 * sign-in/out actions for the logs) with this as the backstop; the job
 * reminders run only from here. Vercel signs cron requests with
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
  const jobReminders = await run(() => sendDueJobReminders());
  // Backstop for scheduled announcements: page loads normally send them within
  // minutes, but a quiet studio shouldn't hold a message overnight.
  const scheduledMessages = await run(flushDueMessages);

  const failed =
    (members as { error?: string }).error ||
    (signinLogs as { error?: string }).error ||
    (jobReminders as { error?: string }).error ||
    (scheduledMessages as { error?: string }).error;
  return NextResponse.json(
    { ok: !failed, members, signinLogs, jobReminders, scheduledMessages },
    { status: failed ? 500 : 200 },
  );
}

/**
 * "You've been assigned a job" mail.
 *
 * Fired from both places an assignment is born — an officer assigning by hand
 * on the jobs board, and the month's draft being published — so nobody first
 * learns about their job from a reminder two weeks later.
 *
 * Email only, by design: the member's dashboard already lists their jobs, so a
 * second copy in the in-app inbox would be noise. Best-effort in the same sense
 * as every other send here — a mail failure must never undo an assignment that
 * is already in the database.
 *
 * SERVER ONLY — uses the service-role client, because the officer's own RLS
 * view doesn't include other members' addresses or notification preferences.
 */

import { dueLabel } from "@/lib/chores";
import {
  renderJobAssignedEmail,
  type SentBy,
  sendEmail,
  siteUrl,
} from "@/lib/email";
import { richTextToPlain } from "@/lib/richtext";
import { monthLabel } from "@/lib/studio";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChoreInterval } from "@/lib/types";

/** One freshly created assignment. Pass ONLY rows that were really inserted. */
export type NewAssignment = { chore_id: string; member_id: string };

export async function emailNewAssignments(args: {
  assignments: NewAssignment[];
  month: string; // "YYYY-MM-01"
  sentBy: SentBy | null;
}): Promise<void> {
  if (args.assignments.length === 0) return;

  try {
    const admin = createAdminClient();
    const choreIds = [...new Set(args.assignments.map((a) => a.chore_id))];
    const memberIds = [...new Set(args.assignments.map((a) => a.member_id))];

    const [choresRes, membersRes] = await Promise.all([
      admin
        .from("chores")
        .select("id, name, description, interval")
        .in("id", choreIds),
      // Only people who can actually receive it: an address on file and email
      // notifications still switched on.
      admin
        .from("members")
        .select("id, full_name, email")
        .in("id", memberIds)
        .eq("notify_by_email", true)
        .not("email", "is", null),
    ]);
    if (choresRes.error || membersRes.error) {
      console.error(
        "[job-assignment-email] lookup failed:",
        choresRes.error ?? membersRes.error,
      );
      return;
    }

    const chores = new Map(
      (choresRes.data ?? []).map((c) => [
        c.id as string,
        c as {
          id: string;
          name: string;
          description: string | null;
          interval: ChoreInterval;
        },
      ]),
    );

    type Target = {
      name: string;
      email: string;
      jobs: { name: string; description: string | null; dueText: string }[];
    };
    const targets = new Map<string, Target>();
    for (const row of membersRes.data ?? []) {
      if (!row.email) continue;
      targets.set(row.id as string, {
        name: row.full_name as string,
        email: row.email as string,
        jobs: [],
      });
    }

    // One email per member listing everything they just picked up — publishing
    // a 40-person draft shouldn't put four separate emails in one inbox.
    for (const a of args.assignments) {
      const target = targets.get(a.member_id);
      const chore = chores.get(a.chore_id);
      if (!target || !chore) continue;
      // The same job twice in one batch is a caller bug, not something to mail
      // about twice.
      if (target.jobs.some((j) => j.name === chore.name)) continue;
      target.jobs.push({
        name: chore.name,
        description: chore.description,
        dueText: dueLabel(chore.interval),
      });
    }

    const monthText = monthLabel(args.month);
    const url = `${siteUrl()}/me`;
    const sending = [...targets.values()].filter((t) => t.jobs.length > 0);

    await Promise.allSettled(
      sending.map((t) => {
        const one = t.jobs.length === 1;
        return sendEmail({
          to: t.email,
          subject: one
            ? `New studio job for ${monthText}: ${t.jobs[0].name}`
            : `${t.jobs.length} new studio jobs for ${monthText}`,
          text: `Hi ${t.name.split(" ")[0] || t.name},\n\nYou've been assigned ${
            one ? "a studio job" : `${t.jobs.length} studio jobs`
          } for ${monthText}:\n\n${t.jobs
            .map(
              (j) =>
                `• ${j.name} (${j.dueText})${
                  j.description ? ` — ${richTextToPlain(j.description, " ")}` : ""
                }`,
            )
            .join(
              "\n",
            )}\n\nPick a day that works for you and mark ${one ? "it" : "them"} off in the app: ${url}\n`,
          html: renderJobAssignedEmail({
            name: t.name,
            monthText,
            jobs: t.jobs,
            url,
            sentBy: args.sentBy,
          }),
          sentBy: args.sentBy,
        });
      }),
    );
  } catch (err) {
    console.error("[job-assignment-email] send step failed:", err);
  }
}

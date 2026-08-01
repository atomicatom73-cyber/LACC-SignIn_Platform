/**
 * Job due-date reminders, driven by each chore's interval:
 *
 *  - first-half jobs   → reminded on the 14th (one day before the due 15th)
 *  - everything else   → reminded two days before the end of the month
 *
 * A reminder is an announcement like any other — a `messages` row (so it
 * shows on the member's messages page) fanned out to the members whose
 * assignments are still pending, plus an email to those who take email.
 *
 * Runs from the daily members-sync cron (Vercel Hobby caps us at two cron
 * jobs, so this piggybacks; see /api/members-sync). A sync_state row per
 * (month, window) makes re-runs no-ops, and the exact-day check gets a small
 * grace window so one failed cron run doesn't swallow the month's reminder.
 *
 * SERVER ONLY — uses the service-role client.
 */

import { renderJobReminderEmail, sendEmail, siteUrl } from "@/lib/email";
import { richTextToPlain } from "@/lib/richtext";
import { monthKey, monthLabel, studioDayKey } from "@/lib/studio";
import { createAdminClient } from "@/lib/supabase/admin";

type ReminderWindow = "first_half" | "month_end";

/** Raw row for the pending-assignment fan-out query below. */
type PendingRow = {
  member_id: string;
  chores: { name: string; description: string | null } | null;
  members: {
    id: string;
    full_name: string;
    email: string | null;
    notify_by_email: boolean;
    active: boolean;
  } | null;
};

export async function sendDueJobReminders(
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const day = Number(studioDayKey(now).slice(8, 10));
  const month = monthKey(now); // "YYYY-MM-01"
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthName = monthLabel(month).split(" ")[0]; // "July"

  // The 15th still counts for first-half jobs, and the last two days still
  // count for month-end — the reminder lands late rather than never if a
  // cron run dies on the exact day.
  let window: ReminderWindow | null = null;
  if (day === 14 || day === 15) window = "first_half";
  else if (day >= lastDay - 2) window = "month_end";
  if (!window) return { skipped: `day ${day} isn't a reminder day` };

  const dueText = window === "first_half" ? `${monthName} 15` : `the end of ${monthName}`;
  const stateKey = `job-reminder:${month.slice(0, 7)}:${window}`;
  const admin = createAdminClient();

  // Whose jobs are still pending in this window? (Paused jobs don't nag.)
  const intervals =
    window === "first_half" ? ["first_half"] : ["month", "second_half"];
  const { data, error } = await admin
    .from("chore_assignments")
    .select(
      // Both member_id and assigned_by reference members — the embed must
      // name its FK or PostgREST rejects it as ambiguous.
      "member_id, chores!inner(name, description, interval, paused), members!chore_assignments_member_id_fkey!inner(id, full_name, email, notify_by_email, active)",
    )
    .eq("month", month)
    .eq("status", "pending")
    .in("chores.interval", intervals)
    .eq("chores.paused", false)
    .eq("members.active", true);
  if (error) return { error: error.message };

  const rows = (data ?? []) as unknown as PendingRow[];
  const pending = rows.filter((r) => r.chores && r.members);
  if (pending.length === 0) {
    return { skipped: `no pending ${window} jobs for ${month.slice(0, 7)}` };
  }

  // Claim the (month, window) marker before sending — a concurrent or
  // repeated run sees the conflict and walks away, so nobody gets nagged
  // twice. 23505 = unique_violation on sync_state's primary key.
  const { error: claimError } = await admin.from("sync_state").insert({
    key: stateKey,
    detail: { recipients: new Set(pending.map((r) => r.member_id)).size },
  });
  if (claimError) {
    if (claimError.code === "23505") {
      return { skipped: `${stateKey} already sent` };
    }
    return { error: claimError.message };
  }

  // One shared announcement listing every due job — members see it on their
  // messages page, officers see it in Sent, and read receipts work as usual.
  const byChore = new Map<string, string[]>();
  for (const row of pending) {
    const list = byChore.get(row.chores!.name) ?? [];
    list.push(row.members!.full_name);
    byChore.set(row.chores!.name, list);
  }
  const bodyLines = [...byChore.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chore, names]) => `• ${chore} — ${names.sort().join(", ")}`);
  const subject = `Job reminder — due by ${dueText}`;
  const body = `Friendly reminder! These ${monthName} jobs are still open and due by ${dueText}:\n\n${bodyLines.join(
    "\n",
  )}\n\nAlready done? Mark it off on your dashboard and you're all set. 🏺`;

  const recipientIds = [...new Set(pending.map((r) => r.member_id))];
  const { data: message, error: messageError } = await admin
    .from("messages")
    .insert({
      sender_id: null,
      sender_role: "studio", // the inbox renders this as "From the studio"
      subject,
      body,
      audience: "selected",
    })
    .select("id")
    .single();
  if (messageError || !message) {
    return { error: messageError?.message ?? "couldn't insert the reminder" };
  }
  const { error: recipientsError } = await admin
    .from("message_recipients")
    .insert(
      recipientIds.map((member_id) => ({ message_id: message.id, member_id })),
    );
  if (recipientsError) return { error: recipientsError.message };

  // Email each member their own job list. Best-effort: a mail hiccup never
  // fails the run (the in-app message already landed).
  type EmailTarget = {
    name: string;
    email: string;
    jobs: { name: string; description: string | null }[];
  };
  const targetByMember = new Map<string, EmailTarget>();
  for (const row of pending) {
    const { full_name, email, notify_by_email } = row.members!;
    if (!email || !notify_by_email) continue;
    const entry =
      targetByMember.get(row.member_id) ?? { name: full_name, email, jobs: [] };
    entry.jobs.push({
      name: row.chores!.name,
      description: row.chores!.description,
    });
    targetByMember.set(row.member_id, entry);
  }
  const url = `${siteUrl()}/me`;
  const emails = [...targetByMember.values()];
  await Promise.allSettled(
    emails.map((t) =>
      sendEmail({
        to: t.email,
        subject,
        text: `Hi ${t.name.split(" ")[0] || t.name},\n\nFriendly reminder — your studio job${
          t.jobs.length === 1 ? " is" : "s are"
        } due by ${dueText}:\n\n${t.jobs
          .map(
            (j) =>
              `• ${j.name}${
                j.description
                  ? ` — ${richTextToPlain(j.description, " ")}`
                  : ""
              }`,
          )
          .join("\n")}\n\nAlready done? Mark it off in the app: ${url}\n`,
        html: renderJobReminderEmail({
          name: t.name,
          dueText,
          jobs: t.jobs,
          url,
        }),
      }),
    ),
  );

  return {
    sent: stateKey,
    recipients: recipientIds.length,
    emailed: emails.length,
  };
}

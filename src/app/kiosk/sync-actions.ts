"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestSigninLogExport } from "@/lib/signin-log-sheet";
import {
  SYNC_BATCH_LIMIT,
  type QueuedEvent,
  type SyncOutcome,
} from "@/lib/offline-queue";

/**
 * Replay sign-ins that happened on the kiosk while it was offline.
 *
 * Every event carries the id of the row it wants to create and the moment of
 * the tap, so this is safe to call with events that already landed: a repeated
 * insert loses to the primary key and comes back `duplicate` instead of
 * double-recording someone. Events say "in" or "out" rather than "toggle", so a
 * replay can't flip a member the wrong way.
 *
 * Each event's outcome is reported separately. The client drops applied and
 * duplicate events, stops retrying rejected ones (and shows them to whoever is
 * standing at the kiosk), and keeps everything else for the next attempt.
 */

/**
 * How far back a queued tap may be written. Long enough for a tablet left
 * offline over a holiday weekend, short enough that the timestamps it accepts
 * stay plausible — this action takes a client-supplied `signed_in_at`, unlike
 * the live path where Postgres stamps `now()`.
 */
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tolerance for a tablet clock that runs slightly fast. */
const MAX_CLOCK_LEAD_MS = 5 * 60 * 1000;

type Supabase = ReturnType<typeof createAdminClient>;

export async function syncOfflineEvents(
  events: QueuedEvent[],
): Promise<SyncOutcome[]> {
  if (!Array.isArray(events) || events.length === 0) return [];

  const supabase = createAdminClient();
  const outcomes: SyncOutcome[] = [];
  let applied = 0;

  // Oldest first: a guest's host and an open-studio student's sign-in have to
  // exist before the events that depend on them.
  const ordered = [...events]
    .filter(isQueuedEvent)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, SYNC_BATCH_LIMIT);

  for (const event of ordered) {
    const when = clampTimestamp(event.at);
    if ("error" in when) {
      outcomes.push({ id: event.id, status: "rejected", reason: when.error });
      continue;
    }

    try {
      const outcome = await applyEvent(supabase, event, when.at);
      outcomes.push({ id: event.id, ...outcome });
      if (outcome.status === "applied") applied++;
    } catch (err) {
      // An unexpected failure is transient by default — the client keeps the
      // event and tries again rather than silently losing someone's hours.
      outcomes.push({
        id: event.id,
        status: "retry",
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  if (applied > 0) {
    revalidatePath("/kiosk");
    revalidatePath("/kiosk/student");
    revalidatePath("/officer/logs");
    after(requestSigninLogExport);
  }

  return outcomes;
}

async function applyEvent(
  supabase: Supabase,
  event: QueuedEvent,
  at: string,
): Promise<Omit<SyncOutcome, "id">> {
  switch (event.kind) {
    case "shift-in":
      return applyShiftIn(supabase, event, at);
    case "shift-out":
      return applyShiftOut(supabase, event, at);
    case "guest-in":
      return applyGuestIn(supabase, event, at);
    case "student-in":
      return applyStudentIn(supabase, event, at);
    case "student-out":
      return applyStudentOut(supabase, event, at);
    default:
      return { status: "rejected", reason: "Unrecognized sign-in type." };
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function applyShiftIn(
  supabase: Supabase,
  event: Extract<QueuedEvent, { kind: "shift-in" }>,
  at: string,
): Promise<Omit<SyncOutcome, "id">> {
  const check = await verifyMember(supabase, event.memberId, event.pin);
  if ("error" in check) return { status: "rejected", reason: check.error };

  // Already replayed — the row is here with the id this event carries.
  const { data: existing } = await supabase
    .from("shifts")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  if (existing) return { status: "duplicate" };

  const { error } = await supabase.from("shifts").insert({
    id: event.id,
    member_id: event.memberId,
    signed_in_at: at,
    // Keep the live value: the officer log reads anything other than "kiosk"
    // as a phone sign-in.
    source: "kiosk",
  });

  if (error) {
    // `shifts_one_open_per_member` — they're already signed in, which is the
    // state this event was asking for.
    if (isUniqueViolation(error)) return { status: "duplicate" };
    throw new Error(error.message);
  }
  return { status: "applied" };
}

async function applyShiftOut(
  supabase: Supabase,
  event: Extract<QueuedEvent, { kind: "shift-out" }>,
  at: string,
): Promise<Omit<SyncOutcome, "id">> {
  const check = await verifyMember(supabase, event.memberId, event.pin);
  if ("error" in check) return { status: "rejected", reason: check.error };

  const { data: openShift } = await supabase
    .from("shifts")
    .select("id, signed_in_at")
    .eq("member_id", event.memberId)
    .is("signed_out_at", null)
    .maybeSingle();

  if (openShift) {
    // A tablet whose clock drifted backwards could stamp an out-time before the
    // in-time; a zero-length shift beats a negative one.
    const out = maxIso(at, openShift.signed_in_at);
    await supabase
      .from("shifts")
      .update({ signed_out_at: out })
      .eq("id", openShift.id);
    await closeGuestsFor(supabase, event.memberId, openShift.signed_in_at, out);
    return { status: "applied" };
  }

  // No open shift. Either this event already synced, or the nightly
  // close_stale_shifts() sweep force-closed the shift while the tablet was off
  // the network — in which case we now know the real out-time and can replace
  // the synthetic end-of-day one, clearing the "Forgot to sign out" note.
  const { data: recent } = await supabase
    .from("shifts")
    .select("id, signed_in_at, signed_out_at, auto_closed")
    .eq("member_id", event.memberId)
    .lte("signed_in_at", at)
    .order("signed_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.auto_closed) {
    const out = maxIso(at, recent.signed_in_at);
    await supabase
      .from("shifts")
      .update({ signed_out_at: out, auto_closed: false })
      .eq("id", recent.id);
    await closeGuestsFor(supabase, event.memberId, recent.signed_in_at, out);
    return { status: "applied" };
  }

  return { status: "duplicate" };
}

/**
 * Guests leave with the member who brought them, exactly as the live sign-out
 * does. Auto-closed guests get the same correction as their host's shift.
 */
async function closeGuestsFor(
  supabase: Supabase,
  memberId: string,
  shiftStart: string,
  out: string,
) {
  await supabase
    .from("guest_signins")
    .update({ signed_out_at: out, auto_closed: false })
    .eq("host_member_id", memberId)
    .gte("signed_in_at", shiftStart)
    .is("signed_out_at", null);

  await supabase
    .from("guest_signins")
    .update({ signed_out_at: out, auto_closed: false })
    .eq("host_member_id", memberId)
    .gte("signed_in_at", shiftStart)
    .eq("auto_closed", true);
}

async function verifyMember(
  supabase: Supabase,
  memberId: string,
  pin: string,
): Promise<{ name: string } | { error: string }> {
  const { data: member, error } = await supabase
    .from("members")
    .select("id, full_name, pin, user_id")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) return { error: "That member no longer exists." };
  if (!member.user_id) {
    return { error: "Quick sign-in needs an account — this one has none." };
  }
  // Same rule as the live kiosk: only members who set a PIN have to match it.
  // A PIN added while the tablet was offline will reject the queued tap, which
  // is the safe direction — the officer log shows the gap.
  if (member.pin && member.pin !== pin.trim()) {
    return { error: "Wrong PIN — this sign-in wasn't recorded." };
  }
  return { name: member.full_name };
}

// ---------------------------------------------------------------------------
// Guests and students
// ---------------------------------------------------------------------------

async function applyGuestIn(
  supabase: Supabase,
  event: Extract<QueuedEvent, { kind: "guest-in" }>,
  at: string,
): Promise<Omit<SyncOutcome, "id">> {
  if (!event.guestName.trim()) {
    return { status: "rejected", reason: "Guest had no name." };
  }

  const { data: existing } = await supabase
    .from("guest_signins")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  if (existing) return { status: "duplicate" };

  // The live path requires the host to be signed in right now. Here the tablet
  // already witnessed that when the guest arrived, and the host may well have
  // gone home since — so the guest is recorded on the strength of the queued
  // event. Missing the guest entirely would be the worse error.
  const { error } = await supabase.from("guest_signins").insert({
    id: event.id,
    host_member_id: event.hostMemberId,
    guest_name: event.guestName.trim().slice(0, 80),
    signed_in_at: at,
  });

  if (error) {
    if (isUniqueViolation(error)) return { status: "duplicate" };
    if (isForeignKeyViolation(error)) {
      return { status: "rejected", reason: "The host member no longer exists." };
    }
    throw new Error(error.message);
  }
  return { status: "applied" };
}

async function applyStudentIn(
  supabase: Supabase,
  event: Extract<QueuedEvent, { kind: "student-in" }>,
  at: string,
): Promise<Omit<SyncOutcome, "id">> {
  const name = event.studentName.trim();
  const label = event.classLabel.trim();
  if (!name || !label) {
    return { status: "rejected", reason: "Student name or class was missing." };
  }

  const { data: existing } = await supabase
    .from("student_signins")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  if (existing) return { status: "duplicate" };

  const { error } = await supabase.from("student_signins").insert({
    id: event.id,
    student_name: name.slice(0, 80),
    class_label: label.slice(0, 80),
    session_type: event.openStudio ? "open_studio" : "class",
    signed_in_at: at,
  });

  if (error) {
    if (isUniqueViolation(error)) return { status: "duplicate" };
    throw new Error(error.message);
  }
  return { status: "applied" };
}

async function applyStudentOut(
  supabase: Supabase,
  event: Extract<QueuedEvent, { kind: "student-out" }>,
  at: string,
): Promise<Omit<SyncOutcome, "id">> {
  const { data: row } = await supabase
    .from("student_signins")
    .select("id, signed_in_at, signed_out_at, auto_closed, session_type")
    .eq("id", event.signinId)
    .maybeSingle();

  if (!row) {
    // The matching sign-in never made it — nothing to close, and retrying
    // forever won't change that.
    return { status: "rejected", reason: "That sign-in isn't on record." };
  }
  if (row.session_type !== "open_studio") {
    return { status: "rejected", reason: "Class sign-ins don't sign out." };
  }

  const out = maxIso(at, row.signed_in_at);
  if (row.signed_out_at && !row.auto_closed) return { status: "duplicate" };

  await supabase
    .from("student_signins")
    .update({ signed_out_at: out, auto_closed: false })
    .eq("id", row.id);
  return { status: "applied" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pin a client-supplied timestamp to a believable window: never in the future,
 * never older than a week.
 */
function clampTimestamp(raw: string): { at: string } | { error: string } {
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return { error: "Unreadable timestamp." };

  const now = Date.now();
  if (parsed > now + MAX_CLOCK_LEAD_MS) return { at: new Date(now).toISOString() };
  if (parsed < now - MAX_BACKDATE_MS) {
    return { error: "Too old to add to the log." };
  }
  return { at: new Date(parsed).toISOString() };
}

function maxIso(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === "23505";
}

function isForeignKeyViolation(error: { code?: string }): boolean {
  return error.code === "23503";
}

/** Shape-check the payload — this action is reachable by anyone, like the kiosk. */
function isQueuedEvent(value: unknown): value is QueuedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (typeof event.id !== "string" || typeof event.at !== "string") return false;

  switch (event.kind) {
    case "shift-in":
    case "shift-out":
      return (
        typeof event.memberId === "string" && typeof event.pin === "string"
      );
    case "guest-in":
      return (
        typeof event.hostMemberId === "string" &&
        typeof event.guestName === "string"
      );
    case "student-in":
      return (
        typeof event.studentName === "string" &&
        typeof event.classLabel === "string"
      );
    case "student-out":
      return typeof event.signinId === "string";
    default:
      return false;
  }
}

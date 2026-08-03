import {
  isOffline,
  readPending,
  dropEvents,
  updateEvents,
  SYNC_BATCH_LIMIT,
  type QueuedEvent,
  type StoredEvent,
  type SyncOutcome,
} from "./offline-queue";
import { syncOfflineEvents } from "@/app/kiosk/sync-actions";

/**
 * Drains the offline queue into the database.
 *
 * Called on page load, when the browser reports the network is back, when the
 * tab becomes visible again, and on a timer while anything is waiting — a
 * kiosk left sitting on the roster screen syncs itself without anyone touching
 * it. OfflineQueueSync wires those triggers up.
 */

/**
 * Give up on an event after this many failed attempts and surface it instead.
 * Something that has failed eight times is not going to start working, and a
 * queue that retries forever hides a real problem.
 */
const MAX_ATTEMPTS = 8;

export type FlushResult = {
  applied: number;
  duplicate: number;
  /**
   * Taps the studio's record contradicted. Nothing was written and an officer
   * has been handed the details — see `SyncStatus`. Counted apart from
   * duplicates because these are the ones somebody still has to act on.
   */
  conflict: number;
  rejected: number;
  /** Still queued — either offline, or waiting on the next attempt. */
  remaining: number;
};

const EMPTY: FlushResult = {
  applied: 0,
  duplicate: 0,
  conflict: 0,
  rejected: 0,
  remaining: 0,
};

let inFlight: Promise<FlushResult> | null = null;

/**
 * Sync everything queued. Concurrent callers share one run, so the load-time
 * flush and an `online` event firing together can't double-send a batch.
 */
export function flushQueue(): Promise<FlushResult> {
  if (inFlight) return inFlight;
  inFlight = drain().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function drain(): Promise<FlushResult> {
  const total: FlushResult = { ...EMPTY };

  // Don't bother the server when the browser already knows there's no network;
  // a real attempt still happens on the next trigger.
  if (isOffline()) {
    total.remaining = (await readPending()).length;
    return total;
  }

  for (;;) {
    const pending = await readPending();
    if (pending.length === 0) break;

    const batch = pending.slice(0, SYNC_BATCH_LIMIT);
    let outcomes: SyncOutcome[];
    try {
      outcomes = await syncOfflineEvents(batch.map(toPayload));
    } catch {
      // The request never landed — still offline, or the deploy is mid-swap.
      // Keep every event and count the attempt.
      await bumpAttempts(batch, "No connection");
      total.remaining = pending.length;
      break;
    }

    const byId = new Map(outcomes.map((o) => [o.id, o]));
    const done: string[] = [];
    const failed: StoredEvent[] = [];
    const refused: { id: string; rejected: string }[] = [];

    for (const event of batch) {
      const outcome = byId.get(event.id);
      if (!outcome || outcome.status === "retry") {
        failed.push(event);
        continue;
      }
      if (outcome.status === "rejected") {
        refused.push({
          id: event.id,
          rejected: outcome.reason || "The server wouldn't accept it.",
        });
        continue;
      }
      // Applied, duplicate, and conflict are all settled server-side: none of
      // them will change on a retry, so the device lets them go.
      done.push(event.id);
      if (outcome.status === "applied") total.applied++;
      else if (outcome.status === "conflict") total.conflict++;
      else total.duplicate++;
    }

    if (done.length) await dropEvents(done);
    if (refused.length) {
      await updateEvents(refused);
      total.rejected += refused.length;
    }
    if (failed.length) {
      await bumpAttempts(failed, byId.get(failed[0].id)?.reason ?? "Sync failed");
    }

    // No event changed state this round, so another identical round won't
    // either. Stop and let the next trigger try again.
    if (done.length === 0 && refused.length === 0) {
      total.remaining = pending.length;
      break;
    }
  }

  if (total.remaining === 0) {
    total.remaining = (await readPending()).length;
  }
  return total;
}

/**
 * Record a failed attempt, retiring events that have exhausted their retries so
 * they show up as a problem rather than quietly cycling forever.
 */
async function bumpAttempts(events: StoredEvent[], reason: string) {
  await updateEvents(
    events.map((event) => {
      const attempts = event.attempts + 1;
      return attempts >= MAX_ATTEMPTS
        ? { id: event.id, attempts, lastError: reason, rejected: reason }
        : { id: event.id, attempts, lastError: reason };
    }),
  );
}

/** Strip local bookkeeping — the server only needs the event itself. */
function toPayload(event: StoredEvent): QueuedEvent {
  const { attempts, lastError, rejected, ...payload } = event;
  void attempts;
  void lastError;
  void rejected;
  return payload as QueuedEvent;
}

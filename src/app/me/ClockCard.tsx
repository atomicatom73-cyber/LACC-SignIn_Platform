"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDuration } from "@/lib/time";
import { useOfflineQueue } from "@/components/OfflineQueueSync";
import {
  enqueue,
  isOffline,
  latestShiftEvent,
  newEventId,
  serverReachable,
  studioNowIso,
} from "@/lib/offline-queue";
import { toggleShift } from "./actions";

/**
 * Clock in and out from a member's own phone.
 *
 * Phones lose signal in the studio, and a tap that can't reach the server used
 * to fail silently here — no message, nothing recorded, the button just went
 * back to how it was. (Both of the only two sign-outs ever lost in this app
 * were from this screen, not the kiosk.) Now the tap is saved on the phone and
 * replayed when signal returns, the same way the kiosk does it.
 *
 * Unlike the kiosk there's no PIN: the member is logged in, so the queued event
 * is authenticated against their session when it syncs. See `QueueVia`.
 */
export function ClockCard({
  openSince,
  memberId,
  memberName,
}: {
  /** ISO timestamp of the open shift, or null if clocked out. */
  openSince: string | null;
  memberId: string;
  memberName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { pending: queued, refresh: refreshQueue } = useOfflineQueue();

  // A tap waiting to sync isn't in the page the server rendered, and that page
  // may itself have come from the offline cache. What this phone knows wins.
  const waiting = latestShiftEvent(queued, memberId);
  const since = waiting
    ? waiting.kind === "shift-in"
      ? waiting.at
      : null
    : openSince;
  const isIn = since !== null;

  useEffect(() => {
    if (!since) return;
    const start = new Date(since).getTime();
    const tick = () => setElapsed(formatDuration(Date.now() - start));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);

  async function queueTap(goingIn: boolean) {
    const stored = await enqueue({
      kind: goingIn ? "shift-in" : "shift-out",
      id: newEventId(),
      at: studioNowIso(),
      memberId,
      memberName,
      via: "phone",
    });
    // Fold it into state before the transition ends so the card settles straight
    // into its new state instead of flicking back first.
    await refreshQueue();
    if (stored) {
      setSaved(true);
      setError(null);
    } else {
      // Nothing to fall back on — don't imply it was recorded.
      setError("No signal, and this phone couldn't save it. Try again in range.");
    }
  }

  function tap() {
    const goingIn = !isIn;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      if (isOffline()) {
        await queueTap(goingIn);
        return;
      }
      try {
        // Returns nothing and revalidates /me, so no throw means it landed.
        await toggleShift();
      } catch {
        // Either the request never left the phone or the server threw — they
        // look identical here, so ask whether the server is answering before
        // telling them it's saved.
        if (await serverReachable()) {
          setError("The studio's system had a problem — please try again.");
        } else {
          await queueTap(goingIn);
        }
      }
    });
  }

  return (
    <div
      className={`rounded-3xl border p-6 text-center transition-colors ${
        isIn ? "border-success/40 bg-success/10" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center justify-center gap-2 text-sm font-medium">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            isIn ? "bg-success animate-pulse" : "bg-muted"
          }`}
        />
        {isIn ? "You're clocked in" : "You're clocked out"}
      </div>

      {isIn && (
        <div className="mt-2 font-mono text-4xl font-bold tabular-nums">
          {elapsed || "0m"}
        </div>
      )}

      <button
        onClick={tap}
        disabled={pending}
        className={`mt-5 w-full rounded-2xl px-6 py-5 text-lg font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
          isIn ? "bg-danger text-background" : "bg-accent text-background"
        }`}
      >
        {pending ? "…" : isIn ? "Clock out" : "Clock in"}
      </button>

      {waiting && (
        <p className="mt-3 text-xs text-muted">
          {saved ? "Saved on your phone. " : ""}
          Waiting for signal — this will reach the studio log on its own.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}

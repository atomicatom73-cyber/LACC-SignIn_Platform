"use client";

import { useOfflineQueue } from "@/components/OfflineQueueSync";
import {
  applyQueuedShifts,
  countInStudio,
  type RosterMember,
} from "./queued-roster";

/**
 * The "N in the studio" pill.
 *
 * A client component so it counts the same roster the cards show — including
 * taps still queued on the tablet. Server-rendered, it would sit next to a grid
 * showing three people signed in and confidently claim one.
 */
export function InStudioCount({ members }: { members: RosterMember[] }) {
  const { pending } = useOfflineQueue();
  const count = countInStudio(applyQueuedShifts(members, pending));

  return (
    <span className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-muted">
      <span className="font-semibold text-success">{count}</span> in the studio
    </span>
  );
}

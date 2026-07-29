import type { StoredEvent } from "@/lib/offline-queue";

export type RosterMember = {
  id: string;
  full_name: string;
  hasPin: boolean;
  hasAccount: boolean;
  openSince: string | null;
};

/**
 * Lay the offline queue over the roster the server sent.
 *
 * Taps taken while offline aren't in that roster — and when the page comes from
 * the service worker cache, the roster can be hours stale. This makes the cards
 * show who is signed in *according to this tablet*, which is the only thing it
 * can honestly claim while it's cut off.
 *
 * Shared by the grid and the "in the studio" count so the two can't disagree.
 */
export function applyQueuedShifts(
  members: RosterMember[],
  queued: StoredEvent[],
): RosterMember[] {
  const latest = new Map<string, StoredEvent>();
  // The queue is ordered oldest first, so the last event for a member wins —
  // someone who signed in and back out again offline ends up out.
  for (const event of queued) {
    if (event.kind === "shift-in" || event.kind === "shift-out") {
      latest.set(event.memberId, event);
    }
  }
  if (latest.size === 0) return members;

  // No re-sort: the server floats whoever is in the studio to the top, and
  // reshuffling cards under someone's finger mid-tap is worse than a signed-in
  // card sitting further down the grid.
  return members.map((member) => {
    const event = latest.get(member.id);
    if (!event) return member;
    return {
      ...member,
      openSince: event.kind === "shift-in" ? event.at : null,
    };
  });
}

export function countInStudio(members: RosterMember[]): number {
  return members.filter((member) => member.openSince !== null).length;
}

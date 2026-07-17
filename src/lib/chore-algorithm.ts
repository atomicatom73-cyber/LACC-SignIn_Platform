/**
 * Monthly chore draft generator — pure logic, no Next.js/Supabase imports.
 *
 * Deterministic: the PRNG is seeded from `targetMonth`, and all inputs are
 * pre-sorted by id before shuffling, so regenerating the same month always
 * produces the identical draft regardless of database row order.
 *
 * Exemptions are decided up front: absent members are skipped for free, and
 * every member holding an unused credit sits the whole month out (one credit
 * is spent at publish time). Both are back in the rotation next month.
 *
 * Load is balanced per half-month window. A `month` chore occupies both
 * halves; `first_half` / `second_half` chores occupy only theirs, so one
 * member can hold a first-half AND a second-half job without it counting as
 * a double-up. Nobody gets a second job in the same window until everyone
 * available has work in that window.
 */

export type ChoreWindowInterval = "month" | "first_half" | "second_half";

export type DraftInput = {
  targetMonth: string; // "YYYY-MM-01"
  chores: {
    id: string;
    name: string;
    slots: number;
    interval: ChoreWindowInterval;
  }[]; // active + unpaused
  members: { id: string; full_name: string }[]; // active, role='member'
  prevAssignments: { chore_id: string; member_id: string }[]; // targetMonth - 1
  absentMemberIds: string[]; // absences(targetMonth)
  creditAvailableMemberIds: string[]; // members with ≥1 unused credit
};

export type Draft = {
  proposals: { chore_id: string; member_ids: string[] }[];
  creditsToConsume: string[]; // member ids spared by spending a credit
  exemptAbsent: string[];
  unassigned: string[]; // eligible members who ended up with no job
  warnings: string[];
};

/** FNV-1a hash of a string → unsigned 32-bit seed. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG over a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle into a new array using the given PRNG. */
function seededShuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pairKey = (choreId: string, memberId: string) => `${choreId}:${memberId}`;

/** The half-month windows an interval occupies. */
function windowsOf(interval: ChoreWindowInterval): ("first" | "second")[] {
  if (interval === "first_half") return ["first"];
  if (interval === "second_half") return ["second"];
  return ["first", "second"];
}

export function generateMonthlyDraft(input: DraftInput): Draft {
  const rand = mulberry32(hashString(input.targetMonth));
  const warnings: string[] = [];

  const absent = new Set(input.absentMemberIds);
  const creditHolders = new Set(input.creditAvailableMemberIds);

  // Absent members are exempt outright — no credit is spent on them.
  const exemptAbsent = input.members
    .filter((m) => absent.has(m.id))
    .map((m) => m.id);

  // Everyone else holding a credit sits the whole month out; the publish
  // step spends one credit each, so they're back in next month's pool.
  const creditsToConsume = input.members
    .filter((m) => !absent.has(m.id) && creditHolders.has(m.id))
    .map((m) => m.id);
  const creditExempt = new Set(creditsToConsume);

  // Previous-month workload count and (chore, member) pairs for the
  // "no one gets the same chore as the previous month" rule.
  const prevCount = new Map<string, number>();
  const prevPairs = new Set<string>();
  for (const a of input.prevAssignments) {
    prevCount.set(a.member_id, (prevCount.get(a.member_id) ?? 0) + 1);
    prevPairs.add(pairKey(a.chore_id, a.member_id));
  }

  // Candidate pool: non-absent, non-credit members, seeded-shuffled, then
  // stably sorted so people who did chores last month rotate to the back.
  const pool = seededShuffle(
    input.members
      .filter((m) => !absent.has(m.id) && !creditExempt.has(m.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    rand,
  ).sort((a, b) => (prevCount.get(a.id) ?? 0) - (prevCount.get(b.id) ?? 0));

  // Month-long chores are the most constrained (they occupy both windows),
  // so they draw first; half-month chores fill the gaps around them.
  const shuffled = seededShuffle(
    input.chores
      .filter((c) => c.slots > 0)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    rand,
  );
  const chores = [
    ...shuffled.filter((c) => c.interval === "month"),
    ...shuffled.filter((c) => c.interval !== "month"),
  ];

  // Per-member load in THIS draft: total jobs and which windows are taken.
  const assignedCount = new Map<string, number>();
  const busyWindows = new Map<string, Set<"first" | "second">>();
  const proposalByChore = new Map<string, string[]>();
  for (const chore of chores) proposalByChore.set(chore.id, []);

  type Mode = "fresh" | "window-free" | "any";

  /**
   * Walk the pool for the next eligible candidate.
   *  - fresh:       nobody with a job yet — spread the load first.
   *  - window-free: may already work the OTHER half of the month, but the
   *                 chore's own window(s) are open. Not a double-up.
   *  - any:         last resort — a second job in the same window.
   */
  const takeCandidate = (
    chore: { id: string; interval: ChoreWindowInterval },
    current: string[],
    mode: Mode,
  ): { id: string; full_name: string } | null => {
    const wanted = windowsOf(chore.interval);
    for (const candidate of pool) {
      if (prevPairs.has(pairKey(chore.id, candidate.id))) continue;
      if (current.includes(candidate.id)) continue;
      if (mode === "fresh" && (assignedCount.get(candidate.id) ?? 0) > 0) {
        continue;
      }
      if (mode !== "any") {
        const busy = busyWindows.get(candidate.id);
        if (busy && wanted.some((w) => busy.has(w))) continue;
      }
      return candidate;
    }
    return null;
  };

  for (const chore of chores) {
    const memberIds = proposalByChore.get(chore.id)!;
    for (let slot = 1; slot <= chore.slots; slot++) {
      let pick = takeCandidate(chore, memberIds, "fresh");
      if (!pick) {
        // Everyone free already has a job — cross-window seconds are fine.
        pick = takeCandidate(chore, memberIds, "window-free");
      }
      if (!pick) {
        pick = takeCandidate(chore, memberIds, "any");
        if (pick) {
          warnings.push(
            `${pick.full_name} got a second job in the same half of the month (${chore.name}) — everyone available already has one there.`,
          );
        }
      }

      if (pick) {
        memberIds.push(pick.id);
        assignedCount.set(pick.id, (assignedCount.get(pick.id) ?? 0) + 1);
        const busy = busyWindows.get(pick.id) ?? new Set();
        for (const w of windowsOf(chore.interval)) busy.add(w);
        busyWindows.set(pick.id, busy);
      } else {
        warnings.push(
          `Couldn't fill slot ${slot} of ${chore.name} — everyone left had it last month. Assign manually.`,
        );
      }
    }
  }

  const unassigned = pool
    .filter((m) => (assignedCount.get(m.id) ?? 0) === 0)
    .map((m) => m.id);

  // Return proposals in the caller's chore order for stable display.
  const proposals = input.chores
    .filter((c) => c.slots > 0)
    .map((c) => ({ chore_id: c.id, member_ids: proposalByChore.get(c.id) ?? [] }));

  return {
    proposals,
    creditsToConsume,
    exemptAbsent,
    unassigned,
    warnings,
  };
}

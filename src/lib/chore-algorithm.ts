/**
 * Monthly chore draft generator — pure logic, no Next.js/Supabase imports.
 *
 * Deterministic: the PRNG is seeded from `targetMonth`, and all inputs are
 * pre-sorted by id before shuffling, so regenerating the same month always
 * produces the identical draft regardless of database row order.
 */

export type DraftInput = {
  targetMonth: string; // "YYYY-MM-01"
  chores: { id: string; name: string; slots: number }[];
  members: { id: string; full_name: string }[]; // active, role='member'
  prevAssignments: { chore_id: string; member_id: string }[]; // targetMonth - 1
  absentMemberIds: string[]; // absences(targetMonth)
  creditAvailableMemberIds: string[]; // members with ≥1 unused credit
};

export type Draft = {
  proposals: { chore_id: string; member_ids: string[] }[];
  creditsToConsume: string[]; // member ids spared by spending a credit
  exemptAbsent: string[];
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

export function generateMonthlyDraft(input: DraftInput): Draft {
  const rand = mulberry32(hashString(input.targetMonth));
  const warnings: string[] = [];

  const absent = new Set(input.absentMemberIds);
  const creditAvailable = new Set(input.creditAvailableMemberIds);
  const creditsToConsume: string[] = [];

  // Absent members are exempt outright — no credit is spent on them.
  const exemptAbsent = input.members
    .filter((m) => absent.has(m.id))
    .map((m) => m.id);

  // Previous-month workload count and (chore, member) pairs for the
  // "no one gets the same chore as the previous month" rule.
  const prevCount = new Map<string, number>();
  const prevPairs = new Set<string>();
  for (const a of input.prevAssignments) {
    prevCount.set(a.member_id, (prevCount.get(a.member_id) ?? 0) + 1);
    prevPairs.add(pairKey(a.chore_id, a.member_id));
  }

  // Candidate pool: non-absent members, seeded-shuffled, then stably sorted
  // so people who did chores last month rotate to the back this month.
  const pool = seededShuffle(
    input.members
      .filter((m) => !absent.has(m.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    rand,
  ).sort((a, b) => (prevCount.get(a.id) ?? 0) - (prevCount.get(b.id) ?? 0));

  const chores = seededShuffle(
    input.chores
      .filter((c) => c.slots > 0)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    rand,
  );

  // How many chores each member has in THIS draft.
  const assignedCount = new Map<string, number>();
  const proposalByChore = new Map<string, string[]>();
  for (const chore of chores) proposalByChore.set(chore.id, []);

  /**
   * Walk the pool for the next eligible candidate. A candidate who would be
   * picked but holds an unused credit spends it instead: they leave the pool
   * for the whole month and the walk continues.
   */
  const takeCandidate = (
    chore: { id: string; name: string },
    current: string[],
    firstChoreOnly: boolean,
  ): { id: string; full_name: string } | null => {
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      if (firstChoreOnly && (assignedCount.get(candidate.id) ?? 0) > 0) continue;
      if (prevPairs.has(pairKey(chore.id, candidate.id))) continue;
      if (current.includes(candidate.id)) continue;
      if (creditAvailable.has(candidate.id)) {
        creditAvailable.delete(candidate.id);
        creditsToConsume.push(candidate.id);
        pool.splice(i, 1);
        i -= 1;
        warnings.push(
          `${candidate.full_name} is sitting this month out on a chore credit.`,
        );
        continue;
      }
      return candidate;
    }
    return null;
  };

  for (const chore of chores) {
    const memberIds = proposalByChore.get(chore.id)!;
    for (let slot = 1; slot <= chore.slots; slot++) {
      let pick = takeCandidate(chore, memberIds, true);

      if (!pick) {
        // Only hand out a second chore once every available member has one.
        const someoneStillFree = pool.some(
          (m) => (assignedCount.get(m.id) ?? 0) === 0,
        );
        if (!someoneStillFree) {
          pick = takeCandidate(chore, memberIds, false);
          if (pick) {
            warnings.push(
              `${pick.full_name} got a second chore (${chore.name}) — everyone available already has one.`,
            );
          }
        }
      }

      if (pick) {
        memberIds.push(pick.id);
        assignedCount.set(pick.id, (assignedCount.get(pick.id) ?? 0) + 1);
      } else {
        warnings.push(
          `Couldn't fill slot ${slot} of ${chore.name} — everyone left had it last month. Assign manually.`,
        );
      }
    }
  }

  // Return proposals in the caller's chore order for stable display.
  const proposals = input.chores
    .filter((c) => c.slots > 0)
    .map((c) => ({ chore_id: c.id, member_ids: proposalByChore.get(c.id) ?? [] }));

  return { proposals, creditsToConsume, exemptAbsent, warnings };
}

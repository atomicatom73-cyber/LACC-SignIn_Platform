/**
 * Monthly chore draft generator — pure logic, no Next.js/Supabase imports.
 *
 * Deterministic: the PRNG is seeded from `targetMonth`, and all inputs are
 * pre-sorted by id before shuffling, so regenerating the same month always
 * produces the identical draft regardless of database row order.
 *
 * Exemptions are decided up front: board officers, the kiln team, and absent
 * members are skipped for free, and every member holding an unused credit sits
 * the whole month out (one credit is spent at publish time). Absences and
 * credits are back in the rotation next month; officers and kiln-team members
 * stay out until an officer unticks the status.
 *
 * Nobody gets more than one job a month, ever. When there aren't enough
 * people to go round, the leftover slots simply stay unassigned instead of
 * doubling anyone up — the officer fills them by hand from the draft.
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
  officerMemberIds: string[]; // members.officer_status — exempt, no credit
  kilnTeamMemberIds: string[]; // members.kiln_team — exempt, no credit
};

export type Draft = {
  proposals: { chore_id: string; member_ids: string[] }[];
  creditsToConsume: string[]; // member ids spared by spending a credit
  exemptAbsent: string[];
  exemptOfficers: string[];
  exemptKilnTeam: string[];
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

export function generateMonthlyDraft(input: DraftInput): Draft {
  const rand = mulberry32(hashString(input.targetMonth));
  const warnings: string[] = [];

  const absent = new Set(input.absentMemberIds);
  const creditHolders = new Set(input.creditAvailableMemberIds);
  const officers = new Set(input.officerMemberIds);
  const kilnTeam = new Set(input.kilnTeamMemberIds);

  // Standing exemptions win over the monthly ones, so someone on the board or
  // the kiln team never burns a credit or shows up as "absent".
  const standing = (id: string) => officers.has(id) || kilnTeam.has(id);

  // Board officers are exempt for as long as they hold the status.
  const exemptOfficers = input.members
    .filter((m) => officers.has(m.id))
    .map((m) => m.id);

  // Kiln team likewise — their kiln work stands in for a monthly job. An
  // officer who is also on the kiln team is only counted once, as an officer.
  const exemptKilnTeam = input.members
    .filter((m) => !officers.has(m.id) && kilnTeam.has(m.id))
    .map((m) => m.id);

  // Absent members are exempt outright — no credit is spent on them.
  const exemptAbsent = input.members
    .filter((m) => !standing(m.id) && absent.has(m.id))
    .map((m) => m.id);

  // Everyone else holding a credit sits the whole month out; the publish
  // step spends one credit each, so they're back in next month's pool.
  const creditsToConsume = input.members
    .filter((m) => !standing(m.id) && !absent.has(m.id) && creditHolders.has(m.id))
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
      .filter(
        (m) =>
          !standing(m.id) && !absent.has(m.id) && !creditExempt.has(m.id),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    rand,
  ).sort((a, b) => (prevCount.get(a.id) ?? 0) - (prevCount.get(b.id) ?? 0));

  // Month-long chores are the biggest commitment, so they draw first; when
  // the studio is short-handed the empty slots land on half-month jobs.
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

  // Who already holds a job in THIS draft — one each is the hard cap.
  const taken = new Set<string>();
  const proposalByChore = new Map<string, string[]>();
  for (const chore of chores) proposalByChore.set(chore.id, []);

  /**
   * The next member with no job yet who didn't hold this chore last month.
   * Null means the slot can't be filled — either everyone's busy or the
   * people still free all had this same job last month.
   */
  const takeCandidate = (choreId: string) =>
    pool.find(
      (m) => !taken.has(m.id) && !prevPairs.has(pairKey(choreId, m.id)),
    ) ?? null;

  for (const chore of chores) {
    const memberIds = proposalByChore.get(chore.id)!;
    for (let slot = 1; slot <= chore.slots; slot++) {
      const pick = takeCandidate(chore.id);
      if (!pick) {
        // Nothing about the next slot would change the answer, so the rest of
        // this job stays unassigned. Only flag the surprising reason: people
        // are still free, they just all had this job last month. Running out
        // of members is obvious from the empty slots themselves.
        if (pool.some((m) => !taken.has(m.id))) {
          const missing = chore.slots - memberIds.length;
          warnings.push(
            `${chore.name} has ${missing} slot${missing === 1 ? "" : "s"} left unassigned — everyone still free had it last month. Add someone by hand if you want it covered.`,
          );
        }
        break;
      }
      memberIds.push(pick.id);
      taken.add(pick.id);
    }
  }

  const unassigned = pool.filter((m) => !taken.has(m.id)).map((m) => m.id);

  // Return proposals in the caller's chore order for stable display.
  const proposals = input.chores
    .filter((c) => c.slots > 0)
    .map((c) => ({ chore_id: c.id, member_ids: proposalByChore.get(c.id) ?? [] }));

  return {
    proposals,
    creditsToConsume,
    exemptAbsent,
    exemptOfficers,
    exemptKilnTeam,
    unassigned,
    warnings,
  };
}

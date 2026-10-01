/**
 * Who sits a month out, and why — shared by the jobs page (which renders the
 * exemption lines) and publishDraft (which spends the credits). Pure logic, no
 * Next.js/Supabase imports.
 *
 * These used to be frozen into the draft the moment it was generated. Now that
 * a draft is saved and can sit for weeks before it's published, they're derived
 * fresh every time instead: someone marked absent after the draft was penciled
 * is absent, and a credit holder the coordinator penciled onto a job anyway
 * keeps their credit.
 */

export type ExemptionInput = {
  /** Active members with role 'member'. */
  members: { id: string; full_name: string; officer_status: boolean; kiln_team: boolean }[];
  /** absences(month) — member ids. */
  absentMemberIds: string[];
  /** Members holding at least one unused credit. */
  creditMemberIds: string[];
  /** Member ids with a job in the draft or already published for the month. */
  workingMemberIds: string[];
};

export type Exemptions = {
  officers: { id: string; name: string }[];
  kilnTeam: { id: string; name: string }[];
  absent: { id: string; name: string }[];
  /** Credit holders sitting the month out — one credit each spent on publish. */
  creditSpends: { id: string; name: string }[];
  /** Everyone who should get a job: not exempt, not already working. */
  inTheDraw: { id: string; name: string }[];
};

export function deriveExemptions(input: ExemptionInput): Exemptions {
  const absent = new Set(input.absentMemberIds);
  const credits = new Set(input.creditMemberIds);
  const working = new Set(input.workingMemberIds);

  // Standing exemptions win over the monthly ones, so someone on the board or
  // the kiln team never burns a credit or shows up as "absent".
  const isOfficer = (m: ExemptionInput["members"][number]) => m.officer_status;
  const isKiln = (m: ExemptionInput["members"][number]) =>
    m.kiln_team && !m.officer_status;
  const standing = (m: ExemptionInput["members"][number]) =>
    isOfficer(m) || isKiln(m);

  const named = (m: ExemptionInput["members"][number]) => ({
    id: m.id,
    name: m.full_name,
  });

  const officers = input.members.filter(isOfficer).map(named);
  const kilnTeam = input.members.filter(isKiln).map(named);
  const absentees = input.members
    .filter((m) => !standing(m) && absent.has(m.id))
    .map(named);

  // A credit is only spent on someone who actually sat the month out. Pencil
  // them onto a job and they keep it — which is why this is recomputed rather
  // than snapshotted when the draft is generated.
  const creditSpends = input.members
    .filter(
      (m) =>
        !standing(m) &&
        !absent.has(m.id) &&
        credits.has(m.id) &&
        !working.has(m.id),
    )
    .map(named);
  const spending = new Set(creditSpends.map((c) => c.id));

  const inTheDraw = input.members
    .filter(
      (m) => !standing(m) && !absent.has(m.id) && !spending.has(m.id),
    )
    .map(named);

  return { officers, kilnTeam, absent: absentees, creditSpends, inTheDraw };
}

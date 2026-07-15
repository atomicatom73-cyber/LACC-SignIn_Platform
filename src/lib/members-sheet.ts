/**
 * Member roster sync. The studio's private "LACC Member session sign-ups/fees"
 * Google sheet is the source of truth for who the members are, their email,
 * and whether they're active this session; we mirror it into `members` so the
 * officer roster, announcement emails, and the kiosk all reflect it.
 *
 * Freshness mirrors the calendar sync: the officer members page calls
 * `syncMembersSheetThrottled()` on load, and a once-daily Vercel Cron hit to
 * app/api/members-sync is the backstop (Hobby caps cron at once per day).
 *
 * Unlike the calendar, the sheet is private (it holds every member's email),
 * so reads authenticate as a Google SERVICE ACCOUNT the sheet is shared with —
 * a signed JWT is exchanged for a short-lived access token, no OAuth consent
 * and no SDK.
 *
 * Sync rules (locked in with the user 2026-07-14):
 * - Always reads the FIRST visible tab — the board hasn't decided how new
 *   trimesters will be filed, so the officers page shows which tab was read.
 * - Sheet rows are matched to existing members by email first, then by
 *   normalized name. Unmatched rows become kiosk-only members (no account).
 * - The sheet WINS on active/inactive for matched members; in-app status
 *   edits for them last only until the next sync.
 * - The app never renames an existing member from the sheet (names are tied
 *   to logins) and never deletes anyone — dropped rows just lose `in_sheet`.
 * - A member's own email alias is never overwritten; the sheet only fills a
 *   missing one.
 */

import { createAdminClient } from "./supabase/admin";
import { memberLoginEmail } from "./roles";
import {
  SHEETS_API,
  SHEETS_READONLY_SCOPE,
  googleAccessToken,
  serviceAccountConfigured,
} from "./google-service-account";

/** True when the env vars the sync needs are all present. */
export function membersSheetConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MEMBERS_SHEET_ID) && serviceAccountConfigured();
}

/** Read-only token — the roster sheet is the studio's source of truth. */
function accessToken(): Promise<string> {
  return googleAccessToken(SHEETS_READONLY_SCOPE);
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

/** One cleaned, usable sheet row. */
type SheetRow = {
  name: string;
  /** Lowercased valid address, or null when the cell is empty or malformed. */
  email: string | null;
  active: boolean;
  paid: string | null;
  paymentType: string | null;
  policy: string | null;
  photos: string | null;
  comments: string | null;
};

/** Collapse whitespace (incl. tabs/nbsp the sheet actually contains). */
function clean(cell: string | undefined): string {
  return (cell ?? "").replace(/\s+/g, " ").trim();
}

/** Loose but honest: reject addresses with embedded spaces rather than "fix" them. */
function cleanEmail(cell: string | undefined): string | null {
  const value = clean(cell).toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** Read the first visible tab of the roster sheet. */
async function fetchSheet(): Promise<{ tab: string; grid: string[][] }> {
  const sheetId = process.env.GOOGLE_MEMBERS_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_MEMBERS_SHEET_ID must be set.");

  const headers = { authorization: `Bearer ${await accessToken()}` };

  const metaRes = await fetch(
    `${SHEETS_API}/${sheetId}?fields=sheets(properties(title,index,hidden))`,
    { headers, cache: "no-store" },
  );
  if (!metaRes.ok) {
    const body = await metaRes.text();
    throw new Error(`Sheets metadata ${metaRes.status}: ${body.slice(0, 300)}`);
  }
  const meta = (await metaRes.json()) as {
    sheets?: { properties?: { title?: string; index?: number; hidden?: boolean } }[];
  };
  const tabs = (meta.sheets ?? [])
    .map((s) => s.properties ?? {})
    .filter((p) => !p.hidden && p.title)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const tab = tabs[0]?.title;
  if (!tab) throw new Error("The roster sheet has no visible tabs.");

  // Single-quote the tab title in the A1 range; literal quotes double up.
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:Z`);
  const valuesRes = await fetch(
    `${SHEETS_API}/${sheetId}/values/${range}?majorDimension=ROWS`,
    { headers, cache: "no-store" },
  );
  if (!valuesRes.ok) {
    const body = await valuesRes.text();
    throw new Error(`Sheets values ${valuesRes.status}: ${body.slice(0, 300)}`);
  }
  const values = (await valuesRes.json()) as { values?: string[][] };
  return { tab, grid: values.values ?? [] };
}

/**
 * Turn the raw grid into rows, locating columns from the header text so the
 * sheet survives reordering and per-trimester renames ("Paid for May-Aug26?").
 */
function parseGrid(grid: string[][]): { rows: SheetRow[]; flagged: string[] } {
  const flagged: string[] = [];

  const headerIdx = grid.findIndex(
    (row) =>
      row.some((c) => /\b(members?|name)\b/i.test(c)) &&
      row.some((c) => /email/i.test(c)),
  );
  if (headerIdx === -1) {
    throw new Error(
      "Couldn't find the header row (looked for Member/Name + Email columns).",
    );
  }
  const header = grid[headerIdx].map(clean);
  const col = (pattern: RegExp) => header.findIndex((c) => pattern.test(c));
  const cols = {
    name: col(/^(members?|name)\b/i),
    email: col(/email/i),
    active: col(/^active/i),
    paid: col(/^paid/i),
    paymentType: col(/payment/i),
    comments: col(/comment/i),
    policy: col(/policy/i),
    photos: col(/photo/i),
  };
  if (cols.name === -1 || cols.email === -1) {
    throw new Error("The header row is missing a Member/Name or Email column.");
  }

  const rows: SheetRow[] = [];
  for (const raw of grid.slice(headerIdx + 1)) {
    const name = clean(raw[cols.name]);
    if (!name) continue;
    // Summary rows like "Total Active" live in the same column as names.
    if (/^total\b/i.test(name)) continue;

    const rawEmail = clean(raw[cols.email]);
    const email = cleanEmail(raw[cols.email]);
    if (rawEmail && !email) {
      flagged.push(`${name}: sheet email "${rawEmail}" looks invalid — not imported.`);
    }

    const cell = (index: number) =>
      index === -1 ? null : clean(raw[index]) || null;

    rows.push({
      name,
      email,
      active: /^y/i.test(clean(cols.active === -1 ? "" : raw[cols.active])),
      paid: cell(cols.paid),
      paymentType: cell(cols.paymentType),
      policy: cell(cols.policy),
      photos: cell(cols.photos),
      comments: cell(cols.comments),
    });
  }
  return { rows, flagged };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type MembersSheetSyncResult = {
  tab: string;
  totalRows: number;
  matched: number;
  created: number;
  updated: number;
  flagged: string[];
};

/** Normalized-name key; the same canonicalizer the login derives from. */
function nameKey(fullName: string): string {
  return memberLoginEmail(fullName) ?? fullName.trim().toLowerCase();
}

/** The member columns the sync reads and reconciles. */
type MemberRow = {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
  email: string | null;
  in_sheet: boolean;
  sheet_paid: string | null;
  sheet_payment_type: string | null;
  sheet_policy: string | null;
  sheet_photos: string | null;
  sheet_comments: string | null;
};

/**
 * Mirror the sheet into `public.members`: update matched members (status +
 * sheet fields, email fill-if-missing), insert unmatched rows as kiosk-only
 * members, and clear `in_sheet` on members that dropped off the sheet.
 * Only rows that actually changed are written, so a routine sync is one read
 * and zero-to-few writes.
 */
export async function syncMembersSheet(): Promise<MembersSheetSyncResult> {
  const { tab, grid } = await fetchSheet();
  const { rows, flagged } = parseGrid(grid);

  const admin = createAdminClient();
  const { data: memberData, error: membersError } = await admin
    .from("members")
    .select(
      "id, full_name, role, active, email, in_sheet, sheet_paid, sheet_payment_type, sheet_policy, sheet_photos, sheet_comments",
    );
  if (membersError) throw new Error(`Members read failed: ${membersError.message}`);
  const members = (memberData ?? []) as MemberRow[];

  // Only real members participate; the shared officer logins are never
  // touched (a sheet row must not deactivate an officer account).
  const candidates = members.filter((m) => m.role === "member");
  const byEmail = new Map<string, MemberRow>();
  const byName = new Map<string, MemberRow>();
  for (const m of candidates) {
    if (m.email) byEmail.set(m.email.toLowerCase(), m);
    const key = nameKey(m.full_name);
    // First name-key wins; a duplicate would make matching ambiguous.
    if (!byName.has(key)) byName.set(key, m);
  }

  // Every email currently on any member (officers included) — the partial
  // unique index on lower(email) means we must not hand out a taken address.
  const takenEmails = new Set(
    members.filter((m) => m.email).map((m) => m.email!.toLowerCase()),
  );

  const seenEmails = new Set<string>();
  const seenNames = new Set<string>();
  const matchedIds = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  let updated = 0;

  for (const row of rows) {
    // Duplicate sheet rows would fight over one member — first one wins.
    const nKey = nameKey(row.name);
    if ((row.email && seenEmails.has(row.email)) || seenNames.has(nKey)) {
      flagged.push(`${row.name}: duplicate sheet row skipped.`);
      continue;
    }
    if (row.email) seenEmails.add(row.email);
    seenNames.add(nKey);

    const match =
      (row.email ? byEmail.get(row.email) : undefined) ?? byName.get(nKey);

    if (!match) {
      inserts.push({
        full_name: row.name,
        email: row.email && !takenEmails.has(row.email) ? row.email : null,
        active: row.active,
        in_sheet: true,
        sheet_paid: row.paid,
        sheet_payment_type: row.paymentType,
        sheet_policy: row.policy,
        sheet_photos: row.photos,
        sheet_comments: row.comments,
      });
      if (row.email) takenEmails.add(row.email);
      continue;
    }

    matchedIds.add(match.id);

    const patch: Record<string, unknown> = {};
    if (match.active !== row.active) patch.active = row.active;
    if (!match.in_sheet) patch.in_sheet = true;
    if (match.sheet_paid !== row.paid) patch.sheet_paid = row.paid;
    if (match.sheet_payment_type !== row.paymentType) {
      patch.sheet_payment_type = row.paymentType;
    }
    if (match.sheet_policy !== row.policy) patch.sheet_policy = row.policy;
    if (match.sheet_photos !== row.photos) patch.sheet_photos = row.photos;
    if (match.sheet_comments !== row.comments) patch.sheet_comments = row.comments;

    // The sheet only fills a MISSING email — a member-chosen alias is their
    // login/recovery address and must survive the sync.
    if (row.email && !match.email && !takenEmails.has(row.email)) {
      patch.email = row.email;
      takenEmails.add(row.email);
    } else if (
      row.email &&
      match.email &&
      match.email.toLowerCase() !== row.email
    ) {
      flagged.push(
        `${row.name}: sheet email differs from the one on their account (kept the account's).`,
      );
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from("members").update(patch).eq("id", match.id);
      if (error) {
        flagged.push(`${row.name}: update failed (${error.message}).`);
      } else {
        updated += 1;
      }
    }
  }

  let created = 0;
  if (inserts.length > 0) {
    const { error } = await admin.from("members").insert(inserts);
    if (error) {
      // Most likely one bad row (e.g. an email race on the unique index) —
      // retry one-by-one so the rest still lands.
      for (const insert of inserts) {
        const { error: rowError } = await admin.from("members").insert(insert);
        if (rowError) {
          flagged.push(`${insert.full_name}: import failed (${rowError.message}).`);
        } else {
          created += 1;
        }
      }
    } else {
      created = inserts.length;
    }
  }

  // Members that dropped off the sheet keep their status and history — they
  // just stop claiming to be sheet-backed.
  const dropped = candidates
    .filter((m) => m.in_sheet && !matchedIds.has(m.id))
    .map((m) => m.id);
  if (dropped.length > 0) {
    const { error } = await admin
      .from("members")
      .update({ in_sheet: false })
      .in("id", dropped);
    if (error) flagged.push(`Couldn't clear ${dropped.length} dropped rows: ${error.message}`);
  }

  const result: MembersSheetSyncResult = {
    tab,
    totalRows: rows.length,
    matched: matchedIds.size,
    created,
    updated,
    flagged: flagged.slice(0, 40),
  };

  await admin.from("sync_state").upsert(
    {
      key: SYNC_STATE_KEY,
      last_synced_at: new Date().toISOString(),
      detail: result,
    },
    { onConflict: "key" },
  );

  return result;
}

/** Key for the sync marker row in `public.sync_state`. */
const SYNC_STATE_KEY = "members_sheet";

/**
 * On-demand pull throttle, same shape as the calendar's: at most one sheet
 * fetch per window per deployment, claimed optimistically so simultaneous
 * page loads skip. Membership changes slowly, so the window is wider than
 * the calendar's 60s.
 */
const THROTTLE_MS = 5 * 60_000;

/** Entry point for the officer members page. */
export async function syncMembersSheetThrottled(): Promise<
  { ran: false } | ({ ran: true } & MembersSheetSyncResult)
> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("sync_state")
    .select("last_synced_at")
    .eq("key", SYNC_STATE_KEY)
    .maybeSingle();

  const last = data?.last_synced_at ? new Date(data.last_synced_at).getTime() : 0;
  if (Date.now() - last < THROTTLE_MS) return { ran: false };

  await admin
    .from("sync_state")
    .upsert(
      { key: SYNC_STATE_KEY, last_synced_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  const result = await syncMembersSheet();
  return { ran: true, ...result };
}

/** Last-run summary for the officers page (null until the first sync). */
export async function membersSheetSyncStatus(): Promise<
  (MembersSheetSyncResult & { syncedAt: string }) | null
> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sync_state")
    .select("last_synced_at, detail")
    .eq("key", SYNC_STATE_KEY)
    .maybeSingle();
  if (!data?.detail) return null;
  return {
    ...(data.detail as MembersSheetSyncResult),
    syncedAt: data.last_synced_at,
  };
}

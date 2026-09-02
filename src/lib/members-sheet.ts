/**
 * Member roster sync. The studio's private "LACC Member session sign-ups/fees"
 * Google sheet is the source of truth for who the members are and whether
 * they're active this session; we mirror it into `members` so the officer
 * roster, announcement emails, and the kiosk all reflect it. Changes members
 * make IN the app flow back the other way — same tab, same columns, only the
 * cells the app owns — so the board's sheet stays current without anyone
 * re-typing.
 *
 * Freshness mirrors the calendar sync: the officer members page calls
 * `syncMembersSheetThrottled()` on load, a once-daily Vercel Cron hit to
 * app/api/members-sync is the backstop (Hobby caps cron at once per day), and
 * the account/signup server actions fire `requestMembersSheetSync()` through
 * Next's `after()` so app-side edits reach the sheet within seconds.
 *
 * The sheet is private (it holds every member's email), so requests
 * authenticate as a Google SERVICE ACCOUNT the sheet is shared with (as an
 * Editor) — a signed JWT is exchanged for a short-lived access token, no
 * OAuth consent and no SDK.
 *
 * Sync rules (locked in with the user 2026-07-14; write-back 2026-07-15):
 * - Reads (and writes) ONE tab, the one the officers picked on the members
 *   page — the board opens a fresh tab each trimester, so the roster has to
 *   be pointed at the current one. Until somebody picks, it's the leftmost
 *   visible tab, as it always was. The page names the tab in use and says so
 *   when the sheet holds others, because a sync quietly mirroring last
 *   trimester looks exactly like a sync that is working.
 * - Sheet rows are matched to members by email first, then by the remembered
 *   sheet-row name (`sheet_name`), then by normalized full name. Unmatched
 *   rows become kiosk-only members (no account).
 * - The sheet WINS on active/inactive and the bookkeeping columns (paid,
 *   payment type, policy, photos, comments) — in-app status edits for synced
 *   members last only until the next sync.
 * - The APP wins on identity: names are tied to logins, and account holders
 *   manage their own email, so app-side renames and email changes are written
 *   back into the row's existing cells. Kiosk-only members have no login —
 *   their email stays board-managed in the sheet (the app only fills a blank
 *   cell for them, never overwrites one).
 * - Members who join through the app (signup or officer-added) are appended
 *   as new rows above the sheet's "Total" summary row, with only the name,
 *   email, and Active cells filled — the board's bookkeeping columns stay
 *   theirs. `sheet_name` records which row a member is bound to and doubles
 *   as a tombstone: a member whose row the board deleted is never re-added.
 * - The app never renames a member FROM the sheet and never deletes anyone —
 *   dropped rows just lose `in_sheet`, and app-side deletions leave the sheet
 *   untouched.
 */

import { createAdminClient } from "./supabase/admin";
import { memberLoginEmail } from "./roles";
import {
  SHEETS_API,
  SHEETS_READWRITE_SCOPE,
  googleAccessToken,
  serviceAccountConfigured,
} from "./google-service-account";

/** True when the env vars the sync needs are all present. */
export function membersSheetConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MEMBERS_SHEET_ID) && serviceAccountConfigured();
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const sheetId = process.env.GOOGLE_MEMBERS_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_MEMBERS_SHEET_ID must be set.");
  const res = await fetch(`${SHEETS_API}/${sheetId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await googleAccessToken(SHEETS_READWRITE_SCOPE)}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Sheets ${path.split("?")[0] || "get"} ${res.status}: ${body.slice(0, 300)}`,
    );
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

/** One cleaned, usable sheet row. */
export type SheetRow = {
  /** 0-based row index in the tab's grid (A1 row minus one). */
  gridRow: number;
  name: string;
  /** Lowercased valid address, or null when the cell is empty or malformed. */
  email: string | null;
  /** True when the email cell holds ANYTHING — even an invalid address. */
  hasEmailCell: boolean;
  active: boolean;
  paid: string | null;
  paymentType: string | null;
  policy: string | null;
  photos: string | null;
  comments: string | null;
};

/** Column indexes located from the header row (-1 = column not present). */
export type SheetCols = {
  name: number;
  email: number;
  active: number;
  paid: number;
  paymentType: number;
  comments: number;
  policy: number;
  photos: number;
};

export type ParsedSheet = {
  rows: SheetRow[];
  cols: SheetCols;
  /** Grid row where appended members go — above the "Total" summary row. */
  insertAt: number;
  flagged: string[];
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

/**
 * The roster sheet's visible tabs, left to right. The board files each
 * trimester as a new tab, so this is also the officers' menu of rosters.
 */
export async function listRosterTabs(): Promise<string[]> {
  const meta = (await sheetsFetch(
    "?fields=sheets(properties(sheetId,title,index,hidden))",
  )) as {
    sheets?: {
      properties?: { sheetId?: number; title?: string; index?: number; hidden?: boolean };
    }[];
  };
  return (meta.sheets ?? [])
    .map((s) => s.properties ?? {})
    .filter((p) => !p.hidden && p.title)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => p.title!);
}

/**
 * Read the tab the officers chose, falling back to the leftmost visible one
 * until somebody chooses (and again, loudly, if a chosen tab disappears —
 * syncing the wrong roster in silence is how a whole trimester went stale).
 */
async function fetchSheet(): Promise<{
  tab: string;
  tabSheetId: number;
  tabs: string[];
  grid: string[][];
  flagged: string[];
}> {
  const meta = (await sheetsFetch(
    "?fields=sheets(properties(sheetId,title,index,hidden))",
  )) as {
    sheets?: {
      properties?: { sheetId?: number; title?: string; index?: number; hidden?: boolean };
    }[];
  };
  const tabs = (meta.sheets ?? [])
    .map((s) => s.properties ?? {})
    .filter((p) => !p.hidden && p.title)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (tabs.length === 0) throw new Error("The roster sheet has no visible tabs.");

  const flagged: string[] = [];
  const chosen = await selectedRosterTab();
  let picked = chosen ? tabs.find((p) => p.title === chosen) : undefined;
  if (chosen && !picked) {
    flagged.push(
      `The chosen sheet tab "${chosen}" is gone (renamed or deleted) — read "${tabs[0].title}" instead. Pick the right tab on this page.`,
    );
  }
  picked ??= tabs[0];
  const tab = picked.title!;

  const values = (await sheetsFetch(
    `/values/${encodeURIComponent(`${a1Tab(tab)}!A1:Z`)}?majorDimension=ROWS`,
  )) as { values?: string[][] };
  return {
    tab,
    tabSheetId: picked.sheetId ?? 0,
    tabs: tabs.map((p) => p.title!),
    grid: values.values ?? [],
    flagged,
  };
}

/** Single-quote a tab title for an A1 range; literal quotes double up. */
function a1Tab(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** 0-based column index → A1 letters (0 → A, 26 → AA). */
function colLetter(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
  }
  return letters;
}

/**
 * Turn the raw grid into rows, locating columns from the header text so the
 * sheet survives reordering and per-trimester renames ("Paid for May-Aug26?").
 * Exported for the reconcile tests.
 */
export function parseGrid(grid: string[][]): ParsedSheet {
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
  const cols: SheetCols = {
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
  let insertAt = grid.length;
  for (let gridRow = headerIdx + 1; gridRow < grid.length; gridRow += 1) {
    const raw = grid[gridRow];
    const name = clean(raw[cols.name]);
    if (!name) continue;
    // Summary rows like "Total Active" live in the same column as names;
    // appended members slot in above the first one.
    if (/^total\b/i.test(name)) {
      insertAt = Math.min(insertAt, gridRow);
      continue;
    }

    const rawEmail = clean(raw[cols.email]);
    const email = cleanEmail(raw[cols.email]);
    if (rawEmail && !email) {
      flagged.push(`${name}: sheet email "${rawEmail}" looks invalid — not imported.`);
    }

    const cell = (index: number) =>
      index === -1 ? null : clean(raw[index]) || null;

    rows.push({
      gridRow,
      name,
      email,
      hasEmailCell: Boolean(rawEmail),
      active: /^y/i.test(clean(cols.active === -1 ? "" : raw[cols.active])),
      paid: cell(cols.paid),
      paymentType: cell(cols.paymentType),
      policy: cell(cols.policy),
      photos: cell(cols.photos),
      comments: cell(cols.comments),
    });
  }
  return { rows, cols, insertAt, flagged };
}

// ---------------------------------------------------------------------------
// Reconcile — pure planning, no I/O
// ---------------------------------------------------------------------------

/** Normalized-name key; the same canonicalizer the login derives from. */
function nameKey(fullName: string): string {
  return memberLoginEmail(fullName) ?? fullName.trim().toLowerCase();
}

/** The member columns the sync reads and reconciles. */
export type MemberRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  role: string;
  active: boolean;
  email: string | null;
  in_sheet: boolean;
  sheet_name: string | null;
  sheet_paid: string | null;
  sheet_payment_type: string | null;
  sheet_policy: string | null;
  sheet_photos: string | null;
  sheet_comments: string | null;
};

/** One cell the app writes back into an existing sheet row. */
export type SheetCellWrite = { gridRow: number; col: number; value: string };

/** One new sheet row for a member the sheet has never listed. */
export type SheetAppend = {
  memberId: string;
  name: string;
  /** Sparse A-to-widest cells; null cells are skipped by the Sheets API. */
  cells: (string | null)[];
};

export type SyncPlan = {
  /** Sheet→app updates, applied unconditionally. */
  memberPatches: { id: string; name: string; patch: Record<string, unknown> }[];
  /** Applied only after the cell write-back lands (rename bookkeeping). */
  postPushPatches: { id: string; patch: Record<string, unknown> }[];
  /** New kiosk-only members imported from unmatched sheet rows. */
  inserts: Record<string, unknown>[];
  /** Members that dropped off the sheet — clear `in_sheet`. */
  droppedIds: string[];
  cellWrites: SheetCellWrite[];
  appends: SheetAppend[];
  matched: number;
  pushedEmails: number;
  pushedNames: number;
  flagged: string[];
};

/**
 * Diff the sheet against the members table in BOTH directions. Pure function
 * over the parsed grid and member rows (exported for tests): the sheet keeps
 * membership/bookkeeping, the app keeps identity, and anything neither side
 * has seen before crosses over. Only actual differences produce writes, so a
 * routine sync plans zero of them.
 */
export function reconcile(parsed: ParsedSheet, members: MemberRow[]): SyncPlan {
  const flagged: string[] = [];

  // Only real members participate; the shared officer logins are never
  // touched (a sheet row must not deactivate an officer account).
  const candidates = members.filter((m) => m.role === "member");
  const byEmail = new Map<string, MemberRow>();
  const bySheetName = new Map<string, MemberRow>();
  const byName = new Map<string, MemberRow>();
  for (const m of candidates) {
    if (m.email) byEmail.set(m.email.toLowerCase(), m);
    if (m.sheet_name) {
      const key = nameKey(m.sheet_name);
      if (!bySheetName.has(key)) bySheetName.set(key, m);
    }
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
  const memberPatches: SyncPlan["memberPatches"] = [];
  const postPushPatches: SyncPlan["postPushPatches"] = [];
  const inserts: Record<string, unknown>[] = [];
  const cellWrites: SheetCellWrite[] = [];
  let pushedEmails = 0;
  let pushedNames = 0;

  for (const row of parsed.rows) {
    // Duplicate sheet rows would fight over one member — first one wins.
    const nKey = nameKey(row.name);
    if ((row.email && seenEmails.has(row.email)) || seenNames.has(nKey)) {
      flagged.push(`${row.name}: duplicate sheet row skipped.`);
      continue;
    }
    if (row.email) seenEmails.add(row.email);
    seenNames.add(nKey);

    const match =
      (row.email ? byEmail.get(row.email) : undefined) ??
      bySheetName.get(nKey) ??
      byName.get(nKey);

    if (!match) {
      inserts.push({
        full_name: row.name,
        email: row.email && !takenEmails.has(row.email) ? row.email : null,
        active: row.active,
        in_sheet: true,
        sheet_name: row.name,
        sheet_paid: row.paid,
        sheet_payment_type: row.paymentType,
        sheet_policy: row.policy,
        sheet_photos: row.photos,
        sheet_comments: row.comments,
      });
      if (row.email) takenEmails.add(row.email);
      continue;
    }
    if (matchedIds.has(match.id)) {
      flagged.push(`${row.name}: another sheet row already matched this member — skipped.`);
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

    // Names: the app wins — they're tied to logins. The remembered sheet_name
    // tells us which side moved: if the row still shows the last agreed name,
    // the rename happened in the app and belongs on the sheet; if the app
    // still shows it, the board renamed the row and we just re-bind (a sheet
    // edit must not rename someone's login).
    const appName = clean(match.full_name);
    const bound = match.sheet_name ? clean(match.sheet_name) : null;
    if (appName !== row.name && bound) {
      if (row.name === bound || appName !== bound) {
        cellWrites.push({ gridRow: row.gridRow, col: parsed.cols.name, value: appName });
        pushedNames += 1;
        if (bound !== appName) {
          postPushPatches.push({ id: match.id, patch: { sheet_name: appName } });
        }
        if (row.name !== bound) {
          flagged.push(
            `${row.name}: renamed on both sides — kept the account's name "${appName}".`,
          );
        }
      } else {
        flagged.push(
          `${appName}: the sheet renamed their row to "${row.name}" — names are logins, so rename them in the app if it should change.`,
        );
        patch.sheet_name = row.name;
      }
    } else if ((match.sheet_name ?? null) !== row.name) {
      patch.sheet_name = row.name;
    }

    // Emails: account holders manage their own (app wins, including fixing an
    // invalid cell); kiosk-only members are board-managed in the sheet (sheet
    // wins, and the app only fills a truly EMPTY cell for them).
    const appEmail = match.email ? match.email.toLowerCase() : null;
    if (match.user_id) {
      if (appEmail && appEmail !== row.email) {
        cellWrites.push({ gridRow: row.gridRow, col: parsed.cols.email, value: appEmail });
        pushedEmails += 1;
        if (row.email) {
          flagged.push(`${row.name}: sheet email replaced with the account's (${appEmail}).`);
        }
      } else if (!appEmail && row.email && !takenEmails.has(row.email)) {
        patch.email = row.email;
        takenEmails.add(row.email);
      }
    } else if (row.email && row.email !== appEmail) {
      if (takenEmails.has(row.email)) {
        flagged.push(`${row.name}: sheet email is already on another account — not imported.`);
      } else {
        patch.email = row.email;
        takenEmails.add(row.email);
      }
    } else if (!row.hasEmailCell && appEmail) {
      cellWrites.push({ gridRow: row.gridRow, col: parsed.cols.email, value: appEmail });
      pushedEmails += 1;
    }

    if (Object.keys(patch).length > 0) {
      memberPatches.push({ id: match.id, name: row.name, patch });
    }
  }

  // Members that dropped off the sheet keep their status and history — they
  // just stop claiming to be sheet-backed.
  const droppedIds = candidates
    .filter((m) => m.in_sheet && !matchedIds.has(m.id))
    .map((m) => m.id);

  // Members the sheet has never listed (sheet_name null) become new rows.
  // A set sheet_name with no matching row means the board DELETED the row —
  // that's a decision, not an omission, so they are never re-added.
  const width = Math.max(parsed.cols.name, parsed.cols.email, parsed.cols.active) + 1;
  const appends: SheetAppend[] = candidates
    .filter((m) => !matchedIds.has(m.id) && !m.sheet_name)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((m) => {
      const cells: (string | null)[] = new Array(width).fill(null);
      cells[parsed.cols.name] = clean(m.full_name);
      if (m.email) cells[parsed.cols.email] = m.email.toLowerCase();
      if (parsed.cols.active !== -1 && m.active) cells[parsed.cols.active] = "Y";
      return { memberId: m.id, name: clean(m.full_name), cells };
    });

  return {
    memberPatches,
    postPushPatches,
    inserts,
    droppedIds,
    cellWrites,
    appends,
    matched: matchedIds.size,
    pushedEmails,
    pushedNames,
    flagged,
  };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type MembersSheetSyncResult = {
  tab: string;
  /** Every visible tab, left to right (absent on results from before the picker). */
  tabs?: string[];
  totalRows: number;
  matched: number;
  created: number;
  updated: number;
  /** App→sheet write-back counts (absent on results from before the feature). */
  pushed?: { emails: number; names: number; added: number };
  flagged: string[];
};

/**
 * Mirror the sheet into `public.members` and the app's own changes back into
 * the sheet (see the module docs for who wins what). Only rows that actually
 * changed are written on either side, so a routine sync is one read and
 * zero-to-few writes. A Google failure on the write-back half is reported in
 * `flagged` but never takes the pull down with it.
 */
export async function syncMembersSheet(): Promise<MembersSheetSyncResult> {
  // Everything the app holds at this instant is covered by this sync; the
  // watermark below tells requestMembersSheetSync whether an edit made it in.
  const dataAsOf = new Date().toISOString();

  const { tab, tabSheetId, tabs, grid, flagged: tabFlags } = await fetchSheet();
  const parsed = parseGrid(grid);

  const admin = createAdminClient();
  const { data: memberData, error: membersError } = await admin
    .from("members")
    .select(
      "id, user_id, full_name, role, active, email, in_sheet, sheet_name, sheet_paid, sheet_payment_type, sheet_policy, sheet_photos, sheet_comments",
    );
  if (membersError) throw new Error(`Members read failed: ${membersError.message}`);

  const plan = reconcile(parsed, (memberData ?? []) as MemberRow[]);
  const flagged = [...tabFlags, ...parsed.flagged, ...plan.flagged];

  let updated = 0;
  for (const { id, name, patch } of plan.memberPatches) {
    const { error } = await admin.from("members").update(patch).eq("id", id);
    if (error) {
      flagged.push(`${name}: update failed (${error.message}).`);
    } else {
      updated += 1;
    }
  }

  let created = 0;
  if (plan.inserts.length > 0) {
    const { error } = await admin.from("members").insert(plan.inserts);
    if (error) {
      // Most likely one bad row (e.g. an email race on the unique index) —
      // retry one-by-one so the rest still lands.
      for (const insert of plan.inserts) {
        const { error: rowError } = await admin.from("members").insert(insert);
        if (rowError) {
          flagged.push(`${insert.full_name}: import failed (${rowError.message}).`);
        } else {
          created += 1;
        }
      }
    } else {
      created = plan.inserts.length;
    }
  }

  if (plan.droppedIds.length > 0) {
    const { error } = await admin
      .from("members")
      .update({ in_sheet: false })
      .in("id", plan.droppedIds);
    if (error) {
      flagged.push(`Couldn't clear ${plan.droppedIds.length} dropped rows: ${error.message}`);
    }
  }

  // --- Write-back: cell fixes for existing rows ---
  const pushed = { emails: 0, names: 0, added: 0 };
  if (plan.cellWrites.length > 0) {
    try {
      await sheetsFetch("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: plan.cellWrites.map((w) => ({
            range: `${a1Tab(tab)}!${colLetter(w.col)}${w.gridRow + 1}`,
            values: [[w.value]],
          })),
        }),
      });
      pushed.emails = plan.pushedEmails;
      pushed.names = plan.pushedNames;
      for (const { id, patch } of plan.postPushPatches) {
        await admin.from("members").update(patch).eq("id", id);
      }
    } catch (error) {
      flagged.push(
        `Couldn't write ${plan.cellWrites.length} change(s) back to the sheet: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // --- Write-back: new rows for members the sheet has never listed ---
  // Claiming sheet_name FIRST (compare-and-set on null) makes concurrent
  // syncs on other instances skip the same member instead of double-adding
  // them; a failed sheet write reverts the claim so the append retries later.
  if (plan.appends.length > 0) {
    const claimed: SheetAppend[] = [];
    for (const append of plan.appends) {
      const { data, error } = await admin
        .from("members")
        .update({ sheet_name: append.name, in_sheet: true })
        .eq("id", append.memberId)
        .is("sheet_name", null)
        .select("id");
      if (!error && (data?.length ?? 0) > 0) claimed.push(append);
    }
    if (claimed.length > 0) {
      try {
        await sheetsFetch(":batchUpdate", {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                insertDimension: {
                  range: {
                    sheetId: tabSheetId,
                    dimension: "ROWS",
                    startIndex: parsed.insertAt,
                    endIndex: parsed.insertAt + claimed.length,
                  },
                  inheritFromBefore: true,
                },
              },
            ],
          }),
        });
        await sheetsFetch("/values:batchUpdate", {
          method: "POST",
          body: JSON.stringify({
            valueInputOption: "RAW",
            data: [
              {
                range: `${a1Tab(tab)}!A${parsed.insertAt + 1}`,
                values: claimed.map((a) => a.cells),
              },
            ],
          }),
        });
        pushed.added = claimed.length;
      } catch (error) {
        await admin
          .from("members")
          .update({ sheet_name: null, in_sheet: false })
          .in("id", claimed.map((a) => a.memberId));
        flagged.push(
          `Couldn't add ${claimed.length} member(s) to the sheet: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  const result: MembersSheetSyncResult = {
    tab,
    tabs,
    totalRows: parsed.rows.length,
    matched: plan.matched,
    created,
    updated,
    pushed,
    flagged: flagged.slice(0, 40),
  };

  // last_synced_at is the sync's data-as-of instant (its coverage point),
  // not its completion time — requestMembersSheetSync compares against it.
  await admin.from("sync_state").upsert(
    {
      key: SYNC_STATE_KEY,
      last_synced_at: dataAsOf,
      detail: result,
    },
    { onConflict: "key" },
  );

  return result;
}

/** Key for the sync marker row in `public.sync_state`. */
const SYNC_STATE_KEY = "members_sheet";

/** Key for the chosen-tab row — the sync's other piece of state. */
const TAB_STATE_KEY = "members_sheet_tab";

/**
 * Which tab the officers pointed the roster at, or null while nobody has
 * chosen (the leftmost visible tab, as it always was). The board opens a new
 * tab each trimester, so this is what keeps the app on the current one.
 */
export async function selectedRosterTab(): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sync_state")
    .select("detail")
    .eq("key", TAB_STATE_KEY)
    .maybeSingle();
  const tab = (data?.detail as { tab?: unknown } | null)?.tab;
  return typeof tab === "string" && tab ? tab : null;
}

/** Point the roster at a tab (null hands it back to the leftmost visible one). */
export async function setSelectedRosterTab(tab: string | null): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("sync_state").upsert(
    {
      key: TAB_STATE_KEY,
      last_synced_at: new Date().toISOString(),
      detail: tab ? { tab } : null,
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(`Couldn't save the tab choice: ${error.message}`);
}

/**
 * Sync right now, ignoring the page-load throttle — for the moment an officer
 * switches tabs and wants to see the new roster, not wait out the window.
 */
export async function syncMembersSheetNow(): Promise<MembersSheetSyncResult> {
  return runCoalesced();
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * Per-instance coalescing: one sync in flight at a time, and any number of
 * requests arriving meanwhile share a single follow-up run (whose reads will
 * see all their writes).
 */
let current: Promise<MembersSheetSyncResult> | null = null;
let queued: Promise<MembersSheetSyncResult> | null = null;

function runCoalesced(): Promise<MembersSheetSyncResult> {
  if (current) {
    queued ??= current
      .catch(() => {})
      .then(() => {
        queued = null;
        return runCoalesced();
      });
    return queued;
  }
  current = syncMembersSheet().finally(() => {
    current = null;
  });
  return current;
}

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

  const result = await runCoalesced();
  return { ran: true, ...result };
}

/**
 * Fire-and-forget entry point for the account/signup server actions, called
 * via `after()` once the DB write has committed — an email change, rename, or
 * new member reaches the sheet in seconds instead of waiting for the daily
 * cron. Skips only when some sync's data-as-of watermark already postdates
 * this call (that sync saw the caller's write). Never throws.
 */
export async function requestMembersSheetSync(): Promise<void> {
  if (!membersSheetConfigured()) return;
  const eventAt = Date.now();
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("sync_state")
      .select("last_synced_at")
      .eq("key", SYNC_STATE_KEY)
      .maybeSingle();
    const coveredTo = data?.last_synced_at
      ? new Date(data.last_synced_at).getTime()
      : 0;
    if (coveredTo >= eventAt) return;
    await runCoalesced();
  } catch (error) {
    console.error("[members-sheet]", error);
  }
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

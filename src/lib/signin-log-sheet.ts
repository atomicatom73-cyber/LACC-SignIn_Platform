/**
 * Sign-in log export. Mirrors the three sign-in tables (member shifts, guest
 * sign-ins, student sign-ins) into a dedicated Google sheet the board can
 * read without opening the app — one tab per studio-local month, newest tab
 * first, rewritten in full on every export.
 *
 * A full rewrite (not append) is deliberate: sign-outs update rows that were
 * already exported, and deleting a member cascades away their history. Wiping
 * and rewriting the month tabs makes the sheet a faithful snapshot no matter
 * what changed, and makes concurrent exports harmless — they all write the
 * same thing.
 *
 * Freshness: every sign-in/out server action fires `requestSigninLogExport()`
 * through Next's `after()`, so the sheet trails the kiosk by seconds without
 * slowing it down. A watermark in `sync_state` (last export's data-as-of
 * instant) skips runs another instance already covered, and an in-memory
 * queue coalesces bursts within one instance — a class signing in produces a
 * couple of exports, not twenty. The daily members-sync cron re-exports as a
 * backstop (Vercel Hobby allows only two crons, both taken).
 *
 * The destination sheet is the service account's to write (shared as Editor);
 * `GOOGLE_SIGNIN_LOG_SHEET_ID` names it. Officer edits made directly in the
 * sheet WILL be overwritten — the app is the source of truth here, the
 * opposite of the roster sync.
 */

import { createAdminClient } from "./supabase/admin";
import {
  SHEETS_API,
  SHEETS_READWRITE_SCOPE,
  googleAccessToken,
  serviceAccountConfigured,
} from "./google-service-account";
import {
  STUDIO_TZ,
  formatStudioClock,
  monthLabel,
  studioDayKey,
} from "./studio";

const SYNC_STATE_KEY = "signin_log_sheet";

export function signinLogSheetConfigured(): boolean {
  return (
    Boolean(process.env.GOOGLE_SIGNIN_LOG_SHEET_ID) && serviceAccountConfigured()
  );
}

/** Where the export lands, for the officers page link. */
export function signinLogSheetUrl(): string | null {
  const id = process.env.GOOGLE_SIGNIN_LOG_SHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : null;
}

// ---------------------------------------------------------------------------
// Read the sign-in tables
// ---------------------------------------------------------------------------

type ShiftRow = {
  signed_in_at: string;
  signed_out_at: string | null;
  source: string;
  members: { full_name: string } | null;
};
type GuestRow = {
  guest_name: string;
  signed_in_at: string;
  signed_out_at: string | null;
  members: { full_name: string } | null;
};
type StudentRow = {
  student_name: string;
  class_label: string;
  session_type: "class" | "open_studio";
  signed_in_at: string;
  signed_out_at: string | null;
};

/**
 * Page through a query in 1000-row chunks — Supabase caps a single select at
 * 1000 rows, and a full mirror needs all of history.
 */
async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

// ---------------------------------------------------------------------------
// Shape rows into month tabs
// ---------------------------------------------------------------------------

const HEADER = [
  "Date",
  "Day",
  "Time in",
  "Time out",
  "Name",
  "Type",
  "Details",
  "Signed in via",
];

type LogCells = string[];

function studioWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: STUDIO_TZ,
    weekday: "short",
  });
}

function toCells(entry: {
  at: string;
  out: string | null;
  name: string;
  type: "Member" | "Guest" | "Student";
  details: string;
  source: string;
}): LogCells {
  return [
    studioDayKey(entry.at),
    studioWeekday(entry.at),
    formatStudioClock(entry.at),
    entry.out ? formatStudioClock(entry.out) : "",
    entry.name,
    entry.type,
    entry.details,
    entry.source,
  ];
}

/** Studio-local month key ("2026-07-01") for an instant — sortable. */
function entryMonthKey(iso: string): string {
  return `${studioDayKey(iso).slice(0, 7)}-01`;
}

/**
 * Deterministic Sheets tab id for a month key ("2026-07-01" → 202607).
 * Assigning ids ourselves lets one batchUpdate both create a tab and format
 * its header row.
 */
function tabId(month: string): number {
  return Number(month.slice(0, 7).replace("-", ""));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type SigninLogExportResult = {
  rows: number;
  months: number;
  createdTabs: string[];
};

async function sheetsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const sheetId = process.env.GOOGLE_SIGNIN_LOG_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SIGNIN_LOG_SHEET_ID must be set.");
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
    throw new Error(`Sheets ${path.split("?")[0] || "get"} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Single-quote a tab title for an A1 range; literal quotes double up. */
function a1Tab(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/**
 * Mirror all sign-in history into the log sheet. Reads everything, groups by
 * studio-local month, creates any missing month tabs (newest first, frozen
 * bold header), then clears and rewrites every month tab in two batched
 * calls — the request count stays flat no matter how many months exist.
 */
export async function exportSigninLogs(): Promise<SigninLogExportResult> {
  // Everything the DB holds at this instant is covered by this export; the
  // watermark below tells later requests whether their write made it in.
  const dataAsOf = new Date().toISOString();

  const admin = createAdminClient();
  const [shifts, guests, students] = await Promise.all([
    pageAll<ShiftRow>((from, to) =>
      admin
        .from("shifts")
        .select("signed_in_at, signed_out_at, source, members(full_name)")
        .order("signed_in_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    pageAll<GuestRow>((from, to) =>
      admin
        .from("guest_signins")
        .select("guest_name, signed_in_at, signed_out_at, members(full_name)")
        .order("signed_in_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    pageAll<StudentRow>((from, to) =>
      admin
        .from("student_signins")
        .select(
          "student_name, class_label, session_type, signed_in_at, signed_out_at",
        )
        .order("signed_in_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const entries = [
    ...shifts.map((s) => ({
      at: s.signed_in_at,
      out: s.signed_out_at,
      name: s.members?.full_name ?? "Unknown member",
      type: "Member" as const,
      details: "",
      source: s.source,
    })),
    ...guests.map((g) => ({
      at: g.signed_in_at,
      out: g.signed_out_at,
      name: g.guest_name,
      type: "Guest" as const,
      details: `Guest of ${g.members?.full_name ?? "unknown"}`,
      source: "",
    })),
    ...students.map((s) => ({
      at: s.signed_in_at,
      // Class students are presence-only; only open-studio visits sign out.
      out: s.session_type === "open_studio" ? s.signed_out_at : null,
      name: s.student_name,
      type: "Student" as const,
      // Open-studio rows carry the class the visit comes with; legacy rows
      // stored the literal "Open studio" and shouldn't double up.
      details:
        s.session_type === "open_studio"
          ? s.class_label && s.class_label !== "Open studio"
            ? `Open studio · ${s.class_label}`
            : "Open studio"
          : s.class_label,
      source: "",
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const byMonth = new Map<string, LogCells[]>();
  for (const entry of entries) {
    const month = entryMonthKey(entry.at);
    const list = byMonth.get(month) ?? [];
    list.push(toCells(entry));
    byMonth.set(month, list);
  }
  // Ascending month order; tabs are inserted at index 0 one after another,
  // which leaves the NEWEST month as the first tab.
  const months = [...byMonth.keys()].sort();

  const meta = (await sheetsFetch(
    "?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))",
  )) as {
    sheets?: {
      properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } };
    }[];
  };
  const existingTabs = (meta.sheets ?? [])
    .map((s) => s.properties ?? {})
    .filter((p) => p.title);
  const byTitle = new Map(existingTabs.map((p) => [p.title!, p]));
  const idsInUse = new Set(existingTabs.map((p) => p.sheetId));

  const structural: Record<string, unknown>[] = [];
  const createdTabs: string[] = [];
  for (const month of months) {
    const title = monthLabel(month);
    const rowsNeeded = byMonth.get(month)!.length + 1;
    const tab = byTitle.get(title);
    if (!tab) {
      // A renamed old tab could still hold this id — then let Google pick
      // one and skip the header bolding rather than fail the whole export.
      const id = idsInUse.has(tabId(month)) ? undefined : tabId(month);
      structural.push({
        addSheet: {
          properties: {
            ...(id === undefined ? {} : { sheetId: id }),
            title,
            index: 0,
            gridProperties: {
              rowCount: Math.max(1000, rowsNeeded + 200),
              columnCount: HEADER.length,
              frozenRowCount: 1,
            },
          },
        },
      });
      if (id !== undefined) {
        structural.push({
          repeatCell: {
            range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        });
      }
      createdTabs.push(title);
    } else if ((tab.gridProperties?.rowCount ?? 1000) < rowsNeeded) {
      // A busy month can outgrow the tab's grid; writes past it would fail.
      structural.push({
        updateSheetProperties: {
          properties: {
            sheetId: tab.sheetId,
            gridProperties: { rowCount: rowsNeeded + 200 },
          },
          fields: "gridProperties.rowCount",
        },
      });
    }
  }
  if (structural.length > 0) {
    await sheetsFetch(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: structural }),
    });
  }

  // Clear every tab we manage — including month tabs whose rows have since
  // vanished entirely (data wipe, member deletion) — then rewrite the ones
  // that still have data. A month tab is "ours" by title convention.
  const MONTH_TAB =
    /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;
  const liveTitles = new Set(months.map((m) => monthLabel(m)));
  const staleTitles = existingTabs
    .map((p) => p.title!)
    .filter((t) => MONTH_TAB.test(t) && !liveTitles.has(t));
  const clearTitles = [...staleTitles, ...liveTitles];
  if (clearTitles.length > 0) {
    await sheetsFetch("/values:batchClear", {
      method: "POST",
      body: JSON.stringify({
        ranges: clearTitles.map((t) => `${a1Tab(t)}!A:Z`),
      }),
    });
  }
  if (months.length > 0) {
    await sheetsFetch("/values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: months.map((m) => ({
          range: `${a1Tab(monthLabel(m))}!A1`,
          values: [HEADER, ...byMonth.get(m)!],
        })),
      }),
    });
  }

  const result: SigninLogExportResult = {
    rows: entries.length,
    months: months.length,
    createdTabs,
  };

  // last_synced_at is the export's data-as-of instant (its coverage point),
  // not its completion time — requestSigninLogExport compares against it.
  await admin.from("sync_state").upsert(
    {
      key: SYNC_STATE_KEY,
      last_synced_at: dataAsOf,
      detail: { ...result, finishedAt: new Date().toISOString() },
    },
    { onConflict: "key" },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * Per-instance coalescing: one export in flight at a time, and any number of
 * requests arriving meanwhile share a single follow-up run (whose DB read
 * will see all their writes).
 */
let current: Promise<void> | null = null;
let queued: Promise<void> | null = null;

function runCoalesced(): Promise<void> {
  if (current) {
    queued ??= current
      .catch(() => {})
      .then(() => {
        queued = null;
        return runCoalesced();
      });
    return queued;
  }
  current = exportSigninLogs()
    .then(() => undefined)
    .finally(() => {
      current = null;
    });
  return current;
}

/**
 * Fire-and-forget entry point for the sign-in/out server actions, called via
 * `after()` once the DB write has committed. Skips only when some export's
 * data-as-of watermark already postdates this call — meaning that export saw
 * the caller's write. Never throws (there's no response left to fail).
 */
export async function requestSigninLogExport(): Promise<void> {
  if (!signinLogSheetConfigured()) return;
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
    console.error("[signin-log-sheet]", error);
  }
}

/**
 * Freshness pass for the officer logs page (via `after()`, so the page never
 * waits on Google): re-export only if the last one is stale. Catches manual
 * DB fixes and member deletions that don't go through a sign-in action.
 */
const THROTTLE_MS = 5 * 60_000;

export async function exportSigninLogsThrottled(): Promise<void> {
  if (!signinLogSheetConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("sync_state")
      .select("last_synced_at")
      .eq("key", SYNC_STATE_KEY)
      .maybeSingle();
    const last = data?.last_synced_at ? new Date(data.last_synced_at).getTime() : 0;
    if (Date.now() - last < THROTTLE_MS) return;
    await runCoalesced();
  } catch (error) {
    console.error("[signin-log-sheet]", error);
  }
}

/** Last-run summary for the officers page (null until the first export). */
export async function signinLogSheetStatus(): Promise<
  (SigninLogExportResult & { syncedAt: string }) | null
> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sync_state")
    .select("last_synced_at, detail")
    .eq("key", SYNC_STATE_KEY)
    .maybeSingle();
  if (!data?.detail) return null;
  return {
    ...(data.detail as SigninLogExportResult),
    syncedAt: data.last_synced_at,
  };
}

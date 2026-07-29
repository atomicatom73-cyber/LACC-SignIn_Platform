/**
 * Offline sign-in queue for the kiosk tablet.
 *
 * The studio's wifi drops. When it does, a tap on the kiosk used to be thrown
 * away — the server action failed and the card snapped back. Now the tap is
 * written to IndexedDB first and replayed once the network returns, so the log
 * shows when someone actually walked in rather than when the wifi came back.
 *
 * Three things make the replay safe:
 *
 *  1. **Client-generated ids.** Every event id doubles as the `id` of the row
 *     it will insert (`shifts`, `guest_signins`, `student_signins` all have
 *     `uuid primary key`). Replaying an event that already landed hits the
 *     primary key and is recognized as a duplicate instead of double-inserting.
 *  2. **Explicit timestamps.** The queued event carries the moment of the tap,
 *     so the sync writes `signed_in_at` rather than letting Postgres default to
 *     `now()`. Corrected for tablet clock drift — see `rememberServerTime`.
 *  3. **Direction, not toggle.** An event says "in" or "out", never "flip".
 *     Replaying "in" twice is a no-op; replaying a toggle twice is a bug.
 *
 * IndexedDB (not localStorage) because a queued event is structured and the
 * writes have to survive the tab being killed mid-tap.
 */

const DB_NAME = "lacc-offline";
const DB_VERSION = 1;
const STORE = "events";
const SKEW_KEY = "lacc.clockSkewMs";
/** Queued events older than this are dropped unsynced rather than replayed. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type QueuedEvent =
  | {
      kind: "shift-in";
      id: string;
      at: string;
      memberId: string;
      memberName: string;
      /** Empty for members without a PIN. Verified server-side at sync. */
      pin: string;
    }
  | {
      kind: "shift-out";
      id: string;
      at: string;
      memberId: string;
      memberName: string;
      pin: string;
    }
  | {
      kind: "guest-in";
      id: string;
      at: string;
      hostMemberId: string;
      guestName: string;
    }
  | {
      kind: "student-in";
      id: string;
      at: string;
      studentName: string;
      classLabel: string;
      openStudio: boolean;
    }
  | {
      kind: "student-out";
      id: string;
      at: string;
      /** The `student_signins` row to close — may itself still be queued. */
      signinId: string;
      studentName: string;
    };

// ---------------------------------------------------------------------------
// The sync contract
//
// These live here rather than beside the server action because a "use server"
// module may only export async functions — a plain const in there silently
// invalidates every export in the file.
// ---------------------------------------------------------------------------

export type SyncStatus =
  /** Written to the database just now. */
  | "applied"
  /** Already on record from an earlier attempt — nothing left to do. */
  | "duplicate"
  /** Refused for good; retrying can't help. The client stops and surfaces it. */
  | "rejected"
  /** Failed for a reason that might not repeat. The client keeps it and retries. */
  | "retry";

export type SyncOutcome = { id: string; status: SyncStatus; reason?: string };

/** One call's worth of replay — the queue is drained in chunks this size. */
export const SYNC_BATCH_LIMIT = 100;

export type StoredEvent = QueuedEvent & {
  attempts: number;
  /** Last transient failure, kept for support/debugging. */
  lastError?: string;
  /** Set when the server refused the event for good (e.g. wrong PIN). */
  rejected?: string;
};

/** Who the event is about, for banners and toasts. */
export function eventSubject(event: QueuedEvent): string {
  switch (event.kind) {
    case "shift-in":
    case "shift-out":
      return event.memberName;
    case "guest-in":
      return event.guestName;
    case "student-in":
    case "student-out":
      return event.studentName;
  }
}

// ---------------------------------------------------------------------------
// Clock skew
// ---------------------------------------------------------------------------

/**
 * Record how far the tablet's clock is from the server's.
 *
 * An offline event's whole value is its timestamp, so a tablet whose clock has
 * drifted needs correcting before the tap is stamped. ClockSync measures this
 * against a live `/api/now` reading while the network is up; the delta is kept
 * and subtracted from every queued tap thereafter.
 *
 * `measuredAt` is the device time that the server's reading corresponds to — the
 * midpoint of the request, not "now". Using `Date.now()` here instead would fold
 * the whole round trip (or, from a cached page, the page's age) into the skew and
 * silently backdate everything.
 */
export function rememberServerTime(serverIso: string, measuredAt: number) {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server) || !Number.isFinite(measuredAt)) return;
  try {
    localStorage.setItem(SKEW_KEY, String(measuredAt - server));
  } catch {
    // Storage blocked — fall back to the raw device clock.
  }
}

function clockSkewMs(): number {
  try {
    const raw = Number(localStorage.getItem(SKEW_KEY));
    // Ignore absurd values; a wildly wrong skew is worse than none.
    return Number.isFinite(raw) && Math.abs(raw) < MAX_AGE_MS ? raw : 0;
  } catch {
    return 0;
  }
}

/** Now, in server time, as an ISO string — the timestamp for a queued tap. */
export function studioNowIso(): string {
  return new Date(Date.now() - clockSkewMs()).toISOString();
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function newEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Non-secure context (shouldn't happen in production, which is HTTPS).
    // Any v4-shaped string works — the server only needs it to be a unique uuid.
    const hex = "0123456789abcdef";
    let out = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
      else if (i === 14) out += "4";
      else out += hex[Math.floor(Math.random() * 16)];
    }
    return out;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    // Private browsing and some locked-down configurations reject outright.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE, mode);
          const req = run(transaction.objectStore(STORE));
          transaction.oncomplete = () => {
            db.close();
            resolve(req.result ?? null);
          };
          transaction.onerror = () => {
            db.close();
            resolve(null);
          };
          transaction.onabort = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      }),
  );
}

/**
 * Persist a tap. Resolves false when the queue is unavailable (private mode,
 * storage disabled) — callers must surface a real failure rather than a
 * reassuring "saved", since nothing was.
 */
export async function enqueue(event: QueuedEvent): Promise<boolean> {
  const stored: StoredEvent = { ...event, attempts: 0 };
  const ok = await tx("readwrite", (store) => store.put(stored));
  notify();
  // `put` resolves to the key, so a non-null result means it landed.
  return ok !== null;
}

/** Everything still waiting, oldest tap first — the order the sync replays in. */
export async function readQueue(): Promise<StoredEvent[]> {
  const all = (await tx<StoredEvent[]>("readonly", (store) =>
    store.getAll() as IDBRequest<StoredEvent[]>,
  )) as StoredEvent[] | null;
  if (!all) return [];

  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh: StoredEvent[] = [];
  const expired: string[] = [];
  for (const event of all) {
    if (Date.parse(event.at) < cutoff) expired.push(event.id);
    else fresh.push(event);
  }
  // A week-old tap is no longer worth writing into the log, and replaying one
  // would only confuse the sheet. Drop it rather than retry forever.
  if (expired.length) await dropEvents(expired);

  return fresh.sort((a, b) => a.at.localeCompare(b.at));
}

export async function readPending(): Promise<StoredEvent[]> {
  return (await readQueue()).filter((e) => !e.rejected);
}

export async function readRejected(): Promise<StoredEvent[]> {
  return (await readQueue()).filter((e) => e.rejected);
}

export async function dropEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        try {
          const transaction = db.transaction(STORE, "readwrite");
          const store = transaction.objectStore(STORE);
          for (const id of ids) store.delete(id);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            resolve();
          };
        } catch {
          db.close();
          resolve();
        }
      }),
  );
  notify();
}

/** Patch stored events in place — used to record attempts and rejections. */
export async function updateEvents(
  patches: { id: string; attempts?: number; lastError?: string; rejected?: string }[],
): Promise<void> {
  if (patches.length === 0) return;
  await openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        try {
          const transaction = db.transaction(STORE, "readwrite");
          const store = transaction.objectStore(STORE);
          for (const patch of patches) {
            const get = store.get(patch.id) as IDBRequest<StoredEvent | undefined>;
            get.onsuccess = () => {
              const existing = get.result;
              if (!existing) return;
              store.put({
                ...existing,
                attempts: patch.attempts ?? existing.attempts,
                lastError: patch.lastError ?? existing.lastError,
                rejected: patch.rejected ?? existing.rejected,
              });
            };
          }
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            resolve();
          };
        } catch {
          db.close();
          resolve();
        }
      }),
  );
  notify();
}

// ---------------------------------------------------------------------------
// Change notification
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function ensureChannel() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  try {
    channel = new BroadcastChannel("lacc-offline-queue");
    channel.onmessage = () => {
      for (const fn of listeners) fn();
    };
  } catch {
    channel = null;
  }
}

/** Re-render queue-aware UI after any change, in this tab and any other. */
function notify() {
  for (const fn of listeners) fn();
  ensureChannel();
  try {
    channel?.postMessage("changed");
  } catch {
    // Channel closed with the page — nothing to coordinate.
  }
}

export function subscribeToQueue(fn: () => void): () => void {
  listeners.add(fn);
  ensureChannel();
  return () => {
    listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * True when a server action failed because the request never made it, rather
 * than because the server said no.
 *
 * A server action that reaches the server returns its error as a value; only a
 * transport failure throws. `navigator.onLine` is unreliable on its own (a
 * captive portal reports online), so the throw is the real signal and the flag
 * is only used to skip a doomed attempt.
 */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

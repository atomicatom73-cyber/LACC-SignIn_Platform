/**
 * Service worker for the kiosk tablet's offline mode.
 *
 * Two jobs:
 *   1. Make the app installable (Chrome/Android won't fire the install prompt
 *      without a registered worker that has a fetch handler).
 *   2. Keep the kiosk sign-in screens loadable when the studio's wifi drops, so
 *      taps can be queued to IndexedDB and replayed later. See
 *      src/lib/offline-queue.ts for the replay half.
 *
 * Deliberately narrow, because a caching service worker on a live app is how
 * you ship stale code to a tablet nobody knows how to hard-refresh:
 *
 *   - Documents are **network-first**. Online, you always get the current
 *     build; the cache is only ever a fallback for a failed fetch.
 *   - `/_next/static/*` is cache-first because those filenames are
 *     content-hashed, so a hit is always the right bytes for that build.
 *   - POSTs are never touched. Server actions must fail fast when offline so
 *     the client knows to queue instead of hanging.
 *
 * The member dashboard (`/me`) is cached too, so a member whose phone has no
 * signal can still clock in — but it holds one person's data, and this same
 * worker runs on the shared studio tablet. So it gets stricter treatment than
 * the public kiosk screens: its own cache, dropped on logout by the page itself
 * (see lib/offline-cache.ts — messaging the worker races the navigation and
 * loses), and an offline copy is only served while it's still fresh, since an
 * offline hit bypasses the auth check in proxy.ts and a stale one must not linger.
 * `/me/door-codes`, `/me/inbox`, `/me/account` and everything under `/officer`
 * are never stored at all.
 *
 * It also answers Background Sync, so a phone that queued a sign-in and went
 * straight into a pocket still gets it into the log without the app being
 * reopened. See the `sync` handler at the bottom.
 *
 * Bump CACHE_VERSION to evict everything on the next deploy.
 */

const CACHE_VERSION = "v3";
const SHELL_CACHE = `lacc-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `lacc-static-${CACHE_VERSION}`;
const PRIVATE_CACHE = `lacc-private-${CACHE_VERSION}`;

/** Public sign-in surfaces — safe to cache and to precache on install. */
const OFFLINE_ROUTES = ["/kiosk", "/kiosk/guest", "/kiosk/student"];

/**
 * Signed-in pages worth having offline. Cached only once actually visited (never
 * precached — we don't know who's logged in at install time), kept apart from
 * the public cache so a logout can drop them, and only served offline while
 * still fresh.
 */
const PRIVATE_ROUTES = ["/me"];

/** How stale a signed-in page may be and still be served offline. */
const PRIVATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Files from /public that the offline screens need. Unlike /_next/static these
 * aren't content-hashed, so they're served stale-while-revalidate: instant from
 * cache, refreshed in the background so a replaced QR still reaches the tablet.
 */
const PUBLIC_ASSETS = ["/qr/lacc-guest-pass.svg"];

/** Keeps the content-hashed asset cache from growing without bound. */
const STATIC_CACHE_LIMIT = 250;

self.addEventListener("install", (event) => {
  // Warm the shell so the tablet survives a drop even if nobody has opened the
  // kiosk since the last deploy. Best-effort: a failure here must not stop the
  // worker activating, or a bad network at install time would leave the app
  // with no worker at all.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([...OFFLINE_ROUTES, ...PUBLIC_ASSETS]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name !== SHELL_CACHE &&
                name !== STATIC_CACHE &&
                name !== PRIVATE_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .catch(() => {})
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Lets the page force an update without a hard refresh nobody knows how to do
  // on an iPad.
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Server actions (POST) and anything cross-origin (Supabase, fonts) pass
  // straight through — not calling respondWith leaves the browser in charge.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFirst(request));
    return;
  }

  if (PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === "navigate") {
    const path = normalizePath(url.pathname);
    if (OFFLINE_ROUTES.includes(path)) {
      event.respondWith(documentNetworkFirst(request, SHELL_CACHE, 0));
      return;
    }
    if (PRIVATE_ROUTES.includes(path)) {
      event.respondWith(
        documentNetworkFirst(request, PRIVATE_CACHE, PRIVATE_MAX_AGE_MS),
      );
      return;
    }
  }

  // Everything else — RSC payloads, images, API routes, /officer, the rest of
  // /me — is left alone. When an RSC fetch fails offline, Next falls back to a
  // full browser navigation, which the branches above then serve from cache.
});

function normalizePath(pathname) {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

/** Content-hashed assets: serve from cache, fall back to network and store. */
async function staticFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (isCacheable(response)) {
    // Don't make the page wait on the cache write, and don't let a full disk
    // turn into a failed asset load.
    const copy = response.clone();
    cache
      .put(request, copy)
      .then(() => pruneStaticCache(cache))
      .catch(() => {});
  }
  return response;
}

/**
 * Un-hashed public files: answer from cache immediately, then quietly replace it
 * so the next load has the current version.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);

  const refresh = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        const copy = response.clone();
        cache.put(request, copy).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (hit) return hit;
  const fresh = await refresh;
  // Nothing cached and no network: let the browser render its own broken-image
  // state rather than throwing inside the worker.
  return fresh || Response.error();
}

/**
 * Documents: always try the network, but keep a copy so a dropped connection
 * still opens the page. The cached content will be stale — OfflineQueueSync
 * tells the user so, and queued taps are reconciled against the server at sync.
 *
 * `maxAgeMs` of 0 means "no age limit" (the public kiosk screens). A positive
 * value refuses to serve a copy older than that, which is what keeps a stale
 * signed-in page from outliving the session it was fetched under.
 */
async function documentNetworkFirst(request, cacheName, maxAgeMs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const copy = response.clone();
      cache.put(request, copy).catch(() => {});
    }
    return response;
  } catch {
    const hit =
      (await cache.match(request)) ||
      // A cold launch lands on the manifest's start_url, and a queued-up
      // tablet may only have /kiosk stored — match on pathname alone so query
      // strings don't cause a miss.
      (await cache.match(normalizePath(new URL(request.url).pathname)));
    if (hit && isFreshEnough(hit, maxAgeMs)) return hit;
    return offlineFallback();
  }
}

/**
 * Age-check a cached response using the `Date` header the server sent with it.
 * No header means we can't tell how old it is, so an age-limited cache treats it
 * as too old rather than guessing in the permissive direction.
 */
function isFreshEnough(response, maxAgeMs) {
  if (!maxAgeMs) return true;
  const dated = response.headers.get("date");
  if (!dated) return false;
  const age = Date.now() - Date.parse(dated);
  return Number.isFinite(age) && age < maxAgeMs;
}

function isCacheable(response) {
  return Boolean(
    response &&
      response.ok &&
      response.status !== 206 &&
      // Opaque cross-origin responses can't be validated, and redirects
      // shouldn't be replayed from cache.
      response.type !== "opaque" &&
      !response.redirected,
  );
}

async function pruneStaticCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= STATIC_CACHE_LIMIT) return;
  // `keys()` is in insertion order, so the front of the list is the oldest —
  // chunks from builds this tablet no longer runs.
  const stale = keys.slice(0, keys.length - STATIC_CACHE_LIMIT);
  await Promise.all(stale.map((key) => cache.delete(key)));
}

// ---------------------------------------------------------------------------
// Background Sync
//
// The page drains the queue whenever it's open (src/lib/offline-sync.ts). This
// is the same job for when it isn't: a member taps "clock in" on their phone
// with no signal and pockets it, and nothing else runs until they reopen the
// app — meanwhile the studio tablet has no idea they're here, and tapping their
// name there to go home opens a *second* shift instead of closing this one.
//
// Chrome and Edge only; Safari never fires `sync`, so on iPhones and the studio
// iPad the in-page retries remain the whole story.
//
// The store layout below mirrors src/lib/offline-queue.ts — keep the two in
// step, especially DB_VERSION.
// ---------------------------------------------------------------------------

const QUEUE_SYNC_TAG = "lacc-offline-queue";
const QUEUE_DB = "lacc-offline";
const QUEUE_DB_VERSION = 1;
const QUEUE_STORE = "events";
const QUEUE_ENDPOINT = "/api/offline-sync";
/** Matches SYNC_BATCH_LIMIT — one call's worth of replay. */
const QUEUE_BATCH_LIMIT = 100;

self.addEventListener("sync", (event) => {
  if (event.tag !== QUEUE_SYNC_TAG) return;
  // Rejecting asks the browser to wake us again on the next connection, so a
  // failure here costs a retry rather than the sign-in.
  event.waitUntil(drainQueue());
});

async function drainQueue() {
  const queued = await readQueuedEvents();
  if (queued.length === 0) return;

  const batch = queued.slice(0, QUEUE_BATCH_LIMIT);
  const response = await fetch(QUEUE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Same-origin, so the member's session cookie travels with it — that's what
    // proves a `phone` event was really theirs.
    body: JSON.stringify({ events: batch.map(stripLocalFields) }),
  });
  if (!response.ok) throw new Error(`Offline sync failed: ${response.status}`);

  const { outcomes } = await response.json();
  const byId = new Map((outcomes || []).map((o) => [o.id, o]));

  const done = [];
  const refused = [];
  let unresolved = 0;
  for (const event of batch) {
    const outcome = byId.get(event.id);
    if (!outcome || outcome.status === "retry") {
      unresolved++;
    } else if (outcome.status === "rejected") {
      refused.push({
        ...event,
        rejected: outcome.reason || "The server wouldn't accept it.",
      });
    } else {
      // applied, duplicate, or conflict — settled server-side either way. A
      // conflict wrote nothing and was handed to an officer, so retrying it
      // here would only file it again.
      done.push(event.id);
    }
  }

  await writeQueueResults(done, refused);
  // Anything left needs another pass: more than one batch, or events the server
  // wants retried. Throwing re-arms the sync rather than dropping them.
  if (unresolved > 0 || queued.length > batch.length) {
    throw new Error("Offline queue not fully drained");
  }
}

/** Strip the page's local bookkeeping — the server only needs the event. */
function stripLocalFields(event) {
  const payload = { ...event };
  delete payload.attempts;
  delete payload.lastError;
  delete payload.rejected;
  return payload;
}

function openQueueDb() {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(QUEUE_DB, QUEUE_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Everything still waiting, oldest tap first — the order the server replays in. */
async function readQueuedEvents() {
  const db = await openQueueDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(QUEUE_STORE, "readonly");
      const request = transaction.objectStore(QUEUE_STORE).getAll();
      transaction.oncomplete = () => {
        db.close();
        const all = request.result || [];
        resolve(
          all
            // Events already refused for good are the page's to show and clear.
            .filter((event) => !event.rejected)
            .sort((a, b) => String(a.at).localeCompare(String(b.at))),
        );
      };
      transaction.onerror = () => {
        db.close();
        resolve([]);
      };
      transaction.onabort = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

/** Drop what landed; flag what was refused so the page can surface it. */
async function writeQueueResults(doneIds, refusedEvents) {
  if (doneIds.length === 0 && refusedEvents.length === 0) return;
  const db = await openQueueDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(QUEUE_STORE, "readwrite");
      const store = transaction.objectStore(QUEUE_STORE);
      for (const id of doneIds) store.delete(id);
      for (const event of refusedEvents) store.put(event);
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
  });
}

/** Last resort: never show the browser's dinosaur on a studio kiosk. */
function offlineFallback() {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · LACC Studio</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#faf7f2;color:#2b2724;
       font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:1.5rem}
  main{max-width:22rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0 0 1.25rem;color:#6b625c;line-height:1.5}
  button{font:inherit;font-weight:600;background:#b4552d;color:#faf7f2;border:0;
         border-radius:.9rem;padding:.8rem 1.4rem}
</style>
</head>
<body>
  <main>
    <div style="font-size:2.5rem" aria-hidden="true">🌵</div>
    <h1>No connection</h1>
    <p>The kiosk hasn't been open on this tablet since it went offline, so there's
       nothing saved to show. Sign-ins on paper for now — reconnect and reload to
       pick back up.</p>
    <button onclick="location.reload()">Try again</button>
  </main>
</body>
</html>`,
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

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
 *   - Only the three public kiosk routes are cached. Signed-in pages (/me,
 *     /officer) are never stored — a cached member page replayed to the next
 *     person on a shared tablet would leak their data.
 *   - `/_next/static/*` is cache-first because those filenames are
 *     content-hashed, so a hit is always the right bytes for that build.
 *   - POSTs are never touched. Server actions must fail fast when offline so
 *     the client knows to queue instead of hanging.
 *
 * Bump CACHE_VERSION to evict everything on the next deploy.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `lacc-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `lacc-static-${CACHE_VERSION}`;

/** The only documents worth having offline — all public, all sign-in surfaces. */
const OFFLINE_ROUTES = ["/kiosk", "/kiosk/guest", "/kiosk/student"];

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
            .filter((name) => name !== SHELL_CACHE && name !== STATIC_CACHE)
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

  if (request.mode === "navigate" && isOfflineRoute(url.pathname)) {
    event.respondWith(documentNetworkFirst(request));
    return;
  }

  // Everything else — RSC payloads, images, API routes, signed-in pages — is
  // left alone. When an RSC fetch fails offline, Next falls back to a full
  // browser navigation, which the branch above then serves from cache.
});

function isOfflineRoute(pathname) {
  const clean =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return OFFLINE_ROUTES.includes(clean);
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
 * still opens the kiosk. The cached roster will be stale — OfflineQueueSync
 * tells the user so, and queued taps are reconciled against the server at sync.
 */
async function documentNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
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
      (await cache.match(new URL(request.url).pathname));
    if (hit) return hit;
    return offlineFallback();
  }
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

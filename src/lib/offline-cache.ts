/**
 * Page-side control over the service worker's caches.
 *
 * The Cache API is available in the page, not just the worker, which matters for
 * logout: posting a message to the worker races the navigation away from /me and
 * loses often enough to be useless. Deleting the cache here can be awaited
 * before the form submits, so it actually happens.
 */

/** Matches every version of the signed-in cache, so this survives a CACHE_VERSION bump. */
const PRIVATE_CACHE_PREFIX = "lacc-private-";

/** Give up rather than trap someone on the logout screen. */
const FORGET_TIMEOUT_MS = 1500;

/**
 * Drop the cached copy of the member dashboard.
 *
 * Called on logout: without this, the next person on a shared device could pull
 * the previous member's page out of the cache while offline, where there's no
 * session check to stop them (see public/sw.js).
 */
export async function forgetPrivateCache(): Promise<void> {
  if (typeof caches === "undefined") return;

  const deleteAll = (async () => {
    try {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(PRIVATE_CACHE_PREFIX))
          .map((name) => caches.delete(name)),
      );
    } catch {
      // Storage unavailable — there was nothing cached to leak either.
    }
  })();

  // Logging out must never hang on this.
  await Promise.race([
    deleteAll,
    new Promise<void>((resolve) => setTimeout(resolve, FORGET_TIMEOUT_MS)),
  ]);
}

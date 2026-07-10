// Minimal service worker — its only job is to make the app installable.
// Chrome/Android won't fire `beforeinstallprompt` (the home-screen install
// prompt) unless the page has a registered service worker with a fetch
// handler. This one is a pure network passthrough: it caches nothing, so it
// can never serve stale app code, but its presence satisfies the install
// eligibility check.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally empty: not calling respondWith lets the browser fetch
  // normally. The handler just needs to exist.
});

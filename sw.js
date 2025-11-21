// QR-Reader service worker: simple passthrough, PWA-enabling only.

self.addEventListener('install', function (event) {
  // Activate immediately on first load
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // Take control of all clients as soon as we're active
  event.waitUntil(self.clients.claim());
});

// Intentionally no "fetch" handler:
// - Network behavior remains default (no caching surprises).
// - Still counts as a PWA for installability.

// Simple SW for QR-Reader v7.3.4
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { self.clients.claim(); });
self.addEventListener('fetch', e => {
  // passthrough (we don't cache-bust vendor files here)
});

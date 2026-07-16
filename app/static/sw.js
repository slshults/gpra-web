// Minimal service worker for PWA installability.
//
// It deliberately does NOT call event.respondWith(): intercepting and
// re-fetching requests breaks the browser's native HTTP Range/partial-content
// handling, which <video> elements rely on to stream. The old pass-through
// (event.respondWith(fetch(event.request))) left demo videos stuck on a
// spinner and could surface a browser connection error when the re-fetch
// failed. Since this worker does no caching, letting the browser handle every
// request natively is strictly better.
//
// An empty fetch listener is still registered so browsers that gate PWA
// installability on the presence of a fetch handler continue to offer the
// "Install" button.
self.addEventListener('fetch', function () {
  // Intentionally empty: fall through to the network for every request.
});

// Take over immediately so visitors who still have the old pass-through
// worker controlling their pages get the fixed (no-op) worker on their next
// load, instead of waiting for every tab to close first.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

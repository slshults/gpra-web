// Minimal service worker for PWA installability
// No offline caching — just pass through to network
self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});

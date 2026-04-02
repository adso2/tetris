const CACHE = 'tetris-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './game.js',
  './style.css',
];
const AUDIO_ASSETS = [
  './Softly Falling Blocks.mp3',
  './Cyber Jurassic Tetris.mp3',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // Cache core assets (required); cache audio separately so a slow
      // network on first visit doesn't block the install.
      cache.addAll(CORE_ASSETS).then(() => {
        cache.addAll(AUDIO_ASSETS).catch(() => {});
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== 'tetris-fonts')
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Google Fonts: cache on first use, serve from cache when offline
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open('tetris-fonts').then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request)
            .then(response => {
              cache.put(event.request, response.clone());
              return response;
            })
            .catch(() => cached); // offline and not yet cached — silent fail
        })
      )
    );
    return;
  }

  // Everything else: cache-first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

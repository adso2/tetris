// Cache version — only bump this if you need to force-clear the audio cache.
// Code files (game.js, style.css, index.html) are served network-first so they
// always update automatically; bumping the version is NOT needed for code changes.
const CACHE = 'tetris-v8';

const AUDIO_ASSETS = [
  './Softly Falling Blocks.mp3',
  './Cyber Jurassic Tetris.mp3',
];

self.addEventListener('install', event => {
  // Only pre-cache audio — code files are fetched fresh on every load.
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(AUDIO_ASSETS).catch(() => {}))
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
            .catch(() => cached);
        })
      )
    );
    return;
  }

  // Audio files: cache-first — large files that never change.
  // Serve from cache immediately; fetch and cache on first visit.
  if (url.endsWith('.mp3')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          caches.open(CACHE).then(c => c.put(event.request, response.clone()));
          return response;
        });
      })
    );
    return;
  }

  // Code files (HTML, JS, CSS) and everything else: network-first.
  // Always fetch fresh code when online so updates reach the app immediately.
  // Fall back to cache so the app still loads when offline.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Store the fresh response in cache for offline use
        caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

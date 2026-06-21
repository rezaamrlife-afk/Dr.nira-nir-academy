// ─────────────────────────────────────────────
// Dr. NIRA — Service Worker (Production Safe)
// Strategy: Cache-first static / Network-first API
// Fully versioned + safe updates
// ─────────────────────────────────────────────

const CACHE_VERSION = '1.2.0';
const CACHE_NAME = `dr-nira-v${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/app.html',
  '/index.html',
  '/proposal.html',
  '/thesis.html',
  '/literature.html',
  '/upload.html',
  '/topic.html',
  '/citations.html',
  '/export.html',
  '/enhance.html',
  '/writer.html',
  '/profile.html',
  '/proposals.html',
  '/reading-list.html',
  '/research-gaps.html',
  '/structural-editor.html',
  '/charts.html',
  '/conceptual-model.html',
  '/questionnaire.html',
  '/js/project-manager.js',
  '/js/knowledge-base.js',
  '/manifest.json'
];

// ── INSTALL ──
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(
        STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' }))
      );
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API → network first, never cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'You are offline. Please check your connection.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // External (fonts, CDN) → network first + cache fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static → cache first, network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (!res || res.status !== 200) return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => {
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/app.html');
          }
        });
    })
  );
});

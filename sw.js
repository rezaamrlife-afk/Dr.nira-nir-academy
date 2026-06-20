// ─────────────────────────────────────────────
// Dr. NIRA — Service Worker
// Strategy: Cache-first for static assets,
//            Network-first for API calls
// ─────────────────────────────────────────────

const CACHE_NAME = 'dr-nira-v1';
const CACHE_VERSION = '1.0.0';

// Static assets to cache on install
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
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS.map(function(url) {
        return new Request(url, { cache: 'reload' });
      })).catch(function(err) {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH ──
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // API calls — always network first, no caching
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(
          JSON.stringify({ error: 'You are offline. Please check your connection.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // External resources (fonts, CDN) — network first with cache fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Static assets — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;

      return fetch(event.request).then(function(response) {
        // Only cache successful responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        // Offline fallback for HTML pages
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/app.html');
        }
      });
    })
  );
});

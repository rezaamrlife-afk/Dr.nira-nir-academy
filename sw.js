// ─────────────────────────────────────────────
// Dr. NIRA — Service Worker (Production Safe)
// Strategy:
//   HTML       → network-first (همیشه آخرین نسخه)
//   JS/CSS/img → cache-first (سریع)
//   API        → network-only
//   External   → network-first + cache fallback
// ─────────────────────────────────────────────

const CACHE_VERSION = '20260623';
const CACHE_NAME = `dr-nira-v${CACHE_VERSION}`;

const HTML_PAGES = [
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
  '/questionnaire.html'
];

const STATIC_ASSETS = [
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

      const htmlResults = await Promise.allSettled(
        HTML_PAGES.map(url =>
          cache.add(new Request(url, { cache: 'reload' }))
        )
      );
      htmlResults.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.warn('[SW] Could not pre-cache:', HTML_PAGES[i], result.reason);
        }
      });
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
            console.log('[SW] Deleting old cache:', key);
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

  // ── API → network only, never cache ──
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

  // ── External (fonts, CDN) → network-first + cache fallback ──
  if (url.origin !== self.location.origin) {
    const externalRequest = event.request.mode === 'no-cors'
      ? event.request
      : new Request(event.request, { mode: 'no-cors' });

    event.respondWith(
      fetch(externalRequest)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── HTML pages → network-first (همیشه آخرین deploy) ──
  const isHTML = event.request.headers.get('accept')?.includes('text/html') ||
                 HTML_PAGES.some(p => url.pathname === p || url.pathname === p.replace('.html', ''));

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => fetch('/app.html'))
    );
    return;
  }

  // ── JS / CSS / images → cache-first ──
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
        .catch(() => undefined);
    })
  );
});

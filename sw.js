const CACHE = 'onfocus-v4';

const PRECACHE = [
  '/logo.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/teacher.svg',
  '/pupils.svg',
  '/manifest.json',
];

const SKIP_HOSTS = new Set([
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
]);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Never intercept navigation — let Cloudflare Pages serve the page
  if (e.request.mode === 'navigate') return;

  // Pass Firebase live requests straight through
  if (SKIP_HOSTS.has(url.hostname)) return;

  // Only our own static files (libraries and fonts are self-hosted). Teacher files under /api/ are
  // left to the normal browser cache so a file the teacher deletes doesn't live on in this cache.
  if (url.hostname !== self.location.hostname || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Clone before the browser consumes the body
        if (res.ok && !res.redirected) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

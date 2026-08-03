const CACHE_NAME = 'ppd-dalat-v16';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fa/css/all.min.css',
  './fa/webfonts/fa-solid-900.woff2',
  './fa/webfonts/fa-regular-400.woff2',
  './fa/webfonts/fa-brands-400.woff2',
  './xlsx/xlsx.full.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'e-Gerak PPD Dalat', body: 'Ada pergerakan baharu.' };
  try { data = { ...data, ...event.data.json() }; } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: data.badge || '/icons/icon-192.png',
      tag: data.tag || 'egenak-push',
      renotify: true,
      data: data.data || {}
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Backend API calls (shared movement data): never cache these - the whole
  // point is other devices' changes must show up, so always hit the network.
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname.startsWith('/api/')) return;

  // App page itself: try the network first so staff always get the latest
  // version when online, but fall back to the cached copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else (fonts, icons, SheetJS, etc.): serve from cache first
  // for speed/offline use, and refresh the cache in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          // Cross-origin CDN requests (fonts, FontAwesome, SheetJS) come back
          // as opaque responses (status 0) since they aren't fetched in CORS
          // mode - still cache them so they're available offline.
          if (response && (response.status === 200 || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

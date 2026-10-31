// sw.js — the service worker. It saves the app's files on the device so the app
// opens instantly and works with no internet.
//
// Strategy "stale-while-revalidate": show the saved copy right away, and quietly
// download a fresh copy in the background for next time. So after you upload a
// new version, close and reopen the app (sometimes twice) to see it.
// Bump CACHE when you add or rename files so old copies get cleaned up.

const CACHE = 'everyday-v7';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/login.js', 'js/reminders.js', 'js/store.js', 'js/sync.js', 'js/ui.js', 'js/config.js',
  'js/modules/index.js', 'js/modules/today.js', 'js/modules/tasks.js', 'js/modules/calendar.js',
  'js/modules/food.js', 'js/modules/money.js', 'js/modules/habits.js', 'js/modules/notes.js', 'js/modules/chores.js', 'js/modules/school.js', 'js/modules/workouts.js', 'js/modules/search.js', 'js/data/recipes.js', 'js/data/diet.js',
  'js/modules/settings.js', 'js/modules/more.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only cache our own files and the sync library. Never cache database traffic.
  if (url.origin !== location.origin && url.hostname !== 'cdn.jsdelivr.net') return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});

// ---- notifications -------------------------------------------------------------------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Everyday', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Everyday', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag,
    data: { url: d.url || '#/today' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = e.notification.data?.url || '#/today';
  const url = new URL(hash, self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { w.postMessage({ type: 'open', hash }); return w.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});

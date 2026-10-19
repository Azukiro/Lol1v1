// Service worker des capsules : coquille hors ligne, cache des illustrations, notifications push.
const SHELL = 'capsules-shell-v1';
const ART = 'capsules-art-v1';
const SHELL_FILES = ['./', 'index.html', 'app.css', 'app.js', 'icon.svg', 'manifest.webmanifest', 'icons/icon-192.png'];
const ART_HOSTS = ['ddragon.leagueoflegends.com', 'raw.communitydragon.org'];
const ART_MAX = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ART).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Illustrations : cache d'abord, nombre d'entrées plafonné.
  if (ART_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(ART).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') {
        cache.put(e.request, res.clone());
        cache.keys().then((keys) => keys.length > ART_MAX && Promise.all(keys.slice(0, keys.length - ART_MAX).map((k) => cache.delete(k))));
      }
      return res;
    }));
    return;
  }
  // Coquille de l'app : réseau d'abord (mises à jour immédiates), cache si hors ligne. L'API n'est jamais mise en cache.
  if (url.origin === location.origin && url.pathname.startsWith('/capsules/')) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Capsules', {
    body: data.body || 'Tes capsules t\'attendent.',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: data.tag || 'capsules',
    renotify: true,
    data: { url: data.url || '/capsules/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/capsules/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    return win ? win.focus() : self.clients.openWindow(target);
  }));
});

// AutoDispatch — service worker (portail chauffeur hors connexion)
// Rôle : pouvoir rouvrir la page du chauffeur sans réseau. Il ne touche JAMAIS aux appels vers la base de données.
const V = 'ad-shell-v3';
const CDN = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  // La page elle-même : toujours la version en ligne si possible, sinon la dernière version connue
  if (u.origin === location.origin && (r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('.html'))) {
    const key = new Request(u.origin + u.pathname);
    e.respondWith((async () => {
      try {
        const res = await timeout(fetch(r, { cache: 'no-cache' }), 6000);   // revérifie toujours auprès du serveur (jamais une copie périmée du cache HTTP)
        if (res && res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(key, c)); }
        return res;
      } catch (_) {
        const hit = await caches.match(key);
        if (hit) return hit;
        return fetch(r);
      }
    })());
    return;
  }

  // Bibliothèques et polices : gardées après le premier chargement
  if (CDN.test(u.hostname)) {
    e.respondWith((async () => {
      const hit = await caches.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res && (res.ok || res.type === 'opaque')) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); }
      return res;
    })());
  }
  // Tout le reste (base de données, photos, API) : passe directement, sans interception
});

// Notifications du chauffeur (envoyées par la fonction send-push)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'AutoDispatch', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'AutoDispatch', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' }, tag: 'ad-driver', renotify: true
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

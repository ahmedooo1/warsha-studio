// Lets the editor open without network once it has been opened here: the page, its scripts, three.js and the
// textures already seen are kept in the browser. The API is never cached: designs travel through cloud.js only.
const CACHE = 'warsha-shell-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/cloud/cloud.js', '/js/fab.js', '/js/i18n.js']).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/v/') || u.pathname.startsWith('/admin')) return;
  const longLived = u.pathname.startsWith('/assets/') || u.pathname.startsWith('/vendor/');
  if (longLived) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
    return;
  }
  // the page and its scripts: the network first, so an update arrives at once; the copy when there is no network
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(u.pathname === '/index.html' ? '/' : r, cp)); } return res; })
    .catch(() => caches.match(u.pathname === '/index.html' ? '/' : r).then(hit => hit || Response.error())));
});

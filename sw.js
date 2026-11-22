/* Mostra Κρατήσεις – service worker.
   Κρατάει τα αρχεία της εφαρμογής ώστε να ανοίγει γρήγορα και χωρίς σήμα.
   Τα δεδομένα των κρατήσεων ΔΕΝ αποθηκεύονται εδώ. */
var CACHE = 'mostra-kratiseis-v4';
var SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
/* Network first for the app's own files (so updates appear at once), cache as fallback.
   Database calls go straight to the network and are never cached. */
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  var own = url.origin === self.location.origin;
  var lib = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!own && !lib) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); }));
});

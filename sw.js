/*
 * Service worker Tempelin.
 *
 * App shell disimpan agar aplikasi tetap terbuka saat offline (file bisa
 * dibaca dan diperiksa tanpa koneksi). Panggilan ke Apps Script selalu
 * lewat jaringan — tidak pernah dilayani dari cache.
 */
var CACHE = 'tempelin-v1';

var SHELL = [
  './',
  'index.html',
  'assets/style.css',
  'assets/parser.js',
  'assets/app.js',
  'assets/manifest.webmanifest',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Apps Script & Google: selalu jaringan, jangan pernah di-cache.
  if (url.hostname.indexOf('google.com') !== -1 ||
      url.hostname.indexOf('googleusercontent.com') !== -1) {
    return;
  }

  // Aset dari origin lain dibiarkan apa adanya.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // Segarkan cache di belakang layar (stale-while-revalidate).
        event.waitUntil(
          fetch(req).then(function (res) {
            if (res && res.ok) {
              return caches.open(CACHE).then(function (c) { return c.put(req, res.clone()); });
            }
          }).catch(function () {})
        );
        return hit;
      }

      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          event.waitUntil(
            caches.open(CACHE).then(function (c) { return c.put(req, copy); })
          );
        }
        return res;
      }).catch(function () {
        // Navigasi saat offline: sajikan app shell.
        if (req.mode === 'navigate') return caches.match('index.html');
        throw new Error('offline');
      });
    })
  );
});

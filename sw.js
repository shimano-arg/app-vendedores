// Service worker minimo para la PWA Shimano Vendedores.
// Estrategia:
// - index.html: network-first con fallback a cache. La app cambia seguido, queremos la version mas nueva.
// - Assets locales (manifest, iconos, logo): cache-first. No cambian salvo deploy.
// - CDNs (firebase, leaflet, sheetjs, jszip, openstreetmap tiles): se dejan pasar directo a la red.
//   No interceptamos para no romper el flujo de auth ni los listeners realtime.
//
// Cuando se cambie la version, bumpear CACHE_VERSION para invalidar el cache viejo.

const CACHE_VERSION = 'v184';
const STATIC_CACHE = 'shimano-static-' + CACHE_VERSION;
const HTML_CACHE = 'shimano-html-' + CACHE_VERSION;

const STATIC_ASSETS = [
  './manifest.json',
  './icon-180-v3.png',
  './icon-192-v3.png',
  './icon-512-v3.png',
  './icon-512-maskable-v3.png',
  './Shimano-Logo.png',
  './login-bg.jpg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS).catch(()=>{}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== HTML_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // No interceptar nada fuera del origin (firebase, leaflet, sheetjs, openstreetmap tiles, etc.)
  if (url.origin !== self.location.origin) return;

  // CRITICO: NO interceptar URLs con callbacks OAuth de Firebase Auth.
  // Cuando el usuario vuelve del redirect de Google, la URL trae parametros
  // como ?state=...&code=...&authuser=...&apiKey=...&storagerelay=...
  // Si el SW devuelve el HTML cacheado en vez de dejar pasar la URL, Firebase
  // Auth no procesa el callback y el usuario queda en loop de login.
  const search = url.search || '';
  const isAuthCallback = (
    search.indexOf('state=') >= 0 ||
    search.indexOf('apiKey=') >= 0 ||
    search.indexOf('authuser=') >= 0 ||
    search.indexOf('storagerelay=') >= 0 ||
    search.indexOf('mode=signIn') >= 0 ||
    url.pathname.indexOf('__/auth/') >= 0
  );
  if (isAuthCallback) return; // dejar pasar a la red directo, sin tocar

  // stock.json: SIEMPRE network-first (sin cache). Es un snapshot que se
  // actualiza cada 30 min en el repo via GitHub Actions y la app necesita
  // siempre la version mas fresca para mostrar stock real.
  if (url.pathname.endsWith('/stock.json')) {
    event.respondWith(
      fetch(req, {cache: 'no-store'}).catch(() => caches.match(req))
    );
    return;
  }

  // HTML / root: network-first con fallback a cache
  const isHtml = req.mode === 'navigate'
    || req.destination === 'document'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html');

  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const respClone = resp.clone();
          caches.open(HTML_CACHE).then(c => c.put(req, respClone)).catch(()=>{});
          return resp;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Assets locales: cache-first
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      if (resp && resp.status === 200) {
        const respClone = resp.clone();
        caches.open(STATIC_CACHE).then(c => c.put(req, respClone)).catch(()=>{});
      }
      return resp;
    }).catch(() => cached))
  );
});

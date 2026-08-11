// Service worker de la PWA Shimano Vendedores.
// Estrategia por tipo de request:
// - index.html: network-first con fallback a cache. Cambia seguido.
// - stock.json: SIEMPRE network-first sin cache. Snapshot cada 30 min.
// - Assets locales (bundle, chunks, iconos, geo.json, logo, manifest):
//   STALE-WHILE-REVALIDATE (E5, v335+). Sirve del cache inmediato para
//   arranque rapido + fetch en background para tener version fresca al
//   proximo load. Resuelve el mismatch shell/chunk cuando el user tiene
//   una version cacheada y otra recien deployada.
// - CDNs (firebase, leaflet, sheetjs, jszip, openstreetmap tiles): no
//   interceptamos, van directo a la red.
//
// Post-E3 (v333+): STATIC_ASSETS incluye ./chunks/*.js explicitamente. Los
// chunks lazy nuevos DEBEN agregarse aca ademas de en build.js LAZY_CHUNKS +
// src/main.js installChunkStubs (regla CLAUDE.md #18 nueva - ver bottom).
//
// Cuando se cambie la version, bumpear CACHE_VERSION para invalidar cache viejo.
// El activate event borra caches con nombres distintos al vigente.

const CACHE_VERSION = 'v445';
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
  // v323+: geometrias del mapa. Se descargan al instalar el SW para que el
  // proximo arranque tenga el mapa completo sin esperar a la red.
  './geo.json',
  // v325+: bundle de módulos ES (funciones puras + sentry + sap-client).
  // index.html tiene <script src="./app.bundle.js"> blocking; sin este
  // asset cacheado, offline no arranca.
  './app.bundle.js',
  // v333+ (E3 code splitting): chunks lazy cargados on-demand por
  // window.loadChunk(name). Cachearlos aquí garantiza offline funcional
  // para exports + admin panel después de la primera apertura online.
  './chunks/exports-core.js',
  './chunks/exports-advanced.js',
  './chunks/admin-users.js',
  // v422+ (2026-08-06): modal FORECAST admin-only (Mariano). Snapshot BQ
  // sku_ventas_snapshot + Sales Plan uploaded + politica inventario.
  './chunks/forecast.js',
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

  // Assets locales: STALE-WHILE-REVALIDATE (E5, v335+).
  // 1. Si hay cached: servir INMEDIATO (fast path, arranque rapido offline).
  // 2. En paralelo: fetch a la red y actualizar cache (background update).
  //    Proximo load ya sirve la version fresca.
  // 3. Si NO hay cached: esperar network (primer load o cache invalidado).
  // 4. Si network falla y NO habia cached: propagar error (nada que servir).
  event.respondWith(
    caches.open(STATIC_CACHE).then(cache =>
      cache.match(req).then(cached => {
        const netFetch = fetch(req).then(resp => {
          if (resp && resp.status === 200) {
            cache.put(req, resp.clone()).catch(()=>{});
          }
          return resp;
        }).catch(() => cached); // network fail → fallback a cached (undefined si no habia)
        // Fast path: si hay cached, retornarlo inmediato y dejar netFetch corriendo.
        // Si no hay cached, esperar netFetch (primer request post-install).
        return cached || netFetch;
      })
    )
  );
});

// src/domains/map-tile-layer.js
// S-9 (2026-11-26): extraído de index.html (bloque 7312-7339) — tile layer OSM
// para el mapa principal Leaflet. Totalmente aislado.
//
// Historial:
//   v645 (2026-08-26): switch CARTO → OpenStreetMap directo. CARTO cambió
//   política (API key + watermark "API KEY REQUIRED"). OSM gratis para
//   nuestro volumen (<500 usuarios activos/mes).
//   v860 (2026-09-09): flags para zoom natural en mobile (updateWhenZooming:
//   false evita cargar tiles durante la animación; updateWhenIdle:true solo
//   update cuando el mapa está quieto; keepBuffer:4 mantiene 4 tiles alrededor
//   del viewport para evitar cuadrados grises al pan corto).
//
// §13: `const map` del inline NO cruza al bundle IIFE. Por eso `initMapTileLayer`
// acepta la instancia explícita como parámetro. Idempotente: segundo call con
// el mismo map es no-op. `window._mapTileLayer` queda expuesto para debug.

/** @type {any} */
const win = window;
/** @type {any} */
const g = globalThis;

if (typeof win._mapTileLayer === 'undefined') win._mapTileLayer = null;

/** @param {any} mapInstance */
win.initMapTileLayer = function initMapTileLayer(mapInstance) {
  if (win._mapTileLayer) return win._mapTileLayer;
  if (typeof g.L === 'undefined' || !mapInstance) return null;
  win._mapTileLayer = g.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: 'abc',
    maxZoom: 19,
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 4,
  }).addTo(mapInstance);
  return win._mapTileLayer;
};

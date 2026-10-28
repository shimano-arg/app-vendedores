// @ts-check
/**
 * firestore-read-policy (v1499 §98, 2026-10-27) — fuente única de la
 * política de lectura Firestore (server vs cache).
 *
 * Problema: Firebase SDK web v8 compat habilita cache IndexedDB (via
 * `enablePersistence({synchronizeTabs:true})`). El cache sirve snapshots
 * STALE del browser cuando el user hace F5. Caso emblemático v1498:
 * CUDC201XG mostraba URQUIOLA 2 filas (15+2) en Mariano Chrome normal,
 * mientras incognito mostraba 1 fila con 17 (fuente actualizada). F5 no
 * limpia IndexedDB. Reportado 2026-10-27.
 *
 * Regla:
 *   - El snapshot cambia cada ~5 min (CF syncSapCatalogStockCF).
 *   - Un dato viejo de stock/backorder es PEOR que esperar un segundo
 *     por una lectura server.
 *   - TODA lectura de las colecciones críticas listadas acá va a server.
 *   - Nuevas colecciones críticas se AGREGAN acá — no en condiciones
 *     sueltas por call-site.
 *
 * CLAUDE.md §99: lista durable de colecciones "siempre server".
 */

/**
 * Colecciones (o doc paths) que SIEMPRE se leen del server, nunca del cache.
 *
 * Formato: cada entry es una string que puede ser:
 *   - Nombre de colección exacto: `'pedidos'` (match prefix por colección).
 *   - Path de doc específico: `'app_config/stock_snapshot'`.
 *
 * El matcher es prefix-sensitive: `'pedidos'` matchea `pedidos`,
 * `pedidos/XYZ`, pero NO `pedidos_draft_locks`.
 *
 * @type {ReadonlyArray<string>}
 */
export const ALWAYS_SERVER_PATHS = Object.freeze([
  // El snapshot stock + backorder cambia cada 5 min. Cache stale → UI miente.
  'app_config/stock_snapshot',
  // Reparto consume ingresos_reparto; cache stale → filas duplicadas/viejas.
  'ingresos_reparto',
  // Lista de espera cross-vendor; otros usuarios ven lo que uno escribe.
  'revision_waitlist',
  // Pedidos alimenta Reparto + Backorder + modal + Planner + popup Master.
  'pedidos',
]);

/**
 * ¿Esta ruta de Firestore debería leerse SIEMPRE del server?
 *
 * @param {string} path - path Firestore (ej. `'pedidos'`, `'pedidos/XYZ'`,
 *   `'app_config/stock_snapshot'`).
 * @returns {boolean}
 */
export function shouldReadFromServer(path) {
  if (!path || typeof path !== 'string') return false;
  const p = String(path).trim();
  if (!p) return false;
  for (const rule of ALWAYS_SERVER_PATHS) {
    if (p === rule) return true;
    // Match colección: `pedidos` → `pedidos/XYZ`.
    if (!rule.includes('/') && (p === rule || p.startsWith(rule + '/'))) return true;
  }
  return false;
}

/**
 * Devuelve el `GetOptions` apropiado para una ruta Firestore. Si está
 * en la whitelist → `{source: 'server'}`; sino undefined (default cache
 * + server fallback).
 *
 * Uso:
 *   const opts = getReadOptionsForPath('pedidos');
 *   const snap = await ref.get(opts); // Firebase v8 compat
 *
 * @param {string} path
 * @returns {{source: 'server'} | undefined}
 */
export function getReadOptionsForPath(path) {
  return shouldReadFromServer(path) ? { source: 'server' } : undefined;
}

/**
 * ¿Un snapshot `fromCache=true` debe ignorarse para esta ruta?
 *
 * Usado por listeners `onSnapshot` con `includeMetadataChanges=true`: el
 * callback recibe snapshots cache-stale primero, server-fresh después.
 * Para colecciones críticas, descartar los cache-stale evita que la UI
 * flashee datos viejos antes de recibir el server.
 *
 * @param {string} path
 * @param {{fromCache?: boolean, hasPendingWrites?: boolean}} metadata
 * @returns {boolean} true si el snapshot debe ignorarse.
 */
export function shouldIgnoreCachedSnapshot(path, metadata) {
  if (!metadata || !metadata.fromCache) return false;
  // hasPendingWrites=true significa que estamos esperando el ACK del server
  // para un write LOCAL; no ignoramos (el user acaba de escribir, le mostramos).
  if (metadata.hasPendingWrites) return false;
  return shouldReadFromServer(path);
}

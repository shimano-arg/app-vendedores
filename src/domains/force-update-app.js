// src/domains/force-update-app.js
// S-9 c2 (2026-11-26): extraido de index.html (lineas 7611-7726) — "Recargar
// limpio" del boton del mapa. Totalmente aislado de pedidos/stock/reservas.
//
// Responsabilidades:
//   1. `window.CLEAN_RELOAD_PRESERVE_KEYS` — claves localStorage preservadas
//      durante el reset (CLAUDE.md §101).
//   2. `window.forceUpdateApp()` — pipeline que cierra Firestore, limpia
//      IndexedDB, SW, caches y localStorage, luego recarga con cache busting
//      (CLAUDE.md §100, §101).
//
// El control Leaflet `RefreshAppControl` que invoca esto queda en el inline
// (esta acoplado a `L.Control.extend` + `map.addControl`). El handler usa
// `window.forceUpdateApp` para resolver la funcion extraida del bundle.
//
// §13: el bundle IIFE corre antes del inline; la funcion queda definida en
// `window` al momento en que el RefreshAppControl es instanciado + clickeado.

/** @type {any} */
const win = window;

// v1499 §98 (2026-10-27): claves localStorage que preservan borradores
// no-enviados del vendedor. Nunca se borran en "Recargar limpio".
// `shimano_zonas_pending_v1` tiene pedidos pending en memoria pre-confirm.
const CLEAN_RELOAD_PRESERVE_KEYS = Object.freeze([
  'shimano_zonas_pending_v1', // borradores pedidos no enviados
  // v1527: lista de precios local (v1523). Sin esto "Recargar limpio" dejaba
  // el Master sin precios hasta que llegaba el listener (segundos largos).
  // El listener la reemplaza igual al llegar: no queda dato viejo.
  'shimano_price_cache_v1',
]);
win.CLEAN_RELOAD_PRESERVE_KEYS = CLEAN_RELOAD_PRESERVE_KEYS;

/**
 * Pipeline "Recargar limpio" (CLAUDE.md §101). Idempotente: se puede invocar
 * multiples veces sin side-effects adicionales.
 * @returns {Promise<void>}
 */
async function forceUpdateApp() {
  // v1499 §98 (2026-10-27): refactor "Recargar limpio". Antes v1499 solo
  // desregistraba SW + caches HTTP + outlines. No limpiaba IndexedDB
  // Firestore ni terminaba la instancia → cache stale persistía. Caso
  // Mariano URQUIOLA + CUDC201XG. Ahora:
  //   1. Confirmación con detalle de qué se borra y qué se preserva.
  //   2. Aviso visual "Limpiando datos locales y recargando".
  //   3. Firestore terminate() + clearPersistence().
  //   4. localStorage: borra todo EXCEPTO claves preservadas (borradores).
  //   5. sessionStorage: borra todo.
  //   6. Service Worker unregister + caches.delete.
  //   7. Reload con cache busting.
  //
  // Si quedan borradores no-enviados, confirmación explícita antes.
  const w = /** @type {any} */ (window);
  let hasDrafts = false;
  try {
    const drafts = localStorage.getItem('shimano_zonas_pending_v1');
    if (drafts) {
      const parsed = JSON.parse(drafts);
      hasDrafts = parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
    }
  } catch (_e) {
    /* ignore */
  }

  const confirmMsg = hasDrafts
    ? 'Recargar limpio?\n\nBorra la cache local y trae todo del servidor.\n' +
      'Tus borradores de pedido NO enviados se preservan.\n\n' +
      '¿Continuar?'
    : 'Recargar limpio?\n\nBorra la cache local y trae todo del servidor.';
  if (!confirm(confirmMsg)) return;

  // Aviso visual overlay.
  try {
    const existing = document.getElementById('clean-reload-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'clean-reload-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(255,255,255,.92);z-index:999999;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",sans-serif;' +
      'color:#1d1d1f;gap:16px;';
    const spinner = document.createElement('div');
    spinner.style.cssText =
      'width:40px;height:40px;border:3px solid rgba(29,29,31,.1);' +
      'border-top-color:#0071e3;border-radius:50%;animation:cleanReloadSpin 0.8s linear infinite;';
    const msg = document.createElement('div');
    msg.textContent = 'Limpiando datos locales y recargando';
    msg.style.cssText = 'font-size:16px;font-weight:500;letter-spacing:-0.3px;';
    const style = document.createElement('style');
    style.textContent = '@keyframes cleanReloadSpin{to{transform:rotate(360deg)}}';
    overlay.appendChild(style);
    overlay.appendChild(spinner);
    overlay.appendChild(msg);
    document.body.appendChild(overlay);
  } catch (_e) {
    /* overlay best-effort */
  }

  // 1. Terminate Firestore (libera listeners + conexión IndexedDB).
  try {
    if (w.fbDb && typeof w.fbDb.terminate === 'function') {
      await w.fbDb.terminate();
    }
  } catch (e) {
    console.warn('[v1499] firestore.terminate falló:', e && e.message);
  }

  // 2. Clear IndexedDB persistence.
  try {
    if (
      w.firebase &&
      w.firebase.firestore &&
      typeof w.firebase.firestore().clearPersistence === 'function'
    ) {
      await w.firebase.firestore().clearPersistence();
    }
  } catch (e) {
    console.warn('[v1499] clearPersistence falló:', e && e.message);
  }

  // 3. localStorage: borra TODO excepto claves preservadas.
  try {
    const preserve = new Set(CLEAN_RELOAD_PRESERVE_KEYS);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && !preserve.has(key)) toRemove.push(key);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch (e) {
    console.warn('[v1499] localStorage clear falló:', e && e.message);
  }

  // 4. sessionStorage: borra todo.
  try {
    sessionStorage.clear();
  } catch (_e) {
    /* ignore */
  }

  // 5. Service Worker: unregister + caches.delete.
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.warn('[v1499] SW unregister falló:', e && e.message);
  }

  try {
    if (w.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn('[v1499] caches clear falló:', e && e.message);
  }

  // 6. Reload con cache busting.
  const base = window.location.pathname.replace(/[?#].*$/, '');
  window.location.replace(base + '?_t=' + Date.now());
}
win.forceUpdateApp = forceUpdateApp;

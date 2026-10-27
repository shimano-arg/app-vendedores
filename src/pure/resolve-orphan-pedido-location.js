// @ts-check
/**
 * resolve-orphan-pedido-location (v1484, 2026-10-27) — fuente única para
 * resolver `province`/`locName` de pedidos huérfanos usando `client_master`
 * por `cardCode`.
 *
 * Problema reportado (JUAN MIGUEL BENGOCHEA ORDEN 356, Oct 2026): la
 * tarjeta mostraba "/" como provincia/localidad porque el pedido se guardó
 * con `province=""` y `locName=""`, mientras otras órdenes del mismo
 * cliente dicen "COMODORO RIVADAVIA / Chubut". Los flujos v695/v708
 * ponían un badge "sin catálogo (revisar province/localidad)" pidiendo
 * revisión manual.
 *
 * Fix v1484: si el pedido no matchea POINTS ni altas por prov+loc,
 * intentar resolver desde `client_master` por el `cardCode` del pedido.
 * Si lo encuentra, se marca `resolvedFromMaster=true` y el badge se
 * oculta. Si tampoco está en master, el badge sigue mostrándose.
 *
 * Reutilizada en: `renderPendientesList` + `renderConfirmadosList` del
 * index.html (los 2 call-sites del badge).
 */

/**
 * @typedef {Object} ResolveResult
 * @property {string} province  Provincia resuelta ("" si no se pudo).
 * @property {string} locName   Localidad resuelta ("" si no se pudo).
 * @property {boolean} resolvedFromMaster  true si vino de client_master.
 * @property {string} source  'master' | 'none'
 */

/**
 * Normaliza cardCode (trim). SAP usa el valor tal cual (ej. "C20293164852").
 * @param {any} v
 * @returns {string}
 */
function _normCard(v) {
  return String(v || '').trim();
}

/**
 * Lee prov/loc desde un doc de `client_master`. Prioridad:
 *   1. `d.provincia` / `d.localidad` (campos canónicos).
 *   2. `d.sapState` / `d.sapCity` (fallback cuando el master viene de
 *      import SAP sin provincia/localidad human-cased).
 *
 * Descarta valores sentinel "(sin provincia)" / "(sin localidad)" que son
 * placeholders del slug del docId cuando el import SAP no tenía la info.
 *
 * @param {any} cmData
 * @returns {{province: string, locName: string}}
 */
function _readLocFromMaster(cmData) {
  const d = cmData || {};
  const SENTINEL = /^\(sin (provincia|localidad)\)$/i;
  /** @param {any} primary @param {any} fallback */
  const pickOne = (primary, fallback) => {
    const p = String(primary || '').trim();
    if (p && !SENTINEL.test(p)) return p;
    const f = String(fallback || '').trim();
    if (f && !SENTINEL.test(f)) return f;
    return '';
  };
  return {
    province: pickOne(d.provincia, d.sapState),
    locName: pickOne(d.localidad, d.sapCity),
  };
}

/**
 * Resuelve `province`/`locName` de un pedido huérfano usando el catálogo de
 * clientes. Fuentes en orden:
 *   1. `client_master` por `cardCode` (SAP card). Fuente autoritativa.
 *   2. `POINTS[].clients[]` por `clientName` (catálogo de tiendas del mapa).
 *      Fallback para clientes que NO están en client_master pero sí en el
 *      padrón POINTS (ej. BENGOCHEA — en POINTS Comodoro Rivadavia, no en
 *      client_master).
 *
 * Si ninguna fuente lo encuentra, devuelve `source='none'` y el badge sigue
 * mostrándose como "sin catálogo (revisar province/localidad)".
 *
 * @param {{province?: string, locName?: string, clientCardCode?: string, clientName?: string}} pedido
 * @param {Map<string, any> | null | undefined} clientMasterCache  Map docId → cmData.
 * @param {Array<{province?: string, name?: string, clients?: Array<string>}>} [pointsArr]
 *   Padrón POINTS (opcional). Si viene, se usa como fallback 2.
 * @returns {ResolveResult}
 */
export function resolveOrphanPedidoLocation(pedido, clientMasterCache, pointsArr) {
  const originalProv = String((pedido && pedido.province) || '').trim();
  const originalLoc = String((pedido && pedido.locName) || '').trim();
  const cardCode = _normCard(pedido && pedido.clientCardCode);
  const clientName = String((pedido && pedido.clientName) || '').trim();

  // Fuente 1: client_master por cardCode.
  if (cardCode && clientMasterCache && typeof clientMasterCache.forEach === 'function') {
    /** @type {any} */
    let found = null;
    clientMasterCache.forEach((cmData) => {
      if (found) return;
      if (!cmData) return;
      const cc1 = _normCard(cmData.sapCardCode);
      const cc2 = _normCard(cmData.cardCodeSap);
      if (cc1 === cardCode || cc2 === cardCode) {
        found = cmData;
      }
    });
    if (found) {
      const { province: masterProv, locName: masterLoc } = _readLocFromMaster(found);
      if (masterProv || masterLoc) {
        return {
          province: masterProv || originalProv,
          locName: masterLoc || originalLoc,
          resolvedFromMaster: true,
          source: 'master',
        };
      }
    }
  }

  // Fuente 2: POINTS por clientName (fallback para clientes no en master).
  if (clientName && Array.isArray(pointsArr)) {
    const needle = clientName.toUpperCase();
    for (const p of pointsArr) {
      if (!p || !Array.isArray(p.clients)) continue;
      const match = p.clients.some(
        (c) =>
          String(c || '')
            .toUpperCase()
            .trim() === needle
      );
      if (!match) continue;
      const prov = String(p.province || '').trim();
      const loc = String(p.name || '').trim();
      if (prov || loc) {
        return {
          province: prov || originalProv,
          locName: loc || originalLoc,
          resolvedFromMaster: true,
          source: 'points',
        };
      }
    }
  }

  return {
    province: originalProv,
    locName: originalLoc,
    resolvedFromMaster: false,
    source: 'none',
  };
}

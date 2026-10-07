// @ts-check
/**
 * v1184 (incident Mariano + cowork 2026-10-07): resuelve `clientCardCode`
 * faltantes en pedidos Firestore de forma automatica.
 *
 * Problema: en 7+ puntos de creacion de pedido en index.html, el frontend
 * resuelve el cardCode via sapGetClienteCode(clientName) desde:
 *   - window.sapClientsMap (mapeo manual admin)
 *   - approvedAltasList (altas aprobadas)
 * Si el nombre no matchea en NINGUNA, guarda '' silencioso. Resultado:
 * ~1570 lineas en v_pedidos_lines sin cliente_code → Power BI atribuye a
 * "(en blanco)".
 *
 * Esta CF corre cada 15min, resuelve pedidos sin cardCode desde las mismas 2
 * fuentes Firestore (sap_clients + client_applications con cardCodeSap). Si
 * resuelve → update + delete flag. Si no resuelve despues de 24h desde
 * creacion → marca `needsCardCodeResolution: true` para que la UI muestre
 * badge amarillo y admin pueda intervenir.
 *
 * NOTA: la 3ra fuente del script Python backfill (BigQuery sap_bp_raw)
 * NO esta disponible desde la CF (requeriria permisos BQ + conexion extra).
 * El script Python backfill cubre el bulk; esta CF cubre el flujo continuo.
 *
 * @typedef {Object} ResolveDeps
 * @property {any} fbDb
 * @property {() => Date} [now]
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 */

const PENDING_THRESHOLD_HOURS = 24; // Despues de X horas sin resolver, marca el flag UI.

/**
 * Normaliza nombre de cliente para match case-insensitive. Replica
 * `norm_name()` del script Python backfill_pedido_cardcode.py.
 * Mas agresiva que sapNorm del frontend — remueve sufijos legales (SA/SRL/
 * S.R.L./SAIC/SCA) iterativamente para pescar 'REBORN SRL' == 'REBORN S.R.L.'.
 *
 * @param {string} name
 * @returns {string}
 */
export function normName(name) {
  if (!name) return '';
  let s = String(name).toUpperCase().trim();
  s = s.replace(/[.,'"]/g, '');
  // Remover sufijos legales iterativamente (hasta 3 pasadas para doble sufijo).
  const SUFFIX_RE =
    /\s*(S\.?\s*A\.?|S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?\s*I\.?\s*C\.?|S\.?\s*C\.?\s*A\.?)\s*$/i;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIX_RE, '').trim();
    if (next === s) break;
    s = next;
  }
  // Colapsar whitespace multiple.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Carga mapeo nombre→cardCode desde Firestore collection `sap_clients`.
 * Doc shape: { name/nombre: string, sapCode/cardCode: string }.
 *
 * @param {ResolveDeps} deps
 * @returns {Promise<Map<string, {cardCode: string, source: string, nameRaw: string}>>}
 */
export async function loadSapClientsMap(deps) {
  const map = new Map();
  const snap = await deps.fbDb.collection('sap_clients').get();
  snap.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    const cardCode = String(data.sapCode || data.cardCode || '').trim();
    if (!cardCode) return;
    const nameRaw = String(data.name || data.nombre || doc.id || '').trim();
    const norm = normName(nameRaw);
    if (!norm) return;
    if (!map.has(norm)) {
      map.set(norm, { cardCode, source: 'sap_clients', nameRaw });
    }
  });
  return map;
}

/**
 * Carga mapeo nombre→cardCode desde Firestore collection `client_applications`.
 * Doc shape puede tener hasta 3 nombres (comercio/titular/fantasia) para el
 * mismo cardCodeSap. Mapeamos los 3 al mismo cardCode.
 *
 * @param {ResolveDeps} deps
 * @returns {Promise<Map<string, {cardCode: string, source: string, nameRaw: string}>>}
 */
export async function loadClientApplicationsMap(deps) {
  const map = new Map();
  const snap = await deps.fbDb.collection('client_applications').get();
  snap.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    const cardCode = String(data.cardCodeSap || '').trim();
    if (!cardCode) return;
    for (const field of ['comercio', 'titular', 'fantasia']) {
      const nameRaw = String(data[field] || '').trim();
      if (!nameRaw) continue;
      const norm = normName(nameRaw);
      if (!norm) continue;
      if (!map.has(norm)) {
        map.set(norm, { cardCode, source: 'client_applications', nameRaw });
      }
    }
  });
  return map;
}

/**
 * Resuelve el cardCode buscando el nombre normalizado en los 2 mapas en orden
 * de prioridad.
 *
 * @param {string} clientName
 * @param {Array<Map<string, {cardCode: string, source: string, nameRaw: string}>>} maps
 * @returns {{cardCode: string, source: string, nameRaw: string, norm: string} | null}
 */
export function resolveCardCode(clientName, maps) {
  const norm = normName(clientName);
  if (!norm) return null;
  for (const m of maps) {
    const hit = m.get(norm);
    if (hit) {
      return {
        cardCode: hit.cardCode,
        source: hit.source,
        nameRaw: hit.nameRaw,
        norm,
      };
    }
  }
  return null;
}

/**
 * Main handler. Query pedidos sin cardCode → resuelve → update o marca flag.
 *
 * Design: NO query con where('clientCardCode', '==', '') + where('closedAt',
 * '==', null) por limite composite index. Scan completo filtrado client-side.
 * Pedidos abiertos en Shimano son <2k docs — scan rapido.
 *
 * @param {ResolveDeps} deps
 * @returns {Promise<{
 *   totalScanned: number,
 *   missingCardCode: number,
 *   resolvedSapClients: number,
 *   resolvedClientApplications: number,
 *   unresolved: number,
 *   flaggedForUi: number,
 *   writeErrors: number,
 * }>}
 */
export async function handleResolvePedidoCardCode(deps) {
  const log = deps.log || ((/** @type {string} */ _m) => {});
  const now = deps.now ? deps.now() : new Date();

  // Cargar 2 fuentes Firestore (prioridad: sap_clients, client_applications).
  const [sapClientsMap, altasMap] = await Promise.all([
    loadSapClientsMap(deps),
    loadClientApplicationsMap(deps),
  ]);
  log('[resolve-cardcode] fuentes cargadas', {
    sapClients: sapClientsMap.size,
    altas: altasMap.size,
  });
  const maps = [sapClientsMap, altasMap];

  // Scan pedidos abiertos (closedAt == null).
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  const stats = {
    totalScanned: 0,
    missingCardCode: 0,
    resolvedSapClients: 0,
    resolvedClientApplications: 0,
    unresolved: 0,
    flaggedForUi: 0,
    writeErrors: 0,
  };

  /** @type {Array<{ref: any, update: Record<string, any>}>} */
  const writes = [];

  snap.forEach((/** @type {any} */ doc) => {
    stats.totalScanned += 1;
    const data = doc.data() || {};
    const cardCode = String(data.clientCardCode || '').trim();
    if (cardCode) return;
    const name = String(data.clientName || '').trim();
    if (!name) return;
    stats.missingCardCode += 1;

    const hit = resolveCardCode(name, maps);
    if (hit) {
      stats[`resolved${hit.source === 'sap_clients' ? 'SapClients' : 'ClientApplications'}`] += 1;
      writes.push({
        ref: doc.ref,
        update: {
          clientCardCode: hit.cardCode,
          _backfillCardCode: {
            source: hit.source,
            at: now.toISOString(),
            script: 'resolvePedidoCardCodeCF',
            matchedNormName: hit.norm,
          },
          // Si el pedido tenia el flag seteado por una pasada previa, limpiarlo.
          needsCardCodeResolution: /** @type {any} */ (null),
        },
      });
      return;
    }

    // No resuelto. Decidir si marcar flag UI (solo si pedido tiene >24h).
    stats.unresolved += 1;
    const createdAt = data.createdAt;
    let createdAtMs = 0;
    if (typeof createdAt === 'string') createdAtMs = new Date(createdAt).getTime() || 0;
    else if (createdAt && typeof createdAt.toMillis === 'function')
      createdAtMs = createdAt.toMillis();
    const ageHours = createdAtMs > 0 ? (now.getTime() - createdAtMs) / (60 * 60 * 1000) : 0;

    if (ageHours >= PENDING_THRESHOLD_HOURS && !data.needsCardCodeResolution) {
      stats.flaggedForUi += 1;
      writes.push({
        ref: doc.ref,
        update: {
          needsCardCodeResolution: true,
          needsCardCodeResolutionAt: now.toISOString(),
        },
      });
    }
  });

  log('[resolve-cardcode] scan completo', {
    totalScanned: stats.totalScanned,
    missingCardCode: stats.missingCardCode,
    resolved: stats.resolvedSapClients + stats.resolvedClientApplications,
    unresolved: stats.unresolved,
    flaggedForUi: stats.flaggedForUi,
    writesPending: writes.length,
  });

  // Aplicar writes en batches de 400 (sub-limite 500 Firestore).
  const CHUNK = 400;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const slice = writes.slice(i, i + CHUNK);
    const batch = deps.fbDb.batch();
    for (const w of slice) {
      batch.update(w.ref, w.update);
    }
    try {
      await batch.commit();
    } catch (e) {
      stats.writeErrors += slice.length;
      log('[resolve-cardcode] batch commit error', {
        batchIndex: Math.floor(i / CHUNK),
        err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
      });
    }
  }

  return stats;
}

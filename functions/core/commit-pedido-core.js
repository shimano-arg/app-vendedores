// @ts-check
/**
 * E2 §stock-servidor-atomico (2026-10-23) — commitPedidoCore.
 *
 * Decisión server-side atómica de "hay stock". Reemplaza las escrituras
 * directas desde el cliente (23 call-sites de categoría A, docs/auditoria/50_*)
 * que hoy toman la decisión con un breakdown stale local y escriben a `pedidos`
 * sin re-chequear.
 *
 * CONTRATO (ver design doc §Sección NUEVA — Contrato):
 *
 * Payload:
 *   {
 *     draftId: string              único; mismo draftId = idempotente.
 *     cardCode: string             cliente SAP CardCode.
 *     origen: 'manual' | 'excel' | 'cpst' | 'auto'
 *     lines: [{sku, cantidad, origenLinea?, asigRefs?, precio?, notas?}]
 *     clientVersion: string        'v1430' bundle version.
 *     expectedBreakdownHash?: string  hash SHA-1 del breakdown que mostraba cliente.
 *     autoAcceptStockChange?: boolean  si true, pre-acepta diff automáticamente.
 *     formaEntrega?, condicionPago?, observaciones?
 *   }
 *
 * Response OK:
 *   {
 *     ok: true,
 *     pedidoId: string,
 *     lines: [{sku, qtyConfirmed, qtyBO, reason}],
 *     diffVsClient: null | {skuChanged: [...], message: string},
 *     servidorNowMs: number,
 *     commitAtIso: string,
 *   }
 *
 * Response ERROR (ok:false):
 *   errorCode: 'VERSION_OLD' | 'CLIENT_HAS_OPEN_WAITLIST' | 'STOCK_CHANGED'
 *              | 'SNAPSHOT_TOO_OLD' | 'CONTENTION_RETRY_EXHAUSTED'
 *              | 'VALIDATION_ERROR' | 'PERMISSION_DENIED'
 *              | 'UNRESOLVED_BO_ENTRY_ROWS'  // tarea L v1457: filas rojas sin resolver
 *
 * GARANTÍAS:
 * - Idempotencia por draftId.
 * - Atomicidad: runTransaction. "Todo o nada". Rollback en error.
 * - Isolation: Firestore reintenta hasta 5× ante conflicto.
 * - Nunca deja pedido a medias.
 *
 * @typedef {Object} CommitPedidoDeps
 * @property {any} fbDb Firestore instance (admin SDK)
 * @property {() => Promise<string | null>} [getUserRole]
 * @property {() => Date} [now]
 * @property {(msg: string, data?: any) => void} [log]
 * @property {(err: Error, context?: any) => void} [reportError]
 * @property {any} [FieldValue] admin.firestore.FieldValue
 * @property {(params: any) => Promise<any>} [fetchStockLive] Fase 3 Capa 2 v1445: callable al SL para live fisicoDep11
 */

import {
  applyAbsorptionsToLines,
  buildBackfillUpdate,
  computeBoAbsorption,
} from './absorb-bo-on-confirm.js';
// Tarea L (v1457 2026-10-25): payload gate "entrada del backorder" (filas rojas).
// Si llegan al CF con `boEntryResolved===null`, es bug cliente → errorCode
// UNRESOLVED_BO_ENTRY_ROWS. Importamos la función solo por sync con el espejo,
// no se invoca el compute acá (confiamos en el payload del cliente).
// NOTA: NO uses esto para re-detectar BO server-side; es un gate puro sobre el
// payload. La detección vive en index.html (cliente).
// eslint-disable-next-line no-unused-vars
import { computeBoEntryRows as _syncBoEntryRows } from './bo_entry_logic.js';
import { findOpenWaitlistsForClient as findOpenWaitlistsPure } from './open-waitlists.js';
import { getStockBreakdown } from './pedido-snapshot-core.js';

// Threshold de staleness del snapshot stock server-side.
// v1456 §60 UPDATE (2026-10-25): BAJADO 8h → 30 min. El sync ahora vive en
// Cloud Scheduler → syncSapCatalogStockCF (cada 5 min, confiable). El cron
// GHA del workflow Python se removió (saltaba runs por saturación). Con el
// scheduler nuevo + el audit E10 que mostró que el hueco de 24 min del 23/10
// fue el propio deploy de la CF (no falla real del scheduler), 30 min es un
// threshold que detecta sync muerto rápido sin bloquear operación normal
// (6 corridas de margen entre runs). Si rompe, la CF Fase 3 Capa 2 cae a
// live-SL vía deps.fetchStockLive — SNAPSHOT_TOO_OLD solo dispara si NO hay
// fallback live configurado.
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutos
const MAX_RETRY_ATTEMPTS = 5;
// §67 (2026-10-25 v1454): se agrega 'manual_backorder' al set válido para
// absorber el flow Generar Backorder manual de index.html:_gbConfirmar. Antes
// pedidos.add directo sin _commitVersion → bloqueaba E10 GREEN. Con esto el
// camino de GB pasa por commitPedidoCF y queda sellado con _commitVersion.
const VALID_ORIGENS = new Set(['manual', 'excel', 'cpst', 'auto', 'reparto', 'manual_backorder']);

/**
 * @param {CommitPedidoDeps} deps
 * @param {any} payload
 * @returns {Promise<any>}
 */
export async function commitPedidoCore(deps, payload) {
  const log = deps.log || (() => {});
  const now = (deps.now ? deps.now() : new Date()).getTime();
  const nowIso = new Date(now).toISOString();

  // 1. Validación básica payload.
  const validation = validatePayload(payload);
  if (!validation.ok) {
    // §64.2 (v1448): log antes del return (await, no fire-and-forget).
    await logCommitRejection(deps, 'VALIDATION_ERROR', payload, {
      validationReason: validation.message || '',
      validationData: validation.data || null,
    });
    return makeError('VALIDATION_ERROR', validation.message || '', validation.data);
  }

  // 2. Chequeo min_app_version.
  try {
    const vmSnap = await deps.fbDb.collection('app_config').doc('version_minima').get();
    if (vmSnap.exists) {
      const vmData = vmSnap.data() || {};
      const minVersion = vmData.minVersion;
      if (minVersion && isVersionLessThan(payload.clientVersion, minVersion)) {
        // §64.2 (v1448): log antes del return.
        await logCommitRejection(deps, 'VERSION_OLD', payload, {
          minVersion,
          currentVersion: payload.clientVersion,
        });
        return makeError('VERSION_OLD', 'Actualizá la app para continuar', {
          minVersion,
          currentVersion: payload.clientVersion,
        });
      }
    }
  } catch (e) {
    // Si no existe el doc o Firestore falla, no bloqueamos (shadow 24h).
    log('commitPedidoCore version_minima check fail (non-blocking)', {
      err: (e && e.message) || String(e),
    });
  }

  // 3. Idempotencia por draftId.
  const existingPedido = await findExistingByDraftId(deps, payload.draftId);
  if (existingPedido) {
    // E8 §stock-servidor-atomico (v1433): si el pedido ya existe Y está en SAP
    // (transferidoSAP.docEntry != null), rechazamos edición. G4.03 del audit
    // grises: un pedido ya enviado a SAP se edita en app y queda divergente.
    const transferido = existingPedido.data && existingPedido.data.transferidoSAP;
    if (transferido && transferido.docEntry != null && transferido.via !== 'app_only') {
      // §64.2 (v1448): log antes del return.
      await logCommitRejection(deps, 'PERMISSION_DENIED', payload, {
        reason: 'pedido_ya_en_sap',
        existingPedidoId: existingPedido.id,
        sapDocNum: transferido.docNum || null,
        sapDocEntry: transferido.docEntry,
        via: transferido.via || null,
      });
      return makeError(
        'PERMISSION_DENIED',
        'Pedido ya enviado a SAP (SQ #' +
          (transferido.docNum || transferido.docEntry) +
          '); para modificar, contactar a admin que lo edita en SAP',
        {
          pedidoId: existingPedido.id,
          sapDocNum: transferido.docNum || null,
          sapDocEntry: transferido.docEntry,
          via: transferido.via || null,
        }
      );
    }
    log('commitPedidoCore idempotente hit', {
      draftId: payload.draftId,
      pedidoId: existingPedido.id,
    });
    return {
      ok: true,
      pedidoId: existingPedido.id,
      lines: deriveLinesFromExisting(existingPedido.data),
      diffVsClient: null,
      servidorNowMs: now,
      commitAtIso: nowIso,
      idempotentHit: true,
    };
  }

  // 4. CLIENT_HAS_OPEN_WAITLIST check (§42) + §57 exclude self.
  //
  // §57 (2026-10-23) — hotfix root cause reporte 23/10 11:37: la CF
  // devolvía CLIENT_HAS_OPEN_WAITLIST sobre la propia waitlist que originó
  // el pedido (todavía abierta porque el cliente la marcaba `stage='consumed'`
  // POST `pedidos.add` legacy). Fix:
  //  (a) Si el pedido nace de waitlist (`origen='cpst'` siempre; manual/excel
  //      con `waitlistOrigenId` explícito desde la UI waitlist→pending flow),
  //      excluir ese ID del chequeo.
  //  (b) `origen='cpst'` SIN `waitlistOrigenId` es error del cliente
  //      (nunca adivinar).
  //  (c) `origen='manual'/'excel'` SIN `waitlistOrigenId` sigue el chequeo
  //      histórico (pedido directo, cualquier waitlist abierta ajena bloquea).
  //
  // La waitlist origen se marca `stage='consumed'` dentro del `runTransaction`
  // (ver `commitInTransaction`), no desde el cliente.
  const waitlistOrigenId = payload.waitlistOrigenId || null;
  if (payload.origen === 'cpst' && !waitlistOrigenId) {
    // §64.2 (v1448): log antes del return.
    await logCommitRejection(deps, 'VALIDATION_ERROR', payload, {
      validationReason: 'cpst requiere waitlistOrigenId',
      validationData: { field: 'waitlistOrigenId' },
    });
    return makeError(
      'VALIDATION_ERROR',
      'cpst requiere waitlistOrigenId (la waitlist que originó el pedido)',
      { field: 'waitlistOrigenId' }
    );
  }
  // §67 (2026-10-25 v1454): manual_backorder NO consume waitlist — es un flow
  // paralelo (VDE/admin arma backorder manual sin pasar por lista de espera).
  // Skipeamos el chequeo CLIENT_HAS_OPEN_WAITLIST.
  const skipOpenWaitlistCheck = payload.origen === 'manual_backorder';
  // Para pedidos directos (manual/excel sin waitlistOrigenId) o pedidos que
  // nacen de waitlist (cpst, o manual/excel con waitlistOrigenId): aplicar
  // el check SIEMPRE excluyendo la propia waitlist cuando corresponde.
  // §42 permite a lo sumo UNA orden abierta por cliente; si el pedido viene
  // de esa única orden, el check debe ignorarla.
  const openWaitlists = skipOpenWaitlistCheck
    ? []
    : await findOpenWaitlistsForClientExcludingSelf(deps, payload.cardCode, waitlistOrigenId);
  if (openWaitlists.length > 0) {
    const first = openWaitlists[0];
    // §64.2 (v1448): log antes del return.
    await logCommitRejection(deps, 'CLIENT_HAS_OPEN_WAITLIST', payload, {
      conflictingWaitlistId: first._id,
      conflictingOrderNumber: first.orderNumber || null,
      conflictingItemsCount: Array.isArray(first.items) ? first.items.length : 0,
    });
    return makeError(
      'CLIENT_HAS_OPEN_WAITLIST',
      'El cliente ya tiene una orden abierta en lista de espera',
      {
        waitlistId: first._id,
        orderNumber: first.orderNumber || null,
        items: Array.isArray(first.items) ? first.items.length : 0,
      }
    );
  }

  // 4.5 Tarea L (v1457 2026-10-25): gate UNRESOLVED_BO_ENTRY_ROWS.
  //
  // Si el cliente del VDE marcó alguna línea con `boEntryResolved===null`,
  // significa que había BO previo del mismo SKU+cliente y el VDE no eligió
  // "son las mismas" ni "son más". Rechazamos — es gate del payload, no
  // revalidación de BO server-side (no re-busca `backorder_lines`; confía
  // en el estado capturado por la UI).
  //
  // Shape esperado en payload.lines[i].boEntryResolved: 'same' | 'additional' | null | undefined
  //   - undefined: no había BO previo detectado por el cliente → OK.
  //   - 'same' / 'additional': el VDE resolvió → OK.
  //   - null: pendiente de decisión → errorCode.
  const unresolvedBoRows = (payload.lines || [])
    .filter((l) => l && l.boEntryResolved === null)
    .map((l) => ({
      sku: l.sku,
      cantidad: Number(l.cantidad) || 0,
      boAnterior: Number(l.boEntryPrevio) || 0,
    }));
  if (unresolvedBoRows.length > 0) {
    await logCommitRejection(deps, 'UNRESOLVED_BO_ENTRY_ROWS', payload, {
      unresolvedCount: unresolvedBoRows.length,
      skus: unresolvedBoRows.map((r) => r.sku),
    });
    return makeError(
      'UNRESOLVED_BO_ENTRY_ROWS',
      'Tenés productos marcados en rojo sin revisar. Elegí para cada uno si son las mismas unidades o son más.',
      { rows: unresolvedBoRows }
    );
  }

  // 5. runTransaction atómica.
  let attempts = 0;
  let lastError = null;
  while (attempts < MAX_RETRY_ATTEMPTS) {
    attempts++;
    try {
      const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        return commitInTransaction(deps, tx, payload, now, nowIso);
      });
      log('commitPedidoCore OK', { draftId: payload.draftId, attempts, pedidoId: result.pedidoId });
      // §J (v1455): operations_log entry fire-and-forget si hubo absorciones.
      if (Array.isArray(result.absorptions) && result.absorptions.length > 0) {
        try {
          deps.fbDb
            .collection('operations_log')
            .add({
              type: 'bo_absorbed',
              newPedidoId: result.pedidoId,
              cardCode: payload.cardCode,
              userId: payload.ownerUid || null,
              userEmail: payload.ownerEmail || null,
              absorptions: result.absorptions,
              totalCubierto: result.boAbsorbedTotal || 0,
              timestamp: new Date(now),
            })
            .catch((/** @type {any} */ _e) => {
              log('operations_log bo_absorbed write failed', { err: _e && _e.message });
            });
        } catch (_e) {
          // No propagar.
        }
      }
      return { ...result, servidorNowMs: now, commitAtIso: nowIso };
    } catch (e) {
      const err = /** @type {any} */ (e);
      lastError = err;

      if (err && err._errorCode) {
        // §64.2 (v1448): log centralizado FUERA de la tx (no duplica en
        // retry, no bloquea runTransaction). Business errors de
        // commitInTransaction propagan metadata via `err._data._logExtra`.
        // Para errores sin _logExtra (ej. SAP_UNAVAILABLE), igual se
        // loguea con el shape básico de logCommitRejection.
        const logExtra = err._data && err._data._logExtra ? err._data._logExtra : {};
        await logCommitRejection(
          deps,
          err._errorCode,
          payload,
          Object.assign({}, logExtra, {
            errMessage: err.message || null,
            // Clean err._data for return (remove internal _logExtra).
          })
        );
        // Scrub _logExtra from err._data antes de retornar al cliente
        // (metadata server-side, el cliente no la necesita).
        const dataForClient = Object.assign({}, err._data || {});
        delete dataForClient._logExtra;
        return makeError(err._errorCode, err.message, dataForClient);
      }
      // Otros errores: podría ser retry de Firestore (ya reintenta ~5×
      // automático). Si llegó acá es raro.
      log('commitPedidoCore retry', { draftId: payload.draftId, attempts, err: err.message });
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50 * attempts)); // backoff
    }
  }

  // §64.2 (v1448): log antes del return.
  await logCommitRejection(deps, 'CONTENTION_RETRY_EXHAUSTED', payload, {
    attempts,
    lastError: lastError && lastError.message,
  });
  return makeError('CONTENTION_RETRY_EXHAUSTED', 'Reintenta en 10 segundos', {
    attempts,
    lastError: lastError && lastError.message,
  });
}

/**
 * Lógica dentro de runTransaction. Throws errores de negocio con _errorCode.
 * @param {any} deps
 * @param {any} tx
 * @param {any} payload
 * @param {number} now
 * @param {string} nowIso
 */
async function commitInTransaction(deps, tx, payload, now, nowIso) {
  // §64.3 (2026-10-25) — IDEMPOTENT LOCK dentro de la tx para prevenir
  // duplicados por doble-click concurrente. SATO (2026-10-23 22:08:41 +
  // 22:08:43, 2s de diferencia) muestra que `findExistingByDraftId` pre-tx
  // tiene race: entre que el query ve "no existe" y la tx hace el write,
  // una segunda invocación puede ganar la carrera.
  //
  // Fix: colección `pedido_draft_locks/{draftId}` con doc_id = draftId. El
  // `tx.get(lockRef)` + `tx.set(lockRef, ...)` dentro de la misma tx es
  // atómico — Firestore serializa 2 txns en el mismo doc. La segunda tx
  // concurrente ve el lock de la primera (o es ABORTED y Firestore
  // retrya, viendo el lock en el retry). Idempotent hit → retornar
  // pedidoId del lock.
  //
  // El `findExistingByDraftId` pre-tx se mantiene como fast-path para 99%
  // de los casos (no race), evitando el costo del tx.get del lock.
  const draftLockRef = payload.draftId
    ? deps.fbDb.collection('pedido_draft_locks').doc(payload.draftId)
    : null;
  if (draftLockRef) {
    const lockSnap = await tx.get(draftLockRef);
    if (lockSnap.exists) {
      const lockData = lockSnap.data() || {};
      if (lockData.pedidoId) {
        // Lock ya existe para este draftId. Devolver idempotent hit.
        // Leemos el pedido para construir el lines[] del response.
        const pedidoRef = deps.fbDb.collection('pedidos').doc(lockData.pedidoId);
        const pedidoSnap = await tx.get(pedidoRef);
        const pedidoData = pedidoSnap.exists ? pedidoSnap.data() || {} : {};
        (deps.log || (() => {}))('commitInTransaction idempotent via draftLock', {
          draftId: payload.draftId,
          pedidoId: lockData.pedidoId,
        });
        return {
          ok: true,
          pedidoId: lockData.pedidoId,
          lines: deriveLinesFromExisting(pedidoData),
          diffVsClient: null,
          idempotentHit: true,
          _idempotentSource: 'draft_lock',
        };
      }
    }
  }

  // 5.1 Lee stock_snapshot/{SKU} para cada SKU del payload.
  const skuSet = new Set();
  for (const l of payload.lines) {
    if (l && l.sku) skuSet.add(String(l.sku).toUpperCase());
  }
  /** @type {Map<string, any>} */
  const perSkuData = new Map();
  for (const sku of skuSet) {
    const docRef = deps.fbDb.collection('stock_snapshot').doc(sku);
    const snap = await tx.get(docRef);
    perSkuData.set(sku, snap.exists ? snap.data() : null);
  }

  // 5.2 Lee app_config/stock_snapshot (fisicoDep11 + updatedAt global).
  const stockConfigRef = deps.fbDb.collection('app_config').doc('stock_snapshot');
  const stockConfigSnap = await tx.get(stockConfigRef);
  const stockConfig = stockConfigSnap.exists ? stockConfigSnap.data() || {} : {};
  // HOTFIX URGENTE 2026-10-25: paridad con client-side (index.html:31987-31989).
  // Python escribe warehouseBreakdown como JSON STRING (v368+ para evitar
  // límite 40k index entries Firestore). Hasta hoy el server esperaba
  // 'object' → cuando venía string, warehouseBreakdown = {} vacío → fisico=0
  // → qtyBO = cantidad_pedida → TODO va a BO.
  //
  // Incidente: desde 2026-10-23 17:52 ART todo pedido confirmado por
  // commitPedidoCF quedó stage=confirmed + via='app_only' +
  // reason='all_lines_bo_server_detected'. Víctimas: BROBRO, DESIATA, SATO
  // (duplicado), BOSCHETTO, BAIGORRIA, LA LOMITA. Reparación pendiente.
  //
  // Fix: parsear si viene string (patrón client-side). Fallback {} si
  // malformed o ausente — es defensivo (fisico=0 implica BO, que es safer
  // que crashear la tx).
  /** @type {Record<string, Record<string, number>>} */
  let warehouseBreakdown = {};
  const rawWhsBd = stockConfig && stockConfig.warehouseBreakdown;
  if (rawWhsBd) {
    if (typeof rawWhsBd === 'string') {
      try {
        warehouseBreakdown = JSON.parse(rawWhsBd) || {};
      } catch (_eParseWhs) {
        (deps.log || (() => {}))('warehouseBreakdown JSON.parse fallo', {
          err: _eParseWhs && _eParseWhs.message,
        });
        warehouseBreakdown = {};
      }
    } else if (typeof rawWhsBd === 'object') {
      warehouseBreakdown = rawWhsBd;
    }
  }

  // 5.3 Snapshot age check.
  // El origen del timestamp es SIEMPRE server-side (app_config/stock_snapshot.updatedAt
  // escrito por el workflow Sync SAP Catalog + Stock). El cliente NO envia
  // su propio snapshot timestamp; depende enteramente del valor server-side.
  //
  // §63 Fase 3 Capa 2 (v1445): si deps.fetchStockLive está definido (flag
  // live_sl.enabled=true), SKIPEAR el SNAPSHOT_TOO_OLD acá. La staleness se
  // reevalúa después del live-SL block: si live OK → ignorar staleness; si
  // live fallback + stale → throw SAP_UNAVAILABLE (nuevo errorCode).
  const updatedAt = stockConfig.updatedAt || null;
  if (updatedAt && typeof deps.fetchStockLive !== 'function') {
    const updatedAtMs = typeof updatedAt.toMillis === 'function' ? updatedAt.toMillis() : null;
    if (updatedAtMs !== null) {
      const age = now - updatedAtMs;
      if (age > SNAPSHOT_MAX_AGE_MS) {
        const ageMinutes = Math.floor(age / 60000);
        const lastSyncIso = new Date(updatedAtMs).toISOString();
        // §64.2 (v1448): el log se escribe desde el catch del retry loop
        // (fuera de tx), via err._data. Dentro del runTransaction NO loguear
        // porque: (a) duplica si la tx se reintenta, (b) write out-of-tx
        // bloquea la tx. El catch loop (línea ~240) hace `await
        // logCommitRejection(..., {...err._data})` → detalle preservado.
        throwError(
          'SNAPSHOT_TOO_OLD',
          `Último sync de stock: ${lastSyncIso} (hace ${ageMinutes} min). El pedido queda en espera; se reintenta cuando se refresque el snapshot.`,
          {
            snapshotAgeMs: age,
            snapshotAgeMinutes: ageMinutes,
            snapshotUpdatedAt: lastSyncIso,
            snapshotOrigin: 'server',
            canRefresh: false,
            // §64.2 (v1448): metadata server-side para el log del catch.
            _logExtra: {
              snapshotAgeMs: age,
              snapshotAgeMinutes: ageMinutes,
              snapshotUpdatedAt: new Date(updatedAtMs),
              snapshotOrigin: 'server:app_config/stock_snapshot',
            },
          }
        );
      }
    }
  }

  // §63 Fase 3 Capa 2 (v1445): live SL query opcional.
  // Si deps.fetchStockLive está definido (lo inyecta el wrapper cuando el flag
  // app_config/live_sl.enabled=true), consultamos el fisicoDep11 en vivo al SL
  // y overrideamos warehouseBreakdown[sku]['11'] con el valor live.
  // Fallback a snapshot si falla; throw SAP_UNAVAILABLE solo si falla + snapshot
  // vencido (§Fallback decisión Mariano 2026-10-23).
  let liveStockResult = null;
  if (typeof deps.fetchStockLive === 'function') {
    const skusUnicos = Array.from(
      new Set(
        (payload.lines || [])
          .map((/** @type {any} */ l) => String((l && l.sku) || '').toUpperCase())
          .filter(Boolean)
      )
    );
    if (skusUnicos.length > 0) {
      /** @type {Record<string, number>} */
      const libreSnapshotMap = {};
      /** @type {Record<string, number>} */
      const qtyPedidaMap = {};
      for (const l of payload.lines) {
        const s = String((l && l.sku) || '').toUpperCase();
        if (!s) continue;
        libreSnapshotMap[s] = Number(warehouseBreakdown[s]?.['11'] || 0);
        qtyPedidaMap[s] = (qtyPedidaMap[s] || 0) + (Number(l.cantidad) || 0);
      }
      try {
        liveStockResult = await deps.fetchStockLive({
          skus: skusUnicos,
          libreSnapshot: libreSnapshotMap,
          qtyPedida: qtyPedidaMap,
        });
        if (liveStockResult && liveStockResult.ok && !liveStockResult.snapshotFallback) {
          // Override fisico dep11 con valor live para los SKUs fetched.
          for (const sku of liveStockResult.skusLive || []) {
            const fisicoLive = Number(liveStockResult.fisicoDep11?.[sku] || 0);
            if (!warehouseBreakdown[sku]) warehouseBreakdown[sku] = {};
            warehouseBreakdown[sku]['11'] = fisicoLive;
          }
          (deps.log || (() => {}))('commitPedidoCore live SL applied', {
            skusLive: (liveStockResult.skusLive || []).length,
            skusSnapshot: (liveStockResult.skusSnapshot || []).length,
            partial: !!liveStockResult.partial,
            durationMs: liveStockResult.durationMs,
          });
        } else if (liveStockResult && liveStockResult.snapshotFallback) {
          // SL caído / timeout / disabled. Chequeamos snapshot age; si vencido →
          // throw SAP_UNAVAILABLE.
          if (updatedAt) {
            const updatedAtMs =
              typeof updatedAt.toMillis === 'function' ? updatedAt.toMillis() : null;
            if (updatedAtMs !== null && now - updatedAtMs > SNAPSHOT_MAX_AGE_MS) {
              throwError(
                'SAP_UNAVAILABLE',
                'SAP no respondió y el último sync de stock está vencido. Reintentá en unos minutos; si persiste contactá admin.',
                {
                  snapshotAgeMinutes: Math.floor((now - updatedAtMs) / 60000),
                  liveReason: liveStockResult.reason || null,
                  canRefresh: false,
                }
              );
            }
          }
          (deps.log || (() => {}))('commitPedidoCore live SL fallback → usando snapshot', {
            reason: liveStockResult.reason,
            snapshotAgeMinutes: updatedAt
              ? Math.floor(
                  (now - (typeof updatedAt.toMillis === 'function' ? updatedAt.toMillis() : now)) /
                    60000
                )
              : null,
          });
        }
      } catch (e) {
        if (e && e._errorCode === 'SAP_UNAVAILABLE') throw e;
        (deps.log || (() => {}))('commitPedidoCore live SL error (ignored, cae a snapshot)', {
          err: (e && e.message) || String(e),
        });
      }
    }
  }

  // 5.4 Lee pedidos abiertos para computar breakdown live (para los SKUs del payload).
  // En E2 Fase 1 leemos TODOS los pedidos abiertos (como hace el trigger existente).
  // En Fase 2 se puede optimizar con query por SKU + index.
  const pedidosSnap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {any[]} */
  const pedidos = [];
  pedidosSnap.forEach((/** @type {any} */ d) => {
    pedidos.push({ _fsId: d.id, ...d.data() });
  });

  // 5.5 Lee ingresos_reparto activos (per SKU, para pendienteReparto).
  const repartoActiveSnap = await deps.fbDb
    .collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();
  /** @type {any[]} */
  const repartosActivos = [];
  repartoActiveSnap.forEach((/** @type {any} */ d) =>
    repartosActivos.push({ _fsId: d.id, ...d.data() })
  );

  // 5.6 Compute breakdown por SKU + decide por línea.
  /** @type {Array<any>} */
  const lineasResultado = [];
  /** @type {Array<any>} */
  const docLines = [];

  // §67 (2026-10-25 v1454): origen='manual_backorder' usa linesPrebuilt del
  // payload sin recomputar breakdown. El flow GB manual arma las líneas con
  // state=ASIG/BO + campos propios (asigCliTipo='manual-backorder',
  // targetMonth, manualBackorder, asigReserva, asigAt) que no se derivan del
  // breakdown. Validamos shape mínimo y propagamos. CLIENT_HAS_OPEN_WAITLIST
  // ya skippeado arriba; aquí NO corremos STOCK_CHANGED (el objetivo del BO
  // manual ES capturar demanda incluso sin stock físico).
  if (payload.origen === 'manual_backorder') {
    const prebuilt = Array.isArray(payload.linesPrebuilt) ? payload.linesPrebuilt : [];
    if (prebuilt.length === 0) {
      await logCommitRejection(deps, 'VALIDATION_ERROR', payload, {
        validationReason: 'manual_backorder requiere linesPrebuilt no-vacío',
        validationData: { field: 'linesPrebuilt' },
      });
      return makeError('VALIDATION_ERROR', 'manual_backorder requiere linesPrebuilt no-vacío', {
        field: 'linesPrebuilt',
      });
    }
    for (const l of prebuilt) {
      if (!l || !l.code) continue;
      const q = Number(l.qty) || 0;
      if (q <= 0) continue;
      const state = String(l.state || '').toUpperCase();
      if (state !== 'ASIG' && state !== 'BO') continue; // defensa
      docLines.push({ ...l, qty: q, qtyOpen: Number(l.qtyOpen) || q, state });
      lineasResultado.push({
        sku: String(l.code).toUpperCase(),
        qtyConfirmed: state === 'ASIG' ? q : 0,
        qtyBO: state === 'BO' ? q : 0,
        reason: 'manual_backorder_prebuilt',
      });
    }
    if (docLines.length === 0) {
      await logCommitRejection(deps, 'VALIDATION_ERROR', payload, {
        validationReason: 'manual_backorder sin líneas válidas tras filter',
        validationData: { field: 'linesPrebuilt' },
      });
      return makeError(
        'VALIDATION_ERROR',
        'manual_backorder sin líneas válidas (state ∈ {ASIG, BO}, qty > 0)',
        { field: 'linesPrebuilt' }
      );
    }
  } else {
    for (const payloadLine of payload.lines) {
      const sku = String(payloadLine.sku || '').toUpperCase();
      const cantidad = Number(payloadLine.cantidad) || 0;
      if (!sku || cantidad <= 0) continue;

      const fisicoDep11 = Number(warehouseBreakdown[sku]?.['11'] || 0);
      const transitoDep12 = Number(warehouseBreakdown[sku]?.['12'] || 0);

      const breakdown = getStockBreakdown(
        sku,
        {
          getStockFisico: () => fisicoDep11,
          getStockTransito: () => transitoDep12,
          pedidos,
          ingresosRepartoActivos: repartosActivos,
        },
        { now }
      );

      // CLAUDE.md §33 + §35: fórmula POR LÍNEA.
      // - origenLinea='stock-asignado' con asigRefs populated → utilizablePara
      //   (incluye reservas propias que serán canceladas por el bloque CPST).
      // - cualquier otra línea → libre global (no suma reservas propias; una
      //   nueva línea manual no cancela ASIG propia existente).
      const esStockAsignado =
        payloadLine.origenLinea === 'stock-asignado' &&
        Array.isArray(payloadLine.asigRefs) &&
        payloadLine.asigRefs.length > 0;
      const utilizable = esStockAsignado
        ? breakdown.utilizablePara(payload.cardCode)
        : breakdown.libre;
      const qtyConfirmed = Math.min(cantidad, utilizable);
      const qtyBO = cantidad - qtyConfirmed;

      let reason = 'ok';
      if (qtyBO > 0 && qtyConfirmed === 0) reason = 'stock_no_disponible';
      else if (qtyBO > 0) reason = 'stock_parcial';

      lineasResultado.push({
        sku,
        qtyConfirmed,
        qtyBO,
        reason,
        libre: breakdown.libre,
        utilizablePara: utilizable,
        // §64 (v1443): preservar breakdown para logging STOCK_CHANGED.
        breakdown,
      });

      if (qtyConfirmed > 0) {
        docLines.push({
          code: sku,
          qty: qtyConfirmed,
          qtyOpen: qtyConfirmed,
          qtyInvoiced: 0,
          qtyCancelled: 0,
          qtyRecycled: 0,
          state: 'confirmed',
          precio: Number(payloadLine.precio) || 0,
          notas: payloadLine.notas || '',
          origen: payloadLine.origenLinea || undefined,
          asigRefs: Array.isArray(payloadLine.asigRefs) ? payloadLine.asigRefs : undefined,
        });
      }
      if (qtyBO > 0) {
        docLines.push({
          code: sku,
          qty: qtyBO,
          qtyOpen: qtyBO,
          qtyInvoiced: 0,
          qtyCancelled: 0,
          qtyRecycled: 0,
          state: 'BO',
          precio: Number(payloadLine.precio) || 0,
          notas: payloadLine.notas || '',
        });
      }
    }
  } // close else (payload.origen !== 'manual_backorder')

  // 5.7 Compute diffVsClient.
  // §67 (v1454): skip para manual_backorder (lineasResultado no tiene breakdown
  // y el objetivo es capturar demanda incluso sin stock físico).
  const diffVsClient =
    payload.origen === 'manual_backorder' ? null : computeDiffVsClient(lineasResultado, payload);
  if (diffVsClient && !payload.autoAcceptStockChange) {
    // §64.2 (v1448): compute skuDetails + propagar via err._data. El catch
    // del retry loop (línea ~240) hace `await logCommitRejection(...,
    // {...err._data, ...})` → log garantizado desde FUERA de la tx (sin
    // duplicados en retry, sin bloquear el callback de runTransaction).
    const clientStock =
      payload && typeof payload.clientStock === 'object' ? payload.clientStock : null;
    const serverSnapshotUpdatedAt =
      updatedAt && typeof updatedAt.toMillis === 'function' ? new Date(updatedAt.toMillis()) : null;
    const skuDetails = diffVsClient.skuChanged.map((/** @type {any} */ ch) => {
      const serverLine = lineasResultado.find((/** @type {any} */ l) => l.sku === ch.sku) || {};
      const serverBd = serverLine.breakdown || null;
      // §64.3 (v1453): `serverBd.utilizablePara` es una FUNCIÓN
      // (`src/pure/stock-breakdown.js:327 utilizablePara = (cardCode) => {...}`),
      // no un número. Pre-fix guardábamos la función como campo del log entry →
      // Firestore rechazaba silenciosamente ("Cannot encode value: function").
      // Los 10 eventos STOCK_CHANGED reales desde v1443 (23/10 15:37 ART)
      // perdieron su log. Fix: invocamos la función con el cardCode del payload
      // para obtener el número efectivo auditado.
      const _utilizableParaNum =
        serverBd && typeof serverBd.utilizablePara === 'function'
          ? Number(serverBd.utilizablePara(payload && payload.cardCode)) || 0
          : serverBd && typeof serverBd.utilizablePara === 'number'
            ? serverBd.utilizablePara
            : null;
      const serverPayload = {
        qtyConfirmed: ch.podesLlevar,
        qtyBO: ch.aBackOrder,
        libre: serverBd ? serverBd.libre : null,
        utilizablePara: _utilizableParaNum,
        fisicoDep11: serverBd ? serverBd.fisicoDep11 : null,
        reservadasTotal: serverBd ? serverBd.reservadasTotal : null,
        backorderAppTotal: serverBd && serverBd.backorderApp ? serverBd.backorderApp.total : null,
        asignadasTotal: serverBd && serverBd.asignadas ? serverBd.asignadas.total : null,
        _version: serverBd ? serverBd._version : null,
        reason: serverLine.reason || null,
      };
      const clientPayload = clientStock && clientStock[ch.sku] ? clientStock[ch.sku] : null;
      return {
        sku: ch.sku,
        pediste: ch.pediste,
        server: serverPayload,
        client: clientPayload,
        mismatch: clientPayload
          ? {
              libre:
                clientPayload.libre !== undefined && clientPayload.libre !== serverPayload.libre,
              utilizablePara:
                clientPayload.utilizablePara !== undefined &&
                clientPayload.utilizablePara !== serverPayload.utilizablePara,
              fisicoDep11:
                clientPayload.fisicoDep11 !== undefined &&
                clientPayload.fisicoDep11 !== serverPayload.fisicoDep11,
            }
          : null,
      };
    });
    throwError('STOCK_CHANGED', 'El stock cambió entre que viste la pantalla y confirmaste', {
      diff: diffVsClient.skuChanged,
      message: diffVsClient.message,
      // Metadata para el log del catch (via err._data → logCommitRejection extra).
      _logExtra: {
        skuDetails,
        totalSkuChanged: diffVsClient.skuChanged.length,
        totalUnitsToBO: diffVsClient.skuChanged.reduce(
          (/** @type {number} */ a, /** @type {any} */ b) => a + (Number(b.aBackOrder) || 0),
          0
        ),
        serverSnapshotUpdatedAt,
        serverSnapshotOrigin: 'server:app_config/stock_snapshot',
        clientSnapshotProvided: !!clientStock,
        clientSnapshotUpdatedAt:
          payload && payload.clientSnapshotUpdatedAt ? payload.clientSnapshotUpdatedAt : null,
      },
    });
  }

  // §58 (2026-10-23) — pre-fetch de TODOS los docs mutados ANTES de los
  // writes. Firestore exige "all reads before all writes" dentro de un
  // runTransaction; mezclar un write con un read posterior tira
  // "FAILED_PRECONDITION: Firestore transactions require all reads to be
  // executed before all writes" → core reintenta 5× (misma falla) → el
  // cliente recibe CONTENTION_RETRY_EXHAUSTED "Reintenta en 10 segundos".
  //
  // Precedente prod: 2026-10-23 Gonzalo De La Rosa cliente BROBRO/DEVOTO.
  // 1. 1er intento → STOCK_CHANGED (throw ANTES de tx.set, OK).
  // 2. Modal "¿Confirmar con BO?" → acepta.
  // 3. 2do intento con autoAcceptStockChange=true → NO throw → tx.set del
  //    pedido → tx.get(wlRef) / tx.get(refDoc en ASIG) → FAILED_PRECONDITION
  //    → 5× retry → "Reintenta en 10 segundos" sin salida.
  //
  // Fix: pre-fetch acá; usar los snapshots fetcheados en los pasos 5.8/5.9.
  const pedidoRef = deps.fbDb.collection('pedidos').doc();

  // 5.7a Pre-fetch ASIG origen docs (si origen='cpst' con asigRefs).
  /** @type {Map<string, any>} */
  const asigOrigenSnapshots = new Map();
  if (payload.origen === 'cpst') {
    const pedidoOrigenIds = new Set();
    for (const l of payload.lines) {
      if (!Array.isArray(l.asigRefs)) continue;
      for (const r of l.asigRefs) {
        if (r && r.pedidoId) pedidoOrigenIds.add(r.pedidoId);
      }
    }
    for (const pedidoOrigenId of pedidoOrigenIds) {
      const refDoc = deps.fbDb.collection('pedidos').doc(pedidoOrigenId);
      const snap = await tx.get(refDoc);
      asigOrigenSnapshots.set(pedidoOrigenId, {
        ref: refDoc,
        exists: snap.exists,
        data: snap.exists ? snap.data() || {} : null,
      });
    }
  }

  // 5.7b Pre-fetch waitlist origen (si waitlistOrigenId).
  /** @type {{ref: any, exists: boolean} | null} */
  let waitlistOrigenSnap = null;
  if (payload.waitlistOrigenId) {
    const wlRef = deps.fbDb.collection('revision_waitlist').doc(payload.waitlistOrigenId);
    const wlSnap = await tx.get(wlRef);
    waitlistOrigenSnap = { ref: wlRef, exists: wlSnap.exists };
  }

  // 5.7c §J (v1455 2026-10-25) — Compute absorciones de BO + pre-fetch pedidos origen.
  /** @type {Record<string, number>} */
  const qtyConfirmedPorSku = {};
  for (const l of docLines) {
    if (!l || l.state !== 'confirmed') continue;
    const sku = String(l.code || '').toUpperCase();
    qtyConfirmedPorSku[sku] = (qtyConfirmedPorSku[sku] || 0) + (Number(l.qty) || 0);
  }
  const absorptionInputLines = Object.keys(qtyConfirmedPorSku)
    .filter((sku) => qtyConfirmedPorSku[sku] > 0)
    .map((sku) => ({ sku, cantidad: qtyConfirmedPorSku[sku] }));
  const absorbResult =
    absorptionInputLines.length > 0
      ? computeBoAbsorption({
          cardCode: payload.cardCode,
          lines: absorptionInputLines,
          allPedidos: pedidos,
          now,
        })
      : { absorptions: [], totalCubierto: 0 };
  /** @type {Map<string, {ref: any, exists: boolean, data: any}>} */
  const absorbOrigenSnapshots = new Map();
  if (absorbResult.absorptions.length > 0) {
    const uniquePedidoIds = new Set(
      absorbResult.absorptions.map((/** @type {any} */ a) => String(a.pedidoIdOrigen))
    );
    for (const pid of uniquePedidoIds) {
      if (asigOrigenSnapshots.has(pid)) {
        const existingSnap = asigOrigenSnapshots.get(pid);
        if (existingSnap) absorbOrigenSnapshots.set(pid, existingSnap);
        continue;
      }
      const refDoc = deps.fbDb.collection('pedidos').doc(pid);
      const snap = await tx.get(refDoc);
      absorbOrigenSnapshots.set(pid, {
        ref: refDoc,
        exists: snap.exists,
        data: snap.exists ? snap.data() || {} : null,
      });
    }
  }

  // ===== A partir de acá, solo WRITES (ningún tx.get). =====

  // 5.8 Escribir pedido nuevo.
  const pedidoData = buildPedidoDocData(payload, docLines, nowIso, deps);
  tx.set(pedidoRef, pedidoData);

  // §64.3 (2026-10-25): escribir el draftLock atómicamente junto al pedido.
  // Previene duplicados por doble-click concurrente. Ver tx.get del lock
  // al inicio de commitInTransaction.
  if (draftLockRef) {
    tx.set(draftLockRef, {
      pedidoId: pedidoRef.id,
      draftId: payload.draftId,
      cardCode: payload.cardCode,
      origen: payload.origen || null,
      ownerUid: payload.ownerUid || null,
      createdAt: nowIso,
    });
  }

  // 5.9 Cancelar ASIG originales si origen='cpst' (usa snapshots pre-fetched).
  if (payload.origen === 'cpst' && asigOrigenSnapshots.size > 0) {
    cancelAsigRefsFromPrefetched(tx, payload, pedidoRef.id, nowIso, asigOrigenSnapshots);
  }

  // 5.9b §J (v1455 2026-10-25) — Aplicar absorciones de BO sobre pedidos
  // origen pre-fetcheados. Mutaciones: qtyOpen -= absorbed; si 0 → cancelled
  // + closedReason='absorbed_by_newer_confirmed'. Audit en _backfill (§55).
  if (absorbResult.absorptions.length > 0) {
    /** @type {Map<string, Array<any>>} */
    const absByPedido = new Map();
    for (const a of absorbResult.absorptions) {
      const pid = String(a.pedidoIdOrigen);
      if (!absByPedido.has(pid)) absByPedido.set(pid, []);
      const arr = absByPedido.get(pid);
      if (arr) arr.push(a);
    }
    for (const [pid, absList] of absByPedido) {
      const snap = absorbOrigenSnapshots.get(pid);
      if (!snap || !snap.exists) continue;
      const data = snap.data || {};
      const newLines = applyAbsorptionsToLines(data.lines || [], absList, pedidoRef.id, nowIso);
      const newBackfill = buildBackfillUpdate(data._backfill || {}, absList, pedidoRef.id, nowIso);
      tx.update(snap.ref, { lines: newLines, _backfill: newBackfill, updatedAt: nowIso });
    }
  }

  // 5.10 §57 (2026-10-23) — marcar waitlist origen `stage='consumed'` + `closedAt`
  // DENTRO de la misma transacción. Antes el cliente lo hacía POST
  // `pedidos.add` → ventana de carrera donde la CF (en el mismo tick de
  // Firestore) encontraba la waitlist "aún abierta" y disparaba
  // CLIENT_HAS_OPEN_WAITLIST sobre sí misma. Fix: aquí.
  //
  // Idempotente: si ya está consumed por un reintento post-hoc, update
  // sobrescribe los mismos campos (noop semántico).
  if (waitlistOrigenSnap && waitlistOrigenSnap.exists) {
    tx.update(waitlistOrigenSnap.ref, {
      stage: 'consumed',
      consumedByPedidoId: pedidoRef.id,
      consumedAt: nowIso,
      closedAt: nowIso,
      closedReason: 'consumed_by_commitPedidoCF',
      updatedAt: nowIso,
    });
  }
  // Si waitlistOrigenId venía pero la waitlist no existe (edge case:
  // borrada entre UI y CF), no bloqueamos — el pedido ya se persistió.

  return {
    ok: true,
    pedidoId: pedidoRef.id,
    lines: lineasResultado,
    diffVsClient,
    // §J (v1455): absorciones expuestas al cliente para modal "cubre N u"
    // + extensión del oneliner _origenesACancelar en index.html.
    absorptions: absorbResult.absorptions,
    boAbsorbedTotal: absorbResult.totalCubierto,
    attempts: 1,
  };
}

/**
 * Cancela las ASIG originales referenciadas en el payload (origen='cpst').
 *
 * §58 (2026-10-23): esta versión usa snapshots PRE-FETCHED (ya leídos antes
 * del primer `tx.set`) para no violar la invariante Firestore "all reads
 * before all writes". El `cancelAsigRefsInTransaction` histórico hacía
 * `tx.get(refDoc)` DESPUÉS del `tx.set(pedidoRef)` → FAILED_PRECONDITION.
 *
 * @param {any} tx
 * @param {any} payload
 * @param {string} newPedidoId
 * @param {string} nowIso
 * @param {Map<string, {ref: any, exists: boolean, data: any}>} snapshots
 */
function cancelAsigRefsFromPrefetched(tx, payload, newPedidoId, nowIso, snapshots) {
  /** @type {Map<string, Array<any>>} */
  const refsByPedido = new Map();
  for (const l of payload.lines) {
    if (!Array.isArray(l.asigRefs)) continue;
    for (const r of l.asigRefs) {
      if (!r || !r.pedidoId) continue;
      if (!refsByPedido.has(r.pedidoId)) refsByPedido.set(r.pedidoId, []);
      const arr = /** @type {any[]} */ (refsByPedido.get(r.pedidoId));
      if (arr) arr.push(r);
    }
  }
  for (const [pedidoOrigenId, refs] of refsByPedido) {
    const snap = snapshots.get(pedidoOrigenId);
    if (!snap || !snap.exists) continue;
    const data = snap.data || {};
    const newLines = Array.isArray(data.lines)
      ? data.lines.map((/** @type {any} */ l) => ({ ...l }))
      : [];
    for (const r of refs) {
      const li = Number(r.lineIndex);
      if (!newLines[li]) continue;
      newLines[li] = {
        ...newLines[li],
        state: 'cancelled',
        qtyOpen: 0,
        qtyCancelled: (Number(newLines[li].qtyCancelled) || 0) + (Number(newLines[li].qty) || 0),
        closedReason: 'waitlist-confirm',
        cancelledAt: nowIso,
        cancelledIntoPedidoId: newPedidoId,
        asigReserva: false,
      };
    }
    tx.update(snap.ref, { lines: newLines, updatedAt: nowIso });
  }
}

/**
 * Build pedido doc data.
 */
/** @param {any} payload @param {any[]} docLines @param {string} nowIso @param {any} deps */
function buildPedidoDocData(payload, docLines, nowIso, deps) {
  const FieldValue = deps.FieldValue || null;
  // §67 (v1454): source/transferidoSAP derivados por origen. manual_backorder
  // nunca va a SAP (skipSap=true, via='manual-backorder'); cpst usa el batch
  // marker; el resto delega al payload.source.
  const isManualBo = payload.origen === 'manual_backorder';
  const resolvedSource = isManualBo
    ? 'manual-backorder'
    : payload.origen === 'cpst'
      ? 'stock-asignado-batch'
      : payload.source || '';
  const resolvedTransferidoSAP = isManualBo
    ? {
        via: 'manual-backorder',
        skipSap: true,
        docNum: null,
        docEntry: null,
        createdAt: nowIso,
      }
    : null;
  const netAmount = isManualBo
    ? Math.round(computeGrossAmountAll(docLines))
    : computeNetAmount(docLines);
  const base = {
    _draftId: payload.draftId,
    _commitVersion: 'commitPedidoCore_v1',
    clientCardCode: payload.cardCode,
    clientName: payload.clientName || '',
    origen: payload.origen,
    source: resolvedSource,
    lines: docLines,
    stage: 'confirmed',
    confirmedAt: FieldValue ? FieldValue.serverTimestamp() : nowIso,
    createdAt: FieldValue ? FieldValue.serverTimestamp() : nowIso,
    closedAt: null,
    closedReason: null,
    schemaVersion: 2,
    sapLinkage: { soDocEntry: null, lastInvoiceDocEntry: null, lastSyncAt: null },
    transferidoSAP: resolvedTransferidoSAP,
    sendingSapLock: null,
    formaEntrega: payload.formaEntrega || null,
    condicionPago: payload.condicionPago || '',
    observaciones: payload.observaciones || '',
    netAmountArs: netAmount,
    subtotalArs: netAmount,
    discountPct: 0,
    ownerUid: payload.ownerUid || null,
    ownerEmail: payload.ownerEmail || null,
    ownerVendor: payload.ownerVendor || null,
    cargadoPorUid: payload.ownerUid || null,
    cargadoPorEmail: payload.ownerEmail || null,
    // §44/§46 (v1406/v1412): persistimos los campos vendedor-del-master si
    // vinieron en el payload (los calcula el cliente via
    // _enrichPayloadWithClientVendor). Null-safe para flows legacy que no
    // los enviaban.
    vendorAssigned: payload.vendorAssigned || null,
    assignedVendorUid: payload.assignedVendorUid || null,
    assignedVendorEmail: payload.assignedVendorEmail || null,
    assignedVendorReason: payload.assignedVendorReason || null,
    // §67 (v1454): preservar la key canónica + tipo + province + locName del
    // payload para el camino manual_backorder (listener agrupa por `key`).
    key: payload.key || null,
    tipo: payload.tipo || null,
    province: payload.province || null,
    locName: payload.locName || null,
    clientProvince: payload.clientProvince || null,
    clientLocality: payload.clientLocality || null,
    orderNumber: payload.orderNumber || null,
    // §57 (2026-10-23): preserva link al waitlist origen para auditoría +
    // consumers legacy (bloque v1058 que ya persistía `waitlistOrigenId`
    // desde el cliente). CF ahora es la autoridad.
    waitlistOrigenId: payload.waitlistOrigenId || null,
  };
  return base;
}

/** @param {any[]} lines */
function computeNetAmount(lines) {
  let s = 0;
  for (const l of lines) {
    if (!l || l.state !== 'confirmed') continue;
    s += (Number(l.qty) || 0) * (Number(l.precio) || 0);
  }
  return s;
}

/**
 * §67 (v1454): gross total sumando TODAS las líneas (ASIG + BO) para
 * manual_backorder. computeNetAmount filtra `state=confirmed` (flow normal);
 * backorder manual quiere mostrar la demanda total.
 * @param {any[]} lines
 */
function computeGrossAmountAll(lines) {
  let s = 0;
  for (const l of lines) {
    if (!l) continue;
    s += (Number(l.qty) || 0) * (Number(l.precio) || 0);
  }
  return s;
}

/** @param {any[]} lineasResultado @param {any} payload */
function computeDiffVsClient(lineasResultado, payload) {
  // §64.1 FIX (2026-10-23 v1447): comparar POR VALOR de los SKUs del pedido.
  //
  // Mariano reporte 17:27 ART: pedido recién abierto, nada cambió, igual
  // devolvía STOCK_CHANGED. Hipótesis confirmada: el sync re-escribe
  // snapshot cada 5 min; si el cliente pidió 7 con libre=6, qtyBO=1 (el
  // cliente YA SABE esto desde que armó el pedido). La CF al validar
  // también calcula qtyBO=1 → disparaba STOCK_CHANGED aunque los números
  // coinciden con lo que el cliente vio.
  //
  // Fix: comparar valor por valor contra `payload.clientStock[sku]` (lo
  // que el cliente usó al armar el pedido). Si `fisicoDep11` y `libre`
  // coinciden entre cliente y CF, NO disparar aunque qtyBO > 0 — el
  // cliente ya conocía el back order; una corrida de sync con los mismos
  // números no es un cambio.
  //
  // Dispara cuando:
  //   - CF ve `fisicoDep11` o `libre` distinto a lo que cliente envió
  //     (otro pedido o reparto tocó el stock entre ambos reads).
  //   - El cliente NO envió `clientStock` (SW stale pre-v1443) y `qtyBO > 0`
  //     → mantener comportamiento histórico; sin info del cliente, el
  //     back order inesperado se reporta igual.
  const clientStock =
    payload && payload.clientStock && typeof payload.clientStock === 'object'
      ? payload.clientStock
      : null;
  const changed = [];
  for (const l of lineasResultado) {
    const original = payload.lines.find(
      (/** @type {any} */ p) => String(p.sku).toUpperCase() === l.sku
    );
    if (!original) continue;
    if (l.qtyBO <= 0) continue;
    // Comparar con clientStock si vino.
    if (clientStock && clientStock[l.sku] && typeof clientStock[l.sku] === 'object') {
      const cs = clientStock[l.sku];
      const clientFisico = Number(cs.fisicoDep11);
      const clientLibre = Number(cs.libre);
      const serverFisico = Number((l.breakdown && l.breakdown.fisicoDep11) || 0);
      const serverLibre = Number(l.libre || 0);
      if (
        Number.isFinite(clientFisico) &&
        Number.isFinite(clientLibre) &&
        clientFisico === serverFisico &&
        clientLibre === serverLibre
      ) {
        // Mismos valores vistos por cliente y CF. El cliente ya sabía
        // que qtyBO=l.qtyBO. No es un "cambio" entre pantalla y commit.
        continue;
      }
    }
    changed.push({
      sku: l.sku,
      pediste: Number(original.cantidad) || 0,
      podesLlevar: l.qtyConfirmed,
      aBackOrder: l.qtyBO,
    });
  }
  if (changed.length === 0) return null;
  const totalBO = changed.reduce((a, b) => a + b.aBackOrder, 0);
  return {
    skuChanged: changed,
    message: `${totalBO} unidad(es) pasaron a back order porque otro pedido las tomó antes`,
  };
}

/** @param {any} payload */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'payload vacío', data: null };
  }
  if (!payload.draftId || typeof payload.draftId !== 'string') {
    return { ok: false, message: 'draftId requerido', data: { field: 'draftId' } };
  }
  if (!payload.cardCode || typeof payload.cardCode !== 'string') {
    return { ok: false, message: 'cardCode requerido', data: { field: 'cardCode' } };
  }
  if (!VALID_ORIGENS.has(payload.origen)) {
    return {
      ok: false,
      message: 'origen inválido',
      data: { field: 'origen', value: payload.origen },
    };
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    return { ok: false, message: 'lines requerido no-vacío', data: { field: 'lines' } };
  }
  for (const l of payload.lines) {
    if (!l || !l.sku) return { ok: false, message: 'line.sku requerido', data: { line: l } };
    if (!Number.isFinite(Number(l.cantidad)) || Number(l.cantidad) <= 0) {
      return { ok: false, message: 'line.cantidad > 0 requerido', data: { line: l } };
    }
  }
  if (!payload.clientVersion || typeof payload.clientVersion !== 'string') {
    return { ok: false, message: 'clientVersion requerido', data: { field: 'clientVersion' } };
  }
  // §57 (2026-10-23): waitlistOrigenId es opcional pero si viene DEBE ser
  // string no-vacío. Permite null/undefined para pedidos directos.
  if (payload.waitlistOrigenId !== undefined && payload.waitlistOrigenId !== null) {
    if (typeof payload.waitlistOrigenId !== 'string' || !payload.waitlistOrigenId.trim()) {
      return {
        ok: false,
        message: 'waitlistOrigenId debe ser string no-vacío si viene',
        data: { field: 'waitlistOrigenId' },
      };
    }
  }
  return { ok: true };
}

/** @param {string} a @param {string} b */
function isVersionLessThan(a, b) {
  // Simplicfied: 'v1430' < 'v1500'. Spliteá por 'v' + number compare.
  const na = Number(String(a).replace(/^v/, '')) || 0;
  const nb = Number(String(b).replace(/^v/, '')) || 0;
  return na < nb;
}

/** @param {any} deps @param {string} draftId */
async function findExistingByDraftId(deps, draftId) {
  if (!draftId) return null;
  const q = await deps.fbDb.collection('pedidos').where('_draftId', '==', draftId).limit(1).get();
  if (q.empty) return null;
  const doc = q.docs[0];
  return { id: doc.id, data: doc.data() };
}

/** @param {any} pedidoData */
function deriveLinesFromExisting(pedidoData) {
  const result = [];
  const linesByCode = new Map();
  for (const l of pedidoData.lines || []) {
    if (!l || !l.code) continue;
    const code = String(l.code).toUpperCase();
    if (!linesByCode.has(code)) linesByCode.set(code, { qtyConfirmed: 0, qtyBO: 0 });
    const entry = linesByCode.get(code);
    const qty = Number(l.qty) || 0;
    if (l.state === 'confirmed' || l.state === 'ASIG') entry.qtyConfirmed += qty;
    else if (l.state === 'BO') entry.qtyBO += qty;
  }
  for (const [sku, entry] of linesByCode) {
    result.push({
      sku,
      qtyConfirmed: entry.qtyConfirmed,
      qtyBO: entry.qtyBO,
      reason: 'idempotent',
    });
  }
  return result;
}

/**
 * §57: delega al pure helper después de leer de Firestore. Lee TODAS las
 * waitlists del cliente (sin filtro de `closedAt` para capturar también los
 * documentos recientes con escritura optimistic). La función pura filtra
 * los campos relevantes.
 *
 * @param {any} deps
 * @param {string} cardCode
 * @param {string | null | undefined} excludeWaitlistId
 * @returns {Promise<Array<any>>} Waitlists abiertas filtradas (sin la de origen).
 */
async function findOpenWaitlistsForClientExcludingSelf(deps, cardCode, excludeWaitlistId) {
  if (!cardCode) return [];
  const q = await deps.fbDb
    .collection('revision_waitlist')
    .where('clientCardCode', '==', cardCode)
    .get();
  if (q.empty) return [];
  /** @type {Array<any>} */
  const docs = [];
  q.forEach((/** @type {any} */ d) => {
    docs.push({ _id: d.id, ...d.data() });
  });
  return findOpenWaitlistsPure(cardCode, excludeWaitlistId, docs);
}

/** @param {string} code @param {string} message @param {any} [data] */
function throwError(code, message, data) {
  const e = new Error(message);
  /** @type {any} */ (e)._errorCode = code;
  /** @type {any} */ (e)._data = data || {};
  throw e;
}

/** @param {string} code @param {string} message @param {any} [data] */
function makeError(code, message, data) {
  return { ok: false, errorCode: code, message, data: data || {} };
}

/**
 * §64.2 (2026-10-23 v1448): logging centralizado de rechazos commitPedido.
 *
 * TODO rechazo (`makeError` o `throwError`) debe pasar por acá antes de
 * retornar/tirar. Pedido Mariano: "no puede haber un rechazo de la CF sin
 * registro". El fire-and-forget previo (§60/§64) perdía logs cuando el
 * runtime terminaba la invocación antes de que el `.add()` complete.
 *
 * **AWAIT no fire-and-forget**. Garantiza que el log existe antes del return.
 * Costo: ~20-50ms extra por rechazo. Acceptable: si rechazamos, informamos.
 *
 * @param {any} deps Deps de commitPedidoCore (fbDb + log).
 * @param {string} errorCode Uno de VERSION_OLD/CLIENT_HAS_OPEN_WAITLIST/
 *   STOCK_CHANGED/SNAPSHOT_TOO_OLD/CONTENTION_RETRY_EXHAUSTED/VALIDATION_ERROR/
 *   PERMISSION_DENIED/SAP_UNAVAILABLE.
 * @param {any} payload El payload del request (para extraer draftId, cardCode, etc).
 * @param {any} [extra] Campos específicos del error (ej. skuDetails, snapshotAgeMinutes).
 */
async function logCommitRejection(deps, errorCode, payload, extra) {
  if (!deps || !deps.fbDb) return;
  try {
    const now =
      deps.now && typeof deps.now === 'function'
        ? deps.now() instanceof Date
          ? /** @type {Date} */ (deps.now()).getTime()
          : /** @type {number} */ (deps.now())
        : Date.now();
    const entry = Object.assign(
      {
        type: 'commit_pedido_rejected',
        errorCode,
        userId:
          payload && (payload.ownerUid || payload.userId)
            ? payload.ownerUid || payload.userId
            : null,
        userEmail:
          payload && (payload.ownerEmail || payload.userEmail)
            ? payload.ownerEmail || payload.userEmail
            : null,
        cardCode: payload && payload.cardCode ? payload.cardCode : null,
        draftId: payload && payload.draftId ? payload.draftId : null,
        origen: payload && payload.origen ? payload.origen : null,
        clientVersion: payload && payload.clientVersion ? payload.clientVersion : null,
        waitlistOrigenId: payload && payload.waitlistOrigenId ? payload.waitlistOrigenId : null,
        timestamp: new Date(now),
      },
      extra || {}
    );
    // §64.3 (v1453): scrubber defensivo. Firestore rechaza silenciosamente
    // writes con `typeof === 'function'`. El fix principal invoca
    // `serverBd.utilizablePara(cardCode)` para resolver a número ANTES de
    // llegar acá, pero este scrubber es red de seguridad para futuras
    // adiciones al extra que accidentalmente arrastren una función (ej.
    // breakdown method que alguien agregue más adelante).
    const scrubbed = scrubFunctionsFromObject(entry);
    await deps.fbDb.collection('operations_log').add(scrubbed);
  } catch (e) {
    if (deps.log) {
      deps.log('operations_log write failed (commit_pedido_rejected)', {
        errorCode,
        err: (e && e.message) || String(e),
      });
    }
  }
}

/**
 * §64.3 (v1453) — walk recursivo que remueve cualquier valor
 * `typeof === 'function'`. Firestore no acepta funciones; el write silently
 * se queda a medias. Preserva Date, Timestamp, arrays, nested objects.
 *
 * @param {any} obj
 * @returns {any}
 */
function scrubFunctionsFromObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'function') return undefined;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  // Firestore Timestamp u otros objetos opacos: no recurrir.
  if (typeof obj.toMillis === 'function' || typeof obj.toDate === 'function') return obj;
  if (Array.isArray(obj)) {
    return obj.map((v) => scrubFunctionsFromObject(v)).filter((v) => v !== undefined);
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') continue;
    const scrubbed = scrubFunctionsFromObject(v);
    if (scrubbed !== undefined) out[k] = scrubbed;
  }
  return out;
}

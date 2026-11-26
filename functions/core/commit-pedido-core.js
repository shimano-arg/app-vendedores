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
 * @property {string} [callerRole] Rol del llamador leído en el servidor (lo
 *   inyecta el wrapper, nunca el payload). 'interno' activa el chequeo de
 *   alcance sobre la orden en espera de origen y los pedidos de asigRefs.
 * @property {(uid: string) => Promise<any>} [getRoleDoc] Lector de roles/{uid}
 *   para el alcance del interno (ver interno-scope.js).
 * @property {Record<string, any> | null | undefined} [featureFlagsDoc] Stack
 *   S-12 M1 (review 2026-11-26): `app_config/feature_flags` precargado por el
 *   core al inicio para evitar reads duplicados. Si `undefined`, el core lo
 *   carga; si viene seteado (null incluido), no se recarga.
 * @property {any} [pgPool] Stack S-12: pg.Pool para dual-write. Opcional —
 *   `replicatePedidoToPg` lo lee de aquí. TBD wiring en `functions/index.js`.
 */

import {
  applyAbsorptionsToLines,
  buildBackfillUpdate,
  computeBoAbsorption,
} from './absorb-bo-on-confirm.js';
// v1565 Incidente Frente A (2026-11-24): healing de asigRefs stale post
// revertSobreAsignadas / recorte_vendedor_cpst / cliente_rechazo_cpst.
// Pure fn mirror de src/pure/asig-ref-healing.js. Ver §108 CLAUDE.md.
import { healAsigRefs } from './asig-ref-healing.js';
// Tarea L (v1457 2026-10-25): payload gate "entrada del backorder" (filas rojas).
// Si llegan al CF con `boEntryResolved===null`, es bug cliente → errorCode
// UNRESOLVED_BO_ENTRY_ROWS. Importamos la función solo por sync con el espejo,
// no se invoca el compute acá (confiamos en el payload del cliente).
// NOTA: NO uses esto para re-detectar BO server-side; es un gate puro sobre el
// payload. La detección vive en index.html (cliente).
// eslint-disable-next-line no-unused-vars
// biome-ignore lint/correctness/noUnusedImports: preservación intencional — sync con el espejo cliente (ver comentario arriba)
import { computeBoEntryRows as _syncBoEntryRows } from './bo_entry_logic.js';
// Stack S-12 Phase 2 (ADR-0016): wiring dual-write Firestore → PG post-commit.
// Fire-and-forget detrás de flag `dual_write_pedidos_enabled` (OFF default).
// Si PG falla, el pedido queda encolado en `dual_write_pending` sin romper
// el commit. Firestore sigue siendo fuente de verdad en todos los casos.
import { replicatePedidoToPg } from './dual-write-pg.js';
// §Decisión-1 v<N> (2026-11-25) P0-B: shape canónico VDE→interno.
// Query inversa: dado internoUid, devuelve set de VDEs que lo tienen como pareja.
import { getVendorsPairedWithInterno, isVendorInInternoPair } from './interno-pareja-helpers.js';
import {
  evaluatePedidoScopeInterno,
  evaluateWaitlistScopeInterno,
  INTERNO_FUERA_DE_PAREJA,
  INTERNO_FUERA_DE_PAREJA_MESSAGE,
  makeGetRoleDoc,
} from './interno-scope.js';
import { findOpenWaitlistsForClient as findOpenWaitlistsPure } from './open-waitlists.js';
import { getStockBreakdown } from './pedido-snapshot-core.js';
// v1491 §89 HOTFIX (2026-10-27): resolver UID server-side cuando el cliente
// (típicamente VDE) no lo pudo resolver client-side por rules de `roles`.
import { resolveClientVendorServerSide } from './resolve-client-vendor-core.js';

// PR F v1578 §Decisión-2A: errorCode para VDE que intenta consumir waitlist
// de cliente que no es suyo (ownerUid != él ∧ assignedVendorUid != él).
const VENDEDOR_WAITLIST_FUERA_CLIENTE = 'VENDEDOR_WAITLIST_FUERA_CLIENTE';
const VENDEDOR_WAITLIST_FUERA_CLIENTE_MESSAGE =
  'Esta orden en espera no es de tus clientes. Avisá al vendedor que la carga o pedile a Pablo que te la reasigne.';

// Stack S-2 T4 (instrumentation, no behavior change):
import { createPhaseTimers, emitPhaseTimers, markPhase } from './commit-phase-timers.js';
// PR 4 §75 (v1477 2026-10-26) — resolución ÚNICA de descripción de línea.
// Fix "undefined" en Pedidos > Confirmados (ORDEN 502 OSVALDO MASERA et al).
import { resolveLineDesc } from './resolve-line-desc-core.js';
// (incidente Federico 2026-11-20) CAPA (b) `SKU_NOT_IN_SAP_CATALOG` removida:
// bloqueaba pedidos legítimos con SKUs todavía no dados de alta en SAP.
// La red de seguridad real es CAPA (c) en `auto-send-sap-core.js`, que degrada
// líneas individuales con `sap_item_not_found` sin bloquear el pedido completo
// (keptLines > 0) y marca el pedido `app_only` cuando TODAS las líneas confirmed
// caen a `sap_item_not_found` (keptLines === 0, edge case de la misma CAPA c).
// Si se reintroduce un gate catalog aquí, debe cumplir §77 (fail-open con sourc
// vacía) + §78 (test Playwright con usuario VDE pre-deploy).

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
// R01-estilo export: `stock-sync-alert-core.js` lo reusa para que el
// texto del email refleje el umbral REAL de bloqueo (ver §60 CLAUDE.md
// y el bug de v1456 donde el email seguía diciendo "8h" post-bajada
// a 30 min). Una sola constante → una sola verdad.
export const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutos
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
  // Stack S-2 T4: phase timers (fire-and-forget, 20% sampling, never throws).
  const _timers = createPhaseTimers();

  // Stack S-12 M1 (review 2026-11-26): pre-cargar `app_config/feature_flags`
  // una sola vez al inicio y pasarlo a los helpers que lo consuman via
  // `deps.featureFlagsDoc`. Antes `replicatePedidoToPg` hacia un read
  // extra por commit (1 por idempotent hit + 1 por happy path). Ahora:
  //   - commit happy path: 1 read de flags (este), 0 reads dentro de dual-write.
  //   - commit idempotent: 1 read de flags, 0 reads dentro de dual-write.
  // Fire-and-forget: si falla, cae al read interno de dual-write (fallback
  // via deps.fbDb) y en ultima instancia a flag OFF (fail-closed).
  if (deps && deps.featureFlagsDoc === undefined) {
    try {
      const _flagsSnap = await deps.fbDb.doc('app_config/feature_flags').get();
      deps.featureFlagsDoc = _flagsSnap && _flagsSnap.exists ? _flagsSnap.data() || null : null;
    } catch (_eFlags) {
      // No bloquear — dual-write tiene su propio fallback (y los demas
      // call-sites que necesiten flags tambien pueden recargar).
      deps.featureFlagsDoc = null;
    }
  }

  // S-3 adversarial fix F3 (2026-11-25): wrap return makeError para
  // emitir phase timers también en rechazos. Antes solo el happy path
  // (y el idempotent hit) emitían a operations_log — rechazos quedaban
  // sin medición de latencia. Fire-and-forget; nunca bloquea el return.
  //
  // Usage: `return rejectWithTimer(errorCode, msg, data)` en vez de
  // `return makeError(errorCode, msg, data)`.
  /**
   * @param {string} errorCode
   * @param {string} message
   * @param {any} [data]
   */
  function rejectWithTimer(errorCode, message, data) {
    try {
      markPhase(_timers, 'rejected_' + errorCode);
      emitPhaseTimers(deps, payload, _timers, errorCode);
    } catch (_e) {
      /* fire-and-forget */
    }
    return makeError(errorCode, message, data);
  }

  // 1. Validación básica payload.
  const validation = validatePayload(payload);
  if (!validation.ok) {
    // §64.2 (v1448): log antes del return (await, no fire-and-forget).
    await logCommitRejection(deps, 'VALIDATION_ERROR', payload, {
      validationReason: validation.message || '',
      validationData: validation.data || null,
    });
    return rejectWithTimer('VALIDATION_ERROR', validation.message || '', validation.data);
  }
  markPhase(_timers, 'validation');

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
        return rejectWithTimer('VERSION_OLD', 'Actualizá la app para continuar', {
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

  markPhase(_timers, 'version_check');

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
      return rejectWithTimer(
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
    markPhase(_timers, 'idempotent_hit');
    emitPhaseTimers(deps, payload, _timers, 'ok_idempotent');
    // Stack S-12 (ADR-0016): dual-write fire-and-forget. En idempotent hit
    // replicamos el existingPedido.data (shape ya en Firestore) por si la
    // ejecucion anterior fue pre-flag-on. Nunca bloquea el return.
    _fireAndForgetDualWrite(deps, existingPedido.id, existingPedido.data);
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
  markPhase(_timers, 'idempotent_check');

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
    return rejectWithTimer(
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
    return rejectWithTimer(
      'CLIENT_HAS_OPEN_WAITLIST',
      'El cliente ya tiene una orden abierta en lista de espera',
      {
        waitlistId: first._id,
        orderNumber: first.orderNumber || null,
        items: Array.isArray(first.items) ? first.items.length : 0,
      }
    );
  }

  markPhase(_timers, 'waitlist_check');

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
  // Fix v1461 (2026-10-26): sólo rechazar si hay BO previo REAL (> 0). Si
  // `boEntryPrevio` es 0, falsy o no reportado, significa que la UI/pure no
  // encontró BO vigente para ese cliente+SKU → la fila roja es espúrea y no
  // debe bloquear. Cumple la regla de Mariano: "una línea requiere resolución
  // SÓLO si el cliente tiene BO vigente por ese SKU al cargarla".
  const unresolvedBoRows = (payload.lines || [])
    .filter(
      (/** @type {any} */ l) => l && l.boEntryResolved === null && Number(l.boEntryPrevio) > 0
    )
    .map((/** @type {any} */ l) => ({
      sku: l.sku,
      cantidad: Number(l.cantidad) || 0,
      boAnterior: Number(l.boEntryPrevio) || 0,
    }));
  if (unresolvedBoRows.length > 0) {
    await logCommitRejection(deps, 'UNRESOLVED_BO_ENTRY_ROWS', payload, {
      unresolvedCount: unresolvedBoRows.length,
      skus: unresolvedBoRows.map((/** @type {any} */ r) => r.sku),
    });
    return rejectWithTimer(
      'UNRESOLVED_BO_ENTRY_ROWS',
      'Tenés productos marcados en rojo sin revisar. Elegí para cada uno si son las mismas unidades o son más.',
      { rows: unresolvedBoRows }
    );
  }

  // 4.5.5 PR 3 §74 (2026-10-26): VENDOR_UID_MISSING gate.
  // El cliente YA resuelve assignedVendorUid + vendorAssigned client-side via
  // enrichPayloadWithClientVendor (src/pure/resolve-client-vendor.js §44/§46).
  // Si llega al CF con vendorAssigned populated (cliente en master) pero
  // assignedVendorUid vacío → el pedido quedaría invisible en Planner VDE
  // (filtro autoritativo §59 por UID). Rechazamos pre-tx para forzar reportar.
  // Si ambos campos vacíos → cliente NO está en master (prospecto nuevo),
  // permite (admin-only por filtro de rol). Reportado SUSANA ANDRILI 2026-10-26.
  const _hasVendorName = !!(payload.vendorAssigned && String(payload.vendorAssigned).trim());
  let _hasVendorUid = !!(payload.assignedVendorUid && String(payload.assignedVendorUid).trim());

  // v1491 §89 HOTFIX (2026-10-27): si llegó vendorAssigned pero sin UID,
  // intentar resolver server-side (admin SDK bypassa rules que bloquean a VDE
  // la lectura de `roles` cross-user). Antes v1491 el rechazo era inmediato
  // → 15 rechazos VENDOR_UID_MISSING el 27/10 todos de VDEs (Mauricio,
  // Santiago, Federico) sobre clientes con vendorAssigned válido. Admin pasa
  // porque su navegador sí lee `roles` + arma `vdeUsers` + resuelve UID.
  // Regla §89: dato que un gate del servidor exija lo resuelve el servidor;
  // el cliente solo lo precarga como optimización.
  //
  // PR E v1577 §Decisión-1 (2026-11-25): recompute SIEMPRE (no solo si falta
  // UID). El servidor es autoridad única sobre quién es el vendedor del
  // cliente — el cliente no puede influir. Guarda la resolución en
  // `_serverResolvedVendor` para usarla en el gate interno abajo.
  /** @type {any} */
  let _serverResolvedVendor = null;
  /** @type {boolean} */
  let _resolveThrewException = false;
  if (_hasVendorName || payload.cardCode || payload.clientName) {
    try {
      const resolved = await resolveClientVendorServerSide({
        fbDb: deps.fbDb,
        cardCode: payload.cardCode,
        clientName: payload.clientName,
        vendorKeyHint: payload.vendorAssigned,
      });
      _serverResolvedVendor = resolved || null;
      if (resolved && resolved.vendorUid) {
        // Sobrescribir payload con la verdad del servidor (decisión A v1577).
        payload.assignedVendorUid = resolved.vendorUid;
        payload.assignedVendorEmail = resolved.vendorEmail || '';
        payload.vendorAssigned = resolved.vendorKey || payload.vendorAssigned;
        payload.assignedVendorReason = 'ok';
        /** @type {any} */ (payload)._assignedVendorResolvedServerSide = true;
        _hasVendorUid = true;
        try {
          if (deps.log) {
            deps.log('[v1577 §Dec1] vendor resuelto server-side', {
              cardCode: payload.cardCode,
              vendorKey: resolved.vendorKey,
              vendorUid: resolved.vendorUid,
              source: /** @type {any} */ (resolved).source || 'pure',
            });
          }
        } catch (_eLog) {
          /* non-fatal */
        }
      }
    } catch (_eResolve) {
      // F1 (adversarial v1577): marcamos la excepción para fail-close
      // en el gate interno. Para admin/gerente/VDE fail-open sigue vigente
      // (el gate VENDOR_UID_MISSING más abajo captura si hace falta).
      _resolveThrewException = true;
      try {
        if (deps.log) {
          deps.log('[v1577 §Dec1] resolve server-side falló', {
            err: _eResolve && /** @type {any} */ (_eResolve).message,
          });
        }
      } catch (_eLog) {
        /* ignore */
      }
    }
  }

  // PR E v1577 §Decisión-1 (2026-11-25): interno solo crea pedidos para
  // clientes de SU pareja. Decisión B pregunta 1 (permisivo cliente sin
  // vendor master): si el cliente no resuelve a NINGÚN vendedor, permitir
  // (es un alta huérfana, no viola la regla de pareja). Decisión B pregunta 2
  // (mensaje con nombre): mencionar el vendor propietario en el error.
  //
  // Punto 3 adversarial (v1577): "cliente sin master" se discrimina por el
  // `reason` del helper, NO por `vendorUid===''`. Razones que permiten:
  //   - `cliente_no_en_master`: no está en POINTS ni approvedAltas.
  //   - `input_vacio`: el payload no tiene cardCode ni clientName.
  // Razones que BLOQUEAN para interno (cliente SÍ está asignado pero el UID
  // no se pudo resolver — podría ser otra pareja):
  //   - `zona_sin_vendedor`: POINT existe pero vendor vacío.
  //   - `vendor_sin_uid`: vendorKey OK pero user no en roles.
  //   - cualquier otro.
  if (deps.callerRole === 'interno') {
    // F1 adversarial: fail-close si el recompute lanzó excepción. Para interno
    // la caída de Firestore NO puede dejar pasar al gate — podría ser cliente
    // de otra pareja.
    if (_resolveThrewException) {
      await logCommitRejection(deps, 'INTERNO_CLIENTE_FUERA_DE_PAREJA', payload, {
        reason: 'master_unreadable',
        cardCode: payload.cardCode,
      });
      return rejectWithTimer(
        'INTERNO_CLIENTE_FUERA_DE_PAREJA',
        'No pudimos verificar al cliente contra el master. Esperá un minuto y volvé a intentar; si sigue pasando, avisale a Mariano.',
        { reason: 'master_unreadable' }
      );
    }
    const _resolvedReason =
      (_serverResolvedVendor && _serverResolvedVendor.reason) || 'input_vacio';
    const _resolvedVendorUid =
      (_serverResolvedVendor &&
        _serverResolvedVendor.vendorUid &&
        String(_serverResolvedVendor.vendorUid).trim()) ||
      '';
    // Cliente SIN master real: permitimos (decisión B pregunta 1).
    const _clienteSinMaster =
      _resolvedReason === 'cliente_no_en_master' ||
      _resolvedReason === 'cliente_sin_zona' ||
      _resolvedReason === 'input_vacio';
    // Si el cliente no tiene vendor master resuelto por "cliente_no_en_master"
    // o "input_vacio" → permitir. Si tiene reason como `vendor_sin_uid` o
    // `zona_sin_vendedor` SÍ aplica el gate (posible cliente ajeno con UID
    // irresolvible — no es fail-open para interno).
    if (_clienteSinMaster && !_resolvedVendorUid) {
      // Rama permisiva: cliente sin vendor master, interno puede crear.
    } else if (_resolvedVendorUid) {
      // Cliente CON vendor master. Validar que sea pareja del interno.
      //
      // §Decisión-1 v<N> P0-B FIX (2026-11-25): shape canónico VDE→interno.
      // Antes (v1577): leía `roles/<internoUid>.internalPartnerUid` single-value,
      // asumiendo shape INVERTIDO. En prod el shape real es
      // `roles/<uidVDE>.internalPartnerUid = <uidInterno>`, varios VDEs pueden
      // apuntar al mismo interno (p.ej. Mauricio→Santiago + Pachi→Santiago).
      // Ahora: query inversa roles.where('internalPartnerUid','==',internoUid)
      // → Set<uidVDE>; chequear _resolvedVendorUid ∈ set.
      /** @type {Set<string>} */
      let pairedSet;
      try {
        pairedSet = await getVendorsPairedWithInterno(deps.fbDb, payload.ownerUid);
      } catch (_eQuery) {
        // Fail-closed: si la query falla (red, permission, etc.), rechazar.
        await logCommitRejection(deps, 'INTERNO_CLIENTE_FUERA_DE_PAREJA', payload, {
          reason: 'pareja_query_failed',
          errMessage: _eQuery && /** @type {any} */ (_eQuery).message,
          callerUid: payload.ownerUid,
        });
        return rejectWithTimer(
          'INTERNO_CLIENTE_FUERA_DE_PAREJA',
          'No pudimos verificar tu usuario. Avisale a Mariano antes de volver a intentar.',
          { reason: 'pareja_query_failed' }
        );
      }
      if (pairedSet.size === 0) {
        // Interno sin ningún VDE pareja → fail-closed.
        // Preservamos el errorCode `INTERNO_CLIENTE_FUERA_DE_PAREJA` con
        // `reason='interno_sin_pareja'` para compat con tests y UX heredada
        // de v1577 (el errorCode es el gate; el reason distingue causa).
        await logCommitRejection(deps, 'INTERNO_CLIENTE_FUERA_DE_PAREJA', payload, {
          reason: 'interno_sin_pareja',
          callerUid: payload.ownerUid,
        });
        return rejectWithTimer(
          'INTERNO_CLIENTE_FUERA_DE_PAREJA',
          'Tu usuario no tiene un vendedor pareja asignado. Pedile a Pablo que lo configure.',
          { reason: 'interno_sin_pareja' }
        );
      }
      if (!isVendorInInternoPair(_resolvedVendorUid, pairedSet)) {
        // Cliente de OTRA pareja → rechazar con nombre del vendor.
        const _vendorName =
          (_serverResolvedVendor && _serverResolvedVendor.vendorKey) || 'otro vendedor';
        await logCommitRejection(deps, 'INTERNO_CLIENTE_FUERA_DE_PAREJA', payload, {
          reason: 'cliente_de_otra_pareja',
          internoUid: payload.ownerUid,
          vendorUid: _resolvedVendorUid,
          clientVendorKey: _vendorName,
          pairedVendorsCount: pairedSet.size,
          cardCode: payload.cardCode,
        });
        return rejectWithTimer(
          'INTERNO_CLIENTE_FUERA_DE_PAREJA',
          'Este cliente está asignado a ' +
            _vendorName +
            '. Avisale a él o pedile a Pablo que lo reasigne.',
          {
            reason: 'cliente_de_otra_pareja',
            vendorName: _vendorName,
          }
        );
      }
      // _resolvedVendorUid ∈ pairedSet → es una pareja del interno, OK.
    } else {
      // Caso restante: cliente SÍ está en master pero el UID no se pudo
      // resolver (ej. `vendor_sin_uid` cuando vendorKey existe pero el user
      // no está en roles, o `zona_sin_vendedor` cuando POINT existe sin
      // vendor). Para interno esto es fail-close: podría ser cliente de
      // otra pareja cuyo user no está cargado. Point 3 adversarial v1577.
      await logCommitRejection(deps, 'INTERNO_CLIENTE_FUERA_DE_PAREJA', payload, {
        reason: 'master_incompleto',
        resolveReason: _resolvedReason,
        vendorKey: (_serverResolvedVendor && _serverResolvedVendor.vendorKey) || '',
        cardCode: payload.cardCode,
      });
      return rejectWithTimer(
        'INTERNO_CLIENTE_FUERA_DE_PAREJA',
        'No pudimos verificar al cliente contra el master. Esperá un minuto y volvé a intentar; si sigue pasando, avisale a Mariano.',
        { reason: 'master_incompleto', resolveReason: _resolvedReason }
      );
    }
  }

  if (_hasVendorName && !_hasVendorUid) {
    await logCommitRejection(deps, 'VENDOR_UID_MISSING', payload, {
      vendorAssigned: payload.vendorAssigned,
      assignedVendorReason: payload.assignedVendorReason || null,
      clientName: payload.clientName,
      cardCode: payload.cardCode,
      serverResolveAttempted: true,
    });
    return rejectWithTimer(
      'VENDOR_UID_MISSING',
      'Este cliente tiene vendedor asignado pero no pudimos encontrar su usuario. Avisale a Mariano con el nombre del cliente antes de volver a intentar.',
      {
        vendorAssigned: payload.vendorAssigned,
        clientName: payload.clientName,
      }
    );
  }

  // 4.6 Gate `SKU_NOT_IN_SAP_CATALOG` REMOVIDO (incidente Federico 2026-11-20).
  //
  // PR 2 §72 (v1475 2026-10-26) agregó un gate pre-tx que rechazaba el pedido
  // si algún SKU no estaba en `app_config/stock_snapshot.quantities`. Historial
  // reciente demuestra que es defecto funcional:
  //   - 2026-10-26 21:00 (v1480 §77): fuente vacía rechazaba 100% confirmaciones.
  //   - 2026-11-20 (Federico): 25 SKUs legítimos sin alta todavía en SAP → el
  //     pedido entero rebotaba. Flow correcto es que esas líneas queden en BO y
  //     el pedido pase como `app_only` hasta el alta SAP.
  //
  // Decisión (Opción A diseño Architect): confiar en CAPA (c) de
  // `auto-send-sap-core.js`, que ya maneja ambos escenarios:
  //   (c.1) keptLines > 0 → envía lo mandable, deja las degradadas como
  //         `_degradedReason='sap_item_not_found_app_only'` + email a Mariano.
  //   (c.2) keptLines === 0 (todas sap_item_not_found) → pedido `app_only` sin
  //         sapPost + log + email. Edge case agregado junto a este fix.
  //
  // CLAUDE.md §77 (fail-open), §78 (Playwright VDE), §89 (datos server-side):
  // si alguien reintroduce un gate catalog, debe cumplir las 3 antes del merge.

  // FRENTE C OOM fix (2026-11-24): memoria pico de cada commit — permite
  // detectar regresiones. Baseline capturado antes del retry loop; final
  // tras commit exitoso. operations_log fire-and-forget.
  const _memBaselineMb =
    typeof process !== 'undefined' && typeof process.memoryUsage === 'function'
      ? Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10
      : null;

  // 5. runTransaction atómica.
  let attempts = 0;
  let lastError = null;
  while (attempts < MAX_RETRY_ATTEMPTS) {
    attempts++;
    try {
      const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        return commitInTransaction(deps, tx, payload, now, nowIso);
      });
      // FRENTE C OOM fix: log memory peak al éxito, no bloqueante.
      const _memPeakMb =
        typeof process !== 'undefined' && typeof process.memoryUsage === 'function'
          ? Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10
          : null;
      log('commitPedidoCore OK', {
        draftId: payload.draftId,
        attempts,
        pedidoId: result.pedidoId,
        memBaselineMb: _memBaselineMb,
        memPeakMb: _memPeakMb,
      });
      try {
        deps.fbDb
          .collection('operations_log')
          .add({
            type: 'commit_pedido_memory',
            pedidoId: result.pedidoId,
            cardCode: payload.cardCode || null,
            userId: payload.ownerUid || null,
            userEmail: payload.ownerEmail || null,
            origen: payload.origen || null,
            attempts,
            payloadLineCount: Array.isArray(payload.lines) ? payload.lines.length : 0,
            asigRefCount: Array.isArray(payload.lines)
              ? payload.lines.reduce(
                  (/** @type {number} */ s, /** @type {any} */ l) =>
                    s + (Array.isArray(l?.asigRefs) ? l.asigRefs.length : 0),
                  0
                )
              : 0,
            memBaselineMb: _memBaselineMb,
            memPeakMb: _memPeakMb,
            memDeltaMb:
              _memBaselineMb !== null && _memPeakMb !== null
                ? Math.round((_memPeakMb - _memBaselineMb) * 10) / 10
                : null,
            clientVersion: payload.clientVersion || null,
            timestamp: new Date(now),
          })
          .catch((/** @type {any} */ _e) => {
            log('operations_log commit_pedido_memory write failed', { err: _e && _e.message });
          });
      } catch (_e) {
        // No propagar.
      }
      // v1565 Frente A (2026-11-24, §108): audit fire-and-forget si el healing
      // modificó refs stale. Guardamos los events para que Mariano pueda
      // auditar en Firestore qué refs se healearon por pedido.
      const _healEvents = /** @type {any} */ (payload)._asigRefHealingEvents;
      if (Array.isArray(_healEvents) && _healEvents.length > 0) {
        try {
          deps.fbDb
            .collection('operations_log')
            .add({
              type: 'asig_ref_healed',
              newPedidoId: result.pedidoId,
              cardCode: payload.cardCode,
              userId: payload.ownerUid || null,
              userEmail: payload.ownerEmail || null,
              waitlistOrigenId: payload.waitlistOrigenId || null,
              draftId: payload.draftId,
              clientVersion: payload.clientVersion || null,
              events: _healEvents,
              totalHealed: _healEvents.length,
              timestamp: new Date(now),
            })
            .catch((/** @type {any} */ _e) => {
              log('operations_log asig_ref_healed write failed', { err: _e && _e.message });
            });
        } catch (_e) {
          // No propagar.
        }
      }
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
      // N1 (auditoría 2026-11-25): absorciones salteadas por alcance del
      // interno. El detalle (ids de pedidos ajenos) queda solo en el log
      // del servidor; al cliente va el conteo. Fire-and-forget como bo_absorbed.
      const _absorbSkipped = Array.isArray(result._absorbSkipped) ? result._absorbSkipped : [];
      if (_absorbSkipped.length > 0) {
        log('bo_absorb_skipped_interno', {
          draftId: payload.draftId,
          cardCode: payload.cardCode,
          skipped: _absorbSkipped,
        });
        try {
          deps.fbDb
            .collection('operations_log')
            .add({
              type: 'bo_absorb_skipped_fuera_de_pareja',
              newPedidoId: result.pedidoId,
              cardCode: payload.cardCode,
              userId: payload.ownerUid || null,
              userEmail: payload.ownerEmail || null,
              role: 'interno',
              skipped: _absorbSkipped,
              skippedCount: _absorbSkipped.length,
              timestamp: new Date(now),
            })
            .catch((/** @type {any} */ _e) => {
              log('operations_log bo_absorb_skipped write failed', { err: _e && _e.message });
            });
        } catch (_e) {
          // No propagar.
        }
      }
      const {
        _absorbSkipped: _omitAbsorbSkipped,
        _pedidoDocForDualWrite: _pedidoDocEmbedded,
        ...resultForClient
      } = result;
      // Stack S-2 T4: emit phase timers. Fire-and-forget.
      // S-3 adversarial fix F3 (2026-11-25): commitInTransaction puede
      // retornar `{ok:false, errorCode}` directamente (sin throw) para
      // flows como manual_backorder con linesPrebuilt vacío. Emitir el
      // outcome correcto (errorCode) en vez de 'ok' hardcodeado.
      markPhase(_timers, 'transaction');
      const _outcome =
        resultForClient && resultForClient.ok === false
          ? 'rejected_' + (resultForClient.errorCode || 'UNKNOWN')
          : 'ok';
      emitPhaseTimers(deps, payload, _timers, _outcome);
      // Stack S-12 (ADR-0016 + H1 fix 2026-11-26): dual-write fire-and-forget
      // solo en commit OK. Pasa el shape EXACTO que acabamos de persistir en
      // Firestore (via `_pedidoDocEmbedded` del result) — garantiza paridad
      // de shape con el idempotent-hit path. Nunca bloquea el return.
      if (resultForClient && resultForClient.ok === true && resultForClient.pedidoId) {
        const pedidoDocForPg = _buildPedidoDocForPg(
          payload,
          { ...resultForClient, _pedidoDocForDualWrite: _pedidoDocEmbedded },
          now
        );
        _fireAndForgetDualWrite(deps, resultForClient.pedidoId, pedidoDocForPg);
      }
      return { ...resultForClient, servidorNowMs: now, commitAtIso: nowIso };
    } catch (e) {
      const err = /** @type {any} */ (e);
      lastError = err;

      if (err && err._errorCode) {
        // §64.2 (v1448): log centralizado FUERA de la tx (no duplica en
        // retry, no bloquea runTransaction). Business errors de
        // commitInTransaction propagan metadata via `err._data._logExtra`.
        // Para errores sin _logExtra (ej. SAP_UNAVAILABLE), igual se
        // loguea con el shape básico de logCommitRejection.
        //
        // Incidente Fase 2 (2026-11-24, observabilidad): los 8 throwError
        // de ASIG_REF_INVALID en accumulateCancelAsigMutations pasan la
        // metadata (reason/pedidoOrigenId/lineIndex/etc.) en err._data
        // TOP-LEVEL — no bajo _logExtra. Sin mergear esos campos el log
        // queda sin sub-reason → imposible auditar per-reason en prod.
        // Fix: extraer whitelist de err._data top-level antes del merge.
        const logExtra = err._data && err._data._logExtra ? err._data._logExtra : {};
        const fromDataTop = extractWhitelistedForLog(err._data);
        await logCommitRejection(
          deps,
          err._errorCode,
          payload,
          Object.assign({}, fromDataTop, logExtra, {
            errMessage: err.message || null,
            // Clean err._data for return (remove internal _logExtra).
          })
        );
        // Scrub _logExtra from err._data antes de retornar al cliente
        // (metadata server-side, el cliente no la necesita).
        const dataForClient = Object.assign({}, err._data || {});
        delete dataForClient._logExtra;
        return rejectWithTimer(err._errorCode, err.message, dataForClient);
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
  return rejectWithTimer('CONTENTION_RETRY_EXHAUSTED', 'Reintenta en 10 segundos', {
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
        // v1469 (2026-10-26): defensa contra lock HUÉRFANO/VENCIDO. Antes
        // devolvía idempotentHit siempre, aunque el pedido referenciado
        // no existiera o el lock fuera viejo. Si el lock quedó tomado por
        // una tx que crasheó mid-write (ej. undefined en Firestore), los
        // retries subsecuentes morían contra ese lock. Ahora: (a) si el
        // pedido referenciado NO existe → tratar como lock huérfano,
        // continuar flow (sobre-escribe el lock al final). (b) si tiene
        // más de 2 min (TTL soft) sin pedido existente → idem huérfano.
        const pedidoRef = deps.fbDb.collection('pedidos').doc(lockData.pedidoId);
        const pedidoSnap = await tx.get(pedidoRef);
        if (pedidoSnap.exists) {
          const pedidoData = pedidoSnap.data() || {};
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
        // Lock sin pedido. Chequear TTL (2 min).
        const LOCK_TTL_MS = 2 * 60 * 1000;
        let lockAgeMs = Infinity;
        if (lockData.createdAt) {
          const createdAtMs =
            typeof lockData.createdAt === 'string'
              ? Date.parse(lockData.createdAt)
              : typeof lockData.createdAt.toMillis === 'function'
                ? lockData.createdAt.toMillis()
                : null;
          if (typeof createdAtMs === 'number' && Number.isFinite(createdAtMs)) {
            lockAgeMs = now - createdAtMs;
          }
        }
        // Lock huérfano siempre (sin pedido): seguir flow. El tx.set al
        // final sobre-escribe el lock con el nuevo pedidoId. El createdAt
        // fuerza el fast-expire al próximo intento si vuelve a crashear.
        (deps.log || (() => {}))(
          'commitInTransaction draftLock HUERFANO: pedido no existe, continuo',
          {
            draftId: payload.draftId,
            lockPedidoIdInexistente: lockData.pedidoId,
            lockAgeMs,
            lockTtlMs: LOCK_TTL_MS,
          }
        );
        // No return — fall through to normal flow.
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
  // FRENTE C OOM fix (2026-11-24 §O1): el `warehouseBreakdown` del snapshot
  // viene como JSON STRING con ~5000 SKUs (~500KB parseado). Un `JSON.parse`
  // completo retenia todo el mapa en memoria en cada retry (hasta 5× por
  // commit) y contribuyó al OOM 256MiB → 273MiB de 2026-11-24 10:50 UTC.
  // Fix: parsear el JSON una sola vez pero **proyectar** solo los SKUs que
  // el payload necesita, descartando los otros 4950+ SKUs. Memory saving
  // estimado: ~450KB por tx × 5 retries = ~2MB de peak reducido. Semánticamente
  // idéntico: `getStockBreakdown(sku)` solo consulta `warehouseBreakdown[sku]`.
  /** @type {Record<string, Record<string, number>>} */
  let warehouseBreakdown = {};
  const rawWhsBd = stockConfig && stockConfig.warehouseBreakdown;
  if (rawWhsBd) {
    if (typeof rawWhsBd === 'string') {
      try {
        const _fullParsed = JSON.parse(rawWhsBd) || {};
        // Proyectar solo las keys del payload (skuSet ya normalizado uppercase).
        for (const _sku of skuSet) {
          if (_fullParsed[_sku]) {
            warehouseBreakdown[_sku] = _fullParsed[_sku];
          }
        }
        // _fullParsed queda sin referencias → GC inmediato.
      } catch (_eParseWhs) {
        (deps.log || (() => {}))('warehouseBreakdown JSON.parse fallo', {
          err: _eParseWhs && _eParseWhs.message,
        });
        warehouseBreakdown = {};
      }
    } else if (typeof rawWhsBd === 'object') {
      // Legacy shape (object): también proyectar.
      for (const _sku of skuSet) {
        if (rawWhsBd[_sku]) {
          warehouseBreakdown[_sku] = rawWhsBd[_sku];
        }
      }
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
        // SEC-H4 iter2 (HARDENING5 BATCH 1, 2026-11-19): propagar TOO_MANY_SKUS.
        // El core fetch-stock-live-core devuelve
        //   { ok:false, errorCode:'TOO_MANY_SKUS', snapshotFallback:true }
        // cuando el payload supera el cap (MAX_SKUS_PER_REQUEST=250). El bloque
        // histórico que sigue trataba cualquier snapshotFallback como "SL caído,
        // seguí con snapshot". Para TOO_MANY_SKUS queremos señal explícita al
        // cliente (no silenciar un abuso de payload). El throwError propaga por
        // el catch externo del runTransaction y pasa por logCommitRejection
        // (§64.2) con _logExtra para auditoría.
        if (liveStockResult && liveStockResult.errorCode === 'TOO_MANY_SKUS') {
          throwError(
            'TOO_MANY_SKUS',
            'El pedido supera el máximo de SKUs permitidos por request. Dividilo en pedidos más chicos.',
            {
              requested: skusUnicos.length,
              cap: 250,
              liveReason: liveStockResult.reason || 'cap_exceeded',
              canRefresh: false,
              // §64.2 (v1448): metadata server-side para el log del catch.
              _logExtra: {
                requested: skusUnicos.length,
                cap: 250,
                liveReason: liveStockResult.reason || 'cap_exceeded',
                liveError: liveStockResult.error || null,
              },
            }
          );
        }
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
        // SEC-H4 iter2 (HARDENING5 BATCH 1, 2026-11-19): propagar también
        // TOO_MANY_SKUS. Sin este re-throw, el error quedaría silenciado
        // en el log y el pedido continuaría usando snapshot stale — habilita
        // el abuso que el cap buscaba bloquear.
        if (e && (e._errorCode === 'SAP_UNAVAILABLE' || e._errorCode === 'TOO_MANY_SKUS')) {
          throw e;
        }
        (deps.log || (() => {}))('commitPedidoCore live SL error (ignored, cae a snapshot)', {
          err: (e && e.message) || String(e),
        });
      }
    }
  }

  // 5.4 Lee pedidos abiertos para computar breakdown live (para los SKUs del payload).
  // En E2 Fase 1 leemos TODOS los pedidos abiertos (como hace el trigger existente).
  // En Fase 2 se puede optimizar con query por SKU + index.
  //
  // FRENTE C OOM fix (2026-11-24 §O2): el fetch retorna cientos de pedidos
  // (100-500 docs) y cada uno tiene decenas de líneas. Cargar el doc completo
  // via `{ _fsId, ...d.data() }` retenía ~5-50MB en memoria por retry.
  // `getStockBreakdown` sólo consulta líneas con `line.code === sku` donde
  // `sku ∈ skuSet` del payload (verificado en pedido-snapshot-core.js:266).
  // Slim: proyectar solo campos que el breakdown consume + filtrar lines[] a
  // los SKUs del payload. Memory saving estimado: ~90% de ese hot path.
  const pedidosSnap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {any[]} */
  const pedidos = [];
  pedidosSnap.forEach((/** @type {any} */ d) => {
    const raw = d.data() || {};
    const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
    // Filtrar lines[] a solo las que matchean SKUs del payload. getStockBreakdown
    // itera `for (let i = 0; i < lines.length; i++)` y usa `i` como lineIndex
    // en los buckets (ver pedido-snapshot-core.js:263-322). Usamos SPARSE ARRAY
    // (holes para líneas no matcheadas) para preservar los lineIndex originales
    // intactos. Las líneas skippedas no ocupan memoria (sparse arrays V8).
    const slimLines = [];
    let _matchedCount = 0;
    for (let _i = 0; _i < rawLines.length; _i++) {
      const _l = rawLines[_i];
      if (!_l || !_l.code) continue;
      const _codeUp = String(_l.code).toUpperCase();
      if (!skuSet.has(_codeUp)) continue;
      // Proyectar solo campos que lineReservesStock + buckets consumen.
      // Preserva el índice original para que `lineIndex` guardado en
      // `asignadas.detalle[]` del breakdown siga siendo correcto si algún
      // consumer futuro lo surfacea.
      slimLines[_i] = {
        code: _l.code,
        state: _l.state,
        qty: _l.qty,
        qtyOpen: _l.qtyOpen,
        asigAt: _l.asigAt,
        asigAtTransito: _l.asigAtTransito,
        asigReserva: _l.asigReserva,
        asigFromReparto: _l.asigFromReparto,
        enTransito: _l.enTransito,
        enDep11At: _l.enDep11At,
        closedReason: _l.closedReason,
      };
      _matchedCount++;
    }
    // Si NINGUNA línea del pedido matchea el payload, el pedido no aporta al
    // breakdown de los SKUs del payload. Pero puede ser el pedido origen (CPST)
    // o target de absorción — esos se leen después por ID específico, no desde
    // este array. Safe to skip acá.
    if (_matchedCount === 0) return;
    pedidos.push({
      _fsId: d.id,
      clientCardCode: raw.clientCardCode,
      clientName: raw.clientName,
      closedAt: raw.closedAt, // null (filtrado por where arriba)
      confirmedAt: raw.confirmedAt,
      createdAt: raw.createdAt,
      transferidoSAP: raw.transferidoSAP,
      lines: slimLines,
    });
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

  // PR 4 §75 (v1477 2026-10-26): catalog map {code → {descripcion}} para
  // resolver descripción de líneas desde el payload. Lectura best-effort:
  // SKUs que no existen en `sap_products` simplemente caen al fallback del
  // payload (gate catalog pre-tx removido 2026-11-20, incidente Federico;
  // CAPA (c) de auto-send-sap-core ya cubre).
  // Si el cliente mandó desc en el payload, se usa; si no, se cae al catálogo.
  /** @type {Record<string, {descripcion: string}>} */
  const catalogDescMap = {};
  try {
    const _skusForDesc = (payload.lines || [])
      .map((/** @type {any} */ l) =>
        String((l && l.sku) || '')
          .toUpperCase()
          .trim()
      )
      .filter(Boolean);
    const _uniqSkus = Array.from(new Set(_skusForDesc));
    if (_uniqSkus.length > 0) {
      const _catSnaps = await Promise.all(
        _uniqSkus.map((/** @type {string} */ s) =>
          deps.fbDb.collection('sap_products').doc(s).get()
        )
      );
      for (let i = 0; i < _uniqSkus.length; i++) {
        const snap = _catSnaps[i];
        if (snap.exists) {
          const d = snap.data() || {};
          catalogDescMap[_uniqSkus[i]] = {
            descripcion: String(d.descripcion || d.desc || d.name || '').trim(),
          };
        }
      }
    }
  } catch (_catErr) {
    // Non-fatal: si el read falla, el helper cae a payload.desc o ''.
    (deps.log || (() => {}))('catalog desc map read failed (non-blocking)', {
      err: _catErr && _catErr.message,
    });
  }

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
        // v1469 hotfix (2026-10-26): nunca escribir campos undefined. Firestore
        // admin SDK sin ignoreUndefinedProperties rechaza `tx.set` con
        // "Cannot use undefined as a Firestore value" cuando una línea manual
        // tiene origenLinea=undefined. El retry loop no reconoce el error
        // (no es _errorCode), reintenta 5× con el mismo write, agota y
        // devuelve CONTENTION_RETRY_EXHAUSTED espúreo. Reportado Santi
        // ORDEN 533 2026-10-26 17:40 ART (docId=1Yatel0fyEtMWB6HVd5j
        // lastError: "Cannot use undefined as a Firestore value found in
        // field lines.0.origen").
        /** @type {Record<string, any>} */
        const _lineConfirmed = {
          code: sku,
          // PR 4 §75 (v1477 2026-10-26): resolver desc desde línea del payload
          // o catálogo. ANTES: no se escribía nada → "undefined" en Pedidos >
          // Confirmados (ORDEN 502 OSVALDO MASERA). Prioridad: payloadLine.desc
          // (ya resuelto cliente) → catalog lookup → '' (nunca "undefined").
          desc: resolveLineDesc(payloadLine, catalogDescMap),
          qty: qtyConfirmed,
          qtyOpen: qtyConfirmed,
          qtyInvoiced: 0,
          qtyCancelled: 0,
          qtyRecycled: 0,
          state: 'confirmed',
          precio: Number(payloadLine.precio) || 0,
          notas: payloadLine.notas || '',
        };
        if (payloadLine.origenLinea) _lineConfirmed.origen = payloadLine.origenLinea;
        if (Array.isArray(payloadLine.asigRefs) && payloadLine.asigRefs.length > 0) {
          _lineConfirmed.asigRefs = payloadLine.asigRefs;
        }
        docLines.push(_lineConfirmed);
      }
      if (qtyBO > 0) {
        docLines.push({
          code: sku,
          // PR 4 §75 (v1477): mismo pattern que confirmed.
          desc: resolveLineDesc(payloadLine, catalogDescMap),
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
  /** @type {{ref: any, exists: boolean, data: any} | null} */
  let waitlistOrigenSnap = null;
  if (payload.waitlistOrigenId) {
    const wlRef = deps.fbDb.collection('revision_waitlist').doc(payload.waitlistOrigenId);
    const wlSnap = await tx.get(wlRef);
    waitlistOrigenSnap = {
      ref: wlRef,
      exists: wlSnap.exists,
      data: wlSnap.exists ? wlSnap.data() || {} : null,
    };
  }

  // 5.7b' Alcance del vendedor interno (auditoría 2026-11-25). Si el pedido
  // consume una orden en espera (waitlistOrigenId) o cancela reservas de
  // otros pedidos (asigRefs, origen='cpst'), cada uno de esos documentos
  // tiene que ser propio del interno o de su VDE pareja. Se evalúa con los
  // datos leídos en esta transacción, antes de cualquier escritura (§58);
  // las lecturas de roles no son tx.get. Rechazo → throwError, que el retry
  // loop registra con await vía logCommitRejection (§64.2).
  if (deps.callerRole === 'interno') {
    const getRoleDoc = deps.getRoleDoc || makeGetRoleDoc(deps.fbDb);
    /** @type {Array<{docType: string, docId: string, reason: string}>} */
    const fueraDeAlcance = [];
    if (waitlistOrigenSnap && waitlistOrigenSnap.exists) {
      const sc = await evaluateWaitlistScopeInterno({
        callerUid: payload.ownerUid,
        waitlist: waitlistOrigenSnap.data || {},
        getRoleDoc,
      });
      if (!sc.ok) {
        fueraDeAlcance.push({
          docType: 'revision_waitlist',
          docId: String(payload.waitlistOrigenId),
          reason: sc.reason,
        });
      }
    }
    for (const [pid, snap] of asigOrigenSnapshots) {
      if (!snap || !snap.exists) continue; // ASIG_REF_INVALID lo maneja abajo
      const sc = await evaluatePedidoScopeInterno({
        callerUid: payload.ownerUid,
        pedido: snap.data || {},
        getRoleDoc,
      });
      if (!sc.ok) fueraDeAlcance.push({ docType: 'pedidos', docId: pid, reason: sc.reason });
    }
    if (fueraDeAlcance.length > 0) {
      throwError(INTERNO_FUERA_DE_PAREJA, INTERNO_FUERA_DE_PAREJA_MESSAGE, {
        _logExtra: { fueraDeAlcance, role: 'interno' },
      });
    }
  }

  // PR F v1578 §Decisión-2A (2026-11-25): gate VDE sobre waitlist origen.
  // Antes el VDE podía consumir CUALQUIER waitlist (incluso de otro VDE)
  // porque no había check — solo el commitPedidoCF setea ownerUid=auth.uid
  // en el pedido nuevo. Ahora: VDE solo puede consumir waitlist si:
  //   - La waitlist tiene assignedVendorUid === él (cliente del VDE, aunque
  //     la cargó otro — típico caso "cargado por Pablo"), O
  //   - La waitlist tiene ownerUid === él (la cargó él).
  // Para waitlist legacy sin assignedVendorUid populated (pre-§44), caemos
  // al chequeo ownerUid solo. criterio simple B elegido por Mariano.
  if (deps.callerRole === 'vendedor' && waitlistOrigenSnap && waitlistOrigenSnap.exists) {
    const wlData = waitlistOrigenSnap.data || {};
    const wlAssignedVendorUid = String(wlData.assignedVendorUid || '').trim();
    const wlOwnerUid = String(wlData.ownerUid || '').trim();
    const vendedorUid = String(payload.ownerUid || '').trim();
    const matchAssigned = wlAssignedVendorUid && wlAssignedVendorUid === vendedorUid;
    const matchOwner = wlOwnerUid && wlOwnerUid === vendedorUid;
    if (!matchAssigned && !matchOwner) {
      throwError(VENDEDOR_WAITLIST_FUERA_CLIENTE, VENDEDOR_WAITLIST_FUERA_CLIENTE_MESSAGE, {
        _logExtra: {
          role: 'vendedor',
          waitlistId: payload.waitlistOrigenId,
          wlAssignedVendorUid,
          wlOwnerUid,
        },
      });
    }
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
  // N1 (auditoría 2026-11-25): si el que llama es interno, la absorción solo
  // toca pedidos propios o de su VDE pareja. Los pedidos de otras parejas se
  // excluyen del cálculo (su back order queda como está) y se registran; el
  // pedido nuevo NO se rechaza. Todo dentro de la fase de lecturas (§58): se
  // recalcula la absorción sin los excluidos y se leen los pedidos nuevos que
  // entren; las lecturas de roles no son tx.get. Termina porque cada vuelta
  // excluye al menos un pedido más o corta.
  /** @type {Map<string, {ref: any, exists: boolean, data: any}>} */
  const absorbOrigenSnapshots = new Map();
  /** @type {Set<string>} */
  const absorbExcluidos = new Set();
  /** @type {Array<{pedidoId: string, reason: string}>} */
  const absorbSkipped = [];
  /** @type {Set<string>} */
  const absorbEvaluados = new Set();
  const absorbGetRoleDoc =
    deps.callerRole === 'interno' ? deps.getRoleDoc || makeGetRoleDoc(deps.fbDb) : null;
  /** @type {{absorptions: Array<any>, totalCubierto: number}} */
  let absorbResult = { absorptions: [], totalCubierto: 0 };
  for (;;) {
    absorbResult =
      absorptionInputLines.length > 0
        ? computeBoAbsorption({
            cardCode: payload.cardCode,
            lines: absorptionInputLines,
            allPedidos:
              absorbExcluidos.size > 0
                ? pedidos.filter((p) => !absorbExcluidos.has(String(p._fsId)))
                : pedidos,
            now,
          })
        : { absorptions: [], totalCubierto: 0 };
    const uniquePedidoIds = new Set(
      absorbResult.absorptions.map((/** @type {any} */ a) => String(a.pedidoIdOrigen))
    );
    for (const pid of uniquePedidoIds) {
      if (absorbOrigenSnapshots.has(pid)) continue;
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
    if (!absorbGetRoleDoc) break;
    let nuevosExcluidos = 0;
    for (const pid of uniquePedidoIds) {
      if (absorbEvaluados.has(pid)) continue;
      absorbEvaluados.add(pid);
      const snap = absorbOrigenSnapshots.get(pid);
      if (!snap || !snap.exists) continue; // accumulateAbsorbBoMutations lo saltea
      const sc = await evaluatePedidoScopeInterno({
        callerUid: payload.ownerUid,
        pedido: snap.data || {},
        getRoleDoc: absorbGetRoleDoc,
      });
      if (!sc.ok) {
        absorbExcluidos.add(pid);
        absorbSkipped.push({ pedidoId: pid, reason: sc.reason });
        nuevosExcluidos += 1;
      }
    }
    if (nuevosExcluidos === 0) break;
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

  // ===== POST-§105 (fix doble tx.update) =====
  // 5.9 / 5.9b CONSOLIDACIÓN: cancel ASIG + absorb BO sobre el MISMO documento
  // origen comparten un solo `tx.update` para evitar que el segundo pise las
  // mutaciones del primero (Firestore last-write-wins sobre el mismo campo
  // `lines` en la misma transacción). Ver informes 029/030/031/032.
  //
  // pendingPedidoWrites acumula las mutaciones en memoria; flushPendingPedidoWrites
  // emite exactamente UN tx.update por pedido origen al final.
  /** @type {Map<string, {ref: any, newLines: Array<any>, newBackfill: Record<string, any>, touchedBackfill: boolean}>} */
  const pendingPedidoWrites = new Map();

  // 5.9 Acumular cancelación ASIG si origen='cpst'.
  // v1565 Frente A (2026-11-24, §108): ANTES de los 7 CHECKs semánticos,
  // healear refs stale que pueden haber quedado obsoletas desde la creación
  // del waitlist. Casos tratados:
  //   - Línea revertida a BO por reconcile automático (§40.11) → DROP ref.
  //   - Línea cancelled por rechazo explícito VDE/admin (§40.6/§40.7/§40.10) → DROP.
  //   - Línea cancelled consumida por otro pedido (waitlist-confirm) → DROP.
  //   - Línea cancelled + splitFromLineIndex → REPOINT a gemela viva, o DROP.
  //   - Línea ASIG con qtyAsignada > qtyOpen → CLAMP a qtyOpen.
  // Las inconsistencias SKU_MISMATCH / LINE_INDEX_INVALID / LINE_MISSING NO se
  // healean (siguen abortando downstream) — son bugs reales del payload.
  // Precedente: SNAKE SRL waitlist 5a0KYAoRAiDO7uKalO6i, 4 refs STATE_MISMATCH
  // por revertida_a_bo. Ver docs/auditoria/BA_incidente_frente_a_*.md.
  /** @type {Array<any>} */
  let _healingEvents = [];
  if (payload.origen === 'cpst' && asigOrigenSnapshots.size > 0) {
    try {
      const healResult = healAsigRefs(payload, asigOrigenSnapshots);
      if (healResult.healedCount > 0) {
        _healingEvents = healResult.events;
        (deps.log || (() => {}))('asig_refs_healed', {
          draftId: payload.draftId,
          cardCode: payload.cardCode,
          waitlistOrigenId: payload.waitlistOrigenId || null,
          droppedRefs: healResult.droppedRefs,
          repointedRefs: healResult.repointedRefs,
          clampedRefs: healResult.clampedRefs,
          healedCount: healResult.healedCount,
        });
      }
    } catch (healErr) {
      (deps.log || (() => {}))('asig_ref_healing_error', {
        draftId: payload.draftId,
        err: (healErr && healErr.message) || String(healErr),
      });
      // Fail-open §77: si el healing crashea, dejamos pasar al CHECK downstream
      // que abortará con ASIG_REF_INVALID. Nunca bloqueamos por bug del healing.
    }
  }

  // VALIDACIONES SEMÁNTICAS (informe 032 §2) — abortan la tx completa si fallan.
  if (payload.origen === 'cpst' && asigOrigenSnapshots.size > 0) {
    accumulateCancelAsigMutations(
      pendingPedidoWrites,
      payload,
      asigOrigenSnapshots,
      pedidoRef.id,
      nowIso
    );
  }

  // Propagar events para audit log fuera de la tx (patrón §64.2).
  if (_healingEvents.length > 0) {
    /** @type {any} */ (payload)._asigRefHealingEvents = _healingEvents;
  }

  // 5.9b §J (v1455 2026-10-25) — Acumular absorciones de BO sobre el mismo
  // pending state. Si el pedido origen ya tiene mutaciones por cancel, el
  // absorb opera sobre `pending.newLines` (no sobre `data.lines` original).
  if (absorbResult.absorptions.length > 0) {
    accumulateAbsorbBoMutations(
      pendingPedidoWrites,
      absorbResult.absorptions,
      absorbOrigenSnapshots,
      pedidoRef.id,
      nowIso
    );
  }

  // 5.9c Flush: un solo tx.update por pedido origen con lines + _backfill
  // consolidados. El orden cancel→absorb se preserva por el orden de los
  // bloques de arriba; applyAbsorbToPending opera sobre el array ya mutado
  // por applyCancelAsigToPending.
  flushPendingPedidoWrites(tx, pendingPedidoWrites, nowIso);

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
    // N1: cuántos pedidos de otras parejas se dejaron sin absorber (interno).
    boAbsorbSkippedCount: absorbSkipped.length,
    _absorbSkipped: absorbSkipped,
    attempts: 1,
    // Stack S-12 H1 (review 2026-11-26): el shape Firestore nativo que
    // acabamos de persistir, para que el dual-write replique el MISMO
    // shape que el idempotent-hit (existingPedido.data). Nunca enviar al
    // cliente — se saca en el caller justo antes del return.
    _pedidoDocForDualWrite: pedidoData,
  };
}

/**
 * §105 (fix doble tx.update, ver informes 029/030/031/032):
 * `pendingPedidoWrites` acumula mutaciones sobre pedidos origen dentro de la
 * misma `runTransaction`, para emitir UN solo `tx.update` por documento al
 * final de la fase write. Antes `cancelAsigRefsFromPrefetched` y el bloque §J
 * de absorciones BO emitían dos `tx.update` secuenciales sobre el mismo doc
 * desde snapshots independientes; Firestore last-write-wins sobre el campo
 * `lines` descartaba las mutaciones del primero (122 ASIG huérfanas en prod
 * entre 2026-10-26 y 2026-11-05).
 *
 * Shape del map:
 *   Map<pedidoId, { ref, newLines, newBackfill, touchedBackfill }>
 *
 * - `newLines` se inicializa como copia defensiva de `snap.data.lines` la
 *   primera vez que un flow toca este pedido. Luego cada mutación posterior
 *   opera sobre ese array mutado (composición linear).
 * - `newBackfill` se inicializa como copia de `snap.data._backfill`. Solo
 *   se escribe al `tx.update` si `touchedBackfill=true` (evita escribir el
 *   campo cuando nadie lo modificó).
 *
 * @param {Map<string, {ref: any, newLines: Array<any>, newBackfill: Record<string, any>, touchedBackfill: boolean}>} pending
 * @param {string} pedidoId
 * @param {{ref: any, exists: boolean, data: any}} snap
 */
function getOrInitPendingWrite(pending, pedidoId, snap) {
  let pw = pending.get(pedidoId);
  if (!pw) {
    const baseLines = Array.isArray(snap.data && snap.data.lines) ? snap.data.lines : [];
    const baseBackfill =
      snap.data && typeof snap.data._backfill === 'object' && snap.data._backfill !== null
        ? snap.data._backfill
        : {};
    pw = {
      ref: snap.ref,
      newLines: baseLines.map((/** @type {any} */ l) => ({ ...l })),
      newBackfill: { ...baseBackfill },
      touchedBackfill: false,
    };
    pending.set(pedidoId, pw);
  }
  return pw;
}

/**
 * §105: deduplicar refs por `(pedidoId, lineIndex)` dentro de un mismo pedido.
 * Suma `qtyAsignada`. Si dos refs al mismo `lineIndex` tienen SKUs distintos
 * (caso inconsistencia del payload), devuelve `null` en el campo `sku` del
 * ref agrupado para que la validación posterior aborte con SKU_MISMATCH
 * (informe 032, ajuste obligatorio 1 del prompt 033).
 *
 * @param {Array<any>} refs
 * @returns {Array<{pedidoId: string, lineIndex: number, sku: string|null, qtyAsignada: number, _conflictingSkus?: string[]}>}
 */
function dedupRefsByLineIndex(refs) {
  /** @type {Map<number, any>} */
  const byIdx = new Map();
  for (const r of refs || []) {
    if (!r) continue;
    const li = Number(r.lineIndex);
    if (!Number.isInteger(li)) {
      // No deduplica: deja pasar para que CHECK A aborte con LINE_INDEX_INVALID.
      byIdx.set(Math.random(), { ...r, qtyAsignada: Number(r.qtyAsignada) || 0 });
      continue;
    }
    const sku = String(r.sku || '')
      .toUpperCase()
      .trim();
    const qa = Number(r.qtyAsignada) || 0;
    const existing = byIdx.get(li);
    if (!existing) {
      byIdx.set(li, { pedidoId: r.pedidoId, lineIndex: li, sku: sku || null, qtyAsignada: qa });
    } else {
      // Si los SKUs no coinciden entre refs duplicadas, marcar conflicto.
      const existingSku = existing.sku || '';
      if (sku && existingSku && sku !== existingSku) {
        // Ajuste 1 prompt 033: SKU conflict en refs duplicadas → sku=null fuerza SKU_MISMATCH abort.
        existing.sku = null;
        existing._conflictingSkus = Array.from(
          new Set([...(existing._conflictingSkus || [existingSku]), sku])
        );
      } else if (!existingSku && sku) {
        existing.sku = sku;
      }
      existing.qtyAsignada += qa;
    }
  }
  return Array.from(byIdx.values());
}

/**
 * §105 — Acumula las mutaciones de cancelación ASIG en `pendingPedidoWrites`.
 * NO emite `tx.update`; eso lo hace `flushPendingPedidoWrites` al final.
 *
 * Valida semánticamente cada referencia antes de mutar (informe 032 §2):
 *   A - lineIndex entero en rango
 *   B - línea existe en el array
 *   C - line.code === r.sku (protege contra bug 027 SKU_MISMATCH)
 *   D1 - line.state === 'cancelled' → SKIP idempotente (NO error) + verif SKU coherente
 *   D2 - line.state !== 'ASIG' (y no cancelled) → ABORT
 *   E - qtyOpen > 0 (zombie §104)
 *   F - qtyAsignada <= qtyOpen (cantidad suficiente)
 *
 * Errores críticos abortan con `throwError('ASIG_REF_INVALID', ...)` → la tx
 * entera rolea (pedido derivado NO se crea).
 *
 * Idempotencia:
 *   - Refs duplicadas: dedup previo con suma de qtyAsignada; CHECK F captura exceso.
 *   - Línea ya cancelled: SKIP sin incrementar qtyCancelled (CHECK D1).
 *   - Retry Firestore: cada reintento re-ejecuta la tx desde cero con snapshot fresco.
 *
 * Cambio idempotencia cuantitativa (informe 032 §3):
 *   - `qtyCancelled += qtyOpen` (NO `+= qty`). Preserva `qtyCancelled_final <= qty_total`.
 *
 * @param {Map<string, {ref: any, newLines: Array<any>, newBackfill: Record<string, any>, touchedBackfill: boolean}>} pending
 * @param {any} payload
 * @param {Map<string, {ref: any, exists: boolean, data: any}>} snapshots
 * @param {string} newPedidoId
 * @param {string} nowIso
 */
function accumulateCancelAsigMutations(pending, payload, snapshots, newPedidoId, nowIso) {
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

  for (const [pedidoOrigenId, refsRaw] of refsByPedido) {
    const snap = snapshots.get(pedidoOrigenId);
    if (!snap || !snap.exists) {
      // Pedido origen no existe en Firestore → ABORT. No se puede cancelar algo
      // que no existe, y un pedido derivado con asigRefs a un pedido inexistente
      // es inconsistencia del payload.
      throwError('ASIG_REF_INVALID', 'pedido origen no existe', {
        reason: 'PEDIDO_ORIGEN_NOT_FOUND',
        pedidoOrigenId,
      });
    }

    // ATK-002 (2026-11-19): el pedido origen de cada asigRef tiene que ser
    // del mismo cliente que el pedido que se confirma. Los checks A-F validan
    // sku, estado y cantidad, no el vínculo con el cliente.
    //
    // Compat: si el pedido origen no tiene clientCardCode persistido (pedidos
    // viejos), no bloquea.
    //
    // Ajuste post-revisión H5 (2026-11-24): la comparación normaliza trim +
    // mayúsculas (§46), y los cardCodes van solo al registro del servidor
    // (_logExtra), no al cliente: el rechazo no revela a qué cliente
    // pertenece un pedido ajeno.
    const payloadCardCode = String(payload.cardCode || '')
      .trim()
      .toUpperCase();
    const snapData = /** @type {any} */ (snap && snap.data) || {};
    const origenCardCode = String(snapData.clientCardCode || '')
      .trim()
      .toUpperCase();
    if (payloadCardCode && origenCardCode && payloadCardCode !== origenCardCode) {
      throwError('ASIG_REF_INVALID', 'pedido origen pertenece a otro cliente', {
        reason: 'CROSS_CLIENT_CARDCODE_MISMATCH',
        pedidoOrigenId,
        _logExtra: { payloadCardCode, origenCardCode },
      });
    }

    const pw = getOrInitPendingWrite(
      pending,
      pedidoOrigenId,
      /** @type {{ref: any, exists: boolean, data: any}} */ (snap)
    );

    // Dedup refs (ajuste 1 prompt 033) — sku=null si hay conflict entre refs duplicadas.
    const refs = dedupRefsByLineIndex(refsRaw);

    for (const r of refs) {
      const li = Number(r.lineIndex);

      // CHECK A — lineIndex entero en rango [0, newLines.length).
      if (!Number.isInteger(li) || li < 0 || li >= pw.newLines.length) {
        throwError('ASIG_REF_INVALID', 'lineIndex fuera de rango', {
          reason: 'LINE_INDEX_INVALID',
          pedidoOrigenId,
          lineIndex: r.lineIndex,
          sku: r.sku,
          arrayLength: pw.newLines.length,
        });
      }

      const line = pw.newLines[li];

      // CHECK B — línea existe (defensive, raro tras CHECK A).
      if (!line) {
        throwError('ASIG_REF_INVALID', 'línea no existe en el array', {
          reason: 'LINE_MISSING',
          pedidoOrigenId,
          lineIndex: li,
          sku: r.sku,
        });
      }

      // CHECK C — SKU coincide con la línea del pedido origen (protege bug 027).
      // Si dedup detectó conflicto SKU entre refs duplicadas, r.sku=null → aborta aquí.
      const expectedSku =
        r.sku === null
          ? null
          : String(r.sku || '')
              .toUpperCase()
              .trim();
      const actualSku = String(line.code || '')
        .toUpperCase()
        .trim();
      if (expectedSku === null) {
        // Conflict detectado en dedupRefsByLineIndex: 2 refs al mismo lineIndex con SKUs
        // distintos. Abort con listado de conflictos. (Ajuste 1 prompt 033.)
        throwError('ASIG_REF_INVALID', 'referencias al mismo lineIndex con SKUs distintos', {
          reason: 'SKU_CONFLICT_IN_DUPES',
          pedidoOrigenId,
          lineIndex: li,
          conflictingSkus: r._conflictingSkus || [],
          actualLineCode: actualSku,
        });
      }
      if (expectedSku && actualSku !== expectedSku) {
        throwError('ASIG_REF_INVALID', 'SKU no coincide con la línea del pedido origen', {
          reason: 'SKU_MISMATCH',
          pedidoOrigenId,
          lineIndex: li,
          expectedSku,
          actualSku,
        });
      }

      // CHECK D — estado válido.
      if (line.state === 'cancelled') {
        // AJUSTE 2 prompt 033: antes de aceptar skip idempotente, verificar SKU
        // coherente (CHECK C arriba ya lo valida — llegamos aquí solo si matched).
        // Validaciones de cantidad (qtyOpen, qtyAsignada vs qtyOpen) ya NO son
        // posibles porque la línea cancelled tiene qtyOpen=0 por definición.
        // Lo que SÍ se puede verificar: que la cancelación previa sea coherente
        // con un flow legítimo (closedReason conocido). No lo forzamos por ahora
        // — la idempotencia prevalece. Documentado en informe 033.
        continue;
      }
      if (line.state !== 'ASIG') {
        throwError('ASIG_REF_INVALID', 'línea no está en estado ASIG', {
          reason: 'STATE_MISMATCH',
          pedidoOrigenId,
          lineIndex: li,
          expectedState: 'ASIG',
          actualState: line.state,
        });
      }

      // CHECK E — qtyOpen > 0 (protege contra ASIG zombie §104).
      const qtyOpen = Number(line.qtyOpen) || 0;
      if (qtyOpen <= 0) {
        throwError('ASIG_REF_INVALID', 'ASIG con qtyOpen inválido (zombie §104)', {
          reason: 'QTY_ZERO',
          pedidoOrigenId,
          lineIndex: li,
          qtyOpen,
        });
      }

      // CHECK F — cantidad asignable suficiente.
      const qtyAsignada = r.qtyAsignada;
      if (qtyAsignada > qtyOpen) {
        throwError('ASIG_REF_INVALID', 'qtyAsignada excede qtyOpen de la línea', {
          reason: 'QTY_INSUFFICIENT',
          pedidoOrigenId,
          lineIndex: li,
          qtyOpen,
          qtyAsignada,
        });
      }

      // MUTACIÓN: setea state=cancelled, qtyOpen=0, qtyCancelled += qtyOpen.
      // Cambio informe 032 §3: `qtyCancelled += qtyOpen` (NO `+= qty`) para
      // preservar invariante `qtyCancelled_final <= qty_total` bajo cancelaciones
      // parciales previas o retries con mutación doble.
      pw.newLines[li] = {
        ...line,
        state: 'cancelled',
        qtyOpen: 0,
        qtyCancelled: (Number(line.qtyCancelled) || 0) + qtyOpen,
        closedReason: 'waitlist-confirm',
        cancelledAt: nowIso,
        cancelledIntoPedidoId: newPedidoId,
        asigReserva: false,
      };
    }
  }
}

/**
 * §105 — Acumula las mutaciones de absorción BO §J v1455 en `pendingPedidoWrites`.
 * NO emite `tx.update`.
 *
 * Opera sobre `pw.newLines` (el array ya mutado por `accumulateCancelAsigMutations`
 * si el pedido estaba en ambos flows). Reutiliza `applyAbsorptionsToLines` y
 * `buildBackfillUpdate` sin modificarlos (helpers puros en `absorb-bo-on-confirm.js`).
 *
 * @param {Map<string, {ref: any, newLines: Array<any>, newBackfill: Record<string, any>, touchedBackfill: boolean}>} pending
 * @param {Array<any>} absorptions
 * @param {Map<string, {ref: any, exists: boolean, data: any}>} snapshots
 * @param {string} newPedidoId
 * @param {string} nowIso
 */
function accumulateAbsorbBoMutations(pending, absorptions, snapshots, newPedidoId, nowIso) {
  /** @type {Map<string, Array<any>>} */
  const absByPedido = new Map();
  for (const a of absorptions) {
    const pid = String(a.pedidoIdOrigen);
    if (!absByPedido.has(pid)) absByPedido.set(pid, []);
    const arr = absByPedido.get(pid);
    if (arr) arr.push(a);
  }

  for (const [pid, absList] of absByPedido) {
    const snap = snapshots.get(pid);
    if (!snap || !snap.exists) continue;
    const pw = getOrInitPendingWrite(pending, pid, snap);

    // IMPORTANTE: applyAbsorptionsToLines recibe pw.newLines (ya mutado por cancel
    // si aplicable), no snap.data.lines. Esto es el núcleo del fix §105.
    pw.newLines = applyAbsorptionsToLines(pw.newLines, absList, newPedidoId, nowIso);

    // Backfill acumulado: operamos sobre pw.newBackfill (que puede tener keys
    // previas del snapshot + keys de otras absorciones acumuladas).
    pw.newBackfill = buildBackfillUpdate(pw.newBackfill, absList, newPedidoId, nowIso);
    pw.touchedBackfill = true;
  }
}

/**
 * §105 — Emite las escrituras acumuladas. Un `tx.update` por pedido origen.
 * `_backfill` solo se escribe si fue tocado (evita update espurio del campo
 * cuando solo hubo cancel ASIG sin absorciones).
 *
 * @param {any} tx
 * @param {Map<string, {ref: any, newLines: Array<any>, newBackfill: Record<string, any>, touchedBackfill: boolean}>} pending
 * @param {string} nowIso
 */
function flushPendingPedidoWrites(tx, pending, nowIso) {
  for (const pw of pending.values()) {
    /** @type {Record<string, any>} */
    const update = { lines: pw.newLines, updatedAt: nowIso };
    if (pw.touchedBackfill) {
      update._backfill = pw.newBackfill;
    }
    tx.update(pw.ref, update);
  }
}

/**
 * Build pedido doc data.
 */
/** @param {any} payload @param {any[]} docLines @param {string} nowIso @param {any} deps */
function buildPedidoDocData(payload, docLines, nowIso, deps) {
  // El prefijo `_` basta para suprimir noUnusedVariables.
  // Preservado por compat: pre-refactor usaba FieldValue.serverTimestamp(),
  // hoy migrado a nowIso string. La captura sigue por si el deps lo mantiene.
  const _FieldValue = deps.FieldValue || null;
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
    // PR 4 §75 (v1477 2026-10-26): copiar `month` del payload. Antes NO se
    // escribía → tarjeta Pedidos > Confirmados mostraba "sin mes" en pedidos
    // CPST (ORDEN 502). El cliente lo arma como `MESES[mesIdx] + ' ' + anio`
    // en doConfirmPedido:36890. Si falta, fallback a mes/año de nowIso.
    month:
      payload.month ||
      (function _fallbackMonth() {
        try {
          const _MESES_ES = [
            'Enero',
            'Febrero',
            'Marzo',
            'Abril',
            'Mayo',
            'Junio',
            'Julio',
            'Agosto',
            'Septiembre',
            'Octubre',
            'Noviembre',
            'Diciembre',
          ];
          const _d = new Date(nowIso);
          return _MESES_ES[_d.getMonth()] + ' ' + _d.getFullYear();
        } catch (_e) {
          return '';
        }
      })(),
    // v1473 (2026-10-26): confirmedAt/createdAt como ISO string, consistente
    // con pedidos pre-v1457 y con el formato que el cliente web lee sin
    // `.toDate()` (todos los call-sites hacen `new Date(c.confirmedAt)` o
    // `.slice(0,10)`). Antes `FieldValue.serverTimestamp()` devolvía objeto
    // Timestamp al snapshot → la tarjeta de Pedidos > Confirmados mostraba
    // "Invalid Date" (reportado Federico ORDEN 530 SUSANA ANDRILI).
    confirmedAt: nowIso,
    createdAt: nowIso,
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
 * Incidente Fase 2 (2026-11-24, observabilidad §64.2 extensión).
 *
 * Whitelist de campos diagnósticos que pueden venir en err._data top-level
 * (set por throwError(code, msg, {...}) en el core) y que queremos persistir
 * a operations_log para audit per-reason.
 *
 * ¿Por qué whitelist y no blacklist? Zero chance de filtrar PII accidental
 * (clientName, clientEmail, etc.). Un `throwError` futuro que pase un campo
 * nuevo necesita agregarse acá explícitamente — intencional + visible.
 *
 * Fuentes documentadas de los 8 throwError ASIG_REF_INVALID en
 * accumulateCancelAsigMutations (líneas 1388-1495):
 *   - reason: PEDIDO_ORIGEN_NOT_FOUND | LINE_INDEX_INVALID | LINE_MISSING
 *             | SKU_CONFLICT_IN_DUPES | SKU_MISMATCH | STATE_MISMATCH
 *             | QTY_ZERO | QTY_INSUFFICIENT
 *   - pedidoOrigenId, lineIndex, sku
 *   - arrayLength (LINE_INDEX_INVALID)
 *   - conflictingSkus, actualLineCode (SKU_CONFLICT_IN_DUPES)
 *   - expectedSku, actualSku (SKU_MISMATCH)
 *   - expectedState, actualState (STATE_MISMATCH)
 *   - qtyOpen (QTY_ZERO)
 *   - qtyAsignada, qtyOpen (QTY_INSUFFICIENT)
 *
 * Fuentes de otros errorCodes:
 *   - CLIENT_HAS_OPEN_WAITLIST: conflictingWaitlistId, conflictingOrderNumber,
 *                               conflictingItemsCount
 *   - SNAPSHOT_TOO_OLD: snapshotAgeMinutes, snapshotUpdatedAt, snapshotOrigin,
 *                       canRefresh
 *   - VERSION_OLD: minVersion, currentVersion
 *   - PERMISSION_DENIED (G4.03): reason, existingPedidoId, sapDocNum,
 *                                sapDocEntry, via
 *   - VALIDATION_ERROR: validationReason (algunos paths lo pasan en extra,
 *                       otros en _data).
 *   - VENDOR_UID_MISSING: resolvedVendorKey, resolvedVendorUid (§89 fallback)
 *
 * **EXCLUIDOS explícitamente** (PII — nunca a operations_log):
 *   - clientName, clientEmail, clientCardCode (cardCode SÍ se loguea aparte
 *     como campo operacional ya establecido por logCommitRejection — ese es
 *     el único cardCode)
 *   - Cualquier free-text que pueda arrastrar datos de cliente.
 *   - `rows[]` de UNRESOLVED_BO_ENTRY_ROWS (array potencialmente grande + nombres).
 *
 * @param {any} errData
 * @returns {Record<string, any>}
 */
export function extractWhitelistedForLog(errData) {
  if (!errData || typeof errData !== 'object') return {};
  /** @type {string[]} */
  const WHITELIST_KEYS = [
    // ASIG_REF_INVALID sub-fields
    'reason',
    'pedidoOrigenId',
    'lineIndex',
    'sku',
    'arrayLength',
    'conflictingSkus',
    'actualLineCode',
    'expectedSku',
    'actualSku',
    'expectedState',
    'actualState',
    'qtyOpen',
    'qtyAsignada',
    // CLIENT_HAS_OPEN_WAITLIST
    'conflictingWaitlistId',
    'conflictingOrderNumber',
    'conflictingItemsCount',
    // SNAPSHOT_TOO_OLD
    'snapshotAgeMinutes',
    'snapshotUpdatedAt',
    'snapshotOrigin',
    'canRefresh',
    // VERSION_OLD
    'minVersion',
    'currentVersion',
    // PERMISSION_DENIED
    'existingPedidoId',
    'sapDocNum',
    'sapDocEntry',
    'via',
    // VALIDATION_ERROR
    'validationReason',
    // VENDOR_UID_MISSING (§89)
    'resolvedVendorKey',
    'resolvedVendorUid',
  ];
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of WHITELIST_KEYS) {
    // biome-ignore lint/suspicious/noPrototypeBuiltins: tsconfig target es2020 — Object.hasOwn requiere es2022
    if (Object.prototype.hasOwnProperty.call(errData, k) && errData[k] !== undefined) {
      out[k] = errData[k];
    }
  }
  return out;
}

/**
 * Stack S-12 (ADR-0016): fire-and-forget wrapper del replicador dual-write.
 *
 * Nunca awaitea, nunca throws. El `.catch` loguea con nombre descriptivo
 * para que un reviewer adversarial (silent-failure-hunter) vea que el error
 * NO esta silenciado — solo esta separado del happy path del commit.
 *
 * Delega la lógica real al modulo `functions/core/dual-write-pg.js` que
 * tiene su propia defensa (flag check, no-op si no hay pool, enqueue
 * retry en Firestore). Este wrapper solo garantiza que no propaga al
 * caller.
 *
 * @param {CommitPedidoDeps} deps
 * @param {string} pedidoId
 * @param {Record<string, any>} pedidoDoc - shape Firestore con lines[].
 */
function _fireAndForgetDualWrite(deps, pedidoId, pedidoDoc) {
  const log = deps && deps.log ? deps.log : () => {};
  try {
    const p = replicatePedidoToPg(deps, pedidoId, pedidoDoc);
    if (p && typeof (/** @type {any} */ (p).catch) === 'function') {
      /** @type {any} */ (p).catch((/** @type {any} */ err) => {
        log('dual_write_fire_forget_err', {
          pedidoId,
          err: err && err.message,
        });
      });
    }
  } catch (err) {
    // Red de seguridad para cualquier throw sincrono inesperado antes
    // de que el promise del replicador exista.
    log('dual_write_fire_forget_err', {
      pedidoId,
      err: /** @type {any} */ (err) && /** @type {any} */ (err).message,
    });
  }
}

/**
 * Stack S-12 (ADR-0016 + review adversarial H1): arma un shape Firestore
 * EXACTAMENTE equivalente al que persiste `commitInTransaction` en
 * `pedidos/{id}` para pasarle al replicador dual-write.
 *
 * H1 (review 2026-11-26): el idempotent-hit path pasa `existingPedido.data`
 * (shape Firestore nativo) al dual-write. El happy path tiene que pasar el
 * mismo shape para que `transformPedidoToPg` lea los mismos campos. La
 * version previa de este helper emitia 1 linea por SKU (mergeado
 * qtyConfirmed+qtyBO) + omitia campos per-linea que transformPedidoToPg
 * lee (`enTransito`, `asigAtTransito`, `enDep11At`, `cancelledAt`,
 * `asigRevertidaAt/By/Reason`, `splitFromLineIndex`, `closedReason`,
 * `closedBy`, `cancelledBy`, `discountPct`). Fix: usa `pedidoData` tal cual
 * lo escribio el tx (incluye `lines: docLines` ya splitteado por state).
 *
 * `pedidoData` viene expuesto en `resultForClient._pedidoDocForDualWrite`
 * (ver `commitInTransaction` — campo privado, no se envia al cliente).
 *
 * Fallback: si por alguna razon (version vieja, path legacy) no esta el
 * `_pedidoDocForDualWrite`, reconstruye con splitting por SKU — garantiza
 * shape consistente con lo que Firestore tiene aunque el shape de las
 * lineas pueda diferir en campos opcionales.
 *
 * @param {any} payload
 * @param {any} resultForClient
 * @param {number} nowMs
 * @returns {Record<string, any>}
 */
function _buildPedidoDocForPg(payload, resultForClient, nowMs) {
  // H1 fix: usar pedidoData directo si vino embebido en el result.
  // Shape matchea byte-for-byte con `existingPedido.data` del idempotent hit
  // (ambos son `pedidoRef.set(pedidoData)` → `doc.data()`). `replicatePedidoToPg`
  // se encarga del `_fsId` fallback a `pedidoId` cuando el shape nativo no lo
  // tiene (Firestore lo almacena como doc id, no como field).
  if (
    resultForClient &&
    resultForClient._pedidoDocForDualWrite &&
    typeof resultForClient._pedidoDocForDualWrite === 'object'
  ) {
    return resultForClient._pedidoDocForDualWrite;
  }

  // Fallback legacy — splittea qtyConfirmed/qtyBO en 2 lineas para que
  // el shape per-linea matchee con lo que Firestore persiste (docLines).
  const nowIso = new Date(nowMs).toISOString();
  /** @type {Array<Record<string, any>>} */
  const lines = [];
  const resultLines = Array.isArray(resultForClient && resultForClient.lines)
    ? resultForClient.lines
    : [];
  for (const l of resultLines) {
    const qtyConfirmed = Number(l.qtyConfirmed || 0);
    const qtyBO = Number(l.qtyBO || 0);
    if (qtyConfirmed > 0) {
      lines.push({
        code: l.sku,
        state: 'confirmed',
        qty: qtyConfirmed,
        qtyOpen: qtyConfirmed,
        qtyCancelled: 0,
        price: Number(l.precio || 0),
        confirmedAt: nowIso,
      });
    }
    if (qtyBO > 0) {
      lines.push({
        code: l.sku,
        state: 'BO',
        qty: qtyBO,
        qtyOpen: qtyBO,
        qtyCancelled: 0,
        price: Number(l.precio || 0),
      });
    }
    // Edge: qtyConfirmed=0 && qtyBO=0 — no emitimos nada (shape nativo tampoco).
  }
  return {
    orderNumber: resultForClient.orderNumber || resultForClient._orderNumber || 0,
    clientCardCode: payload && payload.cardCode,
    clientName: (payload && payload.clientName) || '',
    assignedVendorUid: (payload && payload.assignedVendorUid) || '',
    vendorAssigned: (payload && payload.vendorAssigned) || '',
    ownerUid: (payload && payload.ownerUid) || '',
    cargadoPorUid: (payload && payload.cargadoPorUid) || (payload && payload.ownerUid) || '',
    origen: (payload && payload.origen) || 'manual',
    draftId: (payload && payload.draftId) || null,
    transferidoSAP: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    closedAt: null,
    lines,
  };
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

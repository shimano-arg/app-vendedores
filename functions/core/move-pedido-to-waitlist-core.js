// @ts-check
/**
 * R01 Fase 1 — movePedidoToWaitlistCF core.
 *
 * Mueve un pedido `stage='pending'` sin SAP a `/revision_waitlist` y
 * elimina el pedido. Todo atómico dentro de UNA `runTransaction`.
 *
 * INVARIANTES (R01 Fase 1 — v1557-dev):
 *   - §42: a lo sumo UNA waitlist abierta por `clientCardCode`.
 *     Garantizado por:
 *       (a) Lock atómico `revision_waitlist_locks/{cardCode}`. Si el lock
 *           apunta a un waitlist abierto vigente, la operación lo USA como
 *           target (UNIFY) en vez de crear uno nuevo.
 *       (b) Detección de lock stale: si el lock apunta a un waitlist
 *           consumed/missing/closedAt, se trata como null y se re-apunta.
 *       (c) Fallback eager: si el lock está vacío (primer touch
 *           post-deploy Fase 1), hace fresh query `where(clientCardCode)`
 *           como pre-tx read para detectar waitlists preexistentes sin
 *           lock asociado. Si encuentra N>=1, re-lee cada una dentro del
 *           tx y absorbe N-1 adicionales.
 *       (d) FAIL-CLOSED H2 (adversarial fix 2026-11-17): si la pre-tx
 *           query falla (permission/timeout) Y tras resolver stale-check
 *           + N-1 extras no quedó candidato verificable, la operación
 *           rechaza con `failed-precondition` + reason=preflight-unverifiable.
 *           Sin esto, el path CREATE abriría un segundo waitlist "fantasma"
 *           cuando ya existía uno pre-existente invisible por la query
 *           caída. Preferimos indisponibilidad transitoria sobre violación
 *           de §42.
 *   - §40.5: `asigRefs` / `origen` / `importedFromOrder` preservados por
 *     línea. Delegado al helper `mergeLinesFromOrders` del espejo pure
 *     (§57).
 *   - §56: un SKU una sola vez por orden. Delegado al mismo helper.
 *     Observación: el helper `mergeLinesFromOrders` SUMA qty por diseño
 *     del pure. La regla §56 UPDATE v1457 ("MÁS NUEVA + piso ASIG") vive
 *     en `bo_entry_logic.js` y se dispara en el modal review del cliente
 *     downstream (fase 3+). El merge server-side NO decide por el VDE;
 *     solo persiste `mergedFrom[]` + `precioAnterior1/2` + `precioOrigen`
 *     para que la UX detecte el aporte duplicado y pida decisión.
 *
 * PERMISOS: admin/gerente/interno OR VDE owner OR VDE `assignedVendorUid`.
 *
 * PRECONDICIONES:
 *   - pedido.stage === 'pending'.
 *   - pedido.transferidoSAP == null (sin SAP; si tiene, usar
 *     revertPedidoToPendingCF primero — Fase 2+).
 *
 * TRANSACCIÓN (patrón §58 ALL reads before ALL writes):
 *
 *   FASE READ:
 *     1. tx.get(pedidoRef) fresh.
 *     2. tx.get(lockRef).
 *     3. Si lock.waitlistId != null → tx.get(lockedTargetRef).
 *     4. Si pre-tx query encontró openOnes y el target del lock es stale o
 *        null → tx.get(bestTargetRef) del pre-tx + tx.get(extraRef) para
 *        cada N-1 extra.
 *     5. Decidir target final + absorbed extras.
 *
 *   FASE WRITE:
 *     6. Si UNIFY: tx.update(targetRef, merged items + unifiedFrom + ...).
 *     7. Si N-1 extras: tx.update(extraRef, stage='consumed', ...).
 *     8. Si CREATE: tx.set(newWaitlistRef, payload).
 *     9. tx.set/tx.update(lockRef, {waitlistId: targetId, lastOperation}).
 *    10. tx.delete(pedidoRef).
 *
 * Audit: operations_log type='pedido_moved_to_waitlist' (create) o
 *   'pedido_moved_and_unified' (unify). Fire-and-forget post-tx.
 */

import { mergeLinesFromOrders } from './unificar-ordenes.js';

/**
 * @param {string} code
 * @param {string} message
 */
function mkErr(code, message) {
  const e = /** @type {any} */ (new Error(message));
  e._errorCode = code;
  return e;
}

/**
 * Convierte `pedido.lines[]` al shape que consume `mergeLinesFromOrders`:
 * `{code, qty, precio, origen?, asigRefs?, importedFromOrder?}`.
 *
 * H-M01 (hardening post-merge 2026-11-18): la qty que va al waitlist es la
 * UNIDADES ACTUALES ABIERTAS de la línea (`qtyOpen`), no la nominal `qty`.
 * Un pedido con línea `{qty:5, qtyOpen:3, qtyCancelled:2}` es una línea
 * parcialmente consumida; al volver a waitlist, debemos preservar solo las
 * 3 unidades abiertas. Si `qtyOpen` no está (pedido legacy o línea recién
 * creada), fallback a `qty` (invariante en waitlist: `qtyOpen == qty`).
 *
 * M2 (adversarial 2026-11-18): validación explícita de cantidades inválidas.
 * `Number.isFinite(qty) && qty > 0` cubre: `0`, `null`, `undefined`, `NaN`,
 * `Infinity`, negativos, strings no numéricos. Firestore rechaza `NaN` y
 * `Infinity` con 'Unsupported field value'; sin esta guard el tx falla con
 * `internal` (no business) y el logger §64.2 lo registra como no-identificado.
 * Las líneas con qty inválida se skipean silencioso (data corrupta upstream);
 * se emite warning via `deps.log` si está disponible.
 *
 * @param {Array<any>} lines
 * @param {{log?: Function}} [logCtx]
 * @returns {Array<any>}
 */
function pedidoLinesToWaitlistItems(lines, logCtx) {
  if (!Array.isArray(lines)) return [];
  /** @type {any[]} */
  const out = [];
  for (const l of lines) {
    if (!l) continue;
    const code = String(l.code || l.sku || '').trim();
    if (!code) continue;
    // H-M01: preservar qtyOpen si está presente (línea parcial). Fallback a qty.
    const qtySource = l.qtyOpen != null ? l.qtyOpen : l.qty;
    const qty = Number(qtySource);
    if (!Number.isFinite(qty) || qty <= 0) {
      if (logCtx && typeof logCtx.log === 'function') {
        try {
          logCtx.log('move-pedido: línea con qty inválida skipeada', {
            code,
            qtySource: String(qtySource),
            qtyNumber: String(qty),
          });
        } catch (_) {
          /* no bloquea */
        }
      }
      continue;
    }
    /** @type {any} */
    const it = { code, qty };
    if (l.precio != null) it.precio = Number(l.precio) || 0;
    if (l.origen) it.origen = String(l.origen);
    if (Array.isArray(l.asigRefs) && l.asigRefs.length > 0) {
      const filtered = l.asigRefs.filter(
        (/** @type {any} */ r) => r && r.pedidoId && typeof r.lineIndex === 'number'
      );
      if (filtered.length > 0) it.asigRefs = filtered;
    }
    if (typeof l.importedFromOrder === 'number' && l.importedFromOrder > 0) {
      it.importedFromOrder = l.importedFromOrder;
    }
    out.push(it);
  }
  return out;
}

/**
 * Agrega `qtyOpen: qty` a cada item y strippa undefined (patrón §70 defense
 * contra invalid data). Shape final persistido en `revision_waitlist.items[]`.
 *
 * M2 (adversarial 2026-11-18): guard `Number.isFinite` en qty — defensa en
 * profundidad. El extractor `pedidoLinesToWaitlistItems` ya filtra, pero este
 * helper también procesa items de waitlists existentes (los absorbed) que
 * podrían tener qty=Infinity por data corrupta preexistente en Firestore.
 * Sin esta guard, `mergeLinesFromOrders` propaga Infinity y Firestore rechaza
 * el write con 'Unsupported field value'.
 *
 * @param {Array<any>} items
 * @returns {Array<any>}
 */
function finalizeItemsForPersist(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const out = /** @type {any} */ ({});
    for (const k of Object.keys(it || {})) {
      if (it[k] !== undefined) out[k] = it[k];
    }
    const q = Number(it.qty);
    out.qty = Number.isFinite(q) && q > 0 ? q : 0;
    out.qtyOpen = out.qty;
    if (out.precio == null) out.precio = 0;
    return out;
  });
}

/**
 * Dedupe pedidosOrigenes por (pedidoId, lineIndex). Patrón §40.5 / §42 v1382.
 * @param {Array<any>} origenes
 * @returns {Array<any>}
 */
function dedupePedidosOrigenes(origenes) {
  if (!Array.isArray(origenes) || origenes.length === 0) return [];
  /** @type {Map<string, any>} */
  const byKey = new Map();
  for (const o of origenes) {
    if (!o || !o.pedidoId) continue;
    const li = typeof o.lineIndex === 'number' ? o.lineIndex : -1;
    const k = o.pedidoId + '|' + li;
    if (!byKey.has(k)) byKey.set(k, o);
  }
  return Array.from(byKey.values());
}

/**
 * Append entry a `unifiedFrom[]` con shape canónico (H11):
 * `{source, pedidoId?, waitlistId?, orderNumber?, mergedAt, mergedBy, lineCount}`.
 * @param {Array<any>|null|undefined} existing
 * @param {any} entry
 * @returns {Array<any>}
 */
function appendUnifiedFromEntry(existing, entry) {
  const acc = Array.isArray(existing) ? existing.slice() : [];
  acc.push(entry);
  return acc;
}

/**
 * Pre-tx fire-and-forget log para fail-open del `where()` query (H2).
 * Patrón §77: fail-open con telemetría estructurada.
 * @param {any} deps
 * @param {{cardCode: string, pedidoId: string, errMessage: string, userId: string}} ctx
 * @param {number} nowMs
 */
function logPreQueryFailed(deps, ctx, nowMs) {
  try {
    const p = deps.fbDb.collection('operations_log').add({
      type: 'move_pedido_pre_query_failed',
      cardCode: ctx.cardCode || null,
      pedidoId: ctx.pedidoId || null,
      errMessage: String(ctx.errMessage || '').slice(0, 500),
      userId: ctx.userId || null,
      via: 'movePedidoToWaitlistCF',
      timestamp: new Date(nowMs),
    });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {
    /* no bloquea */
  }
}

/**
 * H-M08 (hardening post-merge 2026-11-18): logger centralizado para TODOS
 * los paths de rechazo de `movePedidoToWaitlistCore`. Replica §64.2
 * (`logCommitRejection` en commit-pedido-core). AWAIT (NO fire-and-forget)
 * para garantizar que el log existe antes del re-throw. Scrubber defensivo
 * contra campos que Firestore rechaza (undefined, function).
 *
 * Shape del entry: {type:'move_pedido_rejected', errorCode, pedidoId,
 * cardCode?, userId, userEmail, role?, errMessage, timestamp, ...extra}.
 *
 * Costo: ~20-50ms por rechazo. Aceptable — si rechazamos, informamos.
 *
 * @param {any} deps
 * @param {string} errorCode
 * @param {{auth?: any, pedidoId?: string}} params
 * @param {Object<string, any>} extra
 * @param {number} nowMs
 */
async function logMoveRejection(deps, errorCode, params, extra, nowMs) {
  if (!deps || !deps.fbDb) return;
  try {
    const auth = params && params.auth;
    const userEmail =
      auth && auth.token && auth.token.email ? String(auth.token.email).toLowerCase() : null;
    /** @type {any} */
    const entry = Object.assign(
      {
        type: 'move_pedido_rejected',
        errorCode,
        pedidoId: (params && params.pedidoId) || null,
        userId: (auth && auth.uid) || null,
        userEmail,
        via: 'movePedidoToWaitlistCF',
        timestamp: new Date(nowMs),
      },
      extra || {}
    );
    // Scrub: strip undefined + function (Firestore rechaza silenciosamente).
    const scrubbed = {};
    for (const k of Object.keys(entry)) {
      const v = entry[k];
      if (v === undefined) continue;
      if (typeof v === 'function') continue;
      scrubbed[k] = v;
    }
    await deps.fbDb.collection('operations_log').add(scrubbed);
  } catch (e) {
    if (deps.log) {
      try {
        deps.log('operations_log write failed (move)', {
          errorCode,
          err: (e && /** @type {any} */ (e).message) || String(e),
        });
      } catch (_) {
        /* no bloquea */
      }
    }
  }
}

/**
 * M1 (adversarial fix 2026-11-18): logger centralizado AWAIT para audit de
 * ÉXITO. Análogo a `logMoveRejection` pero sin `_errorCode`. Patrón §64.2
 * extendido a éxitos: si el log write falla (quota, permission, timeout),
 * el error queda registrado via `deps.log` en vez de perderse silencioso.
 *
 * Costo: ~20-50ms añadidos al path de éxito. Aceptable para coherencia de
 * audit trail y para detectar problemas estructurales de operations_log.
 *
 * @param {any} deps
 * @param {Object<string, any>} logEntry
 */
async function logMoveSuccess(deps, logEntry) {
  if (!deps || !deps.fbDb) return;
  try {
    // Scrub defensivo (mismo patrón que logMoveRejection).
    const scrubbed = {};
    for (const k of Object.keys(logEntry || {})) {
      const v = logEntry[k];
      if (v === undefined) continue;
      if (typeof v === 'function') continue;
      scrubbed[k] = v;
    }
    await deps.fbDb.collection('operations_log').add(scrubbed);
  } catch (e) {
    if (deps.log) {
      try {
        deps.log('operations_log success write failed (move)', {
          type: logEntry && logEntry.type,
          err: (e && /** @type {any} */ (e).message) || String(e),
        });
      } catch (_) {
        /* no bloquea */
      }
    }
  }
}

/**
 * @param {{ fbDb: any, log?: Function, now?: Function }} deps
 * @param {{ auth: any, pedidoId: string }} params
 */
export async function movePedidoToWaitlistCore(deps, params) {
  const now = deps && typeof deps.now === 'function' ? deps.now() : Date.now();
  const nowIso = new Date(now).toISOString();
  const { auth, pedidoId } = params || {};

  // H-M08 (hardening 2026-11-18): contexto para el logger centralizado.
  // Se expone en outer scope para que el catch final lo lea aunque el throw
  // ocurra antes de que `role`/`cardCode` estén resueltos.
  let role = '';
  let cardCode = '';

  try {
    if (!auth || !auth.uid) throw mkErr('unauthenticated', 'login requerido');
    if (!pedidoId || typeof pedidoId !== 'string') {
      throw mkErr('invalid-argument', 'pedidoId requerido');
    }

    // Role lookup.
    try {
      const roleSnap = await deps.fbDb.collection('roles').doc(auth.uid).get();
      role = String((roleSnap.data() || {}).role || '').toLowerCase();
    } catch (e) {
      throw mkErr(
        'internal',
        'no se pudo resolver rol: ' + ((e && /** @type {any} */ (e).message) || String(e))
      );
    }

    // Pre-fetch pedido para permission + state check.
    const pedidoRef = deps.fbDb.collection('pedidos').doc(pedidoId);
    const pedidoSnap = await pedidoRef.get();
    if (!pedidoSnap.exists) throw mkErr('not-found', 'pedido no existe');
    const data = pedidoSnap.data() || {};

    // Permission check.
    // Obs 7 fix (Fase 2 prep 2026-11-17): `isOwner` solo cuenta si el usuario
    // tiene un rol con read (defensa en profundidad). Antes alcanzaba con ser
    // ownerUid del pedido; un usuario con rol vacío/no asignado podía pasar.
    // Las rules Firestore de `/pedidos.read` ya exigen isReader(), pero este
    // check defensivo evita cualquier confusión si en el futuro se habilita
    // acceso cross-rol al Core.
    const READER_ROLES = new Set(['admin', 'gerente', 'interno', 'vendedor', 'viewer']);
    const isReader = READER_ROLES.has(role);
    const isPrivileged = role === 'admin' || role === 'gerente' || role === 'interno';
    const isOwner = isReader && data.ownerUid === auth.uid;
    const isAssignedVendor = role === 'vendedor' && data.assignedVendorUid === auth.uid;
    if (!isPrivileged && !isOwner && !isAssignedVendor) {
      throw mkErr('permission-denied', 'solo admin/gerente/interno o VDE owner');
    }

    // State check pre-tx.
    if (data.stage !== 'pending') {
      throw mkErr('failed-precondition', `stage debe ser pending (actual: ${data.stage})`);
    }
    if (data.transferidoSAP && data.transferidoSAP.docNum) {
      throw mkErr('failed-precondition', 'pedido tiene SAP, use revertPedidoToPendingCF primero');
    }

    const userEmail = String((auth.token && auth.token.email) || '').toLowerCase();
    // H-M08: reassign outer scope `cardCode` para que el logger lo tenga en catch.
    cardCode = String(data.clientCardCode || '').trim();

    // === §42 PRE-TX QUERY (fallback eager) ===
    // Si el lock todavía no existe (primera operación post-deploy Fase 1), el
    // único modo de detectar waitlists preexistentes abiertos es via `where`.
    // La query pre-tx NO garantiza unicidad; es el LOCK dentro del tx quien
    // la garantiza. Esto solo sirve para: (a) descubrir preexistentes y
    // (b) elegir un candidato que la fase tx re-lee + valida.
    //
    // H2 (adversarial fix 2026-11-18): `.limit(PRE_TX_QUERY_LIMIT)` previene
    // DoS si un cardCode acumula miles de docs consumed históricos. El filtro
    // `closedAt/stage='consumed'` se hace en memoria (no `.where('closedAt','==',null)`
    // porque Firestore distingue `null explícito` de `campo ausente` y rompería
    // con docs legacy sin el field — ver notas de diseño architect 2026-11-18).
    const PRE_TX_QUERY_LIMIT = 200;
    // H4 (adversarial fix 2026-11-18): umbral de absorb preexistentes. >50
    // waitlists abiertas del mismo cardCode viola §42 operativamente (debería
    // ser ≤1). Cap defensivo evita que un bug upstream cause un tx con N+3
    // writes que exceda el límite Firestore (500/tx) y aborte silencioso.
    // Alineado con H-W07 (unify cap 100 → también 50 por consistencia).
    const PRE_TX_OPEN_CAP = 50;
    /** @type {Array<{id: string, data: any}>} */
    const preTxOpenOnes = [];
    let preQueryFailed = false;
    let preQueryTruncated = false;
    if (cardCode) {
      try {
        const qs = await deps.fbDb
          .collection('revision_waitlist')
          .where('clientCardCode', '==', cardCode)
          .limit(PRE_TX_QUERY_LIMIT)
          .get();
        qs.forEach((/** @type {any} */ d) => {
          const wd = d.data() || {};
          if (wd.closedAt) return;
          if (wd.stage === 'consumed') return;
          preTxOpenOnes.push({ id: d.id, data: wd });
        });
        // H2: si llenamos el límite, no podemos probar §42; el histórico puede
        // esconder más abiertos fuera de los 200 top. Fail-closed.
        if (qs.size === PRE_TX_QUERY_LIMIT) {
          preQueryTruncated = true;
        }
        preTxOpenOnes.sort((a, b) => {
          const ca = String(a.data.createdAt || '');
          const cb = String(b.data.createdAt || '');
          return cb.localeCompare(ca);
        });
      } catch (e) {
        preQueryFailed = true;
        logPreQueryFailed(
          deps,
          {
            cardCode,
            pedidoId,
            errMessage: (e && /** @type {any} */ (e).message) || String(e),
            userId: auth.uid,
          },
          now
        );
        // Fail-closed controlado (H2 adversarial fix, 2026-11-17):
        // El tx procede leyendo SOLO el lock. Si el lock también falla en
        // identificar un target válido, la fase posterior (FASE FAIL-CLOSED)
        // lanza `failed-precondition` con reason='preflight-unverifiable'.
        // No creamos nuevo waitlist sin prueba de unicidad.
      }
    }

    // H2 (adversarial 2026-11-18): si la pre-tx query llenó el límite, no
    // podemos probar §42 — el histórico puede esconder más abiertos. Mensaje
    // §68 humano para el vendedor.
    if (preQueryTruncated) {
      throw mkErr(
        'failed-precondition',
        'Este cliente tiene demasiados pedidos en espera abiertos. Avisale a Mariano.'
      );
    }

    // H4 (adversarial 2026-11-18): cap operativo. >50 abiertas no es escenario
    // legítimo (§42 garantiza ≤1); si aparece, es bug upstream. Fail antes
    // del tx para no exceder límite Firestore (500 writes/tx).
    if (preTxOpenOnes.length > PRE_TX_OPEN_CAP) {
      throw mkErr(
        'failed-precondition',
        'Este cliente tiene demasiados pedidos en espera abiertos (' +
          preTxOpenOnes.length +
          '). Avisale a Mariano para que los revise.'
      );
    }

    // === H1 — SNAPSHOT TOKEN del lock (adversarial 2026-11-18, round 2) ===
    // Simetría con unify-core: capturar `lock.updatedAt` ANTES del tx. Dentro
    // del tx, re-leer el lock y verificar que `updatedAt` no cambió entre
    // pre-tx query y el commit. Defensa en profundidad: Firestore OCC ya
    // reintenta el tx si detecta conflicto en el write del lock, pero el
    // snapshot token cubre la ventana donde el pre-tx query vio `0 abiertas`
    // pero un `move` concurrente creó una waitlist entre esa query y el
    // `tx.get(lockRef)` → en el retry OCC el candidateTargetId se resolvería
    // correctamente, pero este check hace EXPLÍCITO el rechazo si el token
    // no coincide, con mensaje humano al vendedor en vez de retry silencioso.
    //
    // Si `cardCode` está vacío (pedido legacy), skipeamos (no hay lock).
    /** @type {string|null} */
    let preTxLockUpdatedAt = null;
    /** @type {boolean} */
    let preTxLockExisted = false;
    if (cardCode) {
      try {
        const lockPreSnap = await deps.fbDb
          .collection('revision_waitlist_locks')
          .doc(cardCode)
          .get();
        if (lockPreSnap.exists) {
          preTxLockExisted = true;
          const ld = lockPreSnap.data() || {};
          preTxLockUpdatedAt = typeof ld.updatedAt === 'string' ? ld.updatedAt : null;
        }
      } catch (_) {
        /* fail-open soft: el tx re-lee con autoridad */
      }
    }

    // === TRANSACTION §58 (ALL reads before ALL writes) ===
    const lockRef = cardCode ? deps.fbDb.collection('revision_waitlist_locks').doc(cardCode) : null;
    const newWaitlistRef = deps.fbDb.collection('revision_waitlist').doc();

    // H-M08 (2026-11-18): el logging del fail-closed H2 lo maneja ahora el
    // outer catch via `logMoveRejection`. La flag `failClosedH2` previa (Obs 5
    // fix Fase 2 prep 2026-11-17) se eliminó: el `err._errorData.reason` del
    // throw dentro del tx persiste al outer catch y se escribe UNA SOLA VEZ
    // (los retries internos del SDK re-levantan el throw pero el catch outer
    // solo ejecuta una vez por invocación del core).
    /** @type {any} */
    const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      // ============ FASE READS ============

      // 1. Fresh del pedido.
      const fresh = await tx.get(pedidoRef);
      if (!fresh.exists) {
        // Pedido desapareció — idempotente.
        return {
          waitlistId: null,
          idempotent: true,
          unified: false,
          targetWaitlistId: null,
          absorbedIds: [],
        };
      }
      const fresh_data = fresh.data() || {};
      if (fresh_data.stage !== 'pending') {
        throw mkErr('failed-precondition', `stage cambió a ${fresh_data.stage} mid-tx`);
      }
      if (fresh_data.transferidoSAP && fresh_data.transferidoSAP.docNum) {
        throw mkErr('failed-precondition', 'pedido adquirió SAP mid-tx');
      }

      // H3 (adversarial fix 2026-11-18): re-verificar ownership contra fresh
      // data. Entre el pre-fetch (línea 294) y el tx.get aquí, un admin puede
      // haber reasignado zonas (patrón §44/§46) cambiando `assignedVendorUid`
      // o transferido ownership cambiando `ownerUid`. El pre-fetch pasó el
      // check contra data vieja; sin este re-check, un VDE podría mover un
      // pedido que ya no le corresponde.
      //
      // Approach conservador (recomendación architect): comparar los campos
      // críticos fresh vs pre-fetch. Si cambiaron, rechazar. No re-evaluamos
      // toda la lógica isOwner/isAssignedVendor porque el role del user es
      // estable (no cambia mid-tx) y los privileged no están afectados.
      if (!isPrivileged) {
        const freshOwnerUid = fresh_data.ownerUid;
        const freshAssignedVendorUid = fresh_data.assignedVendorUid;
        const ownerChanged = freshOwnerUid !== data.ownerUid;
        const vendorChanged = freshAssignedVendorUid !== data.assignedVendorUid;
        if (ownerChanged || vendorChanged) {
          // Re-evaluar con fresh data.
          const freshIsOwner = isReader && freshOwnerUid === auth.uid;
          const freshIsAssignedVendor = role === 'vendedor' && freshAssignedVendorUid === auth.uid;
          if (!freshIsOwner && !freshIsAssignedVendor) {
            throw mkErr(
              'permission-denied',
              'permisos del pedido cambiaron mid-tx (reasignación de zona o cambio de dueño).'
            );
          }
        }
      }

      // 2. Lock.
      /** @type {any} */
      let lockData = null;
      /** @type {boolean} */
      let lockNowExists = false;
      if (lockRef) {
        const lockSnap = await tx.get(lockRef);
        lockNowExists = lockSnap.exists;
        lockData = lockSnap.exists ? lockSnap.data() || {} : null;
      }

      // H1 (adversarial fix 2026-11-18, round 2): snapshot-token verification.
      // Simetría con unify-core. Verificar que el lock NO cambió entre el
      // pre-tx capture y este tx.get. Si cambió, un move/unify concurrente
      // modificó el lock entre pre-tx y tx → fail-closed con mensaje humano
      // (vs el retry silencioso de Firestore OCC).
      //
      // Casos (idénticos a unify):
      //   (a) pre-existió Y sigue existiendo Y updatedAt igual → OK.
      //   (b) pre-existió Y sigue existiendo pero updatedAt cambió → fail.
      //   (c) pre-existió Y ya no existe → fail.
      //   (d) NO pre-existió Y ahora existe → fail.
      //   (e) NO pre-existió Y sigue sin existir → OK.
      if (cardCode && lockRef) {
        if (preTxLockExisted && !lockNowExists) {
          const e = mkErr(
            'failed-precondition',
            'lock cambió mid-operación (un pedido concurrente lo modificó). Reintentá en unos segundos.'
          );
          /** @type {any} */ (e)._errorData = {
            reason: 'concurrent-lock-deleted',
            cardCode,
          };
          throw e;
        }
        if (!preTxLockExisted && lockNowExists) {
          const e = mkErr(
            'failed-precondition',
            'lock cambió mid-operación (un pedido concurrente lo creó). Reintentá en unos segundos.'
          );
          /** @type {any} */ (e)._errorData = {
            reason: 'concurrent-lock-created',
            cardCode,
            lockNowPointsTo: (lockData && lockData.waitlistId) || null,
          };
          throw e;
        }
        if (preTxLockExisted && lockNowExists) {
          const freshLockUpdatedAt =
            lockData && typeof lockData.updatedAt === 'string' ? lockData.updatedAt : null;
          if (preTxLockUpdatedAt !== freshLockUpdatedAt) {
            const e = mkErr(
              'failed-precondition',
              'lock cambió mid-operación (un pedido concurrente lo modificó). Reintentá en unos segundos.'
            );
            /** @type {any} */ (e)._errorData = {
              reason: 'concurrent-waitlist-detected',
              cardCode,
              preTxLockUpdatedAt,
              freshLockUpdatedAt,
              lockNowPointsTo: (lockData && lockData.waitlistId) || null,
            };
            throw e;
          }
        }
      }

      // 3. Determinar candidato target.
      //    Prioridad: lock.waitlistId (si válido) > pre-tx query más reciente.
      /** @type {string|null} */
      let candidateTargetId = null;
      if (lockData && typeof lockData.waitlistId === 'string' && lockData.waitlistId) {
        candidateTargetId = lockData.waitlistId;
      } else if (preTxOpenOnes.length > 0) {
        candidateTargetId = preTxOpenOnes[0].id;
      }

      // 4. Si hay candidato, re-leer dentro del tx para stale check.
      /** @type {any} */
      let targetData = null;
      /** @type {any} */
      let targetRef = null;
      if (candidateTargetId) {
        targetRef = deps.fbDb.collection('revision_waitlist').doc(candidateTargetId);
        const tSnap = await tx.get(targetRef);
        if (tSnap.exists) {
          const td = tSnap.data() || {};
          const stillOpen = !td.closedAt && td.stage !== 'consumed';
          const sameCardCode = String(td.clientCardCode || '').trim() === cardCode;
          if (stillOpen && sameCardCode) {
            targetData = td;
          } else {
            // Lock stale (consumed/closed/mismatch). Re-apuntar.
            targetRef = null;
            candidateTargetId = null;
          }
        } else {
          // Lock stale: apuntaba a waitlist inexistente.
          targetRef = null;
          candidateTargetId = null;
        }
      }

      // 5. Si el candidato vino del lock, verificar si quedan abiertas EXTRAS
      //    del pre-tx que no fueron absorbidas (H3). Intersectar con el id del
      //    target; las demás son candidatas a absorber.
      /** @type {Array<{id: string, ref: any, data: any}>} */
      const extraAbsorbed = [];
      if (preTxOpenOnes.length > 0 && cardCode) {
        for (const open of preTxOpenOnes) {
          if (candidateTargetId && open.id === candidateTargetId) continue;
          const extraRef = deps.fbDb.collection('revision_waitlist').doc(open.id);
          const eSnap = await tx.get(extraRef);
          if (!eSnap.exists) continue;
          const ed = eSnap.data() || {};
          if (ed.closedAt || ed.stage === 'consumed') continue;
          if (String(ed.clientCardCode || '').trim() !== cardCode) continue;
          extraAbsorbed.push({ id: open.id, ref: extraRef, data: ed });
        }

        // Si el lock no apuntaba a nada y hay abiertos pre-existentes, elegir
        // uno como target y marcar los otros como extras.
        if (!candidateTargetId && extraAbsorbed.length > 0) {
          // El primer extra (más reciente) pasa a ser target; el resto, absorb.
          extraAbsorbed.sort((a, b) => {
            const ca = String(a.data.createdAt || '');
            const cb = String(b.data.createdAt || '');
            return cb.localeCompare(ca);
          });
          const first = extraAbsorbed.shift();
          if (first) {
            candidateTargetId = first.id;
            targetRef = first.ref;
            targetData = first.data;
          }
        }
      }

      // ============ FASE FAIL-CLOSED (H2 adversarial fix) ============
      // Si la pre-tx query falló (permission-denied/timeout/etc.) Y después de
      // resolver stale-check + N-1 pre-tx extras no quedó candidato verificable,
      // NO creamos. Sin pre-query válida ni lock utilizable no podemos probar
      // §42 (a lo sumo 1 waitlist abierta por cardCode); el path CREATE sin
      // esa prueba abriría un segundo waitlist "fantasma".
      //
      // Resolución: fail-closed con errorCode='failed-precondition' + data
      // `{reason:'preflight-unverifiable', cardCode, preQueryFailed:true}`.
      // El handler cliente mostrará el mensaje al vendedor, loggea en
      // operations_log y el pedido queda intacto (pending). Mariano reconcilia
      // manualmente (ver script W drift) o reintenta cuando la pre-query pase.
      if (preQueryFailed && cardCode && !candidateTargetId) {
        // H-M08 (2026-11-18): el log sale UNA SOLA VEZ en el outer catch via
        // `logMoveRejection`. El `err._errorData.reason` del throw persiste
        // y el logger lo graba como `reason` en el entry.
        const e = mkErr(
          'failed-precondition',
          'preflight no verificable: query de waitlists falló y el lock está vacío. ' +
            'Rechazado para preservar §42 (no crear duplicado). Reintenta en unos segundos.'
        );
        /** @type {any} */ (e)._errorData = {
          reason: 'preflight-unverifiable',
          cardCode,
          preQueryFailed: true,
        };
        throw e;
      }

      // ============ FASE COMPUTE ============

      const pedidoItemsNorm = pedidoLinesToWaitlistItems(fresh_data.lines, deps);

      // ============ FASE WRITES ============

      if (candidateTargetId && targetRef && targetData) {
        // === PATH UNIFY ===
        // Usar mergeLinesFromOrders del espejo pure (§57):
        //   base = target.items (actual).
        //   other = [el pedido origen + cualquier extra absorbed, como "órdenes"].
        /** @type {Array<any>} */
        const otherOrders = [];
        otherOrders.push({
          orderNumber: Number(fresh_data.orderNumber) || 0,
          pedidoId,
          source: fresh_data.source || undefined,
          pedidosOrigenes: Array.isArray(fresh_data.pedidosOrigenes)
            ? fresh_data.pedidosOrigenes
            : undefined,
          lines: pedidoItemsNorm,
        });
        for (const ex of extraAbsorbed) {
          otherOrders.push({
            orderNumber: Number(ex.data.orderNumber) || 0,
            pedidoId: undefined,
            source: ex.data.source || undefined,
            pedidosOrigenes: Array.isArray(ex.data.pedidosOrigenes)
              ? ex.data.pedidosOrigenes
              : undefined,
            lines: Array.isArray(ex.data.items) ? ex.data.items : [],
          });
        }
        const mergeResult = mergeLinesFromOrders(
          Array.isArray(targetData.items) ? targetData.items : [],
          otherOrders
        );
        const mergedItems = finalizeItemsForPersist(mergeResult.mergedLines);

        // pedidosOrigenes: union dedupe.
        const allOrigenes = (
          Array.isArray(targetData.pedidosOrigenes) ? targetData.pedidosOrigenes : []
        ).concat(Array.isArray(fresh_data.pedidosOrigenes) ? fresh_data.pedidosOrigenes : []);
        for (const ex of extraAbsorbed) {
          if (Array.isArray(ex.data.pedidosOrigenes)) {
            for (const o of ex.data.pedidosOrigenes) allOrigenes.push(o);
          }
        }
        const mergedOrigenes = dedupePedidosOrigenes(allOrigenes);

        // unifiedFrom (H11 shape canónico objeto).
        let unifiedFromAcc = Array.isArray(targetData.unifiedFrom)
          ? targetData.unifiedFrom.slice()
          : [];
        unifiedFromAcc = appendUnifiedFromEntry(unifiedFromAcc, {
          source: 'move_pedido_to_waitlist',
          pedidoId,
          orderNumber: Number(fresh_data.orderNumber) || null,
          mergedAt: nowIso,
          mergedBy: userEmail || auth.uid,
          lineCount: pedidoItemsNorm.length,
        });
        for (const ex of extraAbsorbed) {
          unifiedFromAcc = appendUnifiedFromEntry(unifiedFromAcc, {
            source: 'move_pedido_to_waitlist_absorb',
            waitlistId: ex.id,
            orderNumber: Number(ex.data.orderNumber) || null,
            mergedAt: nowIso,
            mergedBy: userEmail || auth.uid,
            lineCount: Array.isArray(ex.data.items) ? ex.data.items.length : 0,
          });
        }

        /** @type {any} */
        const updatePayload = {
          items: mergedItems,
          pedidosOrigenes: mergedOrigenes,
          unifiedFrom: unifiedFromAcc,
          updatedAt: nowIso,
        };
        // Hereda source='stock-asignado-batch' §42 v1404.
        if (
          !targetData.source &&
          (fresh_data.source === 'stock-asignado-batch' ||
            (Array.isArray(fresh_data.pedidosOrigenes) && fresh_data.pedidosOrigenes.length > 0) ||
            extraAbsorbed.some((ex) => ex.data.source === 'stock-asignado-batch'))
        ) {
          updatePayload.source = 'stock-asignado-batch';
        }

        tx.update(targetRef, updatePayload);

        // Absorb extras: marcar consumed.
        for (const ex of extraAbsorbed) {
          tx.update(ex.ref, {
            stage: 'consumed',
            closedAt: nowIso,
            closedReason: 'absorbed_by_move_pedido_to_waitlist',
            unifiedInto: candidateTargetId,
            unifiedIntoOrderNumber: targetData.orderNumber || null,
          });
        }

        // Lock update.
        if (lockRef) {
          /** @type {any} */
          const lockPayload = {
            cardCode,
            waitlistId: candidateTargetId,
            updatedAt: nowIso,
            updatedBy: auth.uid,
            lastOperation: extraAbsorbed.length > 0 ? 'unify_and_absorb' : 'unify',
            _version: 1,
          };
          if (lockData) {
            tx.update(lockRef, lockPayload);
          } else {
            tx.set(lockRef, lockPayload);
          }
        }

        tx.delete(pedidoRef);

        return {
          waitlistId: candidateTargetId,
          idempotent: false,
          unified: true,
          targetWaitlistId: candidateTargetId,
          absorbedIds: extraAbsorbed.map((ex) => ex.id),
        };
      }

      // === PATH CREATE ===
      // Nuevo waitlist (no hay abiertos — ni por lock ni por pre-tx query).
      // Usamos mergeLinesFromOrders([], [orden del pedido]) para heredar el
      // shape canónico de items (con mergedFrom / asigRefs / etc.).
      const mergeResult = mergeLinesFromOrders(
        [],
        [
          {
            orderNumber: Number(fresh_data.orderNumber) || 0,
            pedidoId,
            source: fresh_data.source || undefined,
            pedidosOrigenes: Array.isArray(fresh_data.pedidosOrigenes)
              ? fresh_data.pedidosOrigenes
              : undefined,
            lines: pedidoItemsNorm,
          },
        ]
      );
      const createdItems = finalizeItemsForPersist(mergeResult.mergedLines);

      /** @type {any} */
      const waitlistPayload = {
        clientName: fresh_data.clientName || '',
        clientCardCode: cardCode,
        ownerUid: fresh_data.ownerUid || auth.uid,
        ownerEmail: fresh_data.ownerEmail || userEmail,
        ownerVendor: fresh_data.ownerVendor || null,
        assignedVendorUid: fresh_data.assignedVendorUid || null,
        assignedVendorEmail: fresh_data.assignedVendorEmail || null,
        items: createdItems,
        source:
          fresh_data.source === 'stock-asignado-batch' ? 'stock-asignado-batch' : 'movedFromPedido',
        movedFromPedidoId: pedidoId,
        pedidosOrigenes: dedupePedidosOrigenes(
          Array.isArray(fresh_data.pedidosOrigenes) ? fresh_data.pedidosOrigenes : []
        ),
        stage: 'active',
        closedAt: null,
        createdAt: nowIso,
        createdByUid: auth.uid,
        createdByEmail: userEmail,
        updatedAt: nowIso,
      };

      tx.set(newWaitlistRef, waitlistPayload);

      if (lockRef) {
        /** @type {any} */
        const lockPayload = {
          cardCode,
          waitlistId: newWaitlistRef.id,
          updatedAt: nowIso,
          updatedBy: auth.uid,
          lastOperation: 'create',
          _version: 1,
        };
        if (lockData) {
          tx.update(lockRef, lockPayload);
        } else {
          tx.set(lockRef, lockPayload);
        }
      }

      tx.delete(pedidoRef);

      return {
        waitlistId: newWaitlistRef.id,
        idempotent: false,
        unified: false,
        targetWaitlistId: null,
        absorbedIds: [],
      };
    });

    // Audit post-tx (M1 adversarial 2026-11-18: AWAIT, patrón §64.2).
    await logMoveSuccess(deps, {
      type: result.unified ? 'pedido_moved_and_unified' : 'pedido_moved_to_waitlist',
      pedidoId,
      newWaitlistId: result.waitlistId,
      targetWaitlistId: result.targetWaitlistId,
      absorbedWaitlistIds: result.absorbedIds || [],
      unified: !!result.unified,
      idempotent: !!result.idempotent,
      preQueryFailed: !!preQueryFailed,
      cliente: data.clientName || null,
      cardCode: cardCode || null,
      userId: auth.uid,
      userEmail,
      role,
      via: 'movePedidoToWaitlistCF',
      timestamp: new Date(now),
    });

    return {
      ok: true,
      newWaitlistId: result.waitlistId,
      idempotent: !!result.idempotent,
      unified: !!result.unified,
      targetWaitlistId: result.targetWaitlistId,
      absorbedWaitlistIds: result.absorbedIds || [],
    };
  } catch (err) {
    // H-M08 (hardening post-merge 2026-11-18): logger centralizado para
    // TODOS los paths de rechazo con `_errorCode` (patrón §64.2
    // `logCommitRejection`). AWAIT para garantizar el log antes del
    // re-throw. Errores sin `_errorCode` son fallas no-business (SDK,
    // network, bug) — no se loguean acá (deja que Firebase / Sentry los
    // capture por su cuenta).
    if (err && /** @type {any} */ (err)._errorCode) {
      const errorCode = /** @type {any} */ (err)._errorCode;
      const errorData = /** @type {any} */ (err)._errorData || {};
      const errMessage = String((err && /** @type {any} */ (err).message) || '').slice(0, 500);
      await logMoveRejection(
        deps,
        errorCode,
        params,
        Object.assign(
          {
            role: role || null,
            cardCode: cardCode || null,
            errMessage,
          },
          errorData
        ),
        now
      );
    }
    throw err;
  }
}

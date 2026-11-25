// @ts-check
/**
 * R01 Fase 1 — unifyWaitlistsCF core.
 *
 * Unifica múltiples waitlists del mismo cardCode en una (target). Las
 * absorbidas pasan a `stage='consumed'`. El servidor construye el
 * `unifiedPayload` server-side (D12.2 Q4 — NO confía en el cliente).
 *
 * INVARIANTES (R01 Fase 1):
 *   - §42: a lo sumo UNA waitlist abierta por cardCode. El tx actualiza
 *     `revision_waitlist_locks/{cardCode}.waitlistId = targetId`.
 *     Si el lock apuntaba a un absorbido, se re-apunta al target. Si no
 *     existía, se crea.
 *   - §40.5: `asigRefs` / `origen` / `importedFromOrder` preservados.
 *     Delegado al espejo pure (§57) `mergeLinesFromOrders`.
 *   - §56: un SKU una sola vez por orden (delegado al mismo helper). El
 *     helper SUMA qty por diseño del pure; la regla "MÁS NUEVA + piso
 *     ASIG" §56 UPDATE v1457 vive en `bo_entry_logic.js` y dispara en el
 *     modal review del cliente downstream (fase 3+).
 *   - H11: shape `unifiedFrom` como array de objetos
 *     `{source, waitlistId, orderNumber, mergedAt, mergedBy, lineCount}`.
 *   - H12: filtrar por `closedAt != null` además de `stage === 'consumed'`.
 *
 * PERMISOS (D12.2 Q4):
 *   - admin/gerente: siempre OK.
 *   - interno: solo si target Y todos los absorbidos son propios o de su VDE
 *     pareja (auditoría 2026-11-25). Si no: INTERNO_FUERA_DE_PAREJA.
 *   - vendedor: solo si target Y todos los absorbidos cumplen
 *     (assignedVendorUid === auth.uid OR ownerUid === auth.uid).
 *
 * CAMPOS INMUTABLES: ownerUid, assignedVendorUid, assignedVendorEmail,
 *   ownerVendor, clientCardCode, createdAt del target.
 *
 * TRANSACCIÓN §58 (ALL reads before ALL writes):
 *   FASE READ: target, N absorbed, lock.
 *   FASE WRITE: update target (merge), mark absorbed consumed, update lock.
 *
 * @param {{ fbDb: any, now?: Function }} deps
 * @param {{ auth: any, targetWaitlistId: string, absorbedWaitlistIds: string[] }} params
 */

import {
  evaluateWaitlistScopeInterno,
  INTERNO_FUERA_DE_PAREJA,
  INTERNO_FUERA_DE_PAREJA_MESSAGE,
  makeGetRoleDoc,
} from './interno-scope.js';
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
 * Finaliza items para persistir: reconstruye `qtyOpen = qty` (invariante en
 * waitlist) y strippa undefined (§70).
 *
 * M2 (adversarial 2026-11-18): guard `Number.isFinite` en qty. Defensa en
 * profundidad: aunque las waitlists absorbidas deberían venir con qty válido
 * (pasaron por finalize antes), data corrupta preexistente con qty=NaN o
 * qty=Infinity propaga a través de `mergeLinesFromOrders` y Firestore rechaza
 * el write. Sin esta guard el tx falla con `internal` (no business).
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
 * H-U02 (hardening post-merge 2026-11-18): logger centralizado para TODOS
 * los paths de rechazo de `unifyWaitlistsCore`. Replica §64.2
 * (`logCommitRejection`). AWAIT (no fire-and-forget) para garantizar que el
 * log existe antes del re-throw. Scrubber defensivo.
 *
 * @param {any} deps
 * @param {string} errorCode
 * @param {{auth?: any, targetWaitlistId?: string, absorbedWaitlistIds?: string[]}} params
 * @param {Object<string, any>} extra
 * @param {number} nowMs
 */
async function logUnifyRejection(deps, errorCode, params, extra, nowMs) {
  if (!deps || !deps.fbDb) return;
  try {
    const auth = params && params.auth;
    const userEmail =
      auth && auth.token && auth.token.email ? String(auth.token.email).toLowerCase() : null;
    /** @type {any} */
    const entry = Object.assign(
      {
        type: 'unify_waitlists_rejected',
        errorCode,
        targetWaitlistId: (params && params.targetWaitlistId) || null,
        absorbedWaitlistIds: (params && params.absorbedWaitlistIds) || [],
        absorbedCount:
          (params && params.absorbedWaitlistIds && params.absorbedWaitlistIds.length) || 0,
        userId: (auth && auth.uid) || null,
        userEmail,
        via: 'unifyWaitlistsCF',
        timestamp: new Date(nowMs),
      },
      extra || {}
    );
    /** @type {Object<string, any>} */
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
        deps.log('operations_log write failed (unify)', {
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
 * ÉXITO en unify. Análogo a `logUnifyRejection` pero sin `_errorCode`.
 * Extiende §64.2 a éxitos: si el log write falla, queda registrado en
 * `deps.log` en vez de perderse silencioso.
 *
 * @param {any} deps
 * @param {Object<string, any>} logEntry
 */
async function logUnifySuccess(deps, logEntry) {
  if (!deps || !deps.fbDb) return;
  try {
    /** @type {Object<string, any>} */
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
        deps.log('operations_log success write failed (unify)', {
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
 * @param {{ fbDb: any, now?: Function, getRoleDoc?: (uid: string) => Promise<any> }} deps
 * @param {{ auth: any, targetWaitlistId: string, absorbedWaitlistIds: string[] }} params
 */
export async function unifyWaitlistsCore(deps, params) {
  const now = deps && typeof deps.now === 'function' ? deps.now() : Date.now();
  const nowIso = new Date(now).toISOString();
  const { auth, targetWaitlistId, absorbedWaitlistIds } = params || {};

  // H-U02 (hardening 2026-11-18): contexto para el logger centralizado.
  // Expuesto en outer scope para que el catch final lo lea aunque el throw
  // ocurra antes de que `role`/`cardCode` estén resueltos.
  let role = '';
  let cardCode = '';

  try {
    if (!auth || !auth.uid) throw mkErr('unauthenticated', 'login requerido');
    if (!targetWaitlistId || typeof targetWaitlistId !== 'string') {
      throw mkErr('invalid-argument', 'targetWaitlistId requerido');
    }
    if (!Array.isArray(absorbedWaitlistIds) || absorbedWaitlistIds.length === 0) {
      throw mkErr('invalid-argument', 'absorbedWaitlistIds debe ser array no-vacío');
    }
    // H-W07 (hardening 2026-11-18): cap de tamaño. Evita que una llamada
    // enferma intente unificar miles de waitlists y fuerce un tx que
    // excede el límite Firestore (500 writes por tx) o cuelga N minutos
    // leyéndolas. 100 es un umbral conservador: en el modelo operativo
    // real, >5 waitlists abiertas del mismo cardCode ya es excepcional.
    if (absorbedWaitlistIds.length > 100) {
      throw mkErr(
        'invalid-argument',
        'absorbedWaitlistIds excede el máximo permitido (100). Dividí la unificación en lotes.'
      );
    }
    if (absorbedWaitlistIds.includes(targetWaitlistId)) {
      throw mkErr('invalid-argument', 'target no puede estar en absorbed');
    }
    const absorbedUnique = Array.from(
      new Set(absorbedWaitlistIds.filter((/** @type {any} */ s) => typeof s === 'string' && s))
    );
    if (absorbedUnique.length === 0) {
      throw mkErr('invalid-argument', 'absorbedWaitlistIds vacío tras dedupe');
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

    const userEmail = String((auth.token && auth.token.email) || '').toLowerCase();
    // Auditoria 2026-11-25: el interno ya no es privilegiado (ver permisos
    // dentro de la tx: propias o de su VDE pareja).
    const isPrivileged = role === 'admin' || role === 'gerente';
    const getRoleDoc = (deps && deps.getRoleDoc) || makeGetRoleDoc(deps.fbDb);
    const targetRef = deps.fbDb.collection('revision_waitlist').doc(targetWaitlistId);

    // G1 (adversarial fix 2026-11-18): resolver `cardCode` del target ANTES
    // del bloque H-U03 de idempotencia para que el log idempotent no tenga
    // `cardCode=''`. Antes H-U03 corría primero y el log salía con cardCode
    // vacío porque H-U04 era el único que lo seteaba.
    try {
      const targetCCSnap = await targetRef.get();
      if (targetCCSnap.exists) {
        cardCode = String((targetCCSnap.data() || {}).clientCardCode || '').trim();
      }
    } catch (_) {
      /* si falla, cardCode queda '' — el tx disparará not-found con log OK */
    }

    // === H1 — SNAPSHOT TOKEN del lock (adversarial 2026-11-18) ===
    // Capturar `lock.updatedAt` ANTES del pre-tx query §42 (H-U04). Dentro
    // del tx, re-leer el lock y verificar que `updatedAt` no cambió. Si
    // cambió, un move/unify concurrente actualizó el lock entre pre-tx y
    // tx → fail-closed para preservar §42. Más fuerte que "set membership"
    // porque detecta también re-unificación parcial donde el lock apunta a
    // un absorbed (válido para el set membership pero inválido semánticamente).
    //
    // Si el lock no existe al pre-tx, capturamos token=null; dentro del tx
    // debe seguir sin existir (o podría haberse creado por concurrencia).
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

    // === H-U04 (hardening 2026-11-18): PRE-TX QUERY §42 ===
    // Validar que no haya waitlists abiertas de MISMO cardCode fuera de
    // {target} ∪ absorbed. Si existen, es §42 violation.
    //
    // H2 (adversarial fix 2026-11-18): `.limit(PRE_TX_QUERY_LIMIT)` previene
    // DoS si un cardCode acumula miles de docs consumed históricos. Filtro
    // de `closedAt/consumed` en memoria (no en `where`) porque Firestore
    // distingue `null explícito` de `campo ausente` y rompería con docs
    // legacy sin el field.
    const UNIFY_PRE_TX_QUERY_LIMIT = 200;
    const UNIFY_PRE_TX_OPEN_CAP = 50;
    let preQueryTruncated = false;
    try {
      if (cardCode) {
        const allowedIds = new Set([targetWaitlistId].concat(absorbedUnique));
        const qs = await deps.fbDb
          .collection('revision_waitlist')
          .where('clientCardCode', '==', cardCode)
          .limit(UNIFY_PRE_TX_QUERY_LIMIT)
          .get();
        /** @type {Array<string>} */
        const unlistedOpenIds = [];
        /** @type {Array<string>} */
        const listedOpenIds = [];
        qs.forEach((/** @type {any} */ d) => {
          const wd = d.data() || {};
          if (wd.closedAt) return;
          if (wd.stage === 'consumed') return;
          if (allowedIds.has(d.id)) {
            listedOpenIds.push(d.id);
          } else {
            unlistedOpenIds.push(d.id);
          }
        });
        if (qs.size === UNIFY_PRE_TX_QUERY_LIMIT) {
          preQueryTruncated = true;
        }
        // H2: histórico saturado — no podemos probar §42.
        if (preQueryTruncated) {
          throw mkErr(
            'failed-precondition',
            'Este cliente tiene demasiados pedidos en espera. Avisale a Mariano.'
          );
        }
        // H4: cap operativo sobre abiertas totales (target + absorbed + unlisted).
        const totalOpen = listedOpenIds.length + unlistedOpenIds.length;
        if (totalOpen > UNIFY_PRE_TX_OPEN_CAP) {
          throw mkErr(
            'failed-precondition',
            'Este cliente tiene demasiados pedidos en espera abiertos (' +
              totalOpen +
              '). Avisale a Mariano para que los revise.'
          );
        }
        // H-U04: tercera waitlist detectada.
        if (unlistedOpenIds.length > 0) {
          const preview = unlistedOpenIds.slice(0, 3).join(', ');
          const more = unlistedOpenIds.length > 3 ? ' (+' + (unlistedOpenIds.length - 3) + ')' : '';
          const e = mkErr(
            'failed-precondition',
            'hay waitlist(s) abierta(s) del mismo cliente fuera de absorbedWaitlistIds: ' +
              preview +
              more +
              '. Rechazado para preservar §42 (una waitlist abierta por cardCode).'
          );
          /** @type {any} */ (e)._errorData = {
            reason: 'third-open-waitlist',
            cardCode,
            unlistedOpenIds,
          };
          throw e;
        }
      }
      // Si no hay cardCode resuelto, el tx disparará 'not-found' con log OK.
    } catch (ePre) {
      // Re-throw si es error de negocio nuestro.
      if (ePre && /** @type {any} */ (ePre)._errorCode) throw ePre;
      // Firestore read falló (permission/timeout). Fail-closed.
      const e = mkErr(
        'failed-precondition',
        'preflight no verificable: query de waitlists falló. ' +
          'Rechazado para preservar §42. Reintenta en unos segundos.'
      );
      /** @type {any} */ (e)._errorData = {
        reason: 'preflight-unverifiable',
        preQueryErr: String((ePre && /** @type {any} */ (ePre).message) || ePre).slice(0, 300),
      };
      throw e;
    }

    // === H-U03 (hardening 2026-11-18): IDEMPOTENCIA en retry ===
    // Si TODOS los absorbeds ya están `stage='consumed'` con
    // `unifiedInto === targetWaitlistId` Y el target sigue vivo, es un
    // retry de operación previa exitosa. Devolvemos idempotent OK sin
    // tocar nada. Los reads son fuera del tx (optimización — el tx
    // habría tirado failed-precondition para absorbeds consumed).
    //
    // G1 (adversarial 2026-11-18): el log idempotent ahora tiene `cardCode`
    // válido porque se resolvió antes de este bloque.
    try {
      const preAbsorbedSnaps = await Promise.all(
        absorbedUnique.map((/** @type {string} */ id) =>
          deps.fbDb.collection('revision_waitlist').doc(id).get()
        )
      );
      const targetStillOpen = await targetRef.get().then((/** @type {any} */ snap) => {
        if (!snap.exists) return false;
        const td = snap.data() || {};
        return !td.closedAt && td.stage !== 'consumed';
      });
      const allAlreadyUnifiedIntoTarget =
        targetStillOpen &&
        preAbsorbedSnaps.every((/** @type {any} */ snap) => {
          if (!snap.exists) return false;
          const d = snap.data() || {};
          return d.stage === 'consumed' && d.unifiedInto === targetWaitlistId;
        });
      if (allAlreadyUnifiedIntoTarget) {
        // M1 (adversarial 2026-11-18): AWAIT via helper logUnifySuccess.
        await logUnifySuccess(deps, {
          type: 'waitlists_unified_idempotent',
          targetWaitlistId,
          absorbedWaitlistIds: absorbedUnique,
          absorbedCount: absorbedUnique.length,
          cardCode: cardCode || null,
          userId: auth.uid,
          userEmail,
          role,
          via: 'unifyWaitlistsCF',
          timestamp: new Date(now),
        });
        return {
          ok: true,
          idempotent: true,
          targetOrderNumber: null,
          absorbedCount: absorbedUnique.length,
          absorbedIds: absorbedUnique,
          unifiedItemsCount: 0,
        };
      }
    } catch (_eIdem) {
      // Pre-tx read falló. No bloqueamos — el tx hará la verificación
      // real. Solo perdemos la fast-path idempotente.
    }

    // === TRANSACTION §58 ===
    const result = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      // ============ FASE READS ============

      // 1. Target.
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) throw mkErr('not-found', 'target waitlist no existe');
      const targetData = targetSnap.data() || {};
      // H12: filtrar por closedAt + stage.
      if (targetData.stage === 'consumed' || targetData.closedAt) {
        throw mkErr(
          'failed-precondition',
          targetData.closedAt ? 'target ya está cerrado (closedAt)' : 'target ya está consumed'
        );
      }

      // 2. Absorbed.
      /** @type {Array<{ref: any, data: any, id: string}>} */
      const absorbedSnaps = [];
      for (const absId of absorbedUnique) {
        const absRef = deps.fbDb.collection('revision_waitlist').doc(absId);
        const absSnap = await tx.get(absRef);
        if (!absSnap.exists) throw mkErr('not-found', `absorbed waitlist ${absId} no existe`);
        const absData = absSnap.data() || {};
        if (absData.stage === 'consumed' || absData.closedAt) {
          throw mkErr(
            'failed-precondition',
            absData.closedAt
              ? `absorbed ${absId} ya está cerrado (closedAt)`
              : `absorbed ${absId} ya consumed`
          );
        }
        absorbedSnaps.push({ ref: absRef, data: absData, id: absId });
      }

      // 3. Validaciones.
      const targetCC = String(targetData.clientCardCode || '').trim();
      if (!targetCC) {
        throw mkErr('failed-precondition', 'target sin clientCardCode');
      }
      // H-U02: reassign outer `cardCode` para el logger (si H-U04 no lo seteó).
      if (!cardCode) cardCode = targetCC;
      for (const abs of absorbedSnaps) {
        const absCC = String(abs.data.clientCardCode || '').trim();
        if (absCC !== targetCC) {
          throw mkErr(
            'failed-precondition',
            `absorbed ${abs.id} cardCode ${absCC} != target ${targetCC}`
          );
        }
      }

      // Permisos (D12.2 Q4).
      if (role === 'interno') {
        // Lecturas de roles antes de cualquier write (§58).
        const docs = [{ id: targetWaitlistId, data: targetData }].concat(
          absorbedSnaps.map((a) => ({ id: a.id, data: a.data }))
        );
        for (const d of docs) {
          const scope = await evaluateWaitlistScopeInterno({
            callerUid: auth.uid,
            waitlist: d.data,
            getRoleDoc,
          });
          if (!scope.ok) {
            const e = mkErr('permission-denied', INTERNO_FUERA_DE_PAREJA_MESSAGE);
            /** @type {any} */ (e)._errorData = {
              errorCode: INTERNO_FUERA_DE_PAREJA,
              waitlistFueraDeAlcance: d.id,
            };
            throw e;
          }
        }
      } else if (!isPrivileged) {
        if (role !== 'vendedor') {
          throw mkErr('permission-denied', 'rol no autorizado');
        }
        const targetAllowed =
          targetData.ownerUid === auth.uid || targetData.assignedVendorUid === auth.uid;
        if (!targetAllowed) {
          throw mkErr('permission-denied', 'VDE sin ownership en target');
        }
        for (const abs of absorbedSnaps) {
          const absAllowed =
            abs.data.ownerUid === auth.uid || abs.data.assignedVendorUid === auth.uid;
          if (!absAllowed) {
            throw mkErr('permission-denied', `VDE sin ownership en absorbed ${abs.id}`);
          }
        }
      }

      // 4. Lock.
      const lockRef = deps.fbDb.collection('revision_waitlist_locks').doc(targetCC);
      const lockSnap = await tx.get(lockRef);
      const lockData = lockSnap.exists ? lockSnap.data() || {} : null;

      // H1 (adversarial fix 2026-11-18): snapshot-token verification.
      // Verificar que el lock NO cambió entre el pre-tx capture y el tx.get
      // de aquí. Si cambió, un move/unify concurrente actualizó el lock
      // entre el pre-tx query §42 (H-U04) y este punto → §42 podría estar
      // violada ahora aunque la pre-query diera OK. Fail-closed.
      //
      // Casos:
      //  (a) pre-existió Y sigue existiendo Y updatedAt igual → OK.
      //  (b) pre-existió Y sigue existiendo pero updatedAt cambió → fail.
      //  (c) pre-existió Y ya no existe → fail (alguien lo borró).
      //  (d) NO pre-existió Y ahora existe → fail (alguien lo creó concurrent).
      //  (e) NO pre-existió Y sigue sin existir → OK.
      //
      // Firestore reintentará el tx automáticamente si detecta conflicto
      // en el lock entre read y commit; este check cubre la ventana
      // pre-tx→tx.get que Firestore NO cubre (optimistic concurrency).
      if (preTxLockExisted && !lockSnap.exists) {
        const e = mkErr(
          'failed-precondition',
          'lock cambió mid-operación (un pedido concurrente lo modificó). Reintentá en unos segundos.'
        );
        /** @type {any} */ (e)._errorData = {
          reason: 'concurrent-lock-deleted',
          cardCode: targetCC,
        };
        throw e;
      }
      if (!preTxLockExisted && lockSnap.exists) {
        const e = mkErr(
          'failed-precondition',
          'lock cambió mid-operación (un pedido concurrente lo creó). Reintentá en unos segundos.'
        );
        /** @type {any} */ (e)._errorData = {
          reason: 'concurrent-lock-created',
          cardCode: targetCC,
          lockNowPointsTo: (lockData && lockData.waitlistId) || null,
        };
        throw e;
      }
      if (preTxLockExisted && lockSnap.exists) {
        const freshLockUpdatedAt =
          lockData && typeof lockData.updatedAt === 'string' ? lockData.updatedAt : null;
        if (preTxLockUpdatedAt !== freshLockUpdatedAt) {
          const e = mkErr(
            'failed-precondition',
            'lock cambió mid-operación (un pedido concurrente lo modificó). Reintentá en unos segundos.'
          );
          /** @type {any} */ (e)._errorData = {
            reason: 'concurrent-waitlist-detected',
            cardCode: targetCC,
            preTxLockUpdatedAt,
            freshLockUpdatedAt,
            lockNowPointsTo: (lockData && lockData.waitlistId) || null,
          };
          throw e;
        }
      }

      // ============ FASE COMPUTE ============

      // Merge usando el helper pure (§57). base=target.items,
      // other=absorbed.items como "órdenes".
      const otherOrders = absorbedSnaps.map((abs) => ({
        orderNumber: Number(abs.data.orderNumber) || 0,
        pedidoId: undefined,
        source: abs.data.source || undefined,
        pedidosOrigenes: Array.isArray(abs.data.pedidosOrigenes)
          ? abs.data.pedidosOrigenes
          : undefined,
        lines: Array.isArray(abs.data.items) ? abs.data.items : [],
      }));
      const mergeResult = mergeLinesFromOrders(
        Array.isArray(targetData.items) ? targetData.items : [],
        otherOrders
      );
      const mergedItems = finalizeItemsForPersist(mergeResult.mergedLines);

      // pedidosOrigenes union + dedupe.
      const allOrigenes = Array.isArray(targetData.pedidosOrigenes)
        ? targetData.pedidosOrigenes.slice()
        : [];
      for (const abs of absorbedSnaps) {
        if (Array.isArray(abs.data.pedidosOrigenes)) {
          for (const o of abs.data.pedidosOrigenes) allOrigenes.push(o);
        }
      }
      const dedupedOrigenes = dedupePedidosOrigenes(allOrigenes);

      // unifiedFrom (H11 shape canónico objeto).
      /** @type {Array<any>} */
      const unifiedFromAcc = Array.isArray(targetData.unifiedFrom)
        ? targetData.unifiedFrom.slice()
        : [];
      for (const abs of absorbedSnaps) {
        unifiedFromAcc.push({
          source: 'unify_waitlists_cf',
          waitlistId: abs.id,
          orderNumber: Number(abs.data.orderNumber) || null,
          mergedAt: nowIso,
          mergedBy: userEmail || auth.uid,
          lineCount: Array.isArray(abs.data.items) ? abs.data.items.length : 0,
        });
      }

      /** @type {any} */
      const updatePayload = {
        items: mergedItems,
        pedidosOrigenes: dedupedOrigenes,
        unifiedFrom: unifiedFromAcc,
        updatedAt: nowIso,
      };
      // Hereda source='stock-asignado-batch' §42 v1404.
      if (!targetData.source) {
        for (const abs of absorbedSnaps) {
          if (abs.data.source === 'stock-asignado-batch') {
            updatePayload.source = 'stock-asignado-batch';
            break;
          }
        }
      }

      // ============ FASE WRITES ============

      tx.update(targetRef, updatePayload);
      for (const abs of absorbedSnaps) {
        tx.update(abs.ref, {
          stage: 'consumed',
          closedAt: nowIso,
          closedReason: 'unified_into_v42',
          unifiedInto: targetWaitlistId,
          unifiedIntoOrderNumber: targetData.orderNumber || null,
        });
      }

      // Lock: apuntar al target.
      /** @type {any} */
      const lockPayload = {
        cardCode: targetCC,
        waitlistId: targetWaitlistId,
        updatedAt: nowIso,
        updatedBy: auth.uid,
        lastOperation: 'unify',
        _version: 1,
      };
      if (lockData) {
        tx.update(lockRef, lockPayload);
      } else {
        tx.set(lockRef, lockPayload);
      }

      return {
        targetOrderNumber: targetData.orderNumber || null,
        absorbedCount: absorbedSnaps.length,
        absorbedIds: absorbedSnaps.map((a) => a.id),
        unifiedItemsCount: mergedItems.length,
        cardCode: targetCC,
      };
    });

    // Audit post-tx (M1 adversarial 2026-11-18: AWAIT, patrón §64.2).
    await logUnifySuccess(deps, {
      type: 'waitlists_unified',
      targetWaitlistId,
      targetOrderNumber: result.targetOrderNumber,
      absorbedWaitlistIds: result.absorbedIds,
      absorbedCount: result.absorbedCount,
      unifiedItemsCount: result.unifiedItemsCount,
      cardCode: result.cardCode,
      userId: auth.uid,
      userEmail,
      role,
      via: 'unifyWaitlistsCF',
      timestamp: new Date(now),
    });

    return {
      ok: true,
      targetOrderNumber: result.targetOrderNumber,
      absorbedCount: result.absorbedCount,
      absorbedIds: result.absorbedIds,
      unifiedItemsCount: result.unifiedItemsCount,
    };
  } catch (err) {
    // H-U02 (hardening post-merge 2026-11-18): logger centralizado para
    // TODOS los paths de rechazo con `_errorCode`. AWAIT antes del
    // re-throw. Errores sin `_errorCode` son fallas no-business.
    if (err && /** @type {any} */ (err)._errorCode) {
      const errorCode = /** @type {any} */ (err)._errorCode;
      const errorData = /** @type {any} */ (err)._errorData || {};
      const errMessage = String((err && /** @type {any} */ (err).message) || '').slice(0, 500);
      await logUnifyRejection(
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

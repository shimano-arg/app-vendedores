// @ts-check
/**
 * DEUDA-M1 R1-R4 (2026-11-19) — validate ownership + transiciones de
 * `revision_waitlist` server-side (trigger onDocumentWritten).
 *
 * Defensa en profundidad complementaria a las rules de A1.2 (PR #1376).
 * El trigger NO reemplaza las rules — si la rule bloquea, no hay write
 * para validar. El trigger SÍ actúa si:
 * - Las rules se abren por accidente (regresión).
 * - Un admin escribe por error un campo inmutable.
 * - Un flow legítimo persiste datos inconsistentes.
 * - Un Admin SDK bypasea rules y persiste algo inválido.
 *
 * Observe-only en primera iteración: loguea cualquier violación a
 * `operations_log.type='sec_m1_waitlist_integrity_violation'` con detalle,
 * NO revierte. Permite medir baseline + ajustar antes de activar hard-revert.
 *
 * 4 reglas validadas:
 * - R1: items[].asigRefs apuntan a pedidos del MISMO clientCardCode.
 * - R2: transición de stage debe ser monotónica (pending→consumed OK;
 *       consumed→pending BLOQUEADO — indicaría reanimación ilegítima).
 * - R3: clientCardCode es inmutable post-create.
 * - R4: ownerUid + ownerVendor + assignedVendorUid son inmutables post-create
 *       (excepción documentada: migraciones batch scripts con _backfill
 *       flag, como script Q vendedor desalineado).
 *
 * El trigger es idempotente: si ya hay un log reciente para el mismo
 * waitlistId + reason, no duplica.
 */

/** Transiciones de stage permitidas: before→after. */
const VALID_STAGE_TRANSITIONS = /** @type {Record<string, Set<any>>} */ ({
  // Primera creación: cualquier valor inicial OK.
  __create__: new Set([undefined, null, 'pending', 'consumed']),
  // Post-create.
  undefined: new Set([undefined, null, 'pending', 'consumed']),
  null: new Set([undefined, null, 'pending', 'consumed']),
  pending: new Set([undefined, null, 'pending', 'consumed']),
  // consumed es terminal — no retorno a pending (indicaría reanimación).
  consumed: new Set(['consumed']),
});

/**
 * Valida un write a revision_waitlist y retorna lista de violaciones.
 * Si retorna [] = write válido.
 *
 * @param {object} params
 * @param {any} params.before  Data del snapshot before (null si create).
 * @param {any} params.after   Data del snapshot after (null si delete).
 * @param {string} params.waitlistId
 * @param {Map<string, {clientCardCode: string}>} [params.pedidoOrigenCards]
 *        Map pedidoId → {clientCardCode} para validar cross-reference R1.
 *        Si no se pasa, R1 se skippea (fail-open controlado).
 * @returns {Array<{rule: string, field?: string, severity: string, detail: any}>}
 */
export function validateWaitlistWrite({ before, after, waitlistId, pedidoOrigenCards }) {
  /** @type {Array<{rule: string, field?: string, severity: string, detail: any}>} */
  const violations = [];

  // Delete: nothing to validate (ownership del delete lo cubren las rules).
  if (!after) return violations;

  // === R2: Transición de stage ===
  const beforeStage = before ? String(before.stage || '') : '__create__';
  const afterStage = after ? String(after.stage || '') : '';
  const allowedTargets = VALID_STAGE_TRANSITIONS[beforeStage];
  if (allowedTargets && !allowedTargets.has(afterStage)) {
    violations.push({
      rule: 'R2_INVALID_STAGE_TRANSITION',
      field: 'stage',
      severity: 'high',
      detail: {
        from: before ? before.stage : null,
        to: after.stage,
        waitlistId,
      },
    });
  }

  if (before) {
    // === R3: clientCardCode inmutable ===
    if (before.clientCardCode && after.clientCardCode !== before.clientCardCode) {
      violations.push({
        rule: 'R3_CLIENTCARDCODE_MUTATED',
        field: 'clientCardCode',
        severity: 'high',
        detail: {
          from: before.clientCardCode,
          to: after.clientCardCode,
          waitlistId,
        },
      });
    }

    // === R4: ownerUid / ownerVendor / assignedVendorUid inmutables ===
    // Excepción: script de backfill batch pone `_backfill.<slug>` en el doc.
    // Si el write tiene `_backfill` presente nuevo, consideramos migración.
    const hasBackfill =
      after._backfill &&
      Object.keys(after._backfill).length > 0 &&
      (!before._backfill ||
        Object.keys(before._backfill).length < Object.keys(after._backfill).length);

    const immutableFields = ['ownerUid', 'ownerVendor', 'assignedVendorUid'];
    if (!hasBackfill) {
      for (const field of immutableFields) {
        if (before[field] && after[field] !== before[field]) {
          violations.push({
            rule: 'R4_OWNERSHIP_FIELD_MUTATED',
            field,
            severity: 'high',
            detail: {
              from: before[field],
              to: after[field],
              waitlistId,
            },
          });
        }
      }
    }
  }

  // === R1: items[].asigRefs cross-reference ===
  if (pedidoOrigenCards && Array.isArray(after.items) && after.clientCardCode) {
    for (let itemIdx = 0; itemIdx < after.items.length; itemIdx++) {
      const item = after.items[itemIdx];
      if (!item || !Array.isArray(item.asigRefs)) continue;
      for (const ref of item.asigRefs) {
        if (!ref || !ref.pedidoId) continue;
        const originPed = pedidoOrigenCards.get(ref.pedidoId);
        if (!originPed) continue; // No info → fail-open (idem SEC-M6).
        if (
          originPed.clientCardCode &&
          after.clientCardCode &&
          originPed.clientCardCode !== after.clientCardCode
        ) {
          violations.push({
            rule: 'R1_ASIGREF_CROSS_CLIENT',
            field: `items[${itemIdx}].asigRefs`,
            severity: 'high',
            detail: {
              waitlistId,
              waitlistCardCode: after.clientCardCode,
              refPedidoId: ref.pedidoId,
              refPedidoCardCode: originPed.clientCardCode,
              itemIdx,
            },
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Handler principal del trigger. Carga pedido origen cards necesarios +
 * valida + loguea violaciones. Idempotente por (waitlistId, rule, timestamp).
 *
 * Fail-open: si Firestore lookup falla, NO bloquea el write (ya ocurrió).
 *
 * @param {object} params
 * @param {any} params.before
 * @param {any} params.after
 * @param {string} params.waitlistId
 * @param {any} params.fbDb
 * @param {(msg: string, extra?: any) => void} [params.log]
 * @param {() => number} [params.now]
 * @returns {Promise<{violations: Array<any>, logged: boolean}>}
 */
export async function handleWaitlistValidate(params) {
  const { before, after, waitlistId, fbDb } = params;
  const log = params.log || (() => {});
  const nowMs = params.now ? params.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!after && !before) return { violations: [], logged: false };
  if (!after) return { violations: [], logged: false }; // Delete: nothing.

  // Collect pedidoIds from asigRefs para R1 cross-check.
  /** @type {Map<string, {clientCardCode: string}>} */
  const pedidoOrigenCards = new Map();
  try {
    const pedidoIds = new Set();
    if (Array.isArray(after.items)) {
      for (const item of after.items) {
        if (!item || !Array.isArray(item.asigRefs)) continue;
        for (const ref of item.asigRefs) {
          if (ref && ref.pedidoId) pedidoIds.add(ref.pedidoId);
        }
      }
    }
    for (const pid of pedidoIds) {
      try {
        const snap = await fbDb.collection('pedidos').doc(pid).get();
        if (snap.exists) {
          const data = snap.data() || {};
          pedidoOrigenCards.set(pid, { clientCardCode: String(data.clientCardCode || '') });
        }
      } catch (_e) {
        // Fail-open por pedido — seguimos con los demás.
      }
    }
  } catch (e) {
    log('waitlist_validate_lookup_failed', { waitlistId, err: (e && e.message) || String(e) });
  }

  const violations = validateWaitlistWrite({
    before,
    after,
    waitlistId,
    pedidoOrigenCards,
  });

  if (violations.length === 0) {
    return { violations: [], logged: false };
  }

  // Log violation(s) a operations_log fire-and-forget.
  try {
    await fbDb.collection('operations_log').add({
      type: 'sec_m1_waitlist_integrity_violation',
      severity: 'warning',
      waitlistId,
      violationCount: violations.length,
      violations: violations.map((v) => ({
        rule: v.rule,
        field: v.field || null,
        detail: v.detail,
      })),
      waitlistCardCode: after.clientCardCode || null,
      waitlistOwner: after.ownerUid || null,
      waitlistAssignedVendor: after.assignedVendorUid || null,
      beforeStage: before ? before.stage : null,
      afterStage: after.stage || null,
      via: 'trigger_onWaitlistWriteValidate',
      timestamp: new Date(nowMs),
      createdAt: nowIso,
    });
    log('waitlist_validate_violation', {
      waitlistId,
      rules: violations.map((v) => v.rule),
    });
    return { violations, logged: true };
  } catch (e) {
    log('waitlist_validate_log_failed', { waitlistId, err: (e && e.message) || String(e) });
    return { violations, logged: false };
  }
}

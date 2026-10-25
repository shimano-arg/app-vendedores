#!/usr/bin/env node
// @ts-check
/**
 * EDUARDO SATO duplicado 2026-10-23 — eliminar `qlB4FpI3R9Rhu5sLZvbf`
 * (confirmed 22:08:43 UTC = 2 segundos después del original 22:08:41 UTC
 * `6LhigQdzUmEcOHcRUEjl`). Mismo _draftId + mismo waitlistOrigenId; es
 * un doble-click del VDE antes del fix de persistencia §57.
 *
 * Qué hace:
 *   - Mutar lines del duplicado: state=BO/ASIG → state=cancelled con
 *     closedReason='duplicate_removed_2026-10-25', qtyCancelled, cancelledAt,
 *     cancelledBy='scripts/audit/D_...'.
 *   - Marcar pedido: closedAt = now, closedReason = 'duplicate_removed_2026-10-25',
 *     transferidoSAP = null.
 *   - Guardar valor anterior en _backfill (§55).
 *
 * Nota (§40): las líneas estaban todas state='BO' con reason=
 * 'all_lines_bo_server_detected'. BO NO reserva stock → "cancelar reservas"
 * es sólo correctness semántica, no libera físico (que ya no estaba reservado).
 *
 * NO elimina el doc (preserva auditoría). Si Mariano quiere delete físico,
 * segundo paso aparte.
 *
 * Uso:
 *   node scripts/audit/D_eliminar_sato_duplicado_2026-10-25.cjs           # dry-run
 *   node scripts/audit/D_eliminar_sato_duplicado_2026-10-25.cjs --apply  # con OK Mariano
 */

const admin = require('../../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

const DUPLICATE_ID = 'qlB4FpI3R9Rhu5sLZvbf';
const ORIGINAL_ID = '6LhigQdzUmEcOHcRUEjl';
const REASON = 'duplicate_removed_2026-10-25';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`\n[D] Eliminación duplicado SATO — ${apply ? 'APPLY' : 'DRY-RUN'}`);

  // Verificar original existe (para no eliminar "huérfanamente").
  const origSnap = await db.collection('pedidos').doc(ORIGINAL_ID).get();
  if (!origSnap.exists) {
    console.error(`[D] CRITICAL: original ${ORIGINAL_ID} no existe. Abortar.`);
    process.exit(1);
  }
  const origData = origSnap.data() || {};
  console.log(`[D] Original ${ORIGINAL_ID} confirmedAt=${origData.confirmedAt}`);

  const dupSnap = await db.collection('pedidos').doc(DUPLICATE_ID).get();
  if (!dupSnap.exists) {
    console.log(`[D] Duplicado ${DUPLICATE_ID} NO existe. Nada que hacer.`);
    return;
  }
  const dupData = dupSnap.data() || {};
  console.log(`[D] Duplicado ${DUPLICATE_ID} confirmedAt=${dupData.confirmedAt}`);

  // Validar invariantes antes de mutar.
  if (dupData._draftId !== origData._draftId) {
    console.error(
      `[D] CRITICAL: _draftId no coincide (${dupData._draftId} != ${origData._draftId}). Abortar.`
    );
    process.exit(1);
  }
  if (dupData.clientCardCode !== origData.clientCardCode) {
    console.error(`[D] CRITICAL: cardCode no coincide. Abortar.`);
    process.exit(1);
  }
  if (dupData.waitlistOrigenId !== origData.waitlistOrigenId) {
    console.error(`[D] CRITICAL: waitlistOrigenId no coincide. Abortar.`);
    process.exit(1);
  }
  const dupMs = dupData.confirmedAt.toMillis
    ? dupData.confirmedAt.toMillis()
    : new Date(dupData.confirmedAt).getTime();
  const origMs = origData.confirmedAt.toMillis
    ? origData.confirmedAt.toMillis()
    : new Date(origData.confirmedAt).getTime();
  if (dupMs < origMs) {
    console.error(
      `[D] CRITICAL: duplicado es MÁS VIEJO que original (${dupMs} < ${origMs}). ¿Elegiste bien cuál conservar? Abortar.`
    );
    process.exit(1);
  }
  console.log(
    `[D] Invariantes OK: mismo _draftId, mismo cardCode, mismo waitlistOrigenId, dup ${dupMs - origMs}ms después del original.`
  );

  // Preparar mutación.
  const nowIso = new Date().toISOString();
  const nowDate = new Date();
  /** @type {any[]} */
  const originalLines = dupData.lines || [];
  const mutatedLines = originalLines.map((l) => {
    if (!l) return l;
    if (l.state === 'cancelled') return l; // idempotente
    const prevQo = Number(l.qtyOpen) || 0;
    const prevCanc = Number(l.qtyCancelled) || 0;
    return {
      ...l,
      state: 'cancelled',
      qtyOpen: 0,
      qtyCancelled: prevCanc + prevQo,
      closedReason: REASON,
      cancelledAt: nowIso,
      cancelledBy: 'scripts/audit/D_eliminar_sato_duplicado_2026-10-25.cjs',
    };
  });
  const stateCount = { BO: 0, cancelled: 0, confirmed: 0, ASIG: 0, otros: 0 };
  for (const l of originalLines) {
    if (!l) continue;
    const s = l.state || 'otros';
    if (s in stateCount) stateCount[s]++;
    else stateCount.otros++;
  }
  console.log(`[D] Líneas originales: ${originalLines.length}, por state: ${JSON.stringify(stateCount)}`);
  console.log(`[D] → todas pasan a state='cancelled' con closedReason='${REASON}'`);

  if (!apply) {
    console.log('\n[D] DRY-RUN. Para aplicar, correr con --apply.');
    return;
  }

  console.log('\n[D] APPLY. Mutando duplicado...');
  await db.collection('pedidos').doc(DUPLICATE_ID).update({
    lines: mutatedLines,
    closedAt: nowDate,
    closedReason: REASON,
    transferidoSAP: null,
    _backfill: {
      [`D_duplicate_removed_${new Date().toISOString().slice(0, 10)}`]: {
        previousValues: {
          lines: originalLines,
          closedAt: dupData.closedAt || null,
          closedReason: dupData.closedReason || null,
          transferidoSAP: dupData.transferidoSAP || null,
        },
        by: 'scripts/audit/D_eliminar_sato_duplicado_2026-10-25.cjs',
        at: nowIso,
        reason: `Eliminación duplicado SATO. Original conservado: ${ORIGINAL_ID}`,
        originalId: ORIGINAL_ID,
      },
    },
    _lastBackfillAt: nowIso,
    _lastBackfillBy: 'scripts/audit/D_eliminar_sato_duplicado_2026-10-25.cjs',
  });
  console.log(`[D] ✓ ${DUPLICATE_ID} marcado como duplicate_removed_2026-10-25.`);
}

main().catch((e) => {
  console.error('[D] ERROR:', e);
  process.exit(1);
});

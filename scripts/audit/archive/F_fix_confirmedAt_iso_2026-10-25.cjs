#!/usr/bin/env node
// @ts-check
/**
 * INCIDENTE 2026-10-25 — fix final de "Invalid Date" en los 7 reparados +
 * SATO duplicado.
 *
 * ROOT CAUSE
 * commitPedidoCore guarda `confirmedAt: FieldValue.serverTimestamp()`
 * (Firestore Timestamp). El panel UI hace `new Date(it.conf.confirmedAt)
 * .toLocaleDateString()`. En el browser:
 *   - `new Date(iso_string)` → Date válido → "23/10/2026".
 *   - `new Date(firestoreTimestamp)` → "Invalid Date" (es un {seconds,
 *     nanoseconds} que Date no sabe parsear).
 *
 * Los pedidos legacy (pre-CF) guardaban `confirmedAt` como ISO string, por
 * eso se veían bien. Los pedidos CF (como los 7 reparados) lo tienen
 * Timestamp → tarjetas con "Invalid Date".
 *
 * Fix: para cada reparado, leer `confirmedAt` (Timestamp) y escribirlo
 * de nuevo como ISO string. Preserva el valor exacto; solo cambia el tipo.
 *
 * TODO futuro: cambiar `buildPedidoDocData` en commit-pedido-core.js para
 * usar `new Date().toISOString()` en vez de `serverTimestamp()`. Alternativa:
 * dejar Timestamp y arreglar el panel para hacer `.toDate()` cuando
 * corresponde (más limpio pero cambia 10+ call-sites). Fix defensivo
 * mínimo: `confirmedAt` ISO string, igual que el flow legacy.
 *
 * Uso:
 *   node scripts/audit/F_fix_confirmedAt_iso_2026-10-25.cjs           # dry-run
 *   node scripts/audit/F_fix_confirmedAt_iso_2026-10-25.cjs --apply  # con OK
 */

const admin = require('../../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`\n[F] Fix confirmedAt ISO — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  // Buscar los 7 reparados + SATO duplicado (via _backfill W o D).
  const snap = await db
    .collection('pedidos')
    .where('_commitVersion', '==', 'commitPedidoCore_v1')
    .get();
  const afectados = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const bf = data._backfill || {};
    const esRep = Object.keys(bf).some((k) => k.includes('W_bo_fantasma'));
    const esDup = Object.keys(bf).some((k) => k.includes('D_duplicate'));
    if (!esRep && !esDup) return;
    afectados.push({ id: d.id, data });
  });
  console.log(`[F] Encontrados ${afectados.length} docs (7 reparados + SATO dup).\n`);

  const plan = [];
  for (const { id, data } of afectados) {
    const ca = data.confirmedAt;
    let caIso = null;
    let srcKind = null;
    if (!ca) {
      srcKind = 'NULL';
    } else if (typeof ca === 'string') {
      srcKind = 'already_string';
      caIso = ca; // ya ok
    } else if (typeof ca.toDate === 'function') {
      srcKind = 'Timestamp';
      caIso = ca.toDate().toISOString();
    } else if (ca instanceof Date) {
      srcKind = 'Date';
      caIso = ca.toISOString();
    } else if (ca.seconds != null) {
      // Firestore server-timestamp-like
      srcKind = 'TimestampLike';
      caIso = new Date(ca.seconds * 1000 + Math.floor((ca.nanoseconds || 0) / 1e6)).toISOString();
    } else {
      srcKind = 'unknown';
    }
    const cliente = (data.clientName || '').slice(0, 24);
    console.log(`  ${id.slice(0, 18)}  ${cliente.padEnd(25)}  src=${srcKind.padEnd(16)}  → ${caIso || '(no cambia)'}`);
    if (srcKind === 'Timestamp' || srcKind === 'Date' || srcKind === 'TimestampLike') {
      plan.push({ id, caIso, cliente });
    }
  }
  console.log(`\n[F] A actualizar: ${plan.length}`);

  if (!apply) {
    console.log('[F] DRY-RUN. --apply para persistir.');
    return;
  }

  console.log('\n[F] APPLY...');
  for (const { id, caIso, cliente } of plan) {
    const dayKey = new Date().toISOString().slice(0, 10);
    await db.collection('pedidos').doc(id).update({
      confirmedAt: caIso,
      [`_backfill.F_confirmedAt_iso_${dayKey}`]: {
        reason: 'Timestamp → ISO string (fix Invalid Date en panel)',
        by: 'scripts/audit/F_fix_confirmedAt_iso_2026-10-25.cjs',
        at: new Date().toISOString(),
      },
    });
    console.log(`  ✓ ${id.slice(0, 18)} (${cliente}): confirmedAt=${caIso}`);
  }
  console.log(`\n[F] APPLY OK: ${plan.length} docs.`);
}

main().catch((e) => {
  console.error('[F] ERROR:', e);
  process.exit(1);
});

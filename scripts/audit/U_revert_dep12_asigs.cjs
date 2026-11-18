// U v1564 §107 (2026-11-18) — rollback de emergencia del feature reparto-dep12.
//
// Revierte en lote líneas ASIG con `enTransito=true` (reservan dep 12 por
// E0..E4). Pensado para cuando se apaga el flag `dep12_reparto_enabled` y
// queda data residual en producción.
//
// Decisión por línea:
//   - Si la línea fue creada por reconcile dep12 (tiene `splitFromLineIndex`
//     numérico y `asigFromReparto===true`): se revierte a BO con audit
//     `closedReason='dep12_feature_rollback'`.
//   - Si no (se marcó `enTransito=true` desde otra ruta manual): se limpia
//     el flag `enTransito` + `asigAtTransito` + `enDep11At`, dejando la
//     línea como ASIG normal (ya está en dep 11 o se asignó a mano).
//
// Snapshot §55: `_backfill.U_revert_dep12_asigs_<fecha>_<version>` con los
// valores previos por línea mutada — reversible.
//
// Protección §104: nunca deja una línea `state='ASIG'` con `qtyOpen<=0`.
// Si al revertir pasaría a quedar así, se cancela directamente
// (`state='cancelled'` con `closedReason='dep12_feature_rollback_zombie'`).
//
// Flags:
//   --apply       Ejecuta writes (default dry-run).
//   --limit N     Limita cantidad de pedidos procesados (debug).
//
// Uso:
//   node scripts/audit/U_revert_dep12_asigs.cjs             # dry-run
//   node scripts/audit/U_revert_dep12_asigs.cjs --apply     # persistir
//
// Requiere credenciales via GOOGLE_APPLICATION_CREDENTIALS o ADC
// (~/.config/gcloud/application_default_credentials.json).

const PROJECT = 'app-vendedores-shimano';
const SLUG = 'U_revert_dep12_asigs_2026-11-18_v1564';

function parseLimit() {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  if (!arg) return Infinity;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const LIMIT = parseLimit();

  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log(`U — Revert dep12 ASIGs (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  console.log('================================================================\n');

  // 1. Pedidos abiertos (closedAt==null).
  console.log('[1] Leyendo pedidos abiertos...');
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log(`    pedidos abiertos: ${snap.size}`);

  // 2. Filtrar pedidos con al menos una línea ASIG + enTransito=true + qtyOpen>0.
  const candidates = [];
  for (const d of snap.docs) {
    const data = d.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const idxs = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l.state !== 'ASIG') continue;
      if (l.enTransito !== true) continue;
      const qo = Number(l.qtyOpen);
      if (!Number.isFinite(qo) || qo <= 0) continue;
      idxs.push(i);
    }
    if (idxs.length === 0) continue;
    candidates.push({ id: d.id, orderNumber: data.orderNumber || null, idxs, data });
    if (candidates.length >= LIMIT) break;
  }
  console.log(`[2] Pedidos con líneas ASIG enTransito activas: ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log('[OK] Nada que revertir. No hay líneas ASIG con enTransito=true activas.');
    return;
  }

  // 3. Decidir mutación por línea.
  const nowIso = new Date().toISOString();
  const by = 'scripts/audit/U_revert_dep12_asigs.cjs';
  const planned = [];
  let totalRevertBO = 0;
  let totalLimpiarFlag = 0;
  let totalZombieCancel = 0;

  for (const c of candidates) {
    const lines = c.data.lines.map((l) => (l && typeof l === 'object' ? { ...l } : l));
    const previousByIdx = {};
    for (const i of c.idxs) {
      const orig = lines[i];
      const snapshot = {
        state: orig.state,
        qty: orig.qty,
        qtyOpen: orig.qtyOpen,
        enTransito: orig.enTransito,
        asigAtTransito: orig.asigAtTransito || null,
        enDep11At: orig.enDep11At || null,
        closedReason: orig.closedReason || null,
      };
      previousByIdx[i] = snapshot;

      const fromReparto =
        orig.asigFromReparto === true && Number.isFinite(Number(orig.splitFromLineIndex));

      if (fromReparto) {
        // Revertir a BO. §104: si qtyOpen quedaría <= 0, cancelar directo.
        const newQty = Number(orig.qty) || 0;
        const newQtyOpen = newQty > 0 ? newQty : 0;
        if (newQtyOpen <= 0) {
          lines[i] = Object.assign({}, orig, {
            state: 'cancelled',
            qtyOpen: 0,
            qtyCancelled: (Number(orig.qtyCancelled) || 0) + (Number(orig.qtyOpen) || 0),
            closedReason: 'dep12_feature_rollback_zombie',
            cancelledAt: nowIso,
            cancelledBy: by,
            enTransito: false,
            asigReserva: false,
          });
          totalZombieCancel++;
        } else {
          lines[i] = Object.assign({}, orig, {
            state: 'BO',
            qty: newQty,
            qtyOpen: newQtyOpen,
            closedReason: 'dep12_feature_rollback',
            asigRevertidaAt: nowIso,
            asigRevertidaBy: by,
            asigRevertidaReason: 'dep12_feature_rollback',
            enTransito: false,
          });
          totalRevertBO++;
        }
      } else {
        // Limpiar flag (línea manual que quedó con enTransito).
        lines[i] = Object.assign({}, orig, {
          enTransito: false,
          enTransitoClearedAt: nowIso,
          enTransitoClearedBy: by,
        });
        totalLimpiarFlag++;
      }
    }

    planned.push({ id: c.id, orderNumber: c.orderNumber, lines, previousByIdx });
  }

  // 4. Resumen dry-run.
  console.log('[3] Resumen plan:');
  console.log(`    Pedidos a tocar:      ${planned.length}`);
  console.log(`    Líneas revert → BO:   ${totalRevertBO}`);
  console.log(`    Líneas limpia flag:   ${totalLimpiarFlag}`);
  console.log(`    Zombie → cancelled:   ${totalZombieCancel}\n`);

  console.log('[4] Primeros 10 pedidos:');
  for (const p of planned.slice(0, 10)) {
    console.log(`    ORDEN ${p.orderNumber || '?'} (${p.id.slice(0, 10)})  líneas afectadas: ${Object.keys(p.previousByIdx).length}`);
  }
  if (planned.length > 10) console.log(`    ... (+${planned.length - 10} más)`);

  if (!APPLY) {
    console.log('\n[5] DRY-RUN completo. Autorizar con --apply.');
    return;
  }

  // 5. Aplicar en batches de 100 pedidos.
  console.log(`\n[5] Aplicando ${planned.length} updates con snapshot _backfill...`);
  const BATCH_SIZE = 100;
  let applied = 0;
  for (let i = 0; i < planned.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = planned.slice(i, i + BATCH_SIZE);
    for (const p of chunk) {
      const ref = db.collection('pedidos').doc(p.id);
      const _backfillEntry = {
        slug: SLUG,
        previousByIdx: p.previousByIdx,
        by,
        at: nowIso,
      };
      batch.update(ref, {
        lines: p.lines,
        [`_backfill.${SLUG}`]: _backfillEntry,
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'U_v1564',
        updatedAt: nowIso,
      });
    }
    await batch.commit();
    applied += chunk.length;
    console.log(`    aplicado ${applied}/${planned.length}`);
  }

  console.log(`\n[6] Done. Pedidos mutados: ${applied}.`);
  console.log(`    Rollback por doc: _backfill.${SLUG}.previousByIdx`);

  // 6. Dump audit.
  const fs = require('node:fs');
  const path = require('node:path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `U_revert_dep12_${SLUG}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { nowIso, applied, totalRevertBO, totalLimpiarFlag, totalZombieCancel, planned: planned.map((p) => ({ id: p.id, orderNumber: p.orderNumber, idxs: Object.keys(p.previousByIdx) })) },
      null,
      2
    )
  );
  console.log(`    Audit JSON: docs/auditoria/U_revert_dep12_${SLUG}.json`);
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});

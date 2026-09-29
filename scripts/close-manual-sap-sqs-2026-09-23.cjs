// scripts/close-manual-sap-sqs-2026-09-23.cjs
//
// One-shot: cierra 4 pedidos-app cuyas SQs quedaron con document_status=bost_Close
// en SAP (Close Document manual del vendedor) SIN SO derivada ni Invoice derivada.
// El Planner Kanban los seguía viendo en "Oferta" porque syncSapOrdersToApp solo
// detecta conversión a SO, no cierre manual.
//
// Casos identificados 2026-09-23 (Mariano):
//   - 2000123 FERNANDO NADIR PERALTA         (SQ.DocEntry 50744, closed 2026-09-07)
//   - 2000155 FEDERICO ALBERTO FATECHI       (SQ.DocEntry 51197, closed 2026-09-12)
//   - 2000220 GUSTAVO EMILIO DESIATA         (SQ.DocEntry 51765, closed 2026-09-23)
//   - 2000221 GUSTAVO EMILIO DESIATA         (SQ.DocEntry 51767, closed 2026-09-23)
//
// Acción: para cada pedido, escribe:
//   closedAt:      <ISO now>          → el listener planner filtra `closedAt == null`
//                                       automáticamente saca del Kanban.
//   closedReason:  'sap_manual_close'
//   transferidoSAP.closedManuallyInSap: true
//   transferidoSAP.sapDocumentStatus:   'bost_Close'
//
// Fix estructural (para casos futuros): nueva CF syncSapQuotationClosures que
// enum SQs `document_status=bost_Close AND cancelled=tNO` sin SO/Invoice y aplica
// el mismo marker automáticamente. Pendiente después de este one-shot.
//
// Requiere GOOGLE_APPLICATION_CREDENTIALS o `gcloud auth application-default login`.
//
// Uso:
//   node scripts/close-manual-sap-sqs-2026-09-23.cjs --dry-run   # simula
//   node scripts/close-manual-sap-sqs-2026-09-23.cjs --apply     # aplica

const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

if (!DRY_RUN && !APPLY) {
  console.error('Falta flag: --dry-run o --apply');
  process.exit(2);
}

const PEDIDOS_A_CERRAR = [
  {
    pedidoId: 'h5mqSFvWI2wb7C3cGfZp',
    client: 'FERNANDO NADIR PERALTA',
    sqDocNum: '2000123',
    sqDocEntry: 50744,
  },
  {
    pedidoId: 'EnqzRvuIPT8ldZFpRX1k',
    client: 'FEDERICO ALBERTO FATECHI',
    sqDocNum: '2000155',
    sqDocEntry: 51197,
  },
  {
    pedidoId: 'WRK4lJo9hZEaQW7aIrR7',
    client: 'GUSTAVO EMILIO DESIATA',
    sqDocNum: '2000220',
    sqDocEntry: 51765,
  },
  {
    pedidoId: '7yWsxWtM8uekU66rqTq0',
    client: 'GUSTAVO EMILIO DESIATA',
    sqDocNum: '2000221',
    sqDocEntry: 51767,
  },
];

async function main() {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
  const db = admin.firestore();
  const nowIso = new Date().toISOString();

  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Target: ${PEDIDOS_A_CERRAR.length} pedidos`);
  console.log(`Timestamp: ${nowIso}`);
  console.log('');

  let ok = 0;
  let missing = 0;
  let skipped = 0;
  const errors = [];

  for (const t of PEDIDOS_A_CERRAR) {
    const ref = db.doc(`pedidos/${t.pedidoId}`);
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        console.warn(`  MISS ${t.pedidoId} (${t.sqDocNum} ${t.client}) — doc no existe`);
        missing++;
        continue;
      }
      const data = snap.data() || {};
      if (data.closedAt) {
        console.log(
          `  SKIP ${t.pedidoId} (${t.sqDocNum} ${t.client}) — ya está closedAt=${data.closedAt}`
        );
        skipped++;
        continue;
      }
      const existingTsap = data.transferidoSAP || {};
      // Defensa: solo actuamos si docEntry matchea el esperado (evita sorpresas
      // por si el docId se reasignó a otro pedido).
      const existingDocEntry = Number(existingTsap.docEntry);
      if (existingDocEntry !== t.sqDocEntry) {
        console.warn(
          `  MISMATCH ${t.pedidoId} (${t.sqDocNum} ${t.client}) — Firestore docEntry=${existingDocEntry}, esperado=${t.sqDocEntry}`
        );
        errors.push({ ...t, error: 'docentry_mismatch', existingDocEntry });
        continue;
      }

      const patch = {
        closedAt: nowIso,
        closedReason: 'sap_manual_close',
        closedBy: 'script/close-manual-sap-sqs-2026-09-23',
        transferidoSAP: {
          ...existingTsap,
          closedManuallyInSap: true,
          sapDocumentStatus: 'bost_Close',
          closedManuallyDetectedAt: nowIso,
        },
      };

      if (DRY_RUN) {
        console.log(`  DRY  ${t.pedidoId} (${t.sqDocNum} ${t.client}) — patch listo`);
      } else {
        await ref.update(patch);
        console.log(`  OK   ${t.pedidoId} (${t.sqDocNum} ${t.client}) — updated`);
      }
      ok++;
    } catch (e) {
      console.error(
        `  ERR  ${t.pedidoId} (${t.sqDocNum} ${t.client}) — ${e && e.message ? e.message : e}`
      );
      errors.push({ ...t, error: (e && e.message) || String(e) });
    }
  }

  console.log('');
  console.log('=== RESUMEN ===');
  console.log(`  ok:      ${ok}`);
  console.log(`  missing: ${missing}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  errors:  ${errors.length}`);
  if (errors.length) console.log(JSON.stringify(errors, null, 2));

  if (DRY_RUN) {
    console.log('');
    console.log('DRY-RUN completo. Correr con --apply para aplicar.');
  }
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

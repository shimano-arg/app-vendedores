// AR v1498 §97 (2026-10-27) — audit pares cliente+SKU duplicados en Reparto.
//
// Recorre todos los ingresos_reparto status in [pending, in_progress] y
// cuenta cuántos pares (ingresoId, cardCode/clientName) aparecen 2+ veces
// en clientesBO. Esos son los que generan filas duplicadas pre-v1498.
//
// Read-only. Output: tabla ASCII + JSON audit.

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const { groupKeyForClienteBO, consolidateClientesBO } = await import(
    '../../src/pure/reparto-consolidate.js'
  );

  console.log('================================================================');
  console.log('AR — Audit pares cliente+SKU duplicados en ingresos_reparto');
  console.log('================================================================\n');

  const snap = await db
    .collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();
  console.log('ingresos_reparto status pending/in_progress:', snap.size);

  /** @type {Array<any>} */
  const dupes = [];
  let totalEntries = 0;
  let totalDupedEntries = 0;

  snap.forEach((d) => {
    const data = d.data();
    const sku = String(data.sku || '').toUpperCase().trim();
    const clientes = Array.isArray(data.clientesBO) ? data.clientesBO : [];
    if (clientes.length === 0) return;
    totalEntries += clientes.length;

    // Agrupar por clave canónica.
    const groups = new Map();
    for (const c of clientes) {
      const key = groupKeyForClienteBO(c);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    // Buscar grupos con 2+ entries.
    for (const [key, members] of groups) {
      if (members.length >= 2) {
        const totalQty = members.reduce((s, m) => s + (Number(m.qtyBackorder) || 0), 0);
        dupes.push({
          ingresoId: d.id,
          sku,
          groupKey: key,
          clientName: members[0].clientName || '(sin nombre)',
          cardCode: members[0].clientCardCode || members[0].cardCode || '',
          entries: members.length,
          totalQty,
          pedidoIds: members.map((m) => m.pedidoId),
        });
        totalDupedEntries += members.length;
      }
    }
  });

  console.log('\nResultado:');
  console.log('  Total entries en clientesBO:', totalEntries);
  console.log('  Pares cliente+SKU duplicados:', dupes.length);
  console.log('  Entries involucrados en duplicados:', totalDupedEntries);
  console.log('  Reducción post-consolidación: ' + (totalDupedEntries - dupes.length) + ' filas');

  dupes.sort((a, b) => b.entries - a.entries || b.totalQty - a.totalQty);

  console.log('\nTop 20 duplicados por entries desc:');
  console.log('  Ingreso ID            | SKU             | Cliente                        | CardCode       | Entries | Total qty');
  console.log('  ---------------------- | --------------- | ------------------------------ | -------------- | ------- | ---------');
  for (const d of dupes.slice(0, 20)) {
    const line = [
      d.ingresoId.padEnd(22),
      String(d.sku).padEnd(15),
      String(d.clientName).slice(0, 30).padEnd(30),
      String(d.cardCode).padEnd(14),
      String(d.entries).padStart(7),
      String(d.totalQty).padStart(9),
    ].join(' | ');
    console.log('  ' + line);
  }

  // Dump JSON completo.
  const fs = require('node:fs');
  const path = require('node:path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'AR_reparto_duplicados.json');
  fs.writeFileSync(
    outFile,
    JSON.stringify({
      totalIngresos: snap.size,
      totalEntries,
      duplicatedPairs: dupes.length,
      dupedEntries: totalDupedEntries,
      reductionRows: totalDupedEntries - dupes.length,
      dupes,
    }, null, 2)
  );
  console.log('\nDump completo: docs/auditoria/AR_reparto_duplicados.json');

  console.log('\n================================================================');
  console.log('Interpretación:');
  console.log(`  Pre-v1498: Reparto muestra ${totalDupedEntries} filas donde debería mostrar ${dupes.length}.`);
  console.log(`  Post-v1498: cada par duplicado colapsa a 1 fila con suma de qty.`);
  console.log('  No requiere corrección de datos en origen (los pedidos son legítimamente');
  console.log('  distintos post-§56 — cada orden tiene UN SKU 1 vez; el bug era de VISTA).');
  console.log('================================================================');
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});

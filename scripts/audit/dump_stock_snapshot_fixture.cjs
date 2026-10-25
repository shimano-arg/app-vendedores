#!/usr/bin/env node
// @ts-check
/**
 * 2026-10-25 (v1449) — Dump de app_config/stock_snapshot de prod como test
 * fixture. Mariano pidió "fixture del snapshot real copiado de prod" para
 * blindar la paridad client ↔ CF contra regresión futura del shape JSON
 * string (incidente 23/10 17:52).
 *
 * Uso:
 *   node scripts/audit/dump_stock_snapshot_fixture.cjs
 *   → escribe tests/fixtures/stock_snapshot_prod.json (overwrite)
 *
 * Credenciales: GOOGLE_APPLICATION_CREDENTIALS o `gcloud auth
 * application-default login` activo apuntando a app-vendedores-shimano.
 *
 * El fixture incluye SOLO los campos relevantes al parse (warehouseBreakdown,
 * quantities, updatedAt, source). No persiste PII — stock por SKU es dato
 * operativo público para el equipo de ventas.
 */

const fs = require('node:fs');
const path = require('node:path');
const admin = require('../../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

async function main() {
  console.log('[fixture] Leyendo app_config/stock_snapshot de prod...');
  const snap = await db.collection('app_config').doc('stock_snapshot').get();
  if (!snap.exists) {
    console.error('[fixture] ERROR: app_config/stock_snapshot NO existe en prod');
    process.exit(1);
  }
  const data = snap.data() || {};

  // Shape que CF/cliente leen (ver commit-pedido-core.js:getStockConfig + index.html:31987).
  const fixture = {
    _dumpedAt: new Date().toISOString(),
    _project: 'app-vendedores-shimano',
    _source: 'app_config/stock_snapshot',
    _comentario:
      'Shape REAL que escribe el workflow Python sync-sap-catalog-stock. ' +
      'warehouseBreakdown + quantities son JSON strings (patrón v368/v377). ' +
      'Si el CF lee con typeof===object sin parse → fisicoDep11=0 → TODO BO.',
    data: {
      updatedAt_ms: data.updatedAt && typeof data.updatedAt.toMillis === 'function'
        ? data.updatedAt.toMillis()
        : null,
      updatedAt_iso: data.updatedAt && typeof data.updatedAt.toDate === 'function'
        ? data.updatedAt.toDate().toISOString()
        : null,
      source: data.source || null,
      _warehouseBreakdown_type: typeof data.warehouseBreakdown,
      _warehouseBreakdown_length:
        typeof data.warehouseBreakdown === 'string' ? data.warehouseBreakdown.length : null,
      warehouseBreakdown: data.warehouseBreakdown || null,
      _quantities_type: typeof data.quantities,
      _quantities_length:
        typeof data.quantities === 'string' ? data.quantities.length : null,
      quantities: data.quantities || null,
    },
  };

  const outPath = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'stock_snapshot_prod.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2), 'utf8');
  console.log(`[fixture] Escrito: ${outPath}`);
  console.log(`[fixture] warehouseBreakdown type=${fixture.data._warehouseBreakdown_type}, len=${fixture.data._warehouseBreakdown_length}`);
  console.log(`[fixture] quantities type=${fixture.data._quantities_type}, len=${fixture.data._quantities_length}`);
}

main().catch((e) => {
  console.error('[fixture] ERROR:', e);
  process.exit(1);
});

#!/usr/bin/env node
// @ts-check
/**
 * 2026-10-26 — Imprime conteos de operations_log por type live SL durante
 * las últimas N horas (default 1h). Útil para verificar impacto del flag
 * app_config/live_sl.enabled=true en la primera hora/día post-prendido.
 *
 * Uso:
 *   node scripts/audit/live_sl_counts.cjs           # última 1h
 *   node scripts/audit/live_sl_counts.cjs --hours=6
 *   node scripts/audit/live_sl_counts.cjs --hours=24 --by-user
 *
 * Requiere: GOOGLE_APPLICATION_CREDENTIALS activo o `gcloud auth
 * application-default login` para app-vendedores-shimano.
 */

const admin = require('../../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) admin.initializeApp({ projectId: 'app-vendedores-shimano' });
const db = admin.firestore();

const args = process.argv.slice(2);
const hoursArg = args.find((a) => a.startsWith('--hours='));
const HOURS = hoursArg ? Number(hoursArg.split('=')[1]) : 1;
const BY_USER = args.includes('--by-user');

const TYPES = ['stock_live_fetched', 'stock_live_partial', 'stock_live_fallback'];

async function main() {
  const sinceMs = Date.now() - HOURS * 60 * 60 * 1000;
  const sinceDate = new Date(sinceMs);
  const sinceIso = sinceDate.toISOString();

  console.log(`\n[live_sl_counts] Ventana: últimas ${HOURS}h (desde ${sinceIso})\n`);

  const totals = {};
  const byUser = {};
  for (const t of TYPES) {
    totals[t] = 0;
    byUser[t] = {};
  }

  for (const type of TYPES) {
    // Query por tipo + filter por timestamp (si existe).
    const snap = await db
      .collection('operations_log')
      .where('type', '==', type)
      .get();
    for (const d of snap.docs) {
      const data = d.data() || {};
      const ts = data.timestamp && typeof data.timestamp.toMillis === 'function'
        ? data.timestamp.toMillis()
        : (data.timestamp && typeof data.timestamp === 'string'
            ? new Date(data.timestamp).getTime()
            : null);
      if (ts === null || ts < sinceMs) continue;
      totals[type] += 1;
      if (BY_USER) {
        const u = data.userEmail || data.userId || '(sin user)';
        byUser[type][u] = (byUser[type][u] || 0) + 1;
      }
    }
  }

  // Tabla principal.
  console.log('type                      | count');
  console.log('--------------------------|------');
  for (const t of TYPES) {
    console.log(`${t.padEnd(26)}| ${String(totals[t]).padStart(5)}`);
  }
  const grand = totals.stock_live_fetched + totals.stock_live_partial + totals.stock_live_fallback;
  console.log('--------------------------|------');
  console.log(`${'TOTAL'.padEnd(26)}| ${String(grand).padStart(5)}`);

  // Ratios.
  if (grand > 0) {
    console.log(`\nRatios:`);
    console.log(`  fetched OK:  ${((totals.stock_live_fetched / grand) * 100).toFixed(1)}%`);
    console.log(`  partial:     ${((totals.stock_live_partial / grand) * 100).toFixed(1)}%`);
    console.log(`  fallback:    ${((totals.stock_live_fallback / grand) * 100).toFixed(1)}%`);
  }

  if (BY_USER) {
    console.log('\n--- Por user (top-10 por tipo) ---');
    for (const t of TYPES) {
      console.log(`\n[${t}]`);
      const entries = Object.entries(byUser[t])
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 10);
      for (const [u, c] of entries) {
        console.log(`  ${String(c).padStart(5)}  ${u}`);
      }
    }
  }

  console.log('');
}

main().catch((e) => { console.error('[error]', e); process.exit(1); });

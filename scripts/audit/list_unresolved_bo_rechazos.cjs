// Lista rechazos UNRESOLVED_BO_ENTRY_ROWS en operations_log desde una fecha.
// Uso: node scripts/audit/list_unresolved_bo_rechazos.cjs [--since=ISO]
const admin = require('../../functions/node_modules/firebase-admin');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'app-vendedores-shimano' });
const db = admin.firestore();

const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const SINCE = sinceArg ? sinceArg.split('=')[1] : '2026-10-25T00:00:00Z';
const sinceMs = new Date(SINCE).getTime();

(async () => {
  console.log(`\n[audit] UNRESOLVED_BO_ENTRY_ROWS desde ${SINCE}\n`);
  const snap = await db.collection('operations_log')
    .where('type', '==', 'commit_pedido_rejected')
    .where('errorCode', '==', 'UNRESOLVED_BO_ENTRY_ROWS')
    .get();
  const rows = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const ts = data.timestamp && typeof data.timestamp.toMillis === 'function'
      ? data.timestamp.toMillis()
      : (typeof data.timestamp === 'string' ? new Date(data.timestamp).getTime() : null);
    if (ts === null || ts < sinceMs) return;
    rows.push({
      ts: new Date(ts).toISOString(),
      user: data.userEmail || data.userId || '(sin user)',
      cardCode: data.cardCode || '(sin cardCode)',
      skus: (data.skus || []).join(','),
      unresolvedCount: data.unresolvedCount || 0,
    });
  });
  rows.sort((a, b) => a.ts.localeCompare(b.ts));
  if (rows.length === 0) {
    console.log('(no hay rechazos UNRESOLVED_BO_ENTRY_ROWS en la ventana)');
    return;
  }
  console.log(`Total rechazos: ${rows.length}\n`);
  console.log('timestamp'.padEnd(26) + ' | ' + 'user'.padEnd(30) + ' | ' + 'cardCode'.padEnd(16) + ' | skus');
  console.log('-'.repeat(100));
  for (const r of rows) {
    console.log(
      r.ts.padEnd(26) + ' | ' +
      String(r.user).padEnd(30).slice(0, 30) + ' | ' +
      String(r.cardCode).padEnd(16).slice(0, 16) + ' | ' +
      r.skus
    );
  }
  // Agregados por user.
  const byUser = {};
  for (const r of rows) {
    byUser[r.user] = (byUser[r.user] || 0) + 1;
  }
  console.log('\n--- Por user ---');
  for (const [u, c] of Object.entries(byUser).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}  ${u}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

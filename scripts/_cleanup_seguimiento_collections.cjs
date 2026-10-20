/**
 * _cleanup_seguimiento_collections.cjs — 2026-10-20 (v1283).
 *
 * Backfill one-off que:
 *   1. Dumpea seguimiento_notes y seguimiento_status a
 *      ./backups/seguimiento_backup_YYYY-MM-DD.json (safety).
 *   2. Las borra en batches de 400 ops.
 *
 * Uso:
 *   node scripts/_cleanup_seguimiento_collections.cjs           # dry-run
 *   node scripts/_cleanup_seguimiento_collections.cjs --commit  # aplica
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const admin = require('../functions/node_modules/firebase-admin');

const COMMIT = process.argv.includes('--commit');
const SA_KEY = path.join(
  os.homedir(),
  'Downloads',
  'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
);
const COLLECTIONS = ['seguimiento_notes', 'seguimiento_status'];
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  console.log('===== v1283 CLEANUP: seguimiento_notes + seguimiento_status =====');
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  const date = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const backup = {};
  let totalDocs = 0;

  for (const colName of COLLECTIONS) {
    const snap = await db.collection(colName).get();
    console.log(`${colName}: ${snap.size} docs`);
    const docs = [];
    snap.forEach((doc) => docs.push({ id: doc.id, data: doc.data() }));
    backup[colName] = docs;
    totalDocs += docs.length;
  }

  const backupFile = path.join(BACKUP_DIR, `seguimiento_backup_${date}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`✓ Backup escrito: ${backupFile} (${totalDocs} docs totales)\n`);

  if (!COMMIT) {
    console.log('🟢 Dry-run. Para aplicar: node scripts/_cleanup_seguimiento_collections.cjs --commit');
    process.exit(0);
  }

  console.log('🔴 Borrando docs...');
  const BATCH_SIZE = 400;
  for (const colName of COLLECTIONS) {
    const docs = backup[colName];
    let batch = db.batch();
    let count = 0;
    let deleted = 0;
    for (const { id } of docs) {
      batch.delete(db.collection(colName).doc(id));
      count++;
      if (count >= BATCH_SIZE) {
        await batch.commit();
        deleted += count;
        console.log(`  ✓ ${colName}: ${deleted}/${docs.length} borrados`);
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
      deleted += count;
    }
    console.log(`  ✓ ${colName}: ${deleted}/${docs.length} borrados`);
  }

  console.log(`\n✅ Cleanup OK. Backup en ${backupFile} si querés restaurar.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});

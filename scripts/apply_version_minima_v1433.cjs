// E10 Fase 1 §stock-servidor-atomico — crear doc app_config/version_minima
// con minVersion='v1433'. Autorizado por Mariano 2026-10-23 post-sesión 2.

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');
const MIN_VERSION = 'v1433';

async function main() {
  const admin = require('../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('E10 Fase 1 — Crear app_config/version_minima @ ' + nowIso);
  console.log('  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  console.log('================================================================');

  // Chequear si ya existe.
  const ref = db.collection('app_config').doc('version_minima');
  const snap = await ref.get();
  if (snap.exists) {
    const existing = snap.data() || {};
    console.log('Doc ya existe:', JSON.stringify(existing, null, 2));
    if (existing.minVersion === MIN_VERSION) {
      console.log('✓ minVersion ya es ' + MIN_VERSION + ' — nada que hacer.');
      return;
    }
    console.log('⚠ minVersion actual: ' + existing.minVersion + ' → se va a actualizar a ' + MIN_VERSION);
  } else {
    console.log('Doc NO existe. Se creará con minVersion=' + MIN_VERSION + '.');
  }

  const payload = {
    minVersion: MIN_VERSION,
    blockedAt: nowIso,
    blockedReason: 'commitPedidoCF obligatorio post stock-servidor-atomico sesión 2',
    message: 'Hay una versión nueva, la app se va a recargar',
    updatedBy: 'E10_create_version_minima_cjs',
    updatedAt: nowIso,
  };

  console.log('\nPayload a persistir:');
  console.log(JSON.stringify(payload, null, 2));

  if (APPLY) {
    await ref.set(payload, { merge: true });
    console.log('\n✓ APPLIED. app_config/version_minima = ' + MIN_VERSION);
  } else {
    console.log('\nDRY-RUN. Correr con --apply para persistir.');
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});

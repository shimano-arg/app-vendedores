/**
 * create-pruebas-gerente-user.cjs (v1514, 2026-10-28)
 *
 * Crea el usuario `pruebas.gerente@shimano.com.ar` con rol=gerente, pensado
 * como account de pruebas para los Playwright E2E del flow Import Reparto
 * Pablo (v1514 §T4). NO reemplaza a admin ni gerente real; es para automatizar.
 *
 * Operaciones (idempotentes — correr N veces produce estado final igual):
 *   1. Crea / actualiza user en Firebase Auth con email + password + displayName.
 *   2. Crea / actualiza doc en `roles/{uid}` con `role=gerente + email + displayName`.
 *   3. Agrega `pruebas.gerente@shimano.com.ar` a `allowed_emails` si falta.
 *
 * NO EJECUTAR AUTOMATICAMENTE — este script requiere service account del
 * admin SDK. Mariano lo corre manualmente:
 *
 *   cd app-vendedores
 *   node scripts/create-pruebas-gerente-user.cjs --dry      # muestra plan
 *   node scripts/create-pruebas-gerente-user.cjs            # ejecuta
 *
 * La password está hardcoded ('Shimano2025') para que los specs Playwright la
 * usen; Mariano puede resetearla via Firebase Console si quiere cambiarla.
 *
 * Rollback: borrar el user via Firebase Console (Auth tab) + el doc
 * roles/{uid}; el allowed_emails entry queda (benigno).
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(
  os.homedir(),
  'Downloads',
  'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
);
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();
const auth = admin.auth();

const DRY = process.argv.includes('--dry');

const USER = {
  email: 'pruebas.gerente@shimano.com.ar',
  password: 'Shimano2025',
  displayName: 'Pruebas Gerente E2E',
  role: 'gerente',
};

async function main() {
  console.log(`===== CREATE pruebas.gerente@shimano.com.ar ${DRY ? '(DRY RUN)' : ''} =====\n`);

  // ---- 1. Crear/actualizar user en Firebase Auth ----
  console.log(`[1/3] Firebase Auth: upsert ${USER.email} ...`);
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(USER.email);
    console.log(`  ya existe con uid=${userRecord.uid}; actualizando password + displayName`);
    if (!DRY) {
      await auth.updateUser(userRecord.uid, {
        password: USER.password,
        displayName: USER.displayName,
        emailVerified: true,
      });
    }
  } catch (e) {
    if (e.code !== 'auth/user-not-found') {
      console.error('  ERROR consultando Auth:', e.message || e);
      process.exit(1);
    }
    console.log('  no existe; creando...');
    if (!DRY) {
      userRecord = await auth.createUser({
        email: USER.email,
        password: USER.password,
        displayName: USER.displayName,
        emailVerified: true,
      });
      console.log(`  OK: uid=${userRecord.uid}`);
    } else {
      userRecord = { uid: '<nuevo_uid_dry_run>' };
    }
  }
  const uid = userRecord.uid;

  // ---- 2. Doc roles/{uid} ----
  console.log(`\n[2/3] Firestore: upsert roles/${uid} ...`);
  const roleData = {
    email: USER.email,
    displayName: USER.displayName,
    role: USER.role,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'scripts/create-pruebas-gerente-user.cjs',
  };
  if (DRY) {
    console.log('  (dry) set:', { uid, ...roleData, createdAt: '<serverTimestamp>' });
  } else {
    await db.collection('roles').doc(uid).set(roleData, { merge: true });
    console.log('  OK');
  }

  // ---- 3. allowed_emails ----
  console.log(`\n[3/3] Firestore: allowed_emails ...`);
  const alloweds = await db.collection('allowed_emails').where('email', '==', USER.email).get();
  if (!alloweds.empty) {
    console.log('  ya está en allowed_emails; skip');
  } else if (DRY) {
    console.log('  (dry) add:', { email: USER.email });
  } else {
    await db.collection('allowed_emails').add({
      email: USER.email,
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      addedBy: 'scripts/create-pruebas-gerente-user.cjs',
    });
    console.log('  OK');
  }

  console.log('\n===== DONE =====');
  console.log('  Email:    ', USER.email);
  console.log('  Password: ', USER.password);
  console.log('  Role:     ', USER.role);
  console.log('  Uid:      ', uid);
  if (DRY) console.log('\n(DRY RUN — nada se escribió)');
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR fatal:', e);
  process.exit(1);
});

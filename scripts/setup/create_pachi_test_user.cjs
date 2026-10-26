// Crear user de prueba pruebas.pachi@shimano.com.ar (rol vendedor + cliente E2E)
// y guardar creds en test-pachi-email + test-pachi-password.
// Mariano P3 (2026-10-26): NO tocar la cuenta real de PACHI.
const admin = require('../../functions/node_modules/firebase-admin');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PROJECT = 'app-vendedores-shimano';
const EMAIL = 'pruebas.pachi@shimano.com.ar';
const VENDOR_KEY = 'PACHI';
const CLIENT_ID = 'e2e-test-client';

if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT });

function genPw() {
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}

function addSecretVersion(name, value) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('invalid secret name');
  // Crear si no existe.
  const check = spawnSync(
    'gcloud', ['secrets', 'describe', name, `--project=${PROJECT}`],
    { encoding: 'utf8', shell: true }
  );
  if (check.status !== 0) {
    console.log(`[secret] creating ${name}...`);
    const c = spawnSync(
      'gcloud', ['secrets', 'create', name, '--replication-policy=automatic', `--project=${PROJECT}`],
      { encoding: 'utf8', shell: true }
    );
    if (c.status !== 0) throw new Error(`create ${name} failed: ${c.stderr}`);
  }
  const r = spawnSync(
    'gcloud', ['secrets', 'versions', 'add', name, '--data-file=-', `--project=${PROJECT}`],
    { input: value, encoding: 'utf8', shell: true }
  );
  if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr}`);
  console.log(`[secret] ${name} new version created`);
}

(async () => {
  const auth = admin.auth();
  const db = admin.firestore();
  const newPw = genPw();
  let uid;
  try {
    const existing = await auth.getUserByEmail(EMAIL);
    uid = existing.uid;
    await auth.updateUser(uid, { password: newPw, displayName: 'Pruebas PACHI (E2E)', emailVerified: true });
    console.log(`[auth] user existe uid=${uid}, pw rotada`);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      const u = await auth.createUser({
        email: EMAIL, password: newPw, displayName: 'Pruebas PACHI (E2E)', emailVerified: true,
      });
      uid = u.uid;
      console.log(`[auth] user creado uid=${uid}`);
    } else { throw e; }
  }

  // Rol vendedor con vendor=PACHI (mismo que el PACHI real para herencia de perms base).
  await db.collection('roles').doc(uid).set({
    role: 'vendedor',
    email: EMAIL,
    vendor: VENDOR_KEY,
    vendorKey: VENDOR_KEY,
    displayName: 'Pruebas PACHI (E2E)',
    createdBy: 'scripts/setup/create_pachi_test_user.cjs',
    createdAt: new Date().toISOString(),
    note: 'User E2E para testing restricciones PACHI. UID agregado a PACHI_UIDS en src/pure/pachi-restrictions.js.',
  }, { merge: true });
  console.log(`[firestore] roles/${uid} rol=vendedor vendor=${VENDOR_KEY}`);

  // Asegurar que el cliente CLIENTE PRUEBAS E2E esté asignado a vendor=PACHI
  // (el que ya existía estaba con PRUEBAS E2E). Lo actualizamos TEMPORAL para
  // que este user lo vea. Si Mariano quiere separar, hacemos un cliente aparte.
  // Mejor: dejar el cliente PRUEBAS E2E con PRUEBAS E2E (otro user lo usa) y crear uno dedicado.
  const PACHI_CLIENT_ID = 'e2e-test-client-pachi';
  await db.collection('client_applications').doc(PACHI_CLIENT_ID).set({
    comercio: 'CLIENTE PRUEBAS E2E PACHI',
    fantasia: 'CLIENTE PRUEBAS E2E PACHI',
    cardCodeSap: 'CE2EPACHI01',
    assignedVendor: VENDOR_KEY,
    assignedVendorUid: uid,
    assignedVendorEmail: EMAIL,
    status: 'approved',
    provincia: 'CORDOBA',
    localidad: 'CORDOBA CAPITAL',
    direccion: 'Prueba PACHI E2E 123',
    telefono: '+54 351 000-0000',
    _e2e: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  // Mirror en sap_clients.
  await db.collection('sap_clients').doc('CE2EPACHI01').set({
    clientName: 'CLIENTE PRUEBAS E2E PACHI',
    sapCode: 'CE2EPACHI01',
    _e2e: true,
    _syncedAt: new Date().toISOString(),
  }, { merge: true });
  console.log(`[firestore] client_applications/${PACHI_CLIENT_ID} + sap_clients/CE2EPACHI01 OK`);

  addSecretVersion('test-pachi-email', EMAIL);
  addSecretVersion('test-pachi-password', newPw);

  await db.collection('app_config').doc('e2e_test_users').set({
    pachi: {
      email: EMAIL, uid, vendor: VENDOR_KEY, clientId: PACHI_CLIENT_ID,
      rotatedAt: new Date().toISOString(),
    },
  }, { merge: true });

  console.log('\n[done] user de prueba PACHI listo:');
  console.log(`  email: ${EMAIL}`);
  console.log(`  uid:   ${uid}`);
  console.log(`  vendor: ${VENDOR_KEY}`);
  console.log(`  cliente: ${PACHI_CLIENT_ID} (CE2EPACHI01)`);
  console.log(`\n[next] Agregá "${uid}" a PACHI_UIDS en src/pure/pachi-restrictions.js`);
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// @ts-check
/**
 * Script Paso 0 (2026-10-25): crea usuario Firebase Authentication de prueba
 * E2E, le asigna rol vendedor, crea cliente ficticio en master
 * (client_applications), y guarda email + password generado en gcloud
 * Secret Manager (test-user-email, test-user-password).
 *
 * Idempotente. Uso: node scripts/setup/create_e2e_test_user.cjs
 */

const admin = require('../../functions/node_modules/firebase-admin');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PROJECT = 'app-vendedores-shimano';
const EMAIL = 'pruebas.e2e@shimano.com.ar';
const VENDOR_KEY = 'PRUEBAS E2E';
const CLIENT_NAME = 'CLIENTE PRUEBAS E2E';
const CARD_CODE = 'CE2E000001';

function genPassword() {
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}

function addSecretVersion(name, value) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid secret name: ${name}`);
  console.log(`[secret] actualizando ${name}...`);
  const r = spawnSync(
    'gcloud',
    ['secrets', 'versions', 'add', name, '--data-file=-', `--project=${PROJECT}`],
    { input: value, encoding: 'utf8', shell: true }
  );
  if (r.status !== 0) {
    throw new Error(`gcloud secrets versions add ${name} failed: status=${r.status} stderr=${r.stderr} stdout=${r.stdout}`);
  }
  console.log(`[secret] ${name} v nueva creada`);
}

async function main() {
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT });
  const auth = admin.auth();
  const db = admin.firestore();

  const password = genPassword();
  let uid;

  try {
    const existing = await auth.getUserByEmail(EMAIL);
    uid = existing.uid;
    await auth.updateUser(uid, {
      password,
      displayName: 'Pruebas E2E',
      emailVerified: true,
    });
    console.log(`[auth] user existe uid=${uid}, password rotado`);
  } catch (e) {
    if (/** @type {any} */ (e).code === 'auth/user-not-found') {
      const u = await auth.createUser({
        email: EMAIL,
        password,
        displayName: 'Pruebas E2E',
        emailVerified: true,
      });
      uid = u.uid;
      console.log(`[auth] user creado uid=${uid}`);
    } else {
      throw e;
    }
  }

  await db.collection('roles').doc(uid).set({
    role: 'vendedor',
    email: EMAIL,
    vendor: VENDOR_KEY,          // frontend lee data.vendor → assignedVendor
    vendorKey: VENDOR_KEY,       // compat con otros consumidores
    displayName: 'Pruebas E2E',
    createdBy: 'scripts/setup/create_e2e_test_user.cjs',
    createdAt: new Date().toISOString(),
    note: 'Usuario Playwright E2E. NO tocar pedidos/stock reales.',
  }, { merge: true });

  const CLIENT_ID = 'e2e-test-client';
  await db.collection('client_applications').doc(CLIENT_ID).set({
    comercio: CLIENT_NAME,
    fantasia: CLIENT_NAME,
    cardCodeSap: CARD_CODE,
    assignedVendor: VENDOR_KEY,
    assignedVendorUid: uid,
    assignedVendorEmail: EMAIL,
    status: 'approved',
    provincia: 'BUENOS AIRES',
    localidad: 'CABA',
    direccion: 'Prueba E2E 123',
    telefono: '+54 11 0000-0000',
    _e2e: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  // También crear en sap_clients para que sapGetClienteCode() resuelva.
  // Shape que usa el listener (src/domains/sap-admin-panel.js:52-59):
  // { clientName, sapCode } indexado por sapNorm(clientName).
  await db.collection('sap_clients').doc(CARD_CODE).set({
    clientName: CLIENT_NAME,
    sapCode: CARD_CODE,
    _e2e: true,
    _syncedAt: new Date().toISOString(),
  }, { merge: true });

  addSecretVersion('test-user-email', EMAIL);
  addSecretVersion('test-user-password', password);

  await db.collection('app_config').doc('e2e_test_user').set({
    email: EMAIL,
    uid,
    vendorKey: VENDOR_KEY,
    clientId: CLIENT_ID,
    clientName: CLIENT_NAME,
    rotatedAt: new Date().toISOString(),
  }, { merge: true });

  console.log('\n[done] user e2e listo:');
  console.log(`  email: ${EMAIL}`);
  console.log(`  uid: ${uid}`);
  console.log(`  vendorKey: ${VENDOR_KEY}`);
  console.log(`  clientId: ${CLIENT_ID}`);
}

main().catch((e) => { console.error('[error]', e); process.exit(1); });

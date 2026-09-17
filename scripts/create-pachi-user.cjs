/**
 * create-pachi-user.cjs (2026-09-17)
 *
 * Crea el usuario "Pachi Naba" (VDE apoyo de Santiago Esteban) con permisos
 * para cargar visitas/pedidos y consultar stock. Los pedidos que carga pachi
 * viajan a SAP a nombre de Santiago (via mapping sap_vendors/PACHI_NABA que
 * apunta al slpCode de Santiago).
 *
 * Operaciones (idempotentes — si ya existe, no rompe):
 *   1. Resuelve uid de Santiago via admin.auth().getUserByEmail
 *   2. Resuelve slpCode de Santiago via sap_vendors (query vendorKey==)
 *   3. Crea/actualiza pachi en Firebase Auth (email + password + displayName)
 *   4. Crea/actualiza doc en sap_vendors/PACHI_NABA con el slpCode de Santiago
 *   5. Crea/actualiza doc en roles/{pachi_uid} con role=vendedor + vendor=PACHI NABA
 *   6. Agrega pachinaba@gmail.com a allowed_emails
 *
 * Uso:
 *   PACHI_PASSWORD='xxx' node scripts/create-pachi-user.cjs --dry   # muestra plan sin escribir
 *   PACHI_PASSWORD='xxx' node scripts/create-pachi-user.cjs         # ejecuta
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

const PACHI = {
  email: 'pachinaba@gmail.com',
  password: process.env.PACHI_PASSWORD || '',
  displayName: 'Pachi Naba',
  vendorKey: 'PACHI NABA',
};

const SANTIAGO_EMAIL = 'santiago.esteban@shimano.com.ar';
const SANTIAGO_VENDOR_KEY = 'SANTIAGO ESTEBAN';

function emailToDocId(email) {
  return (email || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_')
    .slice(0, 1400);
}

async function main() {
  console.log(`===== CREATE PACHI USER ${DRY ? '(DRY RUN)' : ''} =====\n`);

  if (!PACHI.password) {
    console.error('ERROR: env var PACHI_PASSWORD requerida.');
    process.exit(1);
  }

  // ---- 1. Resolver uid de Santiago ----
  console.log('[1/6] Buscando uid de Santiago via Firebase Auth...');
  let santiagoUid;
  try {
    const santiago = await auth.getUserByEmail(SANTIAGO_EMAIL);
    santiagoUid = santiago.uid;
    console.log('  OK: uid=' + santiagoUid);
  } catch (e) {
    console.error('  ERROR: no encontre user con email ' + SANTIAGO_EMAIL);
    console.error('  ' + (e.message || e));
    process.exit(1);
  }

  // ---- 2. Resolver slpCode de Santiago via sap_vendors ----
  console.log(`\n[2/6] Buscando slpCode de "${SANTIAGO_VENDOR_KEY}" en sap_vendors...`);
  const santiagoVendorSnap = await db
    .collection('sap_vendors')
    .where('vendorKey', '==', SANTIAGO_VENDOR_KEY)
    .get();
  if (santiagoVendorSnap.empty) {
    console.error(`  ERROR: no encontre doc en sap_vendors con vendorKey="${SANTIAGO_VENDOR_KEY}"`);
    process.exit(1);
  }
  const santiagoVendor = santiagoVendorSnap.docs[0].data();
  const santiagoSlp = Number(santiagoVendor.slpCode);
  if (!Number.isFinite(santiagoSlp)) {
    console.error(`  ERROR: slpCode invalido para Santiago (${santiagoVendor.slpCode})`);
    process.exit(1);
  }
  console.log(`  OK: slpCode=${santiagoSlp}`);

  // ---- 3. Crear/actualizar pachi en Firebase Auth ----
  console.log('\n[3/6] Creando/actualizando pachi en Firebase Auth...');
  let pachiUid;
  try {
    const existing = await auth.getUserByEmail(PACHI.email);
    pachiUid = existing.uid;
    console.log(`  Usuario ya existe (uid=${pachiUid}). Actualizando displayName + password.`);
    if (!DRY) {
      await auth.updateUser(pachiUid, {
        password: PACHI.password,
        displayName: PACHI.displayName,
      });
      console.log('  OK: actualizado.');
    }
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      console.log('  No existe, creando...');
      if (!DRY) {
        const created = await auth.createUser({
          email: PACHI.email,
          emailVerified: false,
          password: PACHI.password,
          displayName: PACHI.displayName,
        });
        pachiUid = created.uid;
        console.log(`  OK: creado (uid=${pachiUid}).`);
      } else {
        pachiUid = '<uid-nuevo>';
      }
    } else {
      console.error('  ERROR: ' + (e.message || e));
      process.exit(1);
    }
  }

  // ---- 4. sap_vendors/PACHI_NABA ----
  console.log(`\n[4/6] Creando mapping sap_vendors/PACHI_NABA -> slpCode ${santiagoSlp}...`);
  const sapVendorRef = db.collection('sap_vendors').doc('PACHI_NABA');
  const sapVendorExisting = await sapVendorRef.get();
  if (sapVendorExisting.exists) {
    console.log('  Ya existe. Data actual:', sapVendorExisting.data());
    if (!DRY) {
      await sapVendorRef.set(
        {
          vendorKey: PACHI.vendorKey,
          slpCode: santiagoSlp,
          proxyOf: SANTIAGO_VENDOR_KEY,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log('  OK: mergeado.');
    }
  } else {
    console.log('  No existe, creando...');
    if (!DRY) {
      await sapVendorRef.set({
        vendorKey: PACHI.vendorKey,
        slpCode: santiagoSlp,
        proxyOf: SANTIAGO_VENDOR_KEY,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('  OK: creado.');
    }
  }

  // ---- 5. roles/{pachi_uid} ----
  console.log(`\n[5/6] Creando/actualizando roles/${pachiUid}...`);
  if (!DRY && pachiUid !== '<uid-nuevo>') {
    const roleRef = db.collection('roles').doc(pachiUid);
    await roleRef.set(
      {
        role: 'vendedor',
        vendor: PACHI.vendorKey,
        email: PACHI.email,
        displayName: PACHI.displayName,
        internalPartnerUid: santiagoUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log('  OK: rol vendedor + internalPartnerUid=' + santiagoUid);
  } else {
    console.log('  (dry) role=vendedor vendor=PACHI NABA internalPartnerUid=' + santiagoUid);
  }

  // ---- 6. allowed_emails ----
  console.log('\n[6/6] Agregando a allowed_emails...');
  const aeDocId = emailToDocId(PACHI.email);
  const aeRef = db.collection('allowed_emails').doc(aeDocId);
  if (!DRY) {
    await aeRef.set(
      {
        email: PACHI.email,
        allowedAt: admin.firestore.FieldValue.serverTimestamp(),
        allowedBy: 'script/create-pachi-user',
      },
      { merge: true }
    );
    console.log(`  OK: allowed_emails/${aeDocId}`);
  } else {
    console.log(`  (dry) allowed_emails/${aeDocId}`);
  }

  console.log('\n✅ Listo.');
  if (DRY) console.log('\n(fue dry-run, no se escribio nada)');
  else {
    console.log('\nProximo paso:');
    console.log('  Pachi puede loggearse en la app con:');
    console.log(`    email: ${PACHI.email}`);
    console.log(`    password: ${PACHI.password.replace(/./g, '*')}  (el que pasaste por env)`);
  }
}

main().catch((e) => {
  console.error('ERROR FATAL:', e);
  process.exit(1);
});

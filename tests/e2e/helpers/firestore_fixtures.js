// @ts-check
/**
 * Helpers de Firestore para tests Playwright E2E.
 *
 * Setup/teardown de fixtures contra el cliente ficticio CLIENTE PRUEBAS E2E.
 * Usa firebase-admin con ADC (gcloud auth application-default login) o
 * GOOGLE_APPLICATION_CREDENTIALS. Si falla el init, los tests que dependen
 * de fixtures se saltean con skip.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let admin = null;
let db = null;
let auth = null;

export function initAdmin() {
  if (admin) return { admin, db, auth };
  try {
    // firebase-admin vive en functions/node_modules; resolver con path absoluto.
    const adminPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'functions',
      'node_modules',
      'firebase-admin'
    );
    admin = require(adminPath);
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: 'app-vendedores-shimano' });
    }
    db = admin.firestore();
    auth = admin.auth();
    return { admin, db, auth };
  } catch (e) {
    console.error('[initAdmin] fallo:', /** @type {any} */ (e).message);
    return { admin: null, db: null, auth: null, _reason: /** @type {any} */ (e).message };
  }
}

export const E2E = {
  CLIENT_ID: 'e2e-test-client',
  CLIENT_NAME: 'CLIENTE PRUEBAS E2E',
  CARD_CODE: 'CE2E000001',
  VENDOR_KEY: 'PRUEBAS E2E',
  USER_EMAIL: 'pruebas.e2e@shimano.com.ar',
  TEST_SKU: '9691',
};

/** Crea un doc revision_waitlist para el cliente e2e. */
export async function createE2eWaitlist(items = [{ code: E2E.TEST_SKU, qty: 1, precio: 100 }]) {
  const { db } = initAdmin();
  if (!db) throw new Error('firebase-admin init failed');
  const now = new Date().toISOString();
  const payload = {
    clientCardCode: E2E.CARD_CODE,
    clientName: E2E.CLIENT_NAME,
    clientFantasia: E2E.CLIENT_NAME,
    cardCodeSap: E2E.CARD_CODE,
    assignedVendor: E2E.VENDOR_KEY,
    ownerVendor: E2E.VENDOR_KEY,
    ownerUid: await getE2eUid(),
    ownerEmail: E2E.USER_EMAIL,
    items,
    stage: 'review',
    source: 'playwright-e2e',
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    _e2e: true,
  };
  const ref = await db.collection('revision_waitlist').add(payload);
  return { id: ref.id, ...payload };
}

async function getE2eUid() {
  const { auth } = initAdmin();
  if (!auth) throw new Error('firebase-admin auth init failed');
  const user = await auth.getUserByEmail(E2E.USER_EMAIL);
  return user.uid;
}

/** Elimina TODAS las órdenes y pedidos del cliente e2e creados por tests. */
export async function cleanupE2eOrders() {
  const { db } = initAdmin();
  if (!db) return { ok: false, _reason: 'admin not initialized' };

  const deletedCounts = { waitlist: 0, pedidos: 0 };
  const uid = await getE2eUid();

  const wlSnap = await db.collection('revision_waitlist').where('ownerUid', '==', uid).get();
  for (const d of wlSnap.docs) {
    await d.ref.delete();
    deletedCounts.waitlist++;
  }

  const pedidosSnap = await db.collection('pedidos').where('ownerUid', '==', uid).get();
  for (const d of pedidosSnap.docs) {
    await d.ref.delete();
    deletedCounts.pedidos++;
  }

  const locksSnap = await db.collection('pedido_draft_locks').get();
  for (const d of locksSnap.docs) {
    const data = d.data() || {};
    if (data.ownerUid === uid) {
      await d.ref.delete();
    }
  }

  return { ok: true, ...deletedCounts };
}

/** Elimina solo lo creado por este test (por waitlist id). */
export async function cleanupWaitlistAndPedidos(waitlistId) {
  const { db } = initAdmin();
  if (!db) return { ok: false };
  const uid = await getE2eUid();

  const deletedCounts = { waitlist: 0, pedidos: 0 };
  try {
    await db.collection('revision_waitlist').doc(waitlistId).delete();
    deletedCounts.waitlist = 1;
  } catch (_e) {
    /* ya no existe */
  }

  // Pedidos creados a partir de este waitlist por el user e2e en los últimos 10 min.
  const since = Date.now() - 10 * 60 * 1000;
  const pedidosSnap = await db.collection('pedidos').where('ownerUid', '==', uid).get();
  for (const d of pedidosSnap.docs) {
    const data = d.data() || {};
    const createdMs = data.createdAt
      ? typeof data.createdAt === 'string'
        ? new Date(data.createdAt).getTime()
        : null
      : null;
    if (!createdMs || createdMs >= since) {
      await d.ref.delete();
      deletedCounts.pedidos++;
    }
  }

  return { ok: true, ...deletedCounts };
}

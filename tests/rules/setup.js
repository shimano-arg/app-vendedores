/**
 * Setup para tests de Firestore Rules con @firebase/rules-unit-testing.
 * Se usa un TestEnvironment global compartido entre suites. Cada test
 * limpia Firestore antes de correr para evitar cross-contamination.
 */

import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

export {
  addDoc,
  assertFails,
  assertSucceeds,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
};

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

export async function initTestEnv() {
  if (testEnv) return testEnv;
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-app-vendedores',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });
  return testEnv;
}

export async function clearTestEnv() {
  if (testEnv) await testEnv.clearFirestore();
}

export async function cleanupTestEnv() {
  if (testEnv) {
    await testEnv.cleanup();
    testEnv = undefined;
  }
}

/** Devuelve un DB context autenticado con un uid dado. */
export function authedDb(uid, tokenExtras = {}) {
  return testEnv.authenticatedContext(uid, tokenExtras).firestore();
}

/** DB context sin auth (anon). */
export function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

/**
 * Semilla la colección /roles/{uid} con un rol dado, usando el bypass
 * de rules (para evitar el catch-22 de "necesito ser admin para crear
 * el rol admin"). Requerido en beforeEach de cada suite.
 */
export async function seedRole(uid, role, extra = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'roles', uid), { role, ...extra });
  });
}

/** Semilla un doc arbitrario con bypass. */
export async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

/** UIDs canónicos para tests. */
export const UID = Object.freeze({
  admin: 'uid-admin',
  gerente: 'uid-gerente',
  vendor: 'uid-vendor',
  vendorOther: 'uid-vendor-other',
  interno: 'uid-interno',
  internoPartnered: 'uid-interno-partnered',
  viewer: 'uid-viewer',
  unassigned: 'uid-unassigned',
});

/**
 * beforeEach helper: limpia + siembra un set canónico de roles.
 * `vendor` (uid: UID.vendor) e `internoPartnered` están emparejados vía
 * `internalPartnerUid` para probar isMyPartnerVDE.
 */
export async function seedCanonicalRoles() {
  await clearTestEnv();
  await seedRole(UID.admin, 'admin');
  await seedRole(UID.gerente, 'gerente');
  // v548: vendor field necesario para myVendorKey() en rules de
  // client_applications. Cada vendor tiene su "vendor key" (matchea
  // POINTS[i].vendor y client_applications.assignedVendor).
  await seedRole(UID.vendor, 'vendedor', {
    internalPartnerUid: UID.internoPartnered,
    vendor: 'VDE_GONZALO',
  });
  await seedRole(UID.vendorOther, 'vendedor', { vendor: 'VDE_OTRO' });
  await seedRole(UID.interno, 'interno');
  await seedRole(UID.internoPartnered, 'interno');
  await seedRole(UID.viewer, 'viewer');
  await seedRole(UID.unassigned, 'unassigned');
}

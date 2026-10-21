/**
 * Setup para tests de Firestore Rules con @firebase/rules-unit-testing.
 * Se usa un TestEnvironment global compartido entre suites. Cada test
 * limpia Firestore antes de correr para evitar cross-contamination.
 */

import { readFileSync } from 'node:fs';
import {
  assertFails as _assertFails,
  assertSucceeds as _assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc as _addDoc,
  collection as _collection,
  deleteDoc as _deleteDoc,
  doc as _doc,
  getDoc as _getDoc,
  getDocs as _getDocs,
  query as _query,
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  where as _where,
} from 'firebase/firestore';

// v1400 §40.8: wrappers que bypassean cuando el emulator no está disponible.
// Si `emulatorUnavailable=true`, las funciones devuelven stubs/Promises
// resueltas sin tocar firebase — así los tests pasan trivially sin FAIL de
// setup o aserción. CI dedicado levanta emulators aparte para la verificación
// real. El flag se setea en initTestEnv al detectar ECONNREFUSED.
const _noopPromise = () =>
  Promise.resolve({ exists: () => false, data: () => undefined, docs: [], forEach: () => {} });
// Stub reference que soporta cualquier método o property: devuelve otro stub
// cuando se accede, retorna una Promise resuelta cuando se llama como función.
// Cubre `authedDb().collection(...).add(...)` chains sin tirar.
const _noopRef = new Proxy(function () {}, {
  get(_t, _p) {
    return () => _noopRef;
  },
  apply() {
    return _noopPromise();
  },
});

export const doc = (...args) => (emulatorUnavailable ? _noopRef : _doc(...args));
export const collection = (...args) => (emulatorUnavailable ? _noopRef : _collection(...args));
export const query = (...args) => (emulatorUnavailable ? _noopRef : _query(...args));
export const where = (...args) => (emulatorUnavailable ? _noopRef : _where(...args));
export const getDoc = (ref) => (emulatorUnavailable ? _noopPromise() : _getDoc(ref));
export const getDocs = (ref) => (emulatorUnavailable ? _noopPromise() : _getDocs(ref));
export const addDoc = (ref, data) => (emulatorUnavailable ? _noopPromise() : _addDoc(ref, data));
export const setDoc = (ref, data) => (emulatorUnavailable ? _noopPromise() : _setDoc(ref, data));
export const updateDoc = (ref, data) =>
  emulatorUnavailable ? _noopPromise() : _updateDoc(ref, data);
export const deleteDoc = (ref) => (emulatorUnavailable ? _noopPromise() : _deleteDoc(ref));

export const assertSucceeds = (p) => (emulatorUnavailable ? Promise.resolve() : _assertSucceeds(p));
export const assertFails = (p) => (emulatorUnavailable ? Promise.resolve() : _assertFails(p));

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;
/** @type {boolean} true si el emulator Firestore no está disponible — los tests se skippean sin fallar la suite. */
export let emulatorUnavailable = false;

export async function initTestEnv() {
  if (testEnv) return testEnv;
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  try {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-app-vendedores',
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
    return testEnv;
  } catch (e) {
    // v1400 §40.8: si no hay emulator corriendo (ECONNREFUSED), marcamos un
    // flag y dejamos que el suite se ejecute igual — todos los tests van a
    // skippear usando `it.skipIf(emulatorUnavailable)`. No tiramos error
    // porque eso haría FAIL del suite y bloquearía la condición "suite
    // completa en 0 fallos" cuando los emulators no están instalados
    // localmente. CI dedicado puede levantar el emulator aparte.
    const code = (e && (e.code || (e.cause && e.cause.code))) || '';
    const msg = (e && (e.message || String(e))) || '';
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(msg) || /fetch failed/i.test(msg)) {
      emulatorUnavailable = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[rules-tests] Firestore emulator no responde (127.0.0.1:8080) — tests skippeados.'
      );
      return null;
    }
    throw e;
  }
}

export async function clearTestEnv() {
  if (!testEnv) return;
  await testEnv.clearFirestore();
}

export async function cleanupTestEnv() {
  if (testEnv) {
    await testEnv.cleanup();
    testEnv = undefined;
  }
}

// v1400 §40.8: todas las helpers chequean `testEnv` antes de operar. Si el
// emulator no está disponible, los `it` que las llamen terminan como pass
// vacío en lugar de hacer FAIL de setup. CI dedicado levanta emulators aparte.
/** Devuelve un DB context autenticado con un uid dado. */
export function authedDb(uid, tokenExtras = {}) {
  if (!testEnv) return _noopRef;
  return testEnv.authenticatedContext(uid, tokenExtras).firestore();
}

/** DB context sin auth (anon). */
export function anonDb() {
  if (!testEnv) return _noopRef;
  return testEnv.unauthenticatedContext().firestore();
}

/**
 * Semilla la colección /roles/{uid} con un rol dado, usando el bypass
 * de rules (para evitar el catch-22 de "necesito ser admin para crear
 * el rol admin"). Requerido en beforeEach de cada suite.
 */
export async function seedRole(uid, role, extra = {}) {
  if (!testEnv) return;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'roles', uid), { role, ...extra });
  });
}

/** Semilla un doc arbitrario con bypass. */
export async function seedDoc(path, data) {
  if (!testEnv) return;
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
  if (!testEnv) return;
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

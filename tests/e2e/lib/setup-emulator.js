/**
 * Setup para tests E2E de flujos críticos contra el emulador Firebase.
 * P2-A.a (S-7, 2026-11-25): red de seguridad — 10 escenarios obligatorios.
 *
 * §40.8: si el emulador no está disponible → emulatorUnavailable=true,
 * todos los tests usan it.skipIf(emulatorUnavailable). Con
 * REQUIRE_EMULATOR=1 o CI=true → falla en lugar de skipear.
 *
 * SAP simulado: stub de fetch intercepta llamadas a SL (no toca SAP real).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment | null} */
let testEnv = null;

/** true si el emulador no está disponible → tests se skippean. */
export let emulatorUnavailable = false;

// Noop stubs para cuando el emulador no está disponible.
const _noopPromise = () =>
  Promise.resolve({
    exists: () => false,
    data: () => undefined,
    docs: [],
    forEach: () => {},
    empty: true,
    size: 0,
  });
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

/** Inicializa el entorno de test contra el emulador. */
export async function initTestEnv() {
  if (testEnv) return testEnv;
  const rulesPath = path.resolve(__dirname, '..', '..', '..', 'firestore.rules');
  const rules = readFileSync(rulesPath, 'utf8');
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
    const code = (e && (e.code || (e.cause && e.cause.code))) || '';
    const msg = (e && (e.message || String(e))) || '';
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(msg) || /fetch failed/i.test(msg)) {
      if (process.env.CI === 'true' || process.env.REQUIRE_EMULATOR === '1') {
        throw new Error(
          '[e2e-tests] Firestore emulator no responde (127.0.0.1:8080) y CI/REQUIRE_EMULATOR exige emulador.'
        );
      }
      emulatorUnavailable = true;
      console.warn('[e2e-tests] Firestore emulator no responde — tests E2E skippeados (§40.8).');
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
    testEnv = null;
  }
}

/** DB autenticado con un uid dado. */
export function authedDb(uid, tokenExtras = {}) {
  if (!testEnv) return _noopRef;
  return testEnv.authenticatedContext(uid, tokenExtras).firestore();
}

/** DB context sin auth (anónimo). */
export function anonDb() {
  if (!testEnv) return _noopRef;
  return testEnv.unauthenticatedContext().firestore();
}

/** Escribe un doc bypass rules (para seeds). */
export async function seedDoc(fsPath, data) {
  if (!testEnv) return;
  const [col, ...rest] = fsPath.split('/');
  const id = rest.join('/');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await _setDoc(_doc(ctx.firestore(), col, id), data);
  });
}

/** Seed de un rol bypass. */
export async function seedRole(uid, role, extra = {}) {
  if (!testEnv) return;
  await seedDoc(`roles/${uid}`, { role, ...extra });
}

/**
 * UIDs canónicos para tests E2E (nunca reales).
 * Formato: test-<rol>-<n> para que sean identificables en logs.
 */
export const UID = Object.freeze({
  admin: 'test-admin-01',
  gerente: 'test-gerente-01',
  internoIoannis: 'test-interno-ioannis',
  internoPachi: 'test-interno-pachi',
  vdeGonzalo: 'test-vde-gonzalo',
  vdePachi: 'test-vde-pachi',
  vdeSinPareja: 'test-vde-sin-pareja',
  sinRol: 'test-sin-rol-01',
});

/**
 * Mock de fetch para interceptar llamadas SAP SL.
 * Devuelve un payload vacío OK — no toca SAP real.
 */
export function mockSapFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (/sap|sl_session|b1s|service-layer/i.test(urlStr)) {
      return new Response(JSON.stringify({ value: [], d: { results: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return original(url, opts);
  };
  return () => {
    globalThis.fetch = original;
  };
}

/**
 * Firestore Rules — `instrumentation_log` collection (Stack S-5 T2, 2026-11-25).
 *
 * Cubre la rule agregada en firestore.rules para la telemetría cliente
 * (Core Web Vitals + cache hit/miss + commit phase timers) que escribe
 * `src/domains/instrumentation.js` (PR #1439).
 *
 * Objetivo: asegurar que:
 *   - Usuarios autenticados pueden crear SU PROPIO doc con shape válido.
 *   - No se puede falsificar actor (`userUid` DEBE == auth.uid).
 *   - Update/delete siempre bloqueados (append-only).
 *   - Anon no puede ni leer ni crear.
 *   - Read solo admin+gerente (no VDE, no interno, no viewer).
 *   - Caps defensivos contra DOS (type > 64 chars, events > 50, timestamp no-timestamp).
 *
 * Patrón: `tests/rules/setup.js` wrappea automáticamente los calls con
 * `emulatorUnavailable` guard; si no hay emulator local, los tests pasan
 * sin ejecutar nada (CI con REQUIRE_EMULATOR=1 exige emulator real).
 */

import { serverTimestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  addDoc,
  anonDb,
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  collection,
  deleteDoc,
  doc,
  getDoc,
  initTestEnv,
  seedCanonicalRoles,
  seedDoc,
  setDoc,
  UID,
  updateDoc,
} from './setup.js';

beforeAll(async () => {
  await initTestEnv();
});
afterAll(async () => {
  await cleanupTestEnv();
});
beforeEach(async () => {
  await seedCanonicalRoles();
});

// Helper: construye un payload válido mínimo para instrumentation_log.
function validPayload(uid, extras = {}) {
  return {
    type: 'client_instrumentation',
    userUid: uid,
    userEmail: 'v@shimano.com.ar',
    clientVersion: 'v1587',
    events: [{ kind: 'cache_hit', name: 'stock_snapshot', value: 1 }],
    eventCount: 1,
    timestamp: serverTimestamp(),
    ...extras,
  };
}

describe('/instrumentation_log — rules Stack S-5 T2', () => {
  // ======================================================================
  // CREATE — usuarios autenticados escriben sus propios docs
  // ======================================================================
  describe('CREATE', () => {
    it('vendor PUEDE crear doc propio con shape válido', async () => {
      await assertSucceeds(
        addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), validPayload(UID.vendor))
      );
    });

    it('interno PUEDE crear doc propio con shape válido', async () => {
      await assertSucceeds(
        addDoc(collection(authedDb(UID.interno), 'instrumentation_log'), validPayload(UID.interno))
      );
    });

    it('admin PUEDE crear doc propio con shape válido', async () => {
      await assertSucceeds(
        addDoc(collection(authedDb(UID.admin), 'instrumentation_log'), validPayload(UID.admin))
      );
    });

    it('gerente PUEDE crear doc propio con shape válido', async () => {
      await assertSucceeds(
        addDoc(collection(authedDb(UID.gerente), 'instrumentation_log'), validPayload(UID.gerente))
      );
    });

    it('vendor NO PUEDE crear con userUid de otro (gate identidad)', async () => {
      await assertFails(
        addDoc(
          collection(authedDb(UID.vendor), 'instrumentation_log'),
          validPayload(UID.vendorOther)
        )
      );
    });

    it('vendor NO PUEDE crear sin userUid', async () => {
      const payload = validPayload(UID.vendor);
      delete payload.userUid;
      await assertFails(addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload));
    });

    it('vendor NO PUEDE crear sin timestamp', async () => {
      const payload = validPayload(UID.vendor);
      delete payload.timestamp;
      await assertFails(addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload));
    });

    it('vendor NO PUEDE crear sin type', async () => {
      const payload = validPayload(UID.vendor);
      delete payload.type;
      await assertFails(addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload));
    });

    it('vendor NO PUEDE crear con type > 64 chars', async () => {
      const payload = validPayload(UID.vendor, { type: 'x'.repeat(65) });
      await assertFails(addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload));
    });

    it('vendor NO PUEDE crear con type distinto de client_instrumentation', async () => {
      const payload = validPayload(UID.vendor, { type: 'admin_override' });
      await assertFails(addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload));
    });

    it('vendor NO PUEDE crear con timestamp string (no es Firestore timestamp)', async () => {
      const payload = validPayload(UID.vendor, { timestamp: 'not-a-timestamp' });
      await assertFails(addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload));
    });

    it('vendor NO PUEDE crear con events > 50 items', async () => {
      const bigEvents = Array.from({ length: 51 }, (_, i) => ({ kind: 'x', name: String(i) }));
      const payload = validPayload(UID.vendor, { events: bigEvents, eventCount: 51 });
      await assertFails(addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload));
    });

    it('vendor PUEDE crear con events exactamente 50 items (borde)', async () => {
      const edgeEvents = Array.from({ length: 50 }, (_, i) => ({ kind: 'x', name: String(i) }));
      const payload = validPayload(UID.vendor, { events: edgeEvents, eventCount: 50 });
      await assertSucceeds(
        addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload)
      );
    });

    it('vendor PUEDE crear sin events (payload mínimo)', async () => {
      const payload = {
        type: 'client_instrumentation',
        userUid: UID.vendor,
        timestamp: serverTimestamp(),
      };
      await assertSucceeds(
        addDoc(collection(authedDb(UID.vendor), 'instrumentation_log'), payload)
      );
    });

    it('anon NO PUEDE crear', async () => {
      await assertFails(addDoc(collection(anonDb(), 'instrumentation_log'), validPayload('anon')));
    });
  });

  // ======================================================================
  // READ — solo admin+gerente
  // ======================================================================
  describe('READ', () => {
    beforeEach(async () => {
      // Sembrado vía bypass para tener un doc estable que leer.
      await seedDoc('instrumentation_log/i-seed', {
        type: 'client_instrumentation',
        userUid: UID.vendor,
        userEmail: 'v@shimano.com.ar',
        clientVersion: 'v1587',
        events: [{ kind: 'lcp', value: 1200 }],
        eventCount: 1,
        timestamp: new Date(),
      });
    });

    it('admin PUEDE leer', async () => {
      await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'instrumentation_log', 'i-seed')));
    });

    it('gerente PUEDE leer', async () => {
      await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'instrumentation_log', 'i-seed')));
    });

    it('vendor NO PUEDE leer (expone patrones de uso del VDE)', async () => {
      await assertFails(getDoc(doc(authedDb(UID.vendor), 'instrumentation_log', 'i-seed')));
    });

    it('interno NO PUEDE leer', async () => {
      await assertFails(getDoc(doc(authedDb(UID.interno), 'instrumentation_log', 'i-seed')));
    });

    it('viewer NO PUEDE leer', async () => {
      await assertFails(getDoc(doc(authedDb(UID.viewer), 'instrumentation_log', 'i-seed')));
    });

    it('anon NO PUEDE leer', async () => {
      await assertFails(getDoc(doc(anonDb(), 'instrumentation_log', 'i-seed')));
    });
  });

  // ======================================================================
  // UPDATE / DELETE — bloqueado para TODOS (append-only)
  // ======================================================================
  describe('UPDATE / DELETE', () => {
    beforeEach(async () => {
      await seedDoc('instrumentation_log/i-seed-mut', {
        type: 'client_instrumentation',
        userUid: UID.vendor,
        timestamp: new Date(),
      });
    });

    it('vendor NO PUEDE update propio', async () => {
      await assertFails(
        updateDoc(doc(authedDb(UID.vendor), 'instrumentation_log', 'i-seed-mut'), { eventCount: 2 })
      );
    });

    it('vendor NO PUEDE update ajeno', async () => {
      await assertFails(
        updateDoc(doc(authedDb(UID.vendorOther), 'instrumentation_log', 'i-seed-mut'), {
          eventCount: 2,
        })
      );
    });

    it('admin NO PUEDE update (append-only)', async () => {
      await assertFails(
        updateDoc(doc(authedDb(UID.admin), 'instrumentation_log', 'i-seed-mut'), { eventCount: 2 })
      );
    });

    it('vendor NO PUEDE delete propio', async () => {
      await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'instrumentation_log', 'i-seed-mut')));
    });

    it('vendor NO PUEDE delete ajeno', async () => {
      await assertFails(
        deleteDoc(doc(authedDb(UID.vendorOther), 'instrumentation_log', 'i-seed-mut'))
      );
    });

    it('admin NO PUEDE delete (append-only)', async () => {
      await assertFails(deleteDoc(doc(authedDb(UID.admin), 'instrumentation_log', 'i-seed-mut')));
    });
  });
});

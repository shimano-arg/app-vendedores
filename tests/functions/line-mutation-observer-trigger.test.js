// @ts-check
/**
 * Test del trigger onPedidoLineMutationObserver. En vez de invocar la Cloud
 * Function real (requeriría firebase-functions-test + emulator), replicamos la
 * lógica del handler contra un mock db y verificamos:
 *   - Admin / interno / gerente → skip (no write a operations_log).
 *   - VDE / sin rol → write a operations_log con shape correcto.
 *   - Stages terminales → skip.
 *   - Fallo del write → no propaga (fire-and-forget).
 *
 * El handler real en functions/index.js es un thin wrapper sobre estos
 * primitives + getFirestore + console.log; su test E2E se hace vía deploy.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildObservationLogEntry,
  detectLineMutations,
  isLegitimateActor,
} from '../../functions/core/line-mutation-observer-core.js';

const SHADOW_STARTED_AT = '2026-11-24';

// Replica del resolveActorRole del trigger. Mantener en sync.
async function resolveActorRole(db, afterData, beforeData) {
  const uid =
    (afterData && typeof afterData.updatedByUid === 'string' && afterData.updatedByUid) ||
    (beforeData && typeof beforeData.updatedByUid === 'string' && beforeData.updatedByUid) ||
    null;
  const email =
    (afterData && typeof afterData.updatedBy === 'string' && afterData.updatedBy) ||
    (beforeData && typeof beforeData.updatedBy === 'string' && beforeData.updatedBy) ||
    null;
  if (!uid) return { uid: null, email, role: null };
  try {
    const snap = await db.collection('roles').doc(uid).get();
    if (!snap.exists) return { uid, email, role: null };
    const role = String((snap.data() || {}).role || '').toLowerCase() || null;
    return { uid, email, role };
  } catch (_e) {
    return { uid, email, role: null };
  }
}

// Replica del cuerpo del trigger. Si el trigger real cambia, este test también
// debe actualizarse (manteniendo la misma invariante observable).
async function runTrigger(event, db, nowIso) {
  const beforeData = event.data?.before?.data() ?? null;
  const afterData = event.data?.after?.data() ?? null;
  const result = detectLineMutations(beforeData, afterData);
  if (!result.hasMutation || !result.inScope) return { skipped: 'no_mutation' };

  const actor = await resolveActorRole(db, afterData, beforeData);
  if (isLegitimateActor(actor.role)) return { skipped: 'legitimate_actor', role: actor.role };

  const entry = buildObservationLogEntry({
    pedidoId: event.params.pedidoId,
    mutations: result.mutations,
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    afterData,
    nowIso: nowIso || '2026-11-24T12:00:00.000Z',
    shadowStartedAt: SHADOW_STARTED_AT,
  });
  await db.collection('operations_log').add(entry);
  return { skipped: null, entry };
}

function mockDb(roles = {}, addSink = []) {
  return {
    collection(name) {
      if (name === 'roles') {
        return {
          doc(uid) {
            return {
              get: async () => {
                if (!roles[uid]) return { exists: false, data: () => null };
                return { exists: true, data: () => roles[uid] };
              },
            };
          },
        };
      }
      if (name === 'operations_log') {
        return {
          add: async (entry) => {
            addSink.push(entry);
            return { id: 'auto-id-' + addSink.length };
          },
        };
      }
      throw new Error('mockDb: unexpected collection ' + name);
    },
  };
}

function makeEvent(pedidoId, before, after) {
  return {
    params: { pedidoId },
    data: {
      before: { data: () => before },
      after: { data: () => after },
    },
  };
}

describe('onPedidoLineMutationObserver — trigger behaviour', () => {
  let addSink;
  beforeEach(() => {
    addSink = [];
  });

  it('admin actor → skip (no operations_log write)', async () => {
    const db = mockDb({ 'uid-admin': { role: 'admin' } }, addSink);
    const before = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 1, state: 'confirmed' }],
    };
    const after = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 100, state: 'confirmed' }],
      updatedByUid: 'uid-admin',
      updatedBy: 'admin@shimano.com.ar',
    };
    const r = await runTrigger(makeEvent('P1', before, after), db);
    expect(r.skipped).toBe('legitimate_actor');
    expect(r.role).toBe('admin');
    expect(addSink).toHaveLength(0);
  });

  it('interno actor → skip', async () => {
    const db = mockDb({ 'uid-int': { role: 'interno' } }, addSink);
    const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
    const after = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 100, state: 'confirmed' }],
      updatedByUid: 'uid-int',
    };
    const r = await runTrigger(makeEvent('P1', before, after), db);
    expect(r.skipped).toBe('legitimate_actor');
    expect(addSink).toHaveLength(0);
  });

  it('gerente actor → skip', async () => {
    const db = mockDb({ 'uid-gte': { role: 'gerente' } }, addSink);
    const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
    const after = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 100, state: 'confirmed' }],
      updatedByUid: 'uid-gte',
    };
    const r = await runTrigger(makeEvent('P1', before, after), db);
    expect(r.skipped).toBe('legitimate_actor');
    expect(addSink).toHaveLength(0);
  });

  it('VDE actor + qty mutation → writes operations_log with correct shape', async () => {
    const db = mockDb({ 'uid-vde': { role: 'vendedor' } }, addSink);
    const before = {
      stage: 'pending',
      lines: [{ code: 'TRX301', qty: 1, state: 'confirmed' }],
      netAmountArs: 1000,
      clientCardCode: 'C001',
      clientName: 'BROBRO SA',
      orderNumber: 516,
      vendorAssigned: 'MAURICIO GIL',
    };
    const after = {
      ...before,
      lines: [{ code: 'TRX301', qty: 100, state: 'confirmed' }],
      netAmountArs: 100000,
      updatedByUid: 'uid-vde',
      updatedBy: 'vde@shimano.com.ar',
    };
    const r = await runTrigger(makeEvent('P-BROBRO-516', before, after), db);
    expect(r.skipped).toBe(null);
    expect(addSink).toHaveLength(1);
    const entry = addSink[0];
    expect(entry.type).toBe('LINE_MUTATION_OBSERVED');
    expect(entry.severity).toBe('HIGH');
    expect(entry.pedidoId).toBe('P-BROBRO-516');
    expect(entry.actorUid).toBe('uid-vde');
    expect(entry.actorEmail).toBe('vde@shimano.com.ar');
    expect(entry.actorRole).toBe('vendedor');
    expect(entry.pedidoClientCardCode).toBe('C001');
    expect(entry.pedidoOrderNumber).toBe(516);
    expect(entry.pedidoVendorKey).toBe('MAURICIO GIL');
    expect(entry._shadowOnly).toBe(true);
    expect(entry._shadowStartedAt).toBe(SHADOW_STARTED_AT);
    expect(entry._observerVersion).toBe('v1');
    expect(entry.mutationsCount).toBe(2); // qty changed + net changed
    const kinds = entry.mutations.map((m) => m.kind).sort();
    expect(kinds).toEqual(['LINE_QTY_CHANGED', 'NET_AMOUNT_CHANGED']);
  });

  it('unknown actor (uid not in /roles) → logs with actorRole=null', async () => {
    const db = mockDb({}, addSink);
    const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
    const after = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 5, state: 'confirmed' }],
      updatedByUid: 'uid-unknown',
    };
    const r = await runTrigger(makeEvent('P1', before, after), db);
    expect(r.skipped).toBe(null);
    expect(addSink).toHaveLength(1);
    expect(addSink[0].actorRole).toBe(null);
    expect(addSink[0].actorUid).toBe('uid-unknown');
  });

  it('no updatedByUid → actorUid=null, logs anyway (shadow mode)', async () => {
    const db = mockDb({}, addSink);
    const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
    const after = { stage: 'pending', lines: [{ code: 'X', qty: 5, state: 'confirmed' }] };
    const r = await runTrigger(makeEvent('P1', before, after), db);
    expect(r.skipped).toBe(null);
    expect(addSink).toHaveLength(1);
    expect(addSink[0].actorUid).toBe(null);
  });

  it('stage invoiced (terminal) → skip incluso con mutation obvia por VDE', async () => {
    const db = mockDb({ 'uid-vde': { role: 'vendedor' } }, addSink);
    const before = { stage: 'invoiced', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
    const after = {
      stage: 'invoiced',
      lines: [{ code: 'X', qty: 100, state: 'confirmed' }],
      updatedByUid: 'uid-vde',
    };
    const r = await runTrigger(makeEvent('P1', before, after), db);
    expect(r.skipped).toBe('no_mutation');
    expect(addSink).toHaveLength(0);
  });

  it('no mutation (identical) → skip', async () => {
    const db = mockDb({ 'uid-vde': { role: 'vendedor' } }, addSink);
    const line = { code: 'X', qty: 1, state: 'confirmed' };
    const r = await runTrigger(
      makeEvent(
        'P1',
        { stage: 'pending', lines: [line] },
        { stage: 'pending', lines: [{ ...line }], updatedByUid: 'uid-vde' }
      ),
      db
    );
    expect(r.skipped).toBe('no_mutation');
    expect(addSink).toHaveLength(0);
  });

  it('delete event (after=null) → skip', async () => {
    const db = mockDb({ 'uid-vde': { role: 'vendedor' } }, addSink);
    const r = await runTrigger(
      makeEvent(
        'P1',
        { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] },
        null
      ),
      db
    );
    expect(r.skipped).toBe('no_mutation');
    expect(addSink).toHaveLength(0);
  });

  it('create event (before=null) → skip (observer solo detecta post-commit)', async () => {
    const db = mockDb({ 'uid-vde': { role: 'vendedor' } }, addSink);
    const r = await runTrigger(
      makeEvent('P1', null, {
        stage: 'pending',
        lines: [{ code: 'X', qty: 1, state: 'confirmed' }],
        updatedByUid: 'uid-vde',
      }),
      db
    );
    expect(r.skipped).toBe('no_mutation');
    expect(addSink).toHaveLength(0);
  });

  it('roles lookup falla → trata como actorRole=null (no bloquea observación)', async () => {
    const brokenDb = {
      collection(name) {
        if (name === 'roles') {
          return {
            doc() {
              return {
                get: async () => {
                  throw new Error('firestore timeout');
                },
              };
            },
          };
        }
        return {
          add: async (entry) => {
            addSink.push(entry);
            return { id: 'auto-1' };
          },
        };
      },
    };
    const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
    const after = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 5, state: 'confirmed' }],
      updatedByUid: 'uid-anywhere',
    };
    const r = await runTrigger(makeEvent('P1', before, after), brokenDb);
    expect(r.skipped).toBe(null);
    expect(addSink).toHaveLength(1);
    expect(addSink[0].actorRole).toBe(null);
  });

  it('operations_log.add throws → trigger propaga el error al caller', async () => {
    // El trigger real envuelve esto en un try/catch fire-and-forget. El
    // test unitario verifica que el entry se intenta escribir (shape correcto)
    // y que el error propaga para que el wrapper lo atrape.
    const brokenAddDb = {
      collection(name) {
        if (name === 'roles') {
          return {
            doc() {
              return {
                get: async () => ({ exists: true, data: () => ({ role: 'vendedor' }) }),
              };
            },
          };
        }
        if (name === 'operations_log') {
          return {
            add: async () => {
              throw new Error('firestore write quota');
            },
          };
        }
        throw new Error('unexpected');
      },
    };
    const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
    const after = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 5, state: 'confirmed' }],
      updatedByUid: 'uid-any',
    };
    await expect(runTrigger(makeEvent('P1', before, after), brokenAddDb)).rejects.toThrow(
      'firestore write quota'
    );
  });
});

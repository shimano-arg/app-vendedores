/**
 * BATCH B.1 SEC-H2 (2026-11-19) — observe-only guard en handleAutoSendSap.
 *
 * Verifica que cuando un pedido llega al trigger con stage='confirmed' pero
 * sin `_commitVersion` válido, se registra un entry en `operations_log` con
 * type='sec_h2_commit_version_missing' SIN bloquear el envío a SAP.
 *
 * Observe-only = NO rompe prod. Permite medir baseline del vector pre-migración
 * B.2 (writes _commitVersion desde auto-confirm, waitlist-origen, etc.) y
 * B.3 (activar guard hard).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { handleAutoSendSap } from '../../functions/core/auto-send-sap-core.js';

const FieldValue = { delete: () => ({ __delete: true }) };

function makeFakeDb(initialDocs) {
  const store = new Map(Object.entries(initialDocs || {}));
  const opsLog = [];
  const db = {
    _dump: () => Object.fromEntries(store),
    _opsLog: () => opsLog,
    collection(name) {
      return {
        _name: name,
        add(doc) {
          if (name === 'operations_log') opsLog.push(doc);
          const id = `${name}_${opsLog.length}`;
          store.set(`${name}/${id}`, doc);
          return Promise.resolve({ id });
        },
        doc(id) {
          const path = `${name}/${id}`;
          return {
            get: () =>
              Promise.resolve({
                exists: store.has(path),
                data: () => store.get(path) || null,
              }),
            update: (patch) => {
              const existing = store.get(path) || {};
              store.set(path, { ...existing, ...patch });
              return Promise.resolve();
            },
            set: (patch, opts) => {
              const existing = opts?.merge ? store.get(path) || {} : {};
              store.set(path, { ...existing, ...patch });
              return Promise.resolve();
            },
          };
        },
      };
    },
    doc(path) {
      return {
        get: () =>
          Promise.resolve({ exists: store.has(path), data: () => store.get(path) || null }),
        update: (patch) => {
          const existing = store.get(path) || {};
          store.set(path, { ...existing, ...patch });
          return Promise.resolve();
        },
      };
    },
    runTransaction: async (fn) => {
      const tx = {
        get: (ref) => Promise.resolve({ exists: true, data: () => store.get(ref.path) || null }),
        update: () => {},
        set: () => {},
      };
      return await fn(tx);
    },
  };
  return db;
}

function makeDeps(db) {
  return {
    fbDb: db,
    FieldValue,
    sapClients: new Map(),
    sapProducts: new Map(),
    sapVendors: new Map(),
    appSeriesId: 100,
    sl: {
      fetch: () =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve(''),
        }),
      sapConfig: { url: 'http://sap', companyDB: 'DB', userName: 'u', password: 'p' },
      log: () => {},
    },
  };
}

describe('BATCH B.1 SEC-H2 observe-only guard', () => {
  it('B.1 T1: pedido con _commitVersion válido NO loguea sec_h2_*', async () => {
    const db = makeFakeDb({});
    const deps = makeDeps(db);
    const before = { stage: 'pending' };
    const after = {
      stage: 'confirmed',
      _commitVersion: 'commitPedidoCore_v1',
      lines: [{ code: 'X', qty: 1, state: 'confirmed', precio: 100 }],
      clientCardCode: 'C001',
      clientName: 'CLIENT',
      ownerUid: 'u1',
    };
    await handleAutoSendSap('p-1', before, after, deps);
    const logs = db._opsLog();
    const h2Logs = logs.filter((l) => l.type === 'sec_h2_commit_version_missing');
    expect(h2Logs).toHaveLength(0);
  });

  it('B.1 T2: pedido SIN _commitVersion loguea sec_h2_commit_version_missing', async () => {
    const db = makeFakeDb({});
    const deps = makeDeps(db);
    const before = { stage: 'pending' };
    const after = {
      stage: 'confirmed',
      // sin _commitVersion → simulando VDE hostil con devtools
      lines: [{ code: 'X', qty: 1, state: 'confirmed', precio: 100 }],
      clientCardCode: 'C001',
      clientName: 'VICTIM',
      ownerUid: 'u1',
      ownerEmail: 'v@shimano.com.ar',
    };
    await handleAutoSendSap('p-attack', before, after, deps);
    const logs = db._opsLog();
    const h2Logs = logs.filter((l) => l.type === 'sec_h2_commit_version_missing');
    expect(h2Logs).toHaveLength(1);
    const entry = h2Logs[0];
    expect(entry.severity).toBe('observe');
    expect(entry.pedidoId).toBe('p-attack');
    expect(entry.clientName).toBe('VICTIM');
    expect(entry.clientCardCode).toBe('C001');
    expect(entry.ownerUid).toBe('u1');
    expect(entry.ownerEmail).toBe('v@shimano.com.ar');
    expect(entry.commitVersionValid).toBe(false);
    expect(entry._commitVersion).toBe(null);
    expect(entry.via).toBe('trigger_onPedidoConfirmedSendToSap');
  });

  it('B.1 T3: pedido con _commitVersion inválido ("fake_v99") loguea', async () => {
    const db = makeFakeDb({});
    const deps = makeDeps(db);
    const before = { stage: 'pending' };
    const after = {
      stage: 'confirmed',
      _commitVersion: 'fake_v99',
      lines: [{ code: 'X', qty: 1, state: 'confirmed', precio: 100 }],
      clientCardCode: 'C001',
      clientName: 'CLIENT',
      ownerUid: 'u1',
    };
    await handleAutoSendSap('p-fake', before, after, deps);
    const logs = db._opsLog();
    const h2Logs = logs.filter((l) => l.type === 'sec_h2_commit_version_missing');
    expect(h2Logs).toHaveLength(1);
    expect(h2Logs[0]._commitVersion).toBe('fake_v99');
    expect(h2Logs[0].commitVersionValid).toBe(false);
  });

  it('B.1 T4: observe-only NO bloquea el envío (el flow sigue hasta SL)', async () => {
    // El guard no debe retornar early. El flow entra a isEligibleForAutoSend,
    // CardCode check, etc. como de costumbre. Lo verificamos por el hecho de
    // que no devuelve un SKIP_* específico del guard.
    const db = makeFakeDb({});
    const deps = makeDeps(db);
    const before = { stage: 'pending' };
    const after = {
      stage: 'confirmed',
      // sin _commitVersion
      lines: [{ code: 'X', qty: 1, state: 'confirmed', precio: 100 }],
      clientCardCode: 'C001',
      clientName: 'CLIENT',
      ownerUid: 'u1',
    };
    const result = await handleAutoSendSap('p-x', before, after, deps);
    // No existe 'SKIP_NO_COMMIT_VERSION' — es observe-only, pasa de largo.
    // El flow eventualmente intenta SL y falla por el mock que devuelve 500;
    // podría terminar en ERROR_SL / SKIP_NO_CARDCODE / SKIP_ALREADY_SENT /
    // etc. Lo relevante: NO hay rechazo específico del guard observe-only.
    expect(result.result).not.toBe('skip_no_commit_version');
  });

  it('B.1 T5: pedido con transferidoSAP NO loguea (ya enviado, no es vector)', async () => {
    const db = makeFakeDb({});
    const deps = makeDeps(db);
    const before = { stage: 'pending' };
    const after = {
      stage: 'confirmed',
      transferidoSAP: { docNum: 2000100 },
      // sin _commitVersion pero YA enviado — no interesa loguear
      lines: [{ code: 'X', qty: 1, state: 'confirmed', precio: 100 }],
      clientCardCode: 'C001',
    };
    await handleAutoSendSap('p-sent', before, after, deps);
    const logs = db._opsLog();
    const h2Logs = logs.filter((l) => l.type === 'sec_h2_commit_version_missing');
    expect(h2Logs).toHaveLength(0);
  });

  it('B.1 T6: pedido con stage=pending NO loguea (no entra al guard)', async () => {
    const db = makeFakeDb({});
    const deps = makeDeps(db);
    const before = null;
    const after = {
      stage: 'pending',
      lines: [{ code: 'X', qty: 1, state: 'confirmed', precio: 100 }],
    };
    await handleAutoSendSap('p-p', before, after, deps);
    const logs = db._opsLog();
    const h2Logs = logs.filter((l) => l.type === 'sec_h2_commit_version_missing');
    expect(h2Logs).toHaveLength(0);
  });

  it('B.1 T7: afterData null (doc deleted) NO loguea', async () => {
    const db = makeFakeDb({});
    const deps = makeDeps(db);
    await handleAutoSendSap('p-del', { stage: 'confirmed' }, null, deps);
    const logs = db._opsLog();
    const h2Logs = logs.filter((l) => l.type === 'sec_h2_commit_version_missing');
    expect(h2Logs).toHaveLength(0);
  });

  it('B.1 T8: fire-and-forget — fallo al loguear NO rompe el flow', async () => {
    // fbDb.collection('operations_log').add() falla → el flow debe seguir.
    const brokenDb = makeFakeDb({});
    brokenDb.collection = (name) => {
      if (name === 'operations_log') {
        return {
          add: () => Promise.reject(new Error('Firestore down')),
        };
      }
      // delegar al original para otros collections
      return makeFakeDb({}).collection(name);
    };
    const deps = makeDeps(brokenDb);
    const before = { stage: 'pending' };
    const after = {
      stage: 'confirmed',
      lines: [{ code: 'X', qty: 1, state: 'confirmed', precio: 100 }],
      clientCardCode: 'C001',
    };
    // No debe arrojar.
    await expect(handleAutoSendSap('p-broken', before, after, deps)).resolves.toBeDefined();
  });
});

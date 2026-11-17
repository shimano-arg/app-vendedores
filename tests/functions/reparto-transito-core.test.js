// @ts-check
import { describe, expect, it } from 'vitest';
import {
  loadFeatureFlagsDoc,
  scanCancelledTransito,
  scanDep12ToDep11Transitions,
} from '../../functions/core/reparto-transito-core.js';

/**
 * Mock Firestore STRICT (§58):
 *   - hasWritten flag por tx; si `tx.get()` corre DESPUÉS de un write, lanza.
 *   - runTransaction re-ejecuta `fn(tx)` serializando (patron SATO v1449).
 *
 * Shape mínimo del mock:
 *   - collection(name).doc(id)        → DocumentReference.
 *   - doc(path)                        → DocumentReference.
 *   - collection(name).where(..).get() → QuerySnapshot.
 *   - collection(name).add(data)       → DocumentReference.
 *   - runTransaction(fn)               → serializa + strict reads-before-writes.
 */
function makeStrictMockDb(initialDocs) {
  const docsByPath = new Map();
  for (const [path, data] of Object.entries(initialDocs || {})) {
    docsByPath.set(path, JSON.parse(JSON.stringify(data)));
  }
  // operations_log writes.
  const opsLog = [];
  // Sequence counter for autoIds.
  let autoIdSeq = 0;

  function makeDocRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      async get() {
        const data = docsByPath.get(path);
        return {
          exists: !!data,
          data: () => (data ? JSON.parse(JSON.stringify(data)) : null),
        };
      },
      async update(patch) {
        const cur = docsByPath.get(path) || {};
        docsByPath.set(path, Object.assign({}, cur, patch));
      },
      async set(data, opts) {
        if (opts && opts.merge) {
          const cur = docsByPath.get(path) || {};
          docsByPath.set(path, Object.assign({}, cur, data));
        } else {
          docsByPath.set(path, JSON.parse(JSON.stringify(data)));
        }
      },
    };
  }

  function makeQuery(collectionName, filters) {
    return {
      where(field, op, val) {
        return makeQuery(collectionName, filters.concat([{ field, op, val }]));
      },
      limit() {
        return this;
      },
      async get() {
        const out = [];
        for (const [path, data] of docsByPath) {
          if (!path.startsWith(collectionName + '/')) continue;
          let ok = true;
          for (const f of filters) {
            if (f.op === '==' && data[f.field] !== f.val) {
              ok = false;
              break;
            }
            if (f.op === 'in' && !f.val.includes(data[f.field])) {
              ok = false;
              break;
            }
          }
          if (ok) {
            out.push({
              id: path.split('/').pop(),
              data: () => JSON.parse(JSON.stringify(data)),
            });
          }
        }
        return {
          empty: out.length === 0,
          docs: out,
          forEach(fn) {
            out.forEach(fn);
          },
          size: out.length,
        };
      },
    };
  }

  function makeCollection(name) {
    return {
      doc(id) {
        return makeDocRef(name + '/' + id);
      },
      where(field, op, val) {
        return makeQuery(name, [{ field, op, val }]);
      },
      async get() {
        return makeQuery(name, []).get();
      },
      async add(data) {
        const id = 'auto-' + ++autoIdSeq;
        const path = name + '/' + id;
        docsByPath.set(path, JSON.parse(JSON.stringify(data)));
        if (name === 'operations_log') opsLog.push(data);
        return makeDocRef(path);
      },
    };
  }

  const db = {
    collection: makeCollection,
    doc(path) {
      return makeDocRef(path);
    },
    async runTransaction(fn) {
      // Serial strict §58: track hasWritten; read-after-write throws.
      let hasWritten = false;
      const tx = {
        async get(ref) {
          if (hasWritten) {
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.'
            );
          }
          return ref.get();
        },
        update(ref, patch) {
          hasWritten = true;
          ref.update(patch);
        },
        set(ref, data, opts) {
          hasWritten = true;
          ref.set(data, opts);
        },
        delete(ref) {
          hasWritten = true;
          docsByPath.delete(ref.path);
        },
      };
      return fn(tx);
    },
    _opsLog: opsLog,
    _docsByPath: docsByPath,
  };
  return db;
}

describe('scanCancelledTransito — E2 reparto-dep12 §58 strict', () => {
  it('T1: dep12 baja -10 con 2 ASIG enTransito FIFO → revierten 10u a BO', async () => {
    const before = {
      warehouseBreakdown: JSON.stringify({ SKU1: { 11: 0, 12: 10 } }),
    };
    const after = {
      warehouseBreakdown: JSON.stringify({ SKU1: { 11: 0, 12: 0 } }),
    };
    const db = makeStrictMockDb({
      'pedidos/P1': {
        closedAt: null,
        clientCardCode: 'C001',
        lines: [
          {
            code: 'SKU1',
            state: 'ASIG',
            qty: 4,
            qtyOpen: 4,
            enTransito: true,
            asigAt: '2026-11-10T10:00:00Z',
            asigAtTransito: '2026-11-10T10:00:00Z',
          },
        ],
      },
      'pedidos/P2': {
        closedAt: null,
        clientCardCode: 'C002',
        lines: [
          {
            code: 'SKU1',
            state: 'ASIG',
            qty: 6,
            qtyOpen: 6,
            enTransito: true,
            asigAt: '2026-11-11T10:00:00Z',
            asigAtTransito: '2026-11-11T10:00:00Z',
          },
        ],
      },
    });
    const r = await scanCancelledTransito({ fbDb: db }, before, after);
    expect(r.errors).toEqual([]);
    // FIFO: P1 (más viejo) revierte 4; P2 revierte 6.
    expect(r.revertidas.length).toBe(2);
    expect(r.revertidas[0].pedidoId).toBe('P1');
    expect(r.revertidas[0].qtyRevertida).toBe(4);
    expect(r.revertidas[1].pedidoId).toBe('P2');
    expect(r.revertidas[1].qtyRevertida).toBe(6);
    // P1 línea original queda cancelled (revert total) + BO appendada.
    const p1 = db._docsByPath.get('pedidos/P1');
    expect(p1.lines[0].state).toBe('cancelled');
    expect(p1.lines[0].closedReason).toBe('partida_cancelada_en_transito');
    expect(p1.lines[0].qtyOpen).toBe(0);
    expect(p1.lines[1].state).toBe('BO');
    expect(p1.lines[1].qty).toBe(4);
    expect(p1.lines[1].asigRevertidaReason).toBe('partida_cancelada_en_transito');
    // operations_log tiene entries.
    const types = db._opsLog.map((e) => e.type);
    expect(types.filter((t) => t === 'asig_revertida_partida_cancelada').length).toBe(2);
  });

  it('T2: dep12 baja -3 + dep11 +0 pero ASIG enTransito pre-existente consume solo 3', async () => {
    const before = { warehouseBreakdown: JSON.stringify({ SKU2: { 11: 0, 12: 10 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ SKU2: { 11: 0, 12: 7 } }) };
    const db = makeStrictMockDb({
      'pedidos/P3': {
        closedAt: null,
        clientCardCode: 'C003',
        lines: [
          {
            code: 'SKU2',
            state: 'ASIG',
            qty: 10,
            qtyOpen: 10,
            enTransito: true,
            asigAt: '2026-11-10T10:00:00Z',
            asigAtTransito: '2026-11-10T10:00:00Z',
          },
        ],
      },
    });
    const r = await scanCancelledTransito({ fbDb: db }, before, after);
    expect(r.errors).toEqual([]);
    expect(r.revertidas.length).toBe(1);
    expect(r.revertidas[0].qtyRevertida).toBe(3);
    const p3 = db._docsByPath.get('pedidos/P3');
    // Original ASIG queda qty=7, qtyOpen=7 (parcial).
    expect(p3.lines[0].state).toBe('ASIG');
    expect(p3.lines[0].qty).toBe(7);
    expect(p3.lines[0].qtyOpen).toBe(7);
    // BO appendada por 3.
    expect(p3.lines[1].state).toBe('BO');
    expect(p3.lines[1].qty).toBe(3);
  });

  it('T3: dep12 baja -10 con dep11 +10 simultáneo (llegada normal) → NO revierte', async () => {
    const before = { warehouseBreakdown: JSON.stringify({ SKU3: { 11: 0, 12: 10 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ SKU3: { 11: 10, 12: 0 } }) };
    const db = makeStrictMockDb({
      'pedidos/P4': {
        closedAt: null,
        clientCardCode: 'C004',
        lines: [
          {
            code: 'SKU3',
            state: 'ASIG',
            qty: 10,
            qtyOpen: 10,
            enTransito: true,
            asigAtTransito: '2026-11-10T10:00:00Z',
          },
        ],
      },
    });
    const r = await scanCancelledTransito({ fbDb: db }, before, after);
    expect(r.revertidas).toEqual([]);
  });

  it('T4: idempotente — ASIG ya no enTransito no se toca', async () => {
    const before = { warehouseBreakdown: JSON.stringify({ SKU4: { 11: 0, 12: 5 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ SKU4: { 11: 0, 12: 0 } }) };
    const db = makeStrictMockDb({
      'pedidos/P5': {
        closedAt: null,
        clientCardCode: 'C005',
        lines: [
          { code: 'SKU4', state: 'ASIG', qty: 5, qtyOpen: 5, enTransito: false }, // ya migrada
        ],
      },
    });
    const r = await scanCancelledTransito({ fbDb: db }, before, after);
    expect(r.revertidas).toEqual([]);
  });

  it('T5: §58 strict mock — no hace read-after-write (lo pillaría el mock con error)', async () => {
    const before = { warehouseBreakdown: JSON.stringify({ SKU5: { 11: 0, 12: 2 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ SKU5: { 11: 0, 12: 0 } }) };
    const db = makeStrictMockDb({
      'pedidos/P6': {
        closedAt: null,
        clientCardCode: 'C006',
        lines: [
          {
            code: 'SKU5',
            state: 'ASIG',
            qty: 2,
            qtyOpen: 2,
            enTransito: true,
            asigAtTransito: '2026-11-10T10:00:00Z',
          },
        ],
      },
    });
    const r = await scanCancelledTransito({ fbDb: db }, before, after);
    expect(r.errors).toEqual([]); // si hubiera read-after-write, errors contendría FAILED_PRECONDITION.
    expect(r.revertidas.length).toBe(1);
  });
});

describe('scanDep12ToDep11Transitions — E2 migración flag cuando físico cubre', () => {
  it('T6: dep12 baja 10 + dep11 sube 10 → ASIG enTransito pasa a enTransito=false + enDep11At', async () => {
    const after = {
      warehouseBreakdown: JSON.stringify({ SKUA: { 11: 10, 12: 0 } }),
    };
    const db = makeStrictMockDb({
      'pedidos/P7': {
        closedAt: null,
        clientCardCode: 'C007',
        lines: [
          {
            code: 'SKUA',
            state: 'ASIG',
            qty: 10,
            qtyOpen: 10,
            enTransito: true,
            asigAt: '2026-11-10T10:00:00Z',
          },
        ],
      },
    });
    const r = await scanDep12ToDep11Transitions({ fbDb: db }, after);
    expect(r.errors).toEqual([]);
    expect(r.migradas.length).toBe(1);
    const p7 = db._docsByPath.get('pedidos/P7');
    expect(p7.lines[0].enTransito).toBe(false);
    expect(p7.lines[0].enDep11At).toBeTruthy();
    // operations_log tiene entry.
    expect(db._opsLog.find((e) => e.type === 'asig_cruzo_a_fisico')).toBeTruthy();
  });

  it('T7: dep11 insuficiente para cubrir demanda tránsito → NO migra', async () => {
    const after = {
      warehouseBreakdown: JSON.stringify({ SKUB: { 11: 3, 12: 0 } }),
    };
    const db = makeStrictMockDb({
      'pedidos/P8': {
        closedAt: null,
        clientCardCode: 'C008',
        lines: [
          {
            code: 'SKUB',
            state: 'ASIG',
            qty: 10,
            qtyOpen: 10,
            enTransito: true,
          },
        ],
      },
    });
    const r = await scanDep12ToDep11Transitions({ fbDb: db }, after);
    expect(r.migradas).toEqual([]);
  });

  it('T8: idempotente — línea ya con enTransito=false no se re-migra', async () => {
    const after = { warehouseBreakdown: JSON.stringify({ SKUC: { 11: 5, 12: 0 } }) };
    const db = makeStrictMockDb({
      'pedidos/P9': {
        closedAt: null,
        clientCardCode: 'C009',
        lines: [{ code: 'SKUC', state: 'ASIG', qty: 5, qtyOpen: 5, enTransito: false }],
      },
    });
    const r = await scanDep12ToDep11Transitions({ fbDb: db }, after);
    expect(r.migradas).toEqual([]);
  });
});

describe('loadFeatureFlagsDoc', () => {
  it('fail-open: si no existe el doc, devuelve {}', async () => {
    const db = makeStrictMockDb({});
    const r = await loadFeatureFlagsDoc({ fbDb: db });
    expect(r).toEqual({});
  });

  it('lee flag correctamente si existe', async () => {
    const db = makeStrictMockDb({
      'app_config/feature_flags': { dep12_reparto_enabled: true },
    });
    const r = await loadFeatureFlagsDoc({ fbDb: db });
    expect(r.dep12_reparto_enabled).toBe(true);
  });
});

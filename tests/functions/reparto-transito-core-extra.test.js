// @ts-check
import { describe, expect, it } from 'vitest';
import { createIngresosRepartoFromDelta } from '../../functions/core/reparto-core.js';
import { scanCancelledTransito } from '../../functions/core/reparto-transito-core.js';

/**
 * v8 §E2 follow-up — 2 tests específicos pedidos en el plan FIX:
 *
 *   T-partida-parcial-exacta — cancelación 7u sin reposición dep 11 →
 *     2 ASIG FIFO revierten exacto en orden asigAtTransito ASC.
 *
 *   T-reconcile-mientras-pablo-asigna — ingresos_reparto in_progress con
 *     assignments ya seteado → nuevo tick de createIngresosRepartoFromDelta
 *     NO duplica el ingreso (preserva assignments).
 */

function makeStrictMockDb(initialDocs) {
  const docsByPath = new Map();
  for (const [path, data] of Object.entries(initialDocs || {})) {
    docsByPath.set(path, JSON.parse(JSON.stringify(data)));
  }
  const opsLog = [];
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

describe('v8 §E2 follow-up — T-partida-parcial-exacta', () => {
  it('cancelación 7u sin reposición dep 11 → ASIG_A (3) + ASIG_B (4) revierten en orden FIFO', async () => {
    // Setup: before dep12=10, after dep12=3, after dep11=0.
    const before = { warehouseBreakdown: JSON.stringify({ SKUP: { 11: 0, 12: 10 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ SKUP: { 11: 0, 12: 3 } }) };
    // ASIG_A qty=3 (T0 — más vieja) ; ASIG_B qty=4 (T1).
    const db = makeStrictMockDb({
      'pedidos/PA': {
        closedAt: null,
        clientCardCode: 'C100',
        lines: [
          {
            code: 'SKUP',
            state: 'ASIG',
            qty: 3,
            qtyOpen: 3,
            enTransito: true,
            asigAt: '2026-11-08T10:00:00Z',
            asigAtTransito: '2026-11-08T10:00:00Z',
          },
        ],
      },
      'pedidos/PB': {
        closedAt: null,
        clientCardCode: 'C200',
        lines: [
          {
            code: 'SKUP',
            state: 'ASIG',
            qty: 4,
            qtyOpen: 4,
            enTransito: true,
            asigAt: '2026-11-09T10:00:00Z',
            asigAtTransito: '2026-11-09T10:00:00Z',
          },
        ],
      },
    });
    const r = await scanCancelledTransito({ fbDb: db }, before, after);

    expect(r.errors).toEqual([]);
    expect(r.revertidas.length).toBe(2);
    // Primero PA (3u) por FIFO asigAtTransito ASC.
    expect(r.revertidas[0]).toMatchObject({ pedidoId: 'PA', qtyRevertida: 3 });
    expect(r.revertidas[1]).toMatchObject({ pedidoId: 'PB', qtyRevertida: 4 });
    // Total cancelaciones = 7 (dep12Bajo 7 - dep11Subio 0).
    const total = r.revertidas.reduce((s, x) => s + x.qtyRevertida, 0);
    expect(total).toBe(7);
    // operations_log tiene 2 entries.
    const opsLogged = db._opsLog.filter((e) => e.type === 'asig_revertida_partida_cancelada');
    expect(opsLogged.length).toBe(2);
    // Cada entry tiene qtyRevertida esperado.
    expect(opsLogged.map((e) => e.qtyRevertida).sort()).toEqual([3, 4]);
  });
});

describe('v8 §E2 follow-up — T-reconcile-mientras-pablo-asigna', () => {
  it('ingresos_reparto source=dep12 in_progress con assignments NO se duplica; se saltea con motivo', async () => {
    // Setup: ya hay un ingreso dep12 pending/in_progress con assignments (Pablo está asignando).
    const before = { warehouseBreakdown: JSON.stringify({ SKUQ: { 11: 0, 12: 5 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ SKUQ: { 11: 0, 12: 10 } }) }; // sube +5
    const db = makeStrictMockDb({
      // Ingreso previo en modal Reparto (Pablo asignando).
      'ingresos_reparto/EXISTENTE_IR1': {
        sku: 'SKUQ',
        source: 'dep12',
        warehouse: 12,
        status: 'in_progress',
        assignments: [{ cardCode: 'C001', qty: 3 }],
        clientesBO: [{ cardCode: 'C001', qtyBackorder: 3, clientName: 'ACME' }],
        qtyIngresada: 5,
        detectedAt: '2026-11-15T10:00:00Z',
      },
      // Pedido BO para que haya demanda.
      'pedidos/PX1': {
        closedAt: null,
        clientCardCode: 'C001',
        clientName: 'ACME',
        lines: [{ code: 'SKUQ', state: 'BO', qty: 3, qtyOpen: 3 }],
      },
      // Flag ON para activar el camino dep12.
      'app_config/feature_flags': { dep12_reparto_enabled: true },
    });

    const r = await createIngresosRepartoFromDelta({ fbDb: db }, before, after);

    // El reconcile NO crea un nuevo ingreso dep12.
    const dep12Created = r.created.filter((id) => {
      const d = db._docsByPath.get('ingresos_reparto/' + id);
      return d && d.source === 'dep12';
    });
    expect(dep12Created.length).toBe(0);

    // skipped[] incluye motivo "ya existe ingreso dep12 pendiente".
    const skipped = r.skipped.find(
      (s) => s.sku && s.sku.includes('SKUQ') && /ya existe/i.test(s.reason)
    );
    expect(skipped).toBeTruthy();

    // El ingreso EXISTENTE queda intacto — assignments preservados.
    const existente = db._docsByPath.get('ingresos_reparto/EXISTENTE_IR1');
    expect(existente.status).toBe('in_progress');
    expect(existente.assignments).toEqual([{ cardCode: 'C001', qty: 3 }]);
  });
});

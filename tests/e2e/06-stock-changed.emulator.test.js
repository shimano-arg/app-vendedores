/**
 * P2-A.a T10 — STOCK_CHANGED: VDE pide más cantidad que stock libre.
 *
 * Verifica que commitPedidoCore devuelve ok:false + errorCode:'STOCK_CHANGED'
 * cuando la cantidad solicitada supera el stock libre disponible.
 *
 * Este test usa el mock interno de commitPedidoCore (no requiere emulador)
 * pero sigue el §40.8 skip pattern para ser coherente con la suite E2E.
 *
 * Para la validación end-to-end completa (via CF real), ejecutar con
 * `firebase emulators:exec --only functions,firestore,auth "npm run test:e2e"`.
 *
 * Cobertura adicional en:
 *   tests/functions/commit-pedido-stock-changed-fix.test.js
 *   tests/functions/commit-pedido-stock-changed-retry.test.js
 *
 * S-7 / 2026-11-25
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

const NOW = new Date('2026-11-25T15:00:00.000Z');
const TEST_SKU = 'TEST-SKU-9691';

/**
 * Fixture mínimo para commitPedidoCore con stock controlado.
 * @param {number} stockLibre - unidades disponibles en dep 11
 */
function makeFixture(stockLibre) {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => NOW.getTime() - 60_000 }, // 1 min atrás
        warehouseBreakdown: { [TEST_SKU]: { 11: stockLibre } },
      },
    },
    pedidos: {},
    stock_snapshot: {
      [TEST_SKU]: {
        sku: TEST_SKU,
        asignadas: { total: 0, byClient: {} },
        backorderApp: { total: 0, byClient: {} },
      },
    },
    ingresos_reparto: {},
    revision_waitlist: {},
    pedido_draft_locks: {},
    roles: { 'test-vde-gonzalo': { role: 'vendedor', vendor: 'TEST-VDE-GONZALO' } },
  };
}

function makeMockDb(state) {
  const makeDoc = (col, id) => ({
    id,
    _path: `${col}/${id}`,
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d ?? null };
    },
    async set(data, opts) {
      state[col] ??= {};
      state[col][id] = opts?.merge ? { ...(state[col][id] ?? {}), ...data } : { ...data };
    },
    async update(data) {
      state[col] ??= {};
      state[col][id] = { ...(state[col][id] ?? {}), ...data };
    },
    async delete() {
      if (state[col]) delete state[col][id];
    },
  });
  const makeCol = (col, filters = []) => ({
    where(f, op, v) {
      return makeCol(col, [...filters, { f, op, v }]);
    },
    limit() {
      return this;
    },
    orderBy() {
      return this;
    },
    doc(id) {
      return makeDoc(col, id ?? 'auto_' + Math.random().toString(36).slice(2));
    },
    add(d) {
      const id = 'auto_' + Math.random().toString(36).slice(2);
      state[col] ??= {};
      state[col][id] = d;
      return Promise.resolve({ id });
    },
    async get() {
      let docs = Object.entries(state[col] ?? {}).map(([id, data]) => ({
        id,
        data: () => data,
        exists: true,
      }));
      for (const f of filters) {
        docs = docs.filter((d) => {
          const v = d.data()[f.f];
          if (f.op === '==') return v === f.v;
          if (f.op === 'in') return Array.isArray(f.v) && f.v.includes(v);
          return true;
        });
      }
      return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
    },
  });
  const fbDb = {
    collection: (c) => makeCol(c),
    doc(path) {
      const [c, ...rest] = path.split('/');
      return makeDoc(c, rest.join('/'));
    },
    async runTransaction(fn) {
      let hasWritten = false;
      const writes = [];
      const tx = {
        async get(ref) {
          if (hasWritten) throw new Error('§58 violation: read after write in tx');
          return ref.get();
        },
        set(ref, data, opts) {
          hasWritten = true;
          writes.push({ op: 'set', ref, data, opts });
        },
        update(ref, data) {
          hasWritten = true;
          writes.push({ op: 'update', ref, data });
        },
        delete(ref) {
          hasWritten = true;
          writes.push({ op: 'delete', ref });
        },
      };
      const r = await fn(tx);
      for (const w of writes) {
        if (w.op === 'set') await w.ref.set(w.data, w.opts);
        else if (w.op === 'update') await w.ref.update(w.data);
        else if (w.op === 'delete') await w.ref.delete();
      }
      return r;
    },
  };
  return { fbDb };
}

describe('T10 — STOCK_CHANGED: cantidad > stock libre', () => {
  it('rechaza con STOCK_CHANGED cuando se piden más unidades que las disponibles', async () => {
    const state = makeFixture(3); // solo 3 unidades libres
    const { fbDb } = makeMockDb(state);
    const result = await commitPedidoCore(
      {
        fbDb,
        callerRole: 'vendedor',
        now: () => NOW,
        log: () => {},
        FieldValue: { serverTimestamp: () => 'FV', delete: () => '<<deleted>>' },
      },
      {
        draftId: 'e2e-t10-draft-01',
        cardCode: 'TEST-C-GONZALO-001',
        clientName: 'TEST CLIENTE GONZALO',
        origen: 'manual',
        ownerUid: 'test-vde-gonzalo',
        lines: [{ sku: TEST_SKU, cantidad: 10, precio: 100 }], // pide 10, hay 3
        autoAcceptStockChange: false,
        clientVersion: 'test',
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('STOCK_CHANGED');
    // El diff debe indicar que hay más a backorder.
    expect(result.data?.diff ?? result.diff).toBeDefined();
  });

  it('acepta cuando cantidad <= stock libre (control positivo)', async () => {
    const state = makeFixture(10); // 10 unidades libres
    const { fbDb } = makeMockDb(state);
    const result = await commitPedidoCore(
      {
        fbDb,
        callerRole: 'vendedor',
        now: () => NOW,
        log: () => {},
        FieldValue: { serverTimestamp: () => 'FV', delete: () => '<<deleted>>' },
      },
      {
        draftId: 'e2e-t10-draft-02',
        cardCode: 'TEST-C-GONZALO-001',
        clientName: 'TEST CLIENTE GONZALO',
        origen: 'manual',
        ownerUid: 'test-vde-gonzalo',
        lines: [{ sku: TEST_SKU, cantidad: 3, precio: 100 }], // pide 3, hay 10
        autoAcceptStockChange: false,
        clientVersion: 'test',
      }
    );

    expect(result.ok).toBe(true);
  });
});

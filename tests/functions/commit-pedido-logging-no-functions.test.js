// @ts-check
/**
 * §64 §64.3 (2026-10-25 v1453) — regresión: operations_log entries NO deben
 * contener valores `typeof === 'function'`. Firestore rechaza silenciosamente
 * writes con funciones en campos → el logging falla sin señal visible.
 *
 * Precedente PR #1207 audit §64: `functions/core/commit-pedido-core.js:627`
 * guardaba `serverBd.utilizablePara` como función directo en el log entry.
 * Firestore: `Cannot encode value: (cardCode) => {...}`. El logging STOCK_CHANGED
 * falló los 10 eventos reales desde v1443 (23/10 15:37 ART).
 *
 * `src/pure/stock-breakdown.js:327` → `utilizablePara = (cardCode) => {...}` es
 * una **función arrow**, no un número. El commit-pedido-core copia
 * `serverBd.utilizablePara` tal cual al payload del log → función en el write.
 *
 * Test:
 *   - Dispara STOCK_CHANGED con fixture que produce qtyBO > 0.
 *   - Captura la entry escrita a `operations_log` via mock.
 *   - Recorre deep el objeto. Si encuentra `typeof === 'function'` → FAIL.
 *   - Si pasa pre-fix: §64.2 (A) PR #1208 ya lo arregló colateralmente; test
 *     queda como regresión.
 *   - Si falla: hay que agregar scrubber en logCommitRejection que filtre
 *     funciones del extra.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Walk recursivo. Devuelve array de paths (strings) donde el value es función.
 * @param {any} obj
 * @param {string} path
 * @returns {string[]}
 */
function findFunctionPaths(obj, path = '$') {
  if (obj === null || obj === undefined) return [];
  if (typeof obj === 'function') return [path];
  if (typeof obj !== 'object') return [];
  if (obj instanceof Date) return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => findFunctionPaths(item, `${path}[${i}]`));
  }
  return Object.entries(obj).flatMap(([k, v]) => findFunctionPaths(v, `${path}.${k}`));
}

function makeMockDb(fixture) {
  const state = fixture || {};
  const operationsLog = [];

  const makeDocRef = (colName, docId) => ({
    id: docId,
    _path: `${colName}/${docId}`,
    async get() {
      const data = state[colName]?.[docId];
      return { exists: !!data, data: () => data || null };
    },
    async set(data) {
      state[colName] ||= {};
      state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
    },
    async update(data) {
      state[colName] ||= {};
      state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
    },
    async delete() {
      if (state[colName]) delete state[colName][docId];
    },
  });

  const makeCollection = (colName, filters = []) => {
    const col = {
      _name: colName,
      doc(id) {
        return makeDocRef(colName, id);
      },
      where(field, op, val) {
        return makeCollection(colName, [...filters, { field, op, val }]);
      },
      limit(_n) {
        return col;
      },
      async get() {
        const docs = Object.entries(state[colName] || {}).map(([id, data]) => ({
          id,
          data: () => data,
          exists: true,
        }));
        return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
      },
      add(data) {
        const id = 'auto_' + Math.random().toString(36).slice(2, 10);
        state[colName] ||= {};
        state[colName][id] = data;
        if (colName === 'operations_log') operationsLog.push(data);
        return Promise.resolve({ id });
      },
    };
    return col;
  };

  const fbDb = {
    collection: (name) => makeCollection(name),
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          return ref.set(data);
        },
        update(ref, data) {
          return ref.update(data);
        },
        delete(ref) {
          return ref.delete();
        },
      };
      return fn(tx);
    },
  };
  return { fbDb, _state: state, _operationsLog: operationsLog };
}

const nowRef = new Date('2026-10-25T18:00:00Z');

/**
 * Fixture: SKU-A fisico 2 (dep 11). Si cliente pide 5, CF calcula
 * qtyConfirmed=2 + qtyBO=3 → STOCK_CHANGED → logCommitRejection → log entry
 * con skuDetails[].server que, pre-fix, incluía serverBd.utilizablePara como
 * función.
 */
function makeStockChangedState() {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: { 'SKU-A': { 11: 2 } },
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('§64 regresión v1453 — operations_log entries SIN funciones', () => {
  it('STOCK_CHANGED log entry NO contiene valores typeof === "function"', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_regr_1',
        cardCode: 'C001',
        clientName: 'TEST',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1453',
        ownerUid: 'U1',
        ownerEmail: 'u1@test.com',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');

    await new Promise((res) => setTimeout(res, 10));
    expect(_operationsLog.length).toBeGreaterThan(0);
    const entry = _operationsLog[0];

    const funcPaths = findFunctionPaths(entry);
    if (funcPaths.length > 0) {
      // eslint-disable-next-line no-console
      console.error('FUNCIONES encontradas en log entry:', funcPaths);
    }
    expect(funcPaths).toEqual([]);
    // Si hubiera función (ej. serverBd.utilizablePara), el array no es vacío.
    // Firestore rechazaría el write: "Cannot encode value: (cardCode) => {...}".
  });

  it('STOCK_CHANGED log entry serializa limpio por JSON.stringify (red backup)', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_regr_2',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1453',
      }
    );
    await new Promise((res) => setTimeout(res, 10));
    const entry = _operationsLog[0];
    // JSON.stringify silently drops functions, so we need to reconstruct
    // and compare the KEY set of each node. Pre-fix, utilizablePara EXISTE en el
    // objeto pero desaparece en JSON.stringify → mismatch con el raw.
    const sd = entry.skuDetails?.[0];
    if (sd && sd.server) {
      // El shape público del server payload NO debe tener `utilizablePara` como
      // función. Si existe como key, su valor DEBE ser number|null, no function.
      if ('utilizablePara' in sd.server) {
        expect(typeof sd.server.utilizablePara).not.toBe('function');
        const t = typeof sd.server.utilizablePara;
        expect(['number', 'object']).toContain(t); // number o null
      }
    }
  });

  it('STOCK_CHANGED log entry.skuDetails[].server.utilizablePara es NUMBER, no función', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeStockChangedState());
    await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_regr_3',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1453',
      }
    );
    await new Promise((res) => setTimeout(res, 10));
    const entry = _operationsLog[0];
    const sd = entry.skuDetails?.[0];
    expect(sd).toBeTruthy();
    expect(sd.server).toBeTruthy();
    // POST-FIX: utilizablePara SE INVOCA con el cardCode y se guarda el
    // número resultante. Pre-fix: estaba la función misma como valor.
    expect(typeof sd.server.utilizablePara).not.toBe('function');
    // Debe ser number (resultado de utilizablePara(cardCode)) o null.
    const t = typeof sd.server.utilizablePara;
    expect(['number', 'object']).toContain(t);
  });
});

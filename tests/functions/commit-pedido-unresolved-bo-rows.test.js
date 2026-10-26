// @ts-check
/**
 * Tarea L (v1457 2026-10-25) — Tests del gate UNRESOLVED_BO_ENTRY_ROWS en
 * `commitPedidoCore`.
 *
 * El CF rechaza si llegan líneas con `boEntryResolved===null`. Verifica que
 * los otros valores (undefined / 'same' / 'additional') pasan sin problemas.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

const nowRef = new Date('2026-10-25T12:00:00Z');

/**
 * Mock mínimo de Firestore con las operaciones que la CF usa en los primeros
 * pasos (versión mínima — solo necesitamos llegar hasta el gate L).
 */
function makeMockDb() {
  const state = {
    app_config: {},
    pedidos: {},
    pedido_draft_locks: {},
    revision_waitlist: {},
    stock_snapshot: {},
    operations_log: {},
  };
  const written = [];
  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _path: key,
      async get() {
        const data = state[colName]?.[docId];
        return { exists: !!data, data: () => data || null };
      },
      async set(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'set', path: key, data });
      },
      async update(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'update', path: key, data });
      },
    };
  };
  const makeCollection = (colName, filters = []) => {
    const col = {
      _name: colName,
      where(field, op, val) {
        return makeCollection(colName, [...filters, { field, op, val }]);
      },
      limit() {
        return col;
      },
      doc(id) {
        return makeDocRef(colName, id || 'auto_' + Math.random().toString(36).slice(2, 10));
      },
      async get() {
        const colData = state[colName] || {};
        let docs = Object.entries(colData).map(([id, data]) => ({
          id,
          data: () => data,
          exists: true,
        }));
        for (const f of filters) {
          docs = docs.filter((d) => {
            const val = d.data()[f.field];
            if (f.op === '==') return val === f.val;
            if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(val);
            return true;
          });
        }
        return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
      },
      async add(data) {
        state[colName] ||= {};
        const id = 'auto_' + Math.random().toString(36).slice(2, 10);
        state[colName][id] = data;
        written.push({ op: 'add', path: `${colName}/${id}`, data });
        return { id };
      },
    };
    return col;
  };
  const fbDb = {
    collection: (name) => makeCollection(name),
    doc(path) {
      const [col, id] = path.split('/');
      return makeDocRef(col, id);
    },
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
          return ref.update({ _deleted: true });
        },
      };
      return fn(tx);
    },
  };
  return { fbDb, _state: state, _written: written };
}

describe('commitPedidoCore — Tarea L UNRESOLVED_BO_ENTRY_ROWS', () => {
  it('T1: una línea con boEntryResolved=null → rechaza', async () => {
    const { fbDb } = makeMockDb();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd1',
        cardCode: 'C001',
        origen: 'manual',
        lines: [
          { sku: '9691', cantidad: 20, boEntryResolved: null, boEntryPrevio: 20 },
          { sku: '7777', cantidad: 5 },
        ],
        clientVersion: 'v1457',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('UNRESOLVED_BO_ENTRY_ROWS');
    expect(r.data.rows).toHaveLength(1);
    expect(r.data.rows[0].sku).toBe('9691');
    expect(r.data.rows[0].cantidad).toBe(20);
    expect(r.data.rows[0].boAnterior).toBe(20);
  });

  it('T2: varias líneas con boEntryResolved=null → rechaza con todas', async () => {
    const { fbDb } = makeMockDb();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd2',
        cardCode: 'C001',
        origen: 'manual',
        lines: [
          { sku: '9691', cantidad: 20, boEntryResolved: null, boEntryPrevio: 20 },
          { sku: '7777', cantidad: 5, boEntryResolved: null, boEntryPrevio: 10 },
          { sku: '8888', cantidad: 3 },
        ],
        clientVersion: 'v1457',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('UNRESOLVED_BO_ENTRY_ROWS');
    expect(r.data.rows).toHaveLength(2);
    expect(r.data.rows.map((r) => r.sku).sort()).toEqual(['7777', '9691']);
  });

  it('T3: boEntryResolved="same" → NO rechaza (pasa el gate L)', async () => {
    const { fbDb } = makeMockDb();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd3',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: '9691', cantidad: 20, boEntryResolved: 'same' }],
        clientVersion: 'v1457',
      }
    );
    // El gate L no bloquea; puede fallar por otra razón (stock, snapshot) pero
    // NO con UNRESOLVED_BO_ENTRY_ROWS.
    if (!r.ok) {
      expect(r.errorCode).not.toBe('UNRESOLVED_BO_ENTRY_ROWS');
    }
  });

  it('T4: boEntryResolved="additional" → NO rechaza', async () => {
    const { fbDb } = makeMockDb();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd4',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: '9691', cantidad: 40, boEntryResolved: 'additional' }],
        clientVersion: 'v1457',
      }
    );
    if (!r.ok) {
      expect(r.errorCode).not.toBe('UNRESOLVED_BO_ENTRY_ROWS');
    }
  });

  it('T5: boEntryResolved=undefined (default, sin BO previo) → NO rechaza', async () => {
    const { fbDb } = makeMockDb();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd5',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: '9691', cantidad: 20 }],
        clientVersion: 'v1457',
      }
    );
    if (!r.ok) {
      expect(r.errorCode).not.toBe('UNRESOLVED_BO_ENTRY_ROWS');
    }
  });

  it('T6: payload del rechazo loguea a operations_log', async () => {
    const { fbDb, _state } = makeMockDb();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd6',
        cardCode: 'C001',
        ownerUid: 'uid-vde-1',
        ownerEmail: 'vde@shimano.com.ar',
        origen: 'manual',
        lines: [{ sku: '9691', cantidad: 20, boEntryResolved: null, boEntryPrevio: 20 }],
        clientVersion: 'v1457',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('UNRESOLVED_BO_ENTRY_ROWS');
    const logEntries = Object.values(_state.operations_log || {});
    const lMatch = logEntries.find(
      (e) => e && e.type === 'commit_pedido_rejected' && e.errorCode === 'UNRESOLVED_BO_ENTRY_ROWS'
    );
    expect(lMatch).toBeTruthy();
    expect(lMatch.unresolvedCount).toBe(1);
    expect(lMatch.skus).toEqual(['9691']);
  });
});

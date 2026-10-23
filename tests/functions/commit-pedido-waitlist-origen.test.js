// @ts-check
/**
 * §57 (2026-10-23) — tests para commitPedidoCore con waitlistOrigenId.
 *
 * Reproduce bug reportado 23/10 11:37: commitPedidoCF devolvía
 * CLIENT_HAS_OPEN_WAITLIST al confirmar un pedido desde la lista de espera
 * porque encontraba la propia orden que se estaba confirmando.
 *
 * Casos:
 *   T1 — Confirmar desde waitlist X (única abierta del cliente) → OK + waitlist
 *        queda consumed/closedAt dentro de la misma transacción.
 *   T2 — Confirmar sin waitlistOrigenId cuando origen='cpst' → VALIDATION_ERROR.
 *   T3 — Confirmar con waitlistOrigenId + otra Y abierta → CLIENT_HAS_OPEN_WAITLIST
 *        con id Y (no X).
 *   T4 — origen=manual con waitlistOrigenId: también excluye self (waitlist→pending).
 *   T5 — origen=manual sin waitlistOrigenId: comportamiento histórico (chequea todas).
 *   T6 — waitlist origen inexistente: pedido se crea igual (no bloquea).
 *   T7 — Idempotencia: re-confirmar mismo draftId con waitlist ya consumed → OK.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

// Reusamos el mock DB del test de commit-pedido-core (mock simple).
function makeMockDb(fixture) {
  const state = fixture || {};
  const written = [];

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _path: key,
      async get() {
        const data = state[colName]?.[docId];
        return {
          exists: !!data,
          data: () => data || null,
        };
      },
      async set(data, _opts) {
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
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn) => docs.forEach(fn),
        };
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
      };
      return fn(tx);
    },
  };
  return { fbDb, _state: state, _written: written };
}

const nowRef = new Date('2026-10-23T12:00:00Z');

function baseStateWithStock(sku, fisico, pedidos = []) {
  const pedidosMap = {};
  for (const p of pedidos) pedidosMap[p._fsId || p.id || 'p1'] = p;
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
        warehouseBreakdown: { [sku]: { 11: fisico } },
      },
    },
    pedidos: pedidosMap,
    stock_snapshot: {
      [sku]: {
        sku,
        asignadas: { total: 0, byClient: {} },
        backorderApp: { total: 0, byClient: {} },
      },
    },
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('v<X> §57 commitPedidoCore con waitlistOrigenId', () => {
  it('T1 — confirmar desde waitlist X única abierta → OK + waitlist consumed/closedAt in same tx', async () => {
    const state = baseStateWithStock('SKU-A', 10, []);
    state.revision_waitlist['wl_X'] = {
      clientCardCode: 'C001',
      orderNumber: 445,
      items: [{ code: 'SKU-A', qty: 3 }],
      closedAt: null,
      stage: 'pending',
    };
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T1',
        cardCode: 'C001',
        origen: 'cpst',
        lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
        clientVersion: 'v1430',
        waitlistOrigenId: 'wl_X',
      }
    );
    expect(r.ok).toBe(true);
    // Waitlist origen marcada consumed dentro de la misma transacción.
    const wlUpdate = _written.find((w) => w.path === 'revision_waitlist/wl_X' && w.op === 'update');
    expect(wlUpdate).toBeTruthy();
    expect(wlUpdate.data.stage).toBe('consumed');
    expect(wlUpdate.data.consumedByPedidoId).toBe(r.pedidoId);
    expect(wlUpdate.data.closedAt).toBeTruthy();
    expect(wlUpdate.data.closedReason).toBe('consumed_by_commitPedidoCF');
  });

  it('T2 — confirmar origen=cpst SIN waitlistOrigenId → VALIDATION_ERROR', async () => {
    const state = baseStateWithStock('SKU-A', 10, []);
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T2',
        cardCode: 'C001',
        origen: 'cpst',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1430',
        // Falta waitlistOrigenId
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
    expect(r.data.field).toBe('waitlistOrigenId');
  });

  it('T3 — confirmar X excluyéndola + otra Y abierta → CLIENT_HAS_OPEN_WAITLIST con id Y', async () => {
    const state = baseStateWithStock('SKU-A', 10, []);
    state.revision_waitlist['wl_X'] = {
      clientCardCode: 'C001',
      orderNumber: 445,
      items: [{ code: 'SKU-A', qty: 3 }],
      closedAt: null,
      stage: 'pending',
      createdAt: '2026-10-23T10:00:00Z',
    };
    state.revision_waitlist['wl_Y'] = {
      clientCardCode: 'C001',
      orderNumber: 446,
      items: [{ code: 'SKU-B', qty: 2 }],
      closedAt: null,
      stage: 'pending',
      createdAt: '2026-10-23T11:00:00Z',
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T3',
        cardCode: 'C001',
        origen: 'cpst',
        lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
        clientVersion: 'v1430',
        waitlistOrigenId: 'wl_X',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('CLIENT_HAS_OPEN_WAITLIST');
    expect(r.data.waitlistId).toBe('wl_Y');
    expect(r.data.orderNumber).toBe(446);
  });

  it('T4 — origen=manual con waitlistOrigenId (waitlist→pending flow): excluye self', async () => {
    const state = baseStateWithStock('SKU-A', 10, []);
    state.revision_waitlist['wl_X'] = {
      clientCardCode: 'C001',
      orderNumber: 445,
      items: [{ code: 'SKU-A', qty: 1 }],
      closedAt: null,
      stage: 'pending',
    };
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T4',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1430',
        waitlistOrigenId: 'wl_X',
      }
    );
    expect(r.ok).toBe(true);
    const wlUpdate = _written.find((w) => w.path === 'revision_waitlist/wl_X' && w.op === 'update');
    expect(wlUpdate).toBeTruthy();
    expect(wlUpdate.data.stage).toBe('consumed');
  });

  it('T5 — origen=manual SIN waitlistOrigenId: comportamiento histórico (todas abiertas bloquean)', async () => {
    const state = baseStateWithStock('SKU-A', 10, []);
    state.revision_waitlist['wl_X'] = {
      clientCardCode: 'C001',
      orderNumber: 445,
      items: [{}],
      closedAt: null,
      stage: 'pending',
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T5',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1430',
        // Sin waitlistOrigenId
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('CLIENT_HAS_OPEN_WAITLIST');
    expect(r.data.waitlistId).toBe('wl_X');
  });

  it('T6 — waitlist origen inexistente: pedido se crea igual (no bloquea)', async () => {
    const state = baseStateWithStock('SKU-A', 10, []);
    // No existe la waitlist (ya borrada entre UI y CF).
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T6',
        cardCode: 'C001',
        origen: 'cpst',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1430',
        waitlistOrigenId: 'wl_borrada',
      }
    );
    expect(r.ok).toBe(true);
    // No se intentó update sobre la waitlist inexistente.
    const wlUpdate = _written.find((w) => w.path === 'revision_waitlist/wl_borrada');
    expect(wlUpdate).toBeFalsy();
  });

  it('T7 — idempotencia: segundo commit mismo draftId → OK sin writes nuevos', async () => {
    const state = baseStateWithStock('SKU-A', 10, []);
    state.pedidos['already_123'] = {
      _draftId: 'd_T7',
      stage: 'confirmed',
      clientCardCode: 'C001',
      lines: [{ code: 'SKU-A', qty: 1, state: 'confirmed' }],
    };
    state.revision_waitlist['wl_X'] = {
      clientCardCode: 'C001',
      items: [{}],
      closedAt: null,
      stage: 'consumed', // Ya fue consumed por el commit anterior.
      consumedByPedidoId: 'already_123',
    };
    const { fbDb, _written } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T7',
        cardCode: 'C001',
        origen: 'cpst',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1430',
        waitlistOrigenId: 'wl_X',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBe('already_123');
    expect(r.idempotentHit).toBe(true);
    // No se escribe nada nuevo en pedidos.
    const pedidoWrites = _written.filter((w) => w.path.startsWith('pedidos/') && w.op === 'set');
    expect(pedidoWrites.length).toBe(0);
  });

  it('T8 — pedido pre-§57 (sin waitlistOrigenId en el payload) + waitlist propia abierta → bug reportado 23/10 11:37', async () => {
    // Repro del bug exacto: antes del fix, un pedido viniendo de waitlist
    // (origen=cpst) sin pasar waitlistOrigenId encontraba su propia
    // waitlist y disparaba CLIENT_HAS_OPEN_WAITLIST false positive.
    // Después del fix: la ausencia es VALIDATION_ERROR explícito (nunca
    // adivinar). El cliente SIEMPRE debe mandar waitlistOrigenId cuando
    // origen=cpst.
    const state = baseStateWithStock('SKU-A', 10, []);
    state.revision_waitlist['wl_self'] = {
      clientCardCode: 'C001',
      orderNumber: 524,
      items: [{ code: 'SKU-A', qty: 1 }],
      closedAt: null,
      stage: 'pending', // La waitlist propia aún no marcada consumed
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_T8_bug_repro',
        cardCode: 'C001',
        origen: 'cpst',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1430',
        // Falta waitlistOrigenId → el cliente DEBE mandarlo.
      }
    );
    // Después del fix: NO devuelve CLIENT_HAS_OPEN_WAITLIST (ya no es false
    // positive), devuelve VALIDATION_ERROR para que el bug se note en el
    // deploy del cliente antes de llegar a producción.
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
  });
});

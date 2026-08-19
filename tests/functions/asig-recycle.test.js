import { describe, expect, it, vi } from 'vitest';
import { _test, updateAsigLineState } from '../../functions/core/asig-recycle-core.js';

function makeFakeFbDb(pedidos = []) {
  const store = { pedidos: [...pedidos] };
  const writes = [];
  return {
    _writes: writes,
    _store: store,
    collection(name) {
      const parent = this;
      return {
        doc(id) {
          return parent.doc(`${name}/${id}`);
        },
      };
    },
    doc(path) {
      const self = this;
      return {
        _path: path,
        async get() {
          if (!path.startsWith('pedidos/')) return { exists: false, data: () => ({}) };
          const id = path.split('/')[1];
          const p = store.pedidos.find((x) => x.id === id);
          return { exists: !!p, data: () => (p ? p.data : {}) };
        },
        async update(data) {
          if (!path.startsWith('pedidos/')) return;
          const id = path.split('/')[1];
          const p = store.pedidos.find((x) => x.id === id);
          if (p) p.data = { ...p.data, ...data };
          writes.push({ type: 'update', path, data });
        },
      };
    },
    async runTransaction(fn) {
      // Fake tx: pasa un objeto con get/update que operan directo sobre store.
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, data) {
          const path = ref._path;
          if (!path || !path.startsWith('pedidos/')) return;
          const id = path.split('/')[1];
          const p = store.pedidos.find((x) => x.id === id);
          if (p) p.data = { ...p.data, ...data };
          writes.push({ type: 'update', path, data });
        },
      };
      return fn(tx);
    },
  };
}

function _pedido(overrides = {}) {
  return {
    id: 'P1',
    data: {
      clientCardCode: 'C001',
      closedAt: null,
      lines: [
        {
          code: 'SKU-A',
          qty: 10,
          qtyOpen: 10,
          qtyInvoiced: 0,
          qtyCancelled: 0,
          qtyRecycled: 0,
          state: 'ASIG',
          asigAt: '2026-08-19T14:00:00Z',
        },
        {
          code: 'SKU-B',
          qty: 3,
          qtyOpen: 0,
          qtyInvoiced: 3,
          qtyCancelled: 0,
          qtyRecycled: 0,
          state: 'invoiced',
        },
      ],
      ...overrides,
    },
  };
}

const AUTH_OK = { uid: 'u1', email: 'admin@shimano.com.ar' };

describe('_isShimanoEmail', () => {
  it('acepta @shimano.com.ar y @shimano.uy', () => {
    expect(_test._isShimanoEmail('a@shimano.com.ar')).toBe(true);
    expect(_test._isShimanoEmail('a@shimano.uy')).toBe(true);
    expect(_test._isShimanoEmail('A@Shimano.com.ar')).toBe(true);
  });
  it('rechaza otros dominios', () => {
    expect(_test._isShimanoEmail('a@gmail.com')).toBe(false);
    expect(_test._isShimanoEmail('a@shimano.co')).toBe(false);
    expect(_test._isShimanoEmail('')).toBe(false);
    expect(_test._isShimanoEmail(null)).toBe(false);
  });
});

describe('updateAsigLineState — auth', () => {
  it('sin auth: throws unauthenticated', async () => {
    const deps = { fbDb: makeFakeFbDb([_pedido()]), log: vi.fn() };
    await expect(
      updateAsigLineState(deps, null, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 0,
        qty: 5,
        action: 'recycled',
      })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('email no-shimano: throws permission-denied', async () => {
    const deps = { fbDb: makeFakeFbDb([_pedido()]), log: vi.fn() };
    await expect(
      updateAsigLineState(
        deps,
        { uid: 'x', email: 'x@gmail.com' },
        {
          sourcePedidoId: 'P1',
          sourceLineIndex: 0,
          qty: 5,
          action: 'recycled',
        }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('updateAsigLineState — input validation', () => {
  it('qty <= 0: throws invalid-argument', async () => {
    const deps = { fbDb: makeFakeFbDb([_pedido()]), log: vi.fn() };
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 0,
        qty: 0,
        action: 'recycled',
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('action invalido: throws invalid-argument', async () => {
    const deps = { fbDb: makeFakeFbDb([_pedido()]), log: vi.fn() };
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 0,
        qty: 5,
        action: 'foo',
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('updateAsigLineState — pedido not found / already closed', () => {
  it('pedido inexistente: throws not-found', async () => {
    const deps = { fbDb: makeFakeFbDb([]), log: vi.fn() };
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'FANTASMA',
        sourceLineIndex: 0,
        qty: 1,
        action: 'recycled',
      })
    ).rejects.toMatchObject({ code: 'not-found' });
  });
  it('pedido ya cerrado: throws failed-precondition', async () => {
    const p = _pedido({ closedAt: '2026-08-01T00:00:00Z' });
    const deps = { fbDb: makeFakeFbDb([p]), log: vi.fn() };
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 0,
        qty: 1,
        action: 'recycled',
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('linea inexistente: throws not-found', async () => {
    const deps = { fbDb: makeFakeFbDb([_pedido()]), log: vi.fn() };
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 99,
        qty: 1,
        action: 'recycled',
      })
    ).rejects.toMatchObject({ code: 'not-found' });
  });
  it('linea con state != ASIG: throws failed-precondition', async () => {
    const deps = { fbDb: makeFakeFbDb([_pedido()]), log: vi.fn() };
    // lineIndex=1 tiene state='invoiced'
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 1,
        qty: 1,
        action: 'recycled',
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('qty > qtyOpen: throws failed-precondition', async () => {
    const deps = { fbDb: makeFakeFbDb([_pedido()]), log: vi.fn() };
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 0,
        qty: 11,
        action: 'recycled',
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('updateAsigLineState — recycle', () => {
  it('parcial: qtyOpen baja, qtyRecycled sube, state sigue ASIG', async () => {
    const fbDb = makeFakeFbDb([_pedido()]);
    const deps = { fbDb, log: vi.fn() };
    const r = await updateAsigLineState(deps, AUTH_OK, {
      sourcePedidoId: 'P1',
      sourceLineIndex: 0,
      qty: 4,
      action: 'recycled',
      targetPedidoId: 'P_NEW',
    });
    expect(r).toMatchObject({
      success: true,
      action: 'recycled',
      qtyApplied: 4,
      pedidoClosed: false,
    });
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyOpen).toBe(6);
    expect(p.lines[0].qtyRecycled).toBe(4);
    expect(p.lines[0].state).toBe('ASIG'); // parcial, sigue abierto
    expect(p.lines[0].recycledIntoPedidoId).toBe('P_NEW');
    expect(p.closedAt).toBeNull();
  });

  it('total: qtyOpen=0, state=recycled, cierra pedido si es la ultima linea abierta', async () => {
    const fbDb = makeFakeFbDb([_pedido()]);
    const deps = { fbDb, log: vi.fn() };
    const r = await updateAsigLineState(deps, AUTH_OK, {
      sourcePedidoId: 'P1',
      sourceLineIndex: 0,
      qty: 10,
      action: 'recycled',
      targetPedidoId: 'P_NEW',
    });
    expect(r.pedidoClosed).toBe(true);
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyOpen).toBe(0);
    expect(p.lines[0].state).toBe('recycled');
    expect(p.closedAt).toBeTruthy();
    expect(p.closedReason).toMatch(/recycled|cancelled|invoiced/);
  });

  it('sin targetPedidoId: no set recycledIntoPedidoId', async () => {
    const fbDb = makeFakeFbDb([_pedido()]);
    const deps = { fbDb, log: vi.fn() };
    await updateAsigLineState(deps, AUTH_OK, {
      sourcePedidoId: 'P1',
      sourceLineIndex: 0,
      qty: 5,
      action: 'recycled',
    });
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].recycledIntoPedidoId).toBeUndefined();
  });
});

describe('updateAsigLineState — cancel/reject', () => {
  it('parcial: qtyOpen baja, qtyCancelled sube, state sigue ASIG', async () => {
    const fbDb = makeFakeFbDb([_pedido()]);
    const deps = { fbDb, log: vi.fn() };
    const r = await updateAsigLineState(deps, AUTH_OK, {
      sourcePedidoId: 'P1',
      sourceLineIndex: 0,
      qty: 3,
      action: 'cancelled',
    });
    expect(r).toMatchObject({ action: 'cancelled', qtyApplied: 3, pedidoClosed: false });
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyOpen).toBe(7);
    expect(p.lines[0].qtyCancelled).toBe(3);
    expect(p.lines[0].state).toBe('ASIG');
    expect(p.closedAt).toBeNull();
  });

  it('total: state=cancelled, cierra pedido si es la ultima linea abierta', async () => {
    const fbDb = makeFakeFbDb([_pedido()]);
    const deps = { fbDb, log: vi.fn() };
    const r = await updateAsigLineState(deps, AUTH_OK, {
      sourcePedidoId: 'P1',
      sourceLineIndex: 0,
      qty: 10,
      action: 'cancelled',
    });
    expect(r.pedidoClosed).toBe(true);
    const p = fbDb._store.pedidos[0].data;
    expect(p.lines[0].qtyOpen).toBe(0);
    expect(p.lines[0].state).toBe('cancelled');
    expect(p.closedAt).toBeTruthy();
  });

  it('rerun con misma qty (post-cancel): throws (linea ya cancelled, no ASIG)', async () => {
    const fbDb = makeFakeFbDb([_pedido()]);
    const deps = { fbDb, log: vi.fn() };
    await updateAsigLineState(deps, AUTH_OK, {
      sourcePedidoId: 'P1',
      sourceLineIndex: 0,
      qty: 10,
      action: 'cancelled',
    });
    // Segundo call falla porque state='cancelled' ya no es 'ASIG'
    await expect(
      updateAsigLineState(deps, AUTH_OK, {
        sourcePedidoId: 'P1',
        sourceLineIndex: 0,
        qty: 1,
        action: 'cancelled',
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('updateAsigLineState — pedido con multiples lineas abiertas', () => {
  it('no cierra pedido si otras lineas siguen abiertas', async () => {
    const p = _pedido();
    // Agregar una segunda linea ASIG abierta
    p.data.lines.push({
      code: 'SKU-C',
      qty: 5,
      qtyOpen: 5,
      qtyInvoiced: 0,
      qtyCancelled: 0,
      qtyRecycled: 0,
      state: 'ASIG',
    });
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, log: vi.fn() };
    const r = await updateAsigLineState(deps, AUTH_OK, {
      sourcePedidoId: 'P1',
      sourceLineIndex: 0,
      qty: 10,
      action: 'recycled',
    });
    expect(r.pedidoClosed).toBe(false);
    const pd = fbDb._store.pedidos[0].data;
    expect(pd.closedAt).toBeNull();
    expect(pd.lines[2].state).toBe('ASIG'); // segunda ASIG intacta
    expect(pd.lines[2].qtyOpen).toBe(5);
  });
});

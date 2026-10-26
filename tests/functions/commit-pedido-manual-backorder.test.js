// @ts-check
/**
 * §67 (2026-10-25 v1454) — commitPedidoCore / origen='manual_backorder'.
 *
 * Suite cubriendo la migración de `_gbConfirmar` (Generar Backorder manual)
 * a `commitPedidoCF`:
 *
 * T1 — payload básico con linesPrebuilt (state=BO) crea pedido con
 *      transferidoSAP.skipSap=true, source='manual-backorder',
 *      _commitVersion='commitPedidoCore_v1'.
 * T2 — mix ASIG + BO en linesPrebuilt preserva cada line + state.
 * T3 — 4 roles (admin, gerente, interno, vendedor) escriben con el mismo
 *      flow (el core no discrimina por rol — el wrapper CF ya pasó auth).
 * T4 — idempotencia por draftId: segundo call con mismo draftId devuelve
 *      pedidoId del primero.
 * T5 — no corre CLIENT_HAS_OPEN_WAITLIST aunque haya waitlists abiertas
 *      del cliente (flow paralelo).
 * T6 — valida cardCode requerido (via validatePayload).
 * T7 — linesPrebuilt vacío → VALIDATION_ERROR.
 * T8 — linesPrebuilt con state inválido ('cancelled') → se filtra;
 *      si todo filtrado → VALIDATION_ERROR.
 * T9 — netAmountArs/subtotalArs incluyen ASIG + BO (gross).
 * T10 — key/tipo/province/locName/clientProvince/clientLocality/orderNumber
 *       se preservan en el doc final.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

const nowRef = new Date('2026-10-25T18:00:00Z');

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

function baseState() {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
        warehouseBreakdown: {},
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
    pedido_draft_locks: {},
  };
}

function buildBasePayload(overrides = {}) {
  return {
    draftId: 'gb|' + Math.random().toString(36).slice(2),
    cardCode: 'C001',
    clientName: 'TEST CLIENTE',
    origen: 'manual_backorder',
    lines: [{ sku: 'SKUX', cantidad: 2 }], // obligatorio por validatePayload
    linesPrebuilt: [
      {
        code: 'SKUX',
        qty: 2,
        qtyOpen: 2,
        state: 'BO',
        precio: 1000,
        priceAtCreation: 1000,
        manualBackorder: true,
        asigAt: null,
      },
    ],
    skipSap: true,
    clientVersion: 'v1454',
    key: 'C||TEST CLIENTE',
    tipo: 'C',
    province: '',
    locName: '',
    orderNumber: 999,
    ...overrides,
  };
}

describe('commitPedidoCore — §67 manual_backorder (v1454)', () => {
  it('T1 — crea pedido con transferidoSAP.skipSap=true + _commitVersion + source=manual-backorder', async () => {
    const { fbDb, _state, _written } = makeMockDb(baseState());
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, buildBasePayload());
    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBeTruthy();
    const pedidoWrite = _written.find(
      (w) => w.op === 'set' && w.path.startsWith('pedidos/') && w.data._commitVersion
    );
    expect(pedidoWrite).toBeTruthy();
    expect(pedidoWrite.data._commitVersion).toBe('commitPedidoCore_v1');
    expect(pedidoWrite.data.source).toBe('manual-backorder');
    expect(pedidoWrite.data.transferidoSAP).toEqual(
      expect.objectContaining({
        via: 'manual-backorder',
        skipSap: true,
        docNum: null,
        docEntry: null,
      })
    );
    expect(pedidoWrite.data.origen).toBe('manual_backorder');
    expect(pedidoWrite.data.stage).toBe('confirmed');
    expect(pedidoWrite.data.schemaVersion).toBe(2);
  });

  it('T2 — mix ASIG + BO preserva state + asigAt + asigReserva + qty + priceAtCreation', async () => {
    const { fbDb, _written } = makeMockDb(baseState());
    const payload = buildBasePayload({
      linesPrebuilt: [
        {
          code: 'A',
          qty: 3,
          qtyOpen: 3,
          state: 'ASIG',
          asigReserva: true,
          asigAt: '2026-10-25T18:00:00Z',
          asigCliTipo: 'manual-backorder',
          precio: 500,
          priceAtCreation: 500,
          manualBackorder: true,
        },
        {
          code: 'B',
          qty: 5,
          qtyOpen: 5,
          state: 'BO',
          precio: 200,
          priceAtCreation: 200,
          manualBackorder: true,
          asigAt: null,
        },
      ],
      lines: [
        { sku: 'A', cantidad: 3 },
        { sku: 'B', cantidad: 5 },
      ],
    });
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);
    const pedidoWrite = _written.find(
      (w) => w.op === 'set' && w.path.startsWith('pedidos/') && w.data.lines
    );
    expect(pedidoWrite.data.lines).toHaveLength(2);
    const a = pedidoWrite.data.lines.find((l) => l.code === 'A');
    expect(a).toEqual(
      expect.objectContaining({
        state: 'ASIG',
        asigReserva: true,
        asigAt: '2026-10-25T18:00:00Z',
        asigCliTipo: 'manual-backorder',
        qty: 3,
        qtyOpen: 3,
      })
    );
    const b = pedidoWrite.data.lines.find((l) => l.code === 'B');
    expect(b).toEqual(expect.objectContaining({ state: 'BO', qty: 5, qtyOpen: 5, asigAt: null }));
  });

  it('T3 — admin / gerente / interno / vendedor: todos pasan por el mismo core (ownerUid respetado)', async () => {
    for (const [role, uid] of [
      ['admin', 'adm_uid'],
      ['gerente', 'ger_uid'],
      ['interno', 'int_uid'],
      ['vendedor', 'vde_uid'],
    ]) {
      const { fbDb, _written } = makeMockDb(baseState());
      const payload = buildBasePayload({
        ownerUid: uid,
        ownerEmail: `${role}@shimano.com.ar`,
        ownerVendor: role === 'vendedor' ? 'MAURICIO GIL' : null,
      });
      const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
      expect(r.ok).toBe(true);
      const pedidoWrite = _written.find(
        (w) => w.op === 'set' && w.path.startsWith('pedidos/') && w.data._commitVersion
      );
      expect(pedidoWrite.data.ownerUid).toBe(uid);
      expect(pedidoWrite.data.ownerEmail).toBe(`${role}@shimano.com.ar`);
      expect(pedidoWrite.data._commitVersion).toBe('commitPedidoCore_v1');
    }
  });

  it('T4 — idempotencia por draftId: segundo call devuelve mismo pedidoId', async () => {
    const { fbDb } = makeMockDb(baseState());
    const payload = buildBasePayload();
    const r1 = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r1.ok).toBe(true);
    const r2 = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r2.ok).toBe(true);
    expect(r2.pedidoId).toBe(r1.pedidoId);
    expect(r2.idempotentHit).toBe(true);
  });

  it('T5 — NO corre CLIENT_HAS_OPEN_WAITLIST aunque haya waitlist abierta del cliente', async () => {
    const state = baseState();
    state.revision_waitlist = {
      wl_abierta: {
        _id: 'wl_abierta',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'draft',
        items: [{ code: 'OTRO', qty: 1 }],
        orderNumber: 500,
      },
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, buildBasePayload());
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
  });

  it('T6 — rechaza payload sin cardCode', async () => {
    const { fbDb } = makeMockDb(baseState());
    const payload = buildBasePayload({ cardCode: '' });
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
  });

  it('T7 — rechaza linesPrebuilt vacío', async () => {
    const { fbDb } = makeMockDb(baseState());
    const payload = buildBasePayload({ linesPrebuilt: [] });
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
    expect(r.data.field).toBe('linesPrebuilt');
  });

  it('T8 — linesPrebuilt con state inválido se filtran; si todo filtrado → VALIDATION_ERROR', async () => {
    const { fbDb } = makeMockDb(baseState());
    const payload = buildBasePayload({
      linesPrebuilt: [
        { code: 'A', qty: 1, qtyOpen: 1, state: 'cancelled', precio: 100 },
        { code: 'B', qty: 0, qtyOpen: 0, state: 'BO', precio: 100 },
      ],
    });
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
    expect(r.data.field).toBe('linesPrebuilt');
  });

  it('T9 — netAmountArs/subtotalArs incluyen ASIG + BO (gross)', async () => {
    const { fbDb, _written } = makeMockDb(baseState());
    const payload = buildBasePayload({
      linesPrebuilt: [
        {
          code: 'A',
          qty: 2,
          qtyOpen: 2,
          state: 'ASIG',
          asigReserva: true,
          precio: 1000,
          priceAtCreation: 1000,
        },
        { code: 'B', qty: 3, qtyOpen: 3, state: 'BO', precio: 500, priceAtCreation: 500 },
      ],
      lines: [
        { sku: 'A', cantidad: 2 },
        { sku: 'B', cantidad: 3 },
      ],
    });
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);
    const pedidoWrite = _written.find(
      (w) => w.op === 'set' && w.path.startsWith('pedidos/') && w.data._commitVersion
    );
    // ASIG 2×1000 + BO 3×500 = 2000 + 1500 = 3500 (gross, no filtra state=confirmed).
    expect(pedidoWrite.data.netAmountArs).toBe(3500);
    expect(pedidoWrite.data.subtotalArs).toBe(3500);
  });

  it('T10 — key / tipo / province / locName / clientProvince / clientLocality / orderNumber persisten', async () => {
    const { fbDb, _written } = makeMockDb(baseState());
    const payload = buildBasePayload({
      key: 'C|BUENOS AIRES|LA PLATA|JUAN PEREZ',
      tipo: 'C',
      province: 'BUENOS AIRES',
      locName: 'LA PLATA',
      clientProvince: 'BUENOS AIRES',
      clientLocality: 'LA PLATA',
      orderNumber: 1234,
    });
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);
    const pedidoWrite = _written.find(
      (w) => w.op === 'set' && w.path.startsWith('pedidos/') && w.data._commitVersion
    );
    expect(pedidoWrite.data.key).toBe('C|BUENOS AIRES|LA PLATA|JUAN PEREZ');
    expect(pedidoWrite.data.tipo).toBe('C');
    expect(pedidoWrite.data.province).toBe('BUENOS AIRES');
    expect(pedidoWrite.data.locName).toBe('LA PLATA');
    expect(pedidoWrite.data.clientProvince).toBe('BUENOS AIRES');
    expect(pedidoWrite.data.clientLocality).toBe('LA PLATA');
    expect(pedidoWrite.data.orderNumber).toBe(1234);
  });

  it('T11 — _commitVersion presente garantiza marker fiable para audit E10', async () => {
    const { fbDb, _written } = makeMockDb(baseState());
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, buildBasePayload());
    expect(r.ok).toBe(true);
    const pedidoWrite = _written.find((w) => w.op === 'set' && w.path.startsWith('pedidos/'));
    expect(pedidoWrite.data._commitVersion).toBe('commitPedidoCore_v1');
    expect(pedidoWrite.data._draftId).toBeTruthy();
  });
});

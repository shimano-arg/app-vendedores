import { describe, expect, it, vi } from 'vitest';
import {
  computeAssignmentsFifo,
  extractSkusWithStockIncrease,
  loadBoCandidatesForSku,
  runFifoAssign,
} from '../../functions/core/fifo-assign-core.js';

function makeFakeFbDb(initialState = {}) {
  const store = {
    syncState: initialState.syncState || null,
    pedidos: initialState.pedidos || [],
  };
  const writes = [];
  return {
    _writes: writes,
    _store: store,
    doc(path) {
      return {
        async get() {
          if (path === 'app_config/sap_sync_state') {
            return { exists: !!store.syncState, data: () => store.syncState || {} };
          }
          if (path.startsWith('pedidos/')) {
            const id = path.split('/')[1];
            const p = store.pedidos.find((x) => x.id === id);
            return { exists: !!p, data: () => (p ? p.data : {}) };
          }
          return { exists: false, data: () => ({}) };
        },
        async set(data) {
          writes.push({ type: 'set', path, data });
        },
        async update(data) {
          if (path.startsWith('pedidos/')) {
            const id = path.split('/')[1];
            const p = store.pedidos.find((x) => x.id === id);
            if (p) p.data = { ...p.data, ...data };
          }
          writes.push({ type: 'update', path, data });
        },
      };
    },
    collection(name) {
      return {
        doc(id) {
          return this._parent.doc(`${name}/${id}`);
        },
        _parent: this,
        where(field, op, value) {
          return {
            async get() {
              if (name !== 'pedidos') return { forEach: () => {} };
              const filtered = store.pedidos.filter((p) => {
                if (field === 'closedAt' && op === '==' && value === null) {
                  return !p.data.closedAt;
                }
                return true;
              });
              return {
                forEach(cb) {
                  for (const p of filtered) cb({ id: p.id, data: () => p.data });
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('extractSkusWithStockIncrease', () => {
  it('detecta SKU con delta positivo en dep 11', () => {
    const before = { warehouseBreakdown: { 'SKU-A': { 11: 5, 12: 10 } } };
    const after = { warehouseBreakdown: { 'SKU-A': { 11: 15, 12: 10 } } };
    const r = extractSkusWithStockIncrease(before, after);
    expect(r.get('SKU-A')).toBe(10);
  });

  it('ignora SKUs sin cambio o con decrement', () => {
    const before = { warehouseBreakdown: { 'SKU-A': { 11: 5 }, 'SKU-B': { 11: 20 } } };
    const after = { warehouseBreakdown: { 'SKU-A': { 11: 5 }, 'SKU-B': { 11: 10 } } };
    const r = extractSkusWithStockIncrease(before, after);
    expect(r.size).toBe(0);
  });

  it('SKU nuevo en after cuenta como delta = valor', () => {
    const before = { warehouseBreakdown: {} };
    const after = { warehouseBreakdown: { NEW: { 11: 30 } } };
    const r = extractSkusWithStockIncrease(before, after);
    expect(r.get('NEW')).toBe(30);
  });

  it('solo considera dep 11 (ignore dep 12 tránsito)', () => {
    const before = { warehouseBreakdown: { X: { 11: 0, 12: 0 } } };
    const after = { warehouseBreakdown: { X: { 11: 0, 12: 100 } } };
    const r = extractSkusWithStockIncrease(before, after);
    expect(r.size).toBe(0);
  });

  it('maneja beforeSnap null (primera vez)', () => {
    const r = extractSkusWithStockIncrease(null, { warehouseBreakdown: { X: { 11: 5 } } });
    expect(r.get('X')).toBe(5);
  });

  // v798 (2026-09-04, bug reportado por Santi): schema real en prod es JSON
  // string (sync_sap_to_firestore.py:673 serializa con json.dumps desde v368
  // para no exceder el limite de 40k index entries de Firestore). La CF
  // hacia Object.keys() directo sobre el string → indices de chars en vez de
  // SKUs → skusChecked siempre 0. Este test cubre el schema real.
  it('parsea warehouseBreakdown como JSON string (schema real prod)', () => {
    const before = {
      warehouseBreakdown: JSON.stringify({ 'SKU-A': { 11: 5 }, 'SKU-B': { 11: 20 } }),
    };
    const after = {
      warehouseBreakdown: JSON.stringify({ 'SKU-A': { 11: 15 }, 'SKU-B': { 11: 20 } }),
    };
    const r = extractSkusWithStockIncrease(before, after);
    expect(r.get('SKU-A')).toBe(10);
    expect(r.has('SKU-B')).toBe(false);
  });

  it('mezcla string y objeto (retrocompat con syncs viejos)', () => {
    const before = { warehouseBreakdown: { X: { 11: 5 } } }; // objeto viejo
    const after = { warehouseBreakdown: JSON.stringify({ X: { 11: 12 } }) }; // string nuevo
    const r = extractSkusWithStockIncrease(before, after);
    expect(r.get('X')).toBe(7);
  });

  it('warehouseBreakdown como JSON string invalido devuelve vacio (safe)', () => {
    const r = extractSkusWithStockIncrease(
      { warehouseBreakdown: 'not json' },
      { warehouseBreakdown: 'still not json' },
    );
    expect(r.size).toBe(0);
  });
});

describe('computeAssignmentsFifo', () => {
  it('FIFO estricto: primeros pedidos completos hasta agotar stock', () => {
    const candidates = [
      { pedidoId: 'P1', createdAtMs: 1, lineIndex: 0, qtyOpen: 5, clientCardCode: 'C1' },
      { pedidoId: 'P2', createdAtMs: 2, lineIndex: 0, qtyOpen: 3, clientCardCode: 'C2' },
      { pedidoId: 'P3', createdAtMs: 3, lineIndex: 0, qtyOpen: 10, clientCardCode: 'C3' },
    ];
    // Stock=18 cabe justo los 3 (5+3+10=18).
    const r = computeAssignmentsFifo(candidates, 18);
    expect(r.assignments).toHaveLength(3);
    expect(r.assignments.map((a) => a.pedidoId)).toEqual(['P1', 'P2', 'P3']);
    expect(r.remaining).toBe(0);
  });

  it('FIFO estricto: stock intermedio, ultimo pedido no cabe', () => {
    const candidates = [
      { pedidoId: 'P1', createdAtMs: 1, lineIndex: 0, qtyOpen: 5, clientCardCode: 'C1' },
      { pedidoId: 'P2', createdAtMs: 2, lineIndex: 0, qtyOpen: 3, clientCardCode: 'C2' },
      { pedidoId: 'P3', createdAtMs: 3, lineIndex: 0, qtyOpen: 10, clientCardCode: 'C3' },
    ];
    // Stock=15: P1(5) + P2(3) = 8. Quedan 7. P3 pide 10, no cabe → break.
    const r = computeAssignmentsFifo(candidates, 15);
    expect(r.assignments).toHaveLength(2);
    expect(r.assignments.map((a) => a.pedidoId)).toEqual(['P1', 'P2']);
    expect(r.remaining).toBe(7);
  });

  it('corta cuando no alcanza para la próxima linea completa (NO parcial)', () => {
    const candidates = [
      { pedidoId: 'P1', createdAtMs: 1, lineIndex: 0, qtyOpen: 10, clientCardCode: 'C1' },
      { pedidoId: 'P2', createdAtMs: 2, lineIndex: 0, qtyOpen: 5, clientCardCode: 'C2' },
    ];
    const r = computeAssignmentsFifo(candidates, 12);
    // P1 se lleva 10 (cabe). Quedan 2. P2 pide 5 - no cabe. Corte.
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].pedidoId).toBe('P1');
    expect(r.remaining).toBe(2);
  });

  it('stock 0 → sin asignaciones', () => {
    const candidates = [
      { pedidoId: 'P1', createdAtMs: 1, lineIndex: 0, qtyOpen: 5, clientCardCode: 'C1' },
    ];
    const r = computeAssignmentsFifo(candidates, 0);
    expect(r.assignments).toEqual([]);
    expect(r.remaining).toBe(0);
  });

  it('sin candidates → sin asignaciones', () => {
    const r = computeAssignmentsFifo([], 100);
    expect(r.assignments).toEqual([]);
    expect(r.remaining).toBe(100);
  });
});

describe('loadBoCandidatesForSku', () => {
  it('carga lineas BO del sku ordenadas FIFO', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P_NUEVO',
          data: {
            clientCardCode: 'C2',
            closedAt: null,
            createdAt: '2026-08-19T12:00:00Z',
            lines: [{ code: 'SKU-X', qtyOpen: 3, state: 'BO' }],
          },
        },
        {
          id: 'P_VIEJO',
          data: {
            clientCardCode: 'C1',
            closedAt: null,
            createdAt: '2026-08-18T10:00:00Z',
            lines: [{ code: 'SKU-X', qtyOpen: 5, state: 'BO' }],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const cands = await loadBoCandidatesForSku(deps, 'SKU-X');
    expect(cands).toHaveLength(2);
    expect(cands[0].pedidoId).toBe('P_VIEJO'); // FIFO: viejo primero
    expect(cands[1].pedidoId).toBe('P_NUEVO');
  });

  it('excluye pedidos cerrados', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P_CLOSED',
          data: {
            closedAt: '2026-08-01',
            lines: [{ code: 'X', qtyOpen: 5, state: 'BO' }],
          },
        },
        {
          id: 'P_OPEN',
          data: {
            closedAt: null,
            createdAt: '2026-08-19T12:00:00Z',
            lines: [{ code: 'X', qtyOpen: 3, state: 'BO' }],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const cands = await loadBoCandidatesForSku(deps, 'X');
    expect(cands).toHaveLength(1);
    expect(cands[0].pedidoId).toBe('P_OPEN');
  });

  it('ignora lineas con state != BO', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P1',
          data: {
            closedAt: null,
            createdAt: '2026-08-19T12:00:00Z',
            lines: [
              { code: 'X', qtyOpen: 5, state: 'confirmed' },
              { code: 'X', qtyOpen: 3, state: 'ASIG' },
              { code: 'X', qtyOpen: 2, state: 'BO' },
            ],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const cands = await loadBoCandidatesForSku(deps, 'X');
    expect(cands).toHaveLength(1);
    expect(cands[0].lineIndex).toBe(2);
    expect(cands[0].qtyOpen).toBe(2);
  });
});

describe('runFifoAssign — shadow mode', () => {
  it('shadow: computa promotions pero NO modifica pedidos', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        {
          id: 'P1',
          data: {
            clientCardCode: 'C1',
            closedAt: null,
            createdAt: '2026-08-19T10:00:00Z',
            lines: [{ code: 'SKU-X', qtyOpen: 5, state: 'BO' }],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const before = { warehouseBreakdown: { 'SKU-X': { 11: 0 } } };
    const after = { warehouseBreakdown: { 'SKU-X': { 11: 10 } } };
    const r = await runFifoAssign(deps, before, after);
    expect(r.mode).toBe('shadow');
    expect(r.skusChecked).toBe(1);
    expect(r.promotions).toHaveLength(1);
    expect(r.promotions[0].sku).toBe('SKU-X');
    expect(r.promotions[0].assignments).toHaveLength(1);
    expect(r.promotions[0].assignments[0].pedidoId).toBe('P1');
    // Pedido NO fue modificado (shadow).
    expect(fbDb._store.pedidos[0].data.lines[0].state).toBe('BO');
    // Audit log escrito a stock_assignment_log_shadow.
    const audit = fbDb._writes.find((w) => w.path.startsWith('stock_assignment_log_shadow/'));
    expect(audit).toBeDefined();
    expect(audit.data.mode).toBe('shadow');
  });

  it('active mode: modifica pedido a state=ASIG + asigAt', async () => {
    const fbDb = makeFakeFbDb({
      syncState: { mode: 'active' },
      pedidos: [
        {
          id: 'P1',
          data: {
            clientCardCode: 'C1',
            closedAt: null,
            createdAt: '2026-08-19T10:00:00Z',
            lines: [{ code: 'X', qtyOpen: 5, state: 'BO' }],
          },
        },
      ],
    });
    const deps = { fbDb, log: vi.fn() };
    const before = { warehouseBreakdown: {} };
    const after = { warehouseBreakdown: { X: { 11: 10 } } };
    const r = await runFifoAssign(deps, before, after);
    expect(r.mode).toBe('active');
    // Pedido SI fue modificado.
    expect(fbDb._store.pedidos[0].data.lines[0].state).toBe('ASIG');
    expect(fbDb._store.pedidos[0].data.lines[0].asigAt).toBeDefined();
    // Audit log a stock_assignment_log (no shadow).
    const audit = fbDb._writes.find((w) => w.path.startsWith('stock_assignment_log/'));
    expect(audit).toBeDefined();
  });

  it('sin cambio en dep 11 → skusChecked=0', async () => {
    const fbDb = makeFakeFbDb();
    const deps = { fbDb, log: vi.fn() };
    const r = await runFifoAssign(deps, { warehouseBreakdown: {} }, { warehouseBreakdown: {} });
    expect(r.skusChecked).toBe(0);
    expect(r.promotions).toEqual([]);
  });
});

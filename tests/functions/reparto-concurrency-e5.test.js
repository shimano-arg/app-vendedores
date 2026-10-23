// @ts-check
/**
 * E5 §stock-servidor-atomico (v1433) — reparto concurrencia hardening.
 *
 * Valida que `applyRepartoManualCore` relee el stock_snapshot DENTRO de la
 * txn por línea y aborta si:
 * 1) fisicoDep11 bajó entre pre-tx y la txn (G1.G02 race).
 * 2) ASIG actual + nuevaAsig > fisicoDep11 actual (sobre-reparto).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyRepartoManualCore } from '../../functions/core/reparto-core.js';

function makeDeps({ ingresoDoc, pedidoDoc, stockSnapshotPreTx, stockSnapshotInTx }) {
  const state = {
    pedidos: { [pedidoDoc._fsId]: pedidoDoc },
    ingresos_reparto: { [ingresoDoc._fsId]: ingresoDoc },
  };
  // El stock snapshot cambia entre pre-tx y el runTransaction.
  let snapshotRead = 0;
  const writes = [];
  const makeStockDocRef = () => ({
    async get() {
      snapshotRead++;
      // 1a lectura (pre-tx) = stockSnapshotPreTx
      // 2a+ lecturas (dentro de txn) = stockSnapshotInTx
      const data = snapshotRead === 1 ? stockSnapshotPreTx : stockSnapshotInTx;
      return { exists: !!data, data: () => data };
    },
  });
  const makeDocRef = (col, id) => {
    if (col === 'app_config' && id === 'stock_snapshot') return makeStockDocRef();
    return {
      id,
      async get() {
        const d = state[col] && state[col][id];
        return { exists: !!d, data: () => d };
      },
      async update(data) {
        state[col][id] = { ...(state[col][id] || {}), ...data };
        writes.push({ op: 'update', path: `${col}/${id}`, data });
      },
      async set(data) {
        state[col] ||= {};
        state[col][id] = { ...(state[col][id] || {}), ...data };
        writes.push({ op: 'set', path: `${col}/${id}`, data });
      },
    };
  };
  const fbDb = {
    collection(name) {
      return {
        doc(id) {
          return makeDocRef(name, id);
        },
        async add(data) {
          writes.push({ op: 'add', path: name + '/auto', data });
          return { id: 'auto_' + Math.random().toString(36).slice(2, 10) };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, data) {
          return ref.update(data);
        },
        set(ref, data) {
          return ref.set(data);
        },
      };
      return fn(tx);
    },
  };
  return { fbDb, log: vi.fn(), _state: state, _writes: writes, _snapshotRead: () => snapshotRead };
}

describe('E5 reparto hardening — concurrencia', () => {
  it('aborta si stockFisicoDep11 bajó entre pre-tx y txn (G1.G02 race)', async () => {
    const stockPreTx = {
      warehouseBreakdown: { 'SKU-A': { 11: 10 } },
      asigBySkuApp: { 'SKU-A': 0 },
    };
    const stockInTx = {
      warehouseBreakdown: { 'SKU-A': { 11: 7 } }, // bajó 3u durante aplicación
      asigBySkuApp: { 'SKU-A': 0 },
    };
    const deps = makeDeps({
      ingresoDoc: {
        _fsId: 'ingreso1',
        sku: 'SKU-A',
        qtyIngresada: 10,
        status: 'pending',
        clientesBO: [{ pedidoId: 'ped1', lineIndex: 0, cardCode: 'C001', qtyBackorder: 3 }],
        clientesCount: 1,
      },
      pedidoDoc: {
        _fsId: 'ped1',
        closedAt: null,
        clientCardCode: 'C001',
        lines: [{ code: 'SKU-A', state: 'BO', qty: 3, qtyOpen: 3 }],
      },
      stockSnapshotPreTx: stockPreTx,
      stockSnapshotInTx: stockInTx,
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ingreso1',
      assignments: [{ pedidoId: 'ped1', lineIndex: 0, qtyAsignada: 3 }],
      eliminations: [],
    });
    expect(r.ok).toBe(false);
    const errJoined = r.errors.join(' | ');
    expect(errJoined).toMatch(/E5 stock físico bajó|E5 reparto excedería/);
    // El pedido NO fue mutado (no hay write ni set en pedidos).
    const pedidoWrites = deps._writes.filter((w) => w.path.startsWith('pedidos/'));
    expect(pedidoWrites).toHaveLength(0);
  });

  it('aborta si ASIG actual + nuevaAsig > fisico actual', async () => {
    const stockPreTx = {
      warehouseBreakdown: { 'SKU-B': { 11: 10 } },
      asigBySkuApp: { 'SKU-B': 0 },
    };
    const stockInTx = {
      warehouseBreakdown: { 'SKU-B': { 11: 10 } }, // sin cambio físico
      asigBySkuApp: { 'SKU-B': 8 }, // pero otro reparto ya asignó 8
    };
    const deps = makeDeps({
      ingresoDoc: {
        _fsId: 'ingreso2',
        sku: 'SKU-B',
        qtyIngresada: 10,
        status: 'pending',
        clientesBO: [{ pedidoId: 'ped2', lineIndex: 0, cardCode: 'C002', qtyBackorder: 5 }],
        clientesCount: 1,
      },
      pedidoDoc: {
        _fsId: 'ped2',
        closedAt: null,
        clientCardCode: 'C002',
        lines: [{ code: 'SKU-B', state: 'BO', qty: 5, qtyOpen: 5 }],
      },
      stockSnapshotPreTx: stockPreTx,
      stockSnapshotInTx: stockInTx,
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ingreso2',
      assignments: [{ pedidoId: 'ped2', lineIndex: 0, qtyAsignada: 5 }],
      eliminations: [],
    });
    expect(r.ok).toBe(false);
    const errJoined = r.errors.join(' | ');
    expect(errJoined).toMatch(/E5 reparto excedería/);
  });

  it('OK si stock no cambió y hay espacio', async () => {
    const stock = {
      warehouseBreakdown: { 'SKU-C': { 11: 10 } },
      asigBySkuApp: { 'SKU-C': 0 },
    };
    const deps = makeDeps({
      ingresoDoc: {
        _fsId: 'ingreso3',
        sku: 'SKU-C',
        qtyIngresada: 10,
        status: 'pending',
        clientesBO: [{ pedidoId: 'ped3', lineIndex: 0, cardCode: 'C003', qtyBackorder: 3 }],
        clientesCount: 1,
      },
      pedidoDoc: {
        _fsId: 'ped3',
        closedAt: null,
        clientCardCode: 'C003',
        lines: [{ code: 'SKU-C', state: 'BO', qty: 3, qtyOpen: 3 }],
      },
      stockSnapshotPreTx: stock,
      stockSnapshotInTx: stock, // sin cambio
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ingreso3',
      assignments: [{ pedidoId: 'ped3', lineIndex: 0, qtyAsignada: 3 }],
      eliminations: [],
    });
    if (!r.ok) {
      console.log('DEBUG r:', JSON.stringify(r, null, 2));
    }
    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].qtyAsignada).toBe(3);
  });
});

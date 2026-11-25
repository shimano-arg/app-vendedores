// @ts-check
/**
 * HARDENING 6 F9 F15-01 (2026-11-20) — reparto-core hardening observabilidad.
 *
 * Valida que `applyRepartoManualCore` LOG + fallback currentAsig=0 cuando
 * `asigBySkuApp` esta ausente del snapshot. Antes v1480: currentAsig=null ->
 * el guard E5 skipped SILENCIOSAMENTE. Ahora: log explicito + fallback 0.
 * El sistema sigue aplicando guards fisicos (fisicoInTx check) + por-linea
 * (qtyOpen > 0). Observabilidad critica (alerta Panel Control engancha).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyRepartoManualCore } from '../../functions/core/reparto-core.js';

function makeDeps({ ingresoDoc, pedidoDoc, stockSnapshotPreTx, stockSnapshotInTx }) {
  const state = {
    pedidos: { [pedidoDoc._fsId]: pedidoDoc },
    ingresos_reparto: { [ingresoDoc._fsId]: ingresoDoc },
  };
  let snapshotRead = 0;
  const writes = [];
  const makeStockDocRef = () => ({
    async get() {
      snapshotRead++;
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
        // v1575: soporte para `.where('closedAt','==',null).get()` que usa
        // applyRepartoManualCore para computar stock libre via getStockBreakdown.
        where() {
          return {
            async get() {
              const col = state[name] || {};
              const docs = Object.entries(col)
                .map(([id, d]) => ({ id, data: () => d }))
                .filter(({ data }) => data() && data().closedAt == null);
              return {
                forEach(cb) {
                  docs.forEach(cb);
                },
              };
            },
          };
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
  return { fbDb, log: vi.fn(), _state: state, _writes: writes };
}

const baseIngreso = {
  _fsId: 'ingreso-f15',
  sku: 'SKU-F15',
  qtyIngresada: 5,
  status: 'pending',
  clientesBO: [{ pedidoId: 'ped-f15', lineIndex: 0, cardCode: 'C001', qtyBackorder: 3 }],
  clientesCount: 1,
};
const basePedido = {
  _fsId: 'ped-f15',
  closedAt: null,
  clientCardCode: 'C001',
  lines: [{ code: 'SKU-F15', state: 'BO', qty: 3, qtyOpen: 3 }],
};

describe('H6 F9 F15-01 reparto-core fail-closed si asigBySkuApp ausente', () => {
  it('F15-01-A: happy path con asigBySkuApp presente — reparto OK + E5 cap respetado', async () => {
    const stock = {
      warehouseBreakdown: { 'SKU-F15': { 11: 10 } },
      asigBySkuApp: { 'SKU-F15': 0 },
    };
    const deps = makeDeps({
      ingresoDoc: { ...baseIngreso },
      pedidoDoc: { ...basePedido, lines: [{ ...basePedido.lines[0] }] },
      stockSnapshotPreTx: stock,
      stockSnapshotInTx: stock,
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ingreso-f15',
      assignments: [{ pedidoId: 'ped-f15', lineIndex: 0, qtyAsignada: 3 }],
      eliminations: [],
    });
    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(1);
  });

  it('F15-01-B: asigBySkuApp SKU ausente — log warning F15-01-SNAPSHOT-DEGRADED + reparto procede', async () => {
    const stock = {
      warehouseBreakdown: { 'SKU-F15': { 11: 10 } },
      asigBySkuApp: { 'SKU-OTRO': 5 }, // SKU-F15 NO esta en el mapa
    };
    const deps = makeDeps({
      ingresoDoc: { ...baseIngreso },
      pedidoDoc: { ...basePedido, lines: [{ ...basePedido.lines[0] }] },
      stockSnapshotPreTx: stock,
      stockSnapshotInTx: stock,
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ingreso-f15',
      assignments: [{ pedidoId: 'ped-f15', lineIndex: 0, qtyAsignada: 3 }],
      eliminations: [],
    });
    // Log explicito con warningCode (observabilidad).
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('F15-01'),
      expect.objectContaining({
        sku: 'SKU-F15',
        warningCode: 'F15-01-SNAPSHOT-DEGRADED',
      })
    );
    // Reparto procede (fallback currentAsig=0, aun con guards fisicos activos).
    expect(r.ok).toBe(true);
  });

  it('F15-01-C: asigBySkuApp entero ausente (campo no existe) — log + reparto procede', async () => {
    const stock = {
      warehouseBreakdown: { 'SKU-F15': { 11: 10 } },
      // Sin asigBySkuApp (sync inconsistente / shape viejo).
    };
    const deps = makeDeps({
      ingresoDoc: { ...baseIngreso },
      pedidoDoc: { ...basePedido, lines: [{ ...basePedido.lines[0] }] },
      stockSnapshotPreTx: stock,
      stockSnapshotInTx: stock,
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ingreso-f15',
      assignments: [{ pedidoId: 'ped-f15', lineIndex: 0, qtyAsignada: 3 }],
      eliminations: [],
    });
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('F15-01'),
      expect.objectContaining({
        warningCode: 'F15-01-SNAPSHOT-DEGRADED',
        hasAsigBySkuApp: false,
      })
    );
    expect(r.ok).toBe(true);
  });
});

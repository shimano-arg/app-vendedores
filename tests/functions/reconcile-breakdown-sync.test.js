// @ts-check
/**
 * v1392 §40 — reconcileRepartosFaltantes aplica fórmula
 *   qtyARepartir = min(fisico - asig - conf, BO vigente)
 *
 * Verifica que la fórmula coincide con el bucket breakdown.backorderApp +
 * el fisico - asignadas - confirmadas. No depende de repartoAbierto
 * (ese es informativo).
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown } from '../../functions/core/pedido-snapshot-core.js';
import { reconcileRepartosFaltantes } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-21T12:00:00Z');
const nowIso = NOW.toISOString();

const pedidoDoc = (id, data) => ({ id, data: () => data });
const asigVig = { state: 'ASIG', qtyOpen: 1, asigAt: nowIso, asigReserva: true };

function makeFakeFbDb({ pedidos = [], ingresosActivos = [] } = {}) {
  const writes = [];
  return {
    _writes: writes,
    collection(name) {
      return {
        where() {
          return {
            get: async () => {
              if (name === 'pedidos') return { forEach: (cb) => pedidos.forEach(cb) };
              if (name === 'ingresos_reparto')
                return { forEach: (cb) => ingresosActivos.forEach(cb) };
              return { forEach: () => {} };
            },
            where() {
              return this;
            },
            limit() {
              return this;
            },
          };
        },
        async add(data) {
          const id = `fake_${writes.length + 1}`;
          writes.push({ collection: name, id, data });
          return { id };
        },
      };
    },
  };
}

const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });
const snap = (whs) => ({ warehouseBreakdown: JSON.stringify(whs) });

function expectedQty(bk, fisico) {
  const diff = fisico - bk.asignadas.total - bk.confirmadasSinFacturar.total;
  return Math.max(0, Math.min(diff, bk.backorderApp.total));
}

describe('reconcile fórmula §40: min(fisico - asig - conf, BO vigente)', () => {
  it('fisico=7, BO=10, ASIG=1 → qtyARepartir=6', async () => {
    const pedidosArr = [
      pedidoDoc('pG', {
        clientCardCode: 'C1',
        clientName: 'GRAUBERGER',
        createdAt: nowIso,
        lines: [{ code: 'STRADIC', ...asigVig }],
      }),
      pedidoDoc('pA', {
        clientCardCode: 'CA',
        clientName: 'ANDRILI',
        createdAt: nowIso,
        lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 10 }],
      }),
    ];
    const pedidosData = pedidosArr.map((d) => Object.assign({ _fsId: d.id }, d.data()));
    const bk = getStockBreakdown(
      'STRADIC',
      { getStockFisico: () => 7, pedidos: pedidosData },
      { now: NOW.getTime() }
    );
    expect(bk.backorderApp.total).toBe(10);
    expect(bk.asignadas.total).toBe(1);
    const expected = expectedQty(bk, 7); // min(7-1-0, 10) = 6
    expect(expected).toBe(6);

    const fbDb = makeFakeFbDb({ pedidos: pedidosArr, ingresosActivos: [] });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ STRADIC: { 11: 7 } }));
    expect(r.created).toHaveLength(1);
    expect(fbDb._writes[0].data.qtyIngresada).toBe(expected);
  });

  it('fisico=5, BO=3, confirmed vigente=2, ASIG=1 → qtyARepartir=2 (min con BO=3)', async () => {
    const pedidosArr = [
      pedidoDoc('p1', {
        clientCardCode: 'C1',
        clientName: 'A',
        createdAt: nowIso,
        lines: [{ code: 'SKU', state: 'BO', qtyOpen: 3 }],
      }),
      pedidoDoc('p2', {
        clientCardCode: 'C2',
        clientName: 'B',
        confirmedAt: nowIso,
        createdAt: nowIso,
        lines: [{ code: 'SKU', state: 'confirmed', qtyOpen: 2 }],
      }),
      pedidoDoc('p3', {
        clientCardCode: 'C3',
        clientName: 'C',
        createdAt: nowIso,
        lines: [{ code: 'SKU', ...asigVig }],
      }),
    ];
    const pedidosData = pedidosArr.map((d) => Object.assign({ _fsId: d.id }, d.data()));
    const bk = getStockBreakdown(
      'SKU',
      { getStockFisico: () => 5, pedidos: pedidosData },
      { now: NOW.getTime() }
    );
    const expected = expectedQty(bk, 5); // min(5-1-2, 3) = min(2, 3) = 2
    expect(expected).toBe(2);

    const fbDb = makeFakeFbDb({ pedidos: pedidosArr });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ SKU: { 11: 5 } }));
    expect(r.created).toHaveLength(1);
    expect(fbDb._writes[0].data.qtyIngresada).toBe(expected);
  });

  it('BO vigente > fisico libre → qtyARepartir cap a fisico libre (no al BO)', async () => {
    // Fisico 3, BO 10, ASIG 1, conf 0 → min(3-1-0, 10) = min(2, 10) = 2.
    const pedidosArr = [
      pedidoDoc('p1', {
        clientCardCode: 'C1',
        clientName: 'A',
        createdAt: nowIso,
        lines: [{ code: 'SKU', state: 'BO', qtyOpen: 10 }],
      }),
      pedidoDoc('p2', {
        clientCardCode: 'C2',
        clientName: 'B',
        createdAt: nowIso,
        lines: [{ code: 'SKU', ...asigVig }],
      }),
    ];
    const pedidosData = pedidosArr.map((d) => Object.assign({ _fsId: d.id }, d.data()));
    const bk = getStockBreakdown(
      'SKU',
      { getStockFisico: () => 3, pedidos: pedidosData },
      { now: NOW.getTime() }
    );
    const expected = expectedQty(bk, 3);
    expect(expected).toBe(2);
    const fbDb = makeFakeFbDb({ pedidos: pedidosArr });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ SKU: { 11: 3 } }));
    expect(fbDb._writes[0].data.qtyIngresada).toBe(2);
  });

  it('fisico libre > BO vigente → qtyARepartir cap a BO (no sobrereservar)', async () => {
    // Fisico 10, BO 2, ASIG 0, conf 0 → min(10, 2) = 2.
    const pedidosArr = [
      pedidoDoc('p1', {
        clientCardCode: 'C1',
        clientName: 'A',
        createdAt: nowIso,
        lines: [{ code: 'SKU', state: 'BO', qtyOpen: 2 }],
      }),
    ];
    const pedidosData = pedidosArr.map((d) => Object.assign({ _fsId: d.id }, d.data()));
    const bk = getStockBreakdown(
      'SKU',
      { getStockFisico: () => 10, pedidos: pedidosData },
      { now: NOW.getTime() }
    );
    const expected = expectedQty(bk, 10);
    expect(expected).toBe(2);
    const fbDb = makeFakeFbDb({ pedidos: pedidosArr });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ SKU: { 11: 10 } }));
    expect(fbDb._writes[0].data.qtyIngresada).toBe(2);
  });
});

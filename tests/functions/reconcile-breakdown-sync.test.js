// @ts-check
/**
 * E2.extra v1391 — Garantizar que reconcileRepartosFaltantes NO divergí
 * de getStockBreakdown.pendienteReparto para el mismo fixture (ajuste
 * Mariano #1, CLAUDE.md §39).
 *
 * Si cambia la fórmula de pendienteReparto en breakdown, este test obliga
 * a actualizar el reconcile (o detecta drift silencioso).
 */
import { describe, expect, it } from 'vitest';
import { reconcileRepartosFaltantes } from '../../functions/core/reparto-core.js';
import { getStockBreakdown } from '../../functions/core/pedido-snapshot-core.js';

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
            where() { return this; },
            limit() { return this; },
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

describe('reconcileRepartosFaltantes NO divergí de breakdown.pendienteReparto (§39)', () => {
  it('fisico=7, BO=10, ASIG=1 → breakdown.pendienteReparto.qty == reconcile qty creado', async () => {
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

    // Breakdown autoritativo:
    const bk = getStockBreakdown(
      'STRADIC',
      { getStockFisico: () => 7, pedidos: pedidosData },
      { now: NOW.getTime() }
    );
    expect(bk.pendienteReparto.qty).toBe(6);

    // Reconcile debe crear doc con qtyIngresada == bk.pendienteReparto.qty.
    const fbDb = makeFakeFbDb({ pedidos: pedidosArr, ingresosActivos: [] });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ STRADIC: { 11: 7 } }));
    expect(r.created).toHaveLength(1);
    expect(fbDb._writes[0].data.qtyIngresada).toBe(bk.pendienteReparto.qty);
  });

  it('fisico=5, BO=3, confirmed vigente=2, ASIG=1 → breakdown.pendienteReparto == 2 == reconcile', async () => {
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
    // pendienteReparto = max(0, 5 - 1 ASIG - 2 confirmed) = 2 (porque BO > 0)
    expect(bk.pendienteReparto.qty).toBe(2);

    const fbDb = makeFakeFbDb({ pedidos: pedidosArr });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ SKU: { 11: 5 } }));
    expect(r.created).toHaveLength(1);
    expect(fbDb._writes[0].data.qtyIngresada).toBe(bk.pendienteReparto.qty);
  });

  it('fisico=0 → breakdown=0 → reconcile NO crea (consistente)', async () => {
    const pedidosArr = [
      pedidoDoc('pA', {
        clientCardCode: 'CA',
        clientName: 'A',
        createdAt: nowIso,
        lines: [{ code: 'SKU', state: 'BO', qtyOpen: 10 }],
      }),
    ];
    const pedidosData = pedidosArr.map((d) => Object.assign({ _fsId: d.id }, d.data()));
    const bk = getStockBreakdown(
      'SKU',
      { getStockFisico: () => 0, pedidos: pedidosData },
      { now: NOW.getTime() }
    );
    expect(bk.pendienteReparto.qty).toBe(0);
    const fbDb = makeFakeFbDb({ pedidos: pedidosArr });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ SKU: { 11: 0 } }));
    expect(r.created).toHaveLength(0);
  });

  it('BO >90d (§37 red seguridad): breakdown=0 → reconcile NO crea', async () => {
    const old = '2026-07-01T00:00:00Z'; // >90d atrás
    const pedidosArr = [
      pedidoDoc('pA', {
        clientCardCode: 'CA',
        clientName: 'VIEJO',
        createdAt: old,
        lines: [{ code: 'SKU', state: 'BO', qtyOpen: 5 }],
      }),
    ];
    const pedidosData = pedidosArr.map((d) => Object.assign({ _fsId: d.id }, d.data()));
    const bk = getStockBreakdown(
      'SKU',
      { getStockFisico: () => 7, pedidos: pedidosData },
      { now: NOW.getTime() }
    );
    expect(bk.backorderApp.total).toBe(0);
    expect(bk.pendienteReparto.qty).toBe(0); // No BO vigente → no reparto
    const fbDb = makeFakeFbDb({ pedidos: pedidosArr });
    const r = await reconcileRepartosFaltantes(deps(fbDb), snap({ SKU: { 11: 7 } }));
    expect(r.created).toHaveLength(0);
  });
});

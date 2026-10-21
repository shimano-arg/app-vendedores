// @ts-check
/**
 * v1395 §40.3 — scanSobreAsignadas: recorre pedidos abiertos + stock snapshot
 * y devuelve lista de líneas con sobreAsignada > 0. NO escribe en Firestore.
 */
import { describe, expect, it } from 'vitest';
import { scanSobreAsignadas } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-21T12:00:00Z');
const nowIso = NOW.toISOString();
const asigIsoOld = new Date(NOW.getTime() - 3 * 24 * 3600 * 1000).toISOString();

const pedidoDoc = (id, data) => ({ id, data: () => data });

function makeFakeFbDb({ pedidos = [] } = {}) {
  return {
    collection(name) {
      return {
        where() {
          return {
            get: async () => {
              if (name === 'pedidos')
                return { forEach: (cb) => pedidos.forEach(cb), docs: pedidos };
              return { forEach: () => {}, docs: [] };
            },
            where() {
              return this;
            },
            limit() {
              return this;
            },
          };
        },
      };
    },
  };
}
const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });
const snap = (whs) => ({ warehouseBreakdown: JSON.stringify(whs) });

describe('scanSobreAsignadas v1395 §40.3', () => {
  it('ASIG 6 / fisico 2 → 1 sobre-asignada registrada', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('p1', {
          closedAt: null,
          clientCardCode: 'C20293164852',
          clientName: 'BENGOCHEA',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 6, asigReserva: true, asigAt: asigIsoOld }],
        }),
      ],
    });
    const r = await scanSobreAsignadas(deps(fbDb), snap({ X: { 11: 2 } }));
    expect(r.errors).toEqual([]);
    expect(r.sobreAsignadas).toHaveLength(1);
    expect(r.sobreAsignadas[0]).toMatchObject({
      sku: 'X',
      cardCode: 'C20293164852',
      qtyNominal: 6,
      qtyEntregable: 2,
      sobreAsignada: 4,
    });
  });

  it('ASIG 2 / fisico 2 → sin sobre-asignadas', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('p1', {
          closedAt: null,
          clientCardCode: 'CA',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: asigIsoOld }],
        }),
      ],
    });
    const r = await scanSobreAsignadas(deps(fbDb), snap({ X: { 11: 2 } }));
    expect(r.sobreAsignadas).toEqual([]);
  });

  it('entra stock que cubre nominal → ya no hay sobre-asignadas', async () => {
    const pedidos = [
      pedidoDoc('p1', {
        closedAt: null,
        clientCardCode: 'CA',
        createdAt: nowIso,
        lines: [{ code: 'X', state: 'ASIG', qtyOpen: 6, asigReserva: true, asigAt: asigIsoOld }],
      }),
    ];
    const fbDbAntes = makeFakeFbDb({ pedidos });
    const rAntes = await scanSobreAsignadas(deps(fbDbAntes), snap({ X: { 11: 2 } }));
    expect(rAntes.sobreAsignadas).toHaveLength(1);
    const fbDbDesp = makeFakeFbDb({ pedidos });
    const rDesp = await scanSobreAsignadas(deps(fbDbDesp), snap({ X: { 11: 10 } }));
    expect(rDesp.sobreAsignadas).toEqual([]);
  });

  it('log callback recibe cada línea sobre-asignada', async () => {
    const logs = [];
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('p1', {
          closedAt: null,
          clientCardCode: 'CA',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 6, asigReserva: true, asigAt: asigIsoOld }],
        }),
      ],
    });
    const d = { fbDb, now: () => NOW, log: (msg, extra) => logs.push({ msg, extra }) };
    await scanSobreAsignadas(d, snap({ X: { 11: 2 } }));
    expect(logs.filter((l) => l.msg === 'sobre_asignada')).toHaveLength(1);
  });
});

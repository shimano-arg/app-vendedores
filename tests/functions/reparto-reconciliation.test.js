// @ts-check
/**
 * E2 v1384 — reconcileRepartosFaltantes: crea reparto para SKUs con BO + físico
 * > 0 que nunca disparó por delta (CUDC201HG caso emblemático).
 */
import { describe, expect, it } from 'vitest';
import { reconcileRepartosFaltantes } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-21T12:00:00Z');
const nowIso = NOW.toISOString();

const _snap = (whs) => ({ warehouseBreakdown: JSON.stringify(whs) });

const pedidoDoc = (id, data) => ({ id, data: () => data });

function makeFakeFbDb({ pedidos = [], ingresosActivos = [] } = {}) {
  const writes = [];
  return {
    _writes: writes,
    collection(name) {
      return {
        _name: name,
        where(/* field, op, value */) {
          return {
            _name: name,
            get: async () => {
              if (name === 'pedidos') {
                return {
                  forEach: (cb) => pedidos.forEach(cb),
                };
              }
              if (name === 'ingresos_reparto') {
                return {
                  forEach: (cb) => ingresosActivos.forEach(cb),
                };
              }
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
          const id = `fake_id_${writes.length + 1}`;
          writes.push({ collection: name, id, data });
          return { id };
        },
      };
    },
  };
}

const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });

const asigVigente = { state: 'ASIG', qtyOpen: 1, asigAt: nowIso, asigReserva: true };
const asigVencida = {
  state: 'ASIG',
  qtyOpen: 1,
  asigAt: '2026-10-10T00:00:00Z',
  asigReserva: true,
}; // >7d
const confirmedVigente = { state: 'confirmed', qtyOpen: 1 }; // Nota: pedido necesita confirmedAt reciente

describe('reconcileRepartosFaltantes (E2 v1384)', () => {
  it('SKU fisico=7 BO=10 ASIG=1 confirmed=0 sin reparto → crea reparto qty=6', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pG', {
          clientCardCode: 'C1',
          clientName: 'GRAUBERGER',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', ...asigVigente }],
        }),
        pedidoDoc('pA', {
          clientCardCode: 'CA',
          clientName: 'ANDRILI',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 10 }],
        }),
      ],
      ingresosActivos: [],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ STRADIC: { 11: 7 } }));
    expect(r.created).toHaveLength(1);
    expect(r.errors).toEqual([]);
    const write = fbDb._writes[0];
    expect(write.data.sku).toBe('STRADIC');
    expect(write.data.qtyIngresada).toBe(6); // 7 - 1 ASIG - 0 confirmed
    expect(write.data.qtyBackorderTotal).toBe(10);
    expect(write.data.source).toBe('reconciliation');
    expect(write.data.clientesBO).toHaveLength(1);
  });

  it('SKU con reparto YA ABIERTO → NO crea duplicado', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pA', {
          clientCardCode: 'CA',
          clientName: 'ANDRILI',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 5 }],
        }),
      ],
      ingresosActivos: [{ id: 'ir_1', data: () => ({ sku: 'STRADIC', status: 'pending' }) }],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ STRADIC: { 11: 7 } }));
    expect(r.created).toHaveLength(0);
    expect(r.skipped.find((s) => s.sku === 'STRADIC')).toEqual({
      sku: 'STRADIC',
      reason: 'reparto_activo_existe',
    });
    expect(fbDb._writes).toHaveLength(0);
  });

  it('SKU con fisico 7 pero confirmed vigente 7 → libre 0 → NO crea', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pC', {
          clientCardCode: 'CC',
          clientName: 'C1',
          confirmedAt: nowIso,
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', state: 'confirmed', qtyOpen: 7 }],
        }),
        pedidoDoc('pB', {
          clientCardCode: 'CA',
          clientName: 'ANDRILI',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 5 }],
        }),
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ STRADIC: { 11: 7 } }));
    expect(r.created).toHaveLength(0);
    const sk = r.skipped.find((s) => s.sku === 'STRADIC');
    expect(sk && sk.reason.startsWith('libre_cero')).toBe(true);
    expect(fbDb._writes).toHaveLength(0);
  });

  it('v1388: SKU con BO >90d (fuera red seguridad) → NO crea reparto', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pA', {
          clientCardCode: 'CA',
          clientName: 'VIEJO',
          createdAt: '2026-07-01T00:00:00Z', // >90d atrás (NOW=2026-10-21)
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 5 }],
        }),
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ STRADIC: { 11: 7 } }));
    expect(r.created).toHaveLength(0);
    expect(r.skipped.find((s) => s.sku === 'STRADIC')).toEqual({
      sku: 'STRADIC',
      reason: 'sin_bo_vigente',
    });
  });

  it('SKU con fisico 0 → NO crea aunque haya BO', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pA', {
          clientCardCode: 'CA',
          clientName: 'ANDRILI',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 10 }],
        }),
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ STRADIC: { 11: 0 } }));
    expect(r.created).toHaveLength(0);
    expect(fbDb._writes).toHaveLength(0);
  });

  it('ASIG vencida NO cuenta (lineReservesStock la expira) → libre aumenta', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pG', {
          clientCardCode: 'C1',
          clientName: 'VIEJO',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', ...asigVencida }],
        }),
        pedidoDoc('pA', {
          clientCardCode: 'CA',
          clientName: 'ANDRILI',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 5 }],
        }),
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ STRADIC: { 11: 7 } }));
    expect(r.created).toHaveLength(1);
    const write = fbDb._writes[0];
    expect(write.data.qtyIngresada).toBe(7); // ASIG expirada no resta
  });
});

// @ts-check
/**
 * v1395 §40.3 → v1403 §40.11 — asignadas.detalle FIFO.
 *
 * Pre-v1403: shape público exponía `asignadas.totalEntregable` + `totalSobreAsignada`.
 * Post-v1403: eliminados del shape top-level porque la CF `revertSobreAsignadas`
 * garantiza `total === entregable` siempre. Los campos per-línea
 * (`detalle[].qtyEntregable`, `detalle[].sobreAsignada`) se preservan como
 * uso INTERNO de la CF — post-reconcile son 0, pre-reconcile sirven para
 * decidir cuánto revertir.
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown as getStockBreakdownCF } from '../../../functions/core/pedido-snapshot-core.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const nowIso = new Date(NOW).toISOString();
const asigIso = new Date(NOW - 2 * 24 * 3600 * 1000).toISOString();
const asigIsoOld = new Date(NOW - 5 * 24 * 3600 * 1000).toISOString();

function makeDeps({ fisico = 0, pedidos = [], waitlist = [] }) {
  return {
    getStockFisico: () => fisico,
    pedidos,
    waitlistEntries: waitlist,
  };
}

function pedASIG({ pedidoId = 'p1', cardCode = 'CA', clientName = 'CA', qty, asigAt = asigIso }) {
  return {
    _fsId: pedidoId,
    closedAt: null,
    clientCardCode: cardCode,
    clientName,
    createdAt: nowIso,
    lines: [{ code: 'X', state: 'ASIG', qtyOpen: qty, asigReserva: true, asigAt }],
  };
}

describe('v1403 §40.11 asignadas FIFO (detalle interno, sin top-level totalSobre/Entregable)', () => {
  it('T1 nominal == fisico: detalle[0].qtyEntregable=nominal, sobreAsignada=0', () => {
    const deps = makeDeps({ fisico: 2, pedidos: [pedASIG({ qty: 2 })] });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(2);
    expect(b.asignadas.detalle).toHaveLength(1);
    expect(b.asignadas.detalle[0].qtyEntregable).toBe(2);
    expect(b.asignadas.detalle[0].sobreAsignada).toBe(0);
  });

  it('T2 nominal > fisico (BENGOCHEA): detalle[0].qtyEntregable=fisico, sobreAsignada=diff', () => {
    const deps = makeDeps({
      fisico: 2,
      pedidos: [pedASIG({ cardCode: 'C20293164852', clientName: 'BENGOCHEA', qty: 6 })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(6);
    expect(b.asignadas.detalle[0].qtyNominal).toBe(6);
    expect(b.asignadas.detalle[0].qtyEntregable).toBe(2);
    expect(b.asignadas.detalle[0].sobreAsignada).toBe(4);
    expect(b.asignadas.detalle[0].cardCode).toBe('C20293164852');
  });

  it('T3 entra stock que cubre nominal → detalle[].sobreAsignada=0', () => {
    const ped = pedASIG({ qty: 6 });
    const bAntes = getStockBreakdown('X', makeDeps({ fisico: 2, pedidos: [ped] }), { now: NOW });
    expect(bAntes.asignadas.detalle[0].sobreAsignada).toBe(4);
    const bDespues = getStockBreakdown('X', makeDeps({ fisico: 10, pedidos: [ped] }), { now: NOW });
    expect(bDespues.asignadas.detalle[0].sobreAsignada).toBe(0);
    expect(bDespues.asignadas.detalle[0].qtyEntregable).toBe(6);
  });

  it('T4 FIFO: dos ASIGs sobre mismo SKU, la más vieja (asigAt menor) consume físico primero', () => {
    const deps = makeDeps({
      fisico: 4,
      pedidos: [
        pedASIG({ pedidoId: 'nueva', cardCode: 'CB', clientName: 'B', qty: 3, asigAt: asigIso }),
        pedASIG({ pedidoId: 'vieja', cardCode: 'CA', clientName: 'A', qty: 3, asigAt: asigIsoOld }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(6);
    expect(b.asignadas.detalle).toHaveLength(2);
    expect(b.asignadas.detalle[0].cardCode).toBe('CA');
    expect(b.asignadas.detalle[0].qtyEntregable).toBe(3);
    expect(b.asignadas.detalle[0].sobreAsignada).toBe(0);
    expect(b.asignadas.detalle[1].cardCode).toBe('CB');
    expect(b.asignadas.detalle[1].qtyEntregable).toBe(1);
    expect(b.asignadas.detalle[1].sobreAsignada).toBe(2);
  });

  it('confirmed consume físico primero → ASIG queda sobre-asignada aunque nominal ≤ físico', () => {
    const confIso = new Date(NOW - 3 * 24 * 3600 * 1000).toISOString();
    const deps = makeDeps({
      fisico: 3,
      pedidos: [
        {
          _fsId: 'confp',
          closedAt: null,
          clientCardCode: 'CC',
          clientName: 'C',
          createdAt: nowIso,
          confirmedAt: confIso,
          lines: [{ code: 'X', state: 'confirmed', qtyOpen: 2 }],
        },
        pedASIG({ qty: 2 }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.confirmadasSinFacturar.total).toBe(2);
    expect(b.asignadas.total).toBe(2);
    expect(b.asignadas.detalle[0].qtyEntregable).toBe(1);
    expect(b.asignadas.detalle[0].sobreAsignada).toBe(1);
  });

  it('fisico 0: todas las ASIG están sobre-asignadas (detalle)', () => {
    const deps = makeDeps({ fisico: 0, pedidos: [pedASIG({ qty: 5 })] });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.detalle[0].qtyEntregable).toBe(0);
    expect(b.asignadas.detalle[0].sobreAsignada).toBe(5);
  });

  it('ASIG sin asigAt va al final del FIFO', () => {
    const deps = makeDeps({
      fisico: 2,
      pedidos: [
        pedASIG({ pedidoId: 'sinat', cardCode: 'C_NULL', qty: 2, asigAt: null }),
        pedASIG({ pedidoId: 'conat', cardCode: 'C_OK', qty: 2, asigAt: asigIsoOld }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.detalle[0].cardCode).toBe('C_OK');
    expect(b.asignadas.detalle[0].qtyEntregable).toBe(2);
    expect(b.asignadas.detalle[1].cardCode).toBe('C_NULL');
    expect(b.asignadas.detalle[1].qtyEntregable).toBe(0);
    expect(b.asignadas.detalle[1].sobreAsignada).toBe(2);
  });

  it('v1403 §40.11: shape top-level NO expone totalEntregable ni totalSobreAsignada', () => {
    const b = getStockBreakdown('X', makeDeps({ fisico: 2, pedidos: [pedASIG({ qty: 6 })] }), {
      now: NOW,
    });
    expect(b.asignadas).not.toHaveProperty('totalEntregable');
    expect(b.asignadas).not.toHaveProperty('totalSobreAsignada');
  });

  it('_version = 7', () => {
    const b = getStockBreakdown('X', makeDeps({}), { now: NOW });
    expect(b._version).toBe(7);
  });

  it('sync src/pure vs functions/core: mismo detalle FIFO', () => {
    const deps = makeDeps({ fisico: 2, pedidos: [pedASIG({ qty: 6 })] });
    const bSrc = getStockBreakdown('X', deps, { now: NOW });
    const bCF = getStockBreakdownCF('X', deps, { now: NOW });
    expect(bSrc.asignadas.detalle.length).toBe(bCF.asignadas.detalle.length);
    expect(bSrc.asignadas.detalle[0].qtyEntregable).toBe(bCF.asignadas.detalle[0].qtyEntregable);
    expect(bSrc.asignadas.detalle[0].sobreAsignada).toBe(bCF.asignadas.detalle[0].sobreAsignada);
    expect(bSrc._version).toBe(bCF._version);
  });
});

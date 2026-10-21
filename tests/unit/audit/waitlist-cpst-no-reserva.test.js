// @ts-check
/**
 * v1393 §40.1 — waitlistCpst NO reserva (es draft VDE). Precedente:
 * BENGOCHEA 597151 (2026-10-21) tenía ASIG=6 + waitlist=6 del mismo
 * cliente/SKU; breakdown v1392 contaba 12 u reservadas con físico 2.
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown as getStockBreakdownCF } from '../../../functions/core/pedido-snapshot-core.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const nowIso = new Date(NOW).toISOString();

function makeDeps({ fisico = 0, pedidos = [], waitlist = [] }) {
  return {
    getStockFisico: () => fisico,
    pedidos,
    waitlistEntries: waitlist,
  };
}

describe('v1393 §40.1 waitlistCpst NO reserva', () => {
  it('caso real BENGOCHEA: ASIG 6 + waitlist 6 mismo cliente → reservadas 6 (NO 12), libre 0 clamp', () => {
    const deps = makeDeps({
      fisico: 2,
      pedidos: [
        {
          _fsId: 'EFw2AM0lhfp8VRB52KmG',
          closedAt: null,
          clientCardCode: 'C20293164852',
          clientName: 'JUAN MIGUEL BENGOCHEA',
          createdAt: nowIso,
          lines: [{ code: '597151', state: 'ASIG', qtyOpen: 6, asigReserva: true, asigAt: nowIso }],
        },
      ],
      waitlist: [
        {
          _id: 'GYQRCgyXyOJttrQyNsru',
          source: 'stock-asignado-batch',
          clientCardCode: 'C20293164852',
          clientName: 'JUAN MIGUEL BENGOCHEA',
          items: [{ code: '597151', qty: 6 }],
        },
      ],
    });
    const b = getStockBreakdown('597151', deps, { now: NOW });
    expect(b.asignadas.total).toBe(6); // nominal
    expect(b.waitlistCpst.total).toBe(6); // informativo
    expect(b.reservadasTotal).toBe(2); // v1394 §40.2 cap por fisico
    expect(b.libre).toBe(0);
    // utilizablePara BENGOCHEA = min(fisico, libre + ASIG propia) = min(2, 0+6) = 2.
    expect(b.utilizablePara('C20293164852')).toBe(2);
  });

  it('fixture Mariano: orden CPST 6 con ASIG 2 y fisico 2 → reservadas 2, libre 0, utilizable 2', () => {
    const deps = makeDeps({
      fisico: 2,
      pedidos: [
        {
          _fsId: 'p1',
          closedAt: null,
          clientCardCode: 'CB',
          clientName: 'BENG',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: nowIso }],
        },
      ],
      waitlist: [
        {
          _id: 'w1',
          source: 'stock-asignado-batch',
          clientCardCode: 'CB',
          clientName: 'BENG',
          items: [{ code: 'X', qty: 6 }],
        },
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(2);
    expect(b.waitlistCpst.total).toBe(6);
    expect(b.reservadasTotal).toBe(2); // solo ASIG
    expect(b.libre).toBe(0);
    expect(b.utilizablePara('CB')).toBe(2);
  });

  it('waitlist sin ASIG de respaldo: NO reserva igual (es draft)', () => {
    // Si existe un waitlist "huérfano" (sin ASIG viva), tampoco reserva.
    // Es coherente con §40.1: waitlist es draft, nunca reserva por sí mismo.
    const deps = makeDeps({
      fisico: 5,
      pedidos: [],
      waitlist: [
        {
          _id: 'w1',
          source: 'stock-asignado-batch',
          clientCardCode: 'C',
          items: [{ code: 'X', qty: 3 }],
        },
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.waitlistCpst.total).toBe(3); // informativo
    expect(b.reservadasTotal).toBe(0); // no reserva
    expect(b.libre).toBe(5);
  });

  it('utilizablePara: BO del cliente + waitlist propia NO cuentan como reserva propia', () => {
    const deps = makeDeps({
      fisico: 5,
      pedidos: [
        {
          _fsId: 'p1',
          closedAt: null,
          clientCardCode: 'CA',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'BO', qtyOpen: 10 }],
        },
      ],
      waitlist: [
        {
          _id: 'w1',
          source: 'stock-asignado-batch',
          clientCardCode: 'CA',
          items: [{ code: 'X', qty: 10 }],
        },
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.libre).toBe(5); // nada reserva (BO y waitlist no cuentan)
    expect(b.utilizablePara('CA')).toBe(5); // libre + 0 (BO y waitlist no suman)
  });

  it('_version = 5 (v1395)', () => {
    const b = getStockBreakdown('X', makeDeps({}), { now: NOW });
    expect(b._version).toBe(7);
  });

  it('sync: espejo functions/core también aplica §40.1', () => {
    const deps = makeDeps({
      fisico: 2,
      pedidos: [
        {
          _fsId: 'p1',
          closedAt: null,
          clientCardCode: 'CB',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: nowIso }],
        },
      ],
      waitlist: [
        {
          _id: 'w1',
          source: 'stock-asignado-batch',
          clientCardCode: 'CB',
          items: [{ code: 'X', qty: 6 }],
        },
      ],
    });
    const bSrc = getStockBreakdown('X', deps, { now: NOW });
    const bCF = getStockBreakdownCF('X', deps, { now: NOW });
    expect(bSrc.reservadasTotal).toBe(bCF.reservadasTotal);
    expect(bSrc.libre).toBe(bCF.libre);
    expect(bSrc.utilizablePara('CB')).toBe(bCF.utilizablePara('CB'));
  });
});

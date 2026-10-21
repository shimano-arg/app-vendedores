// @ts-check
/**
 * v1394 §40.2 — reservadasTotal cap por físico.
 * reservadasTotal = min(ASIG + confirmed, fisicoDep11). Si la reserva nominal
 * excede el físico, muestra lo entregable (no la sobre-reserva nominal).
 * Precedente: BENGOCHEA 597151 (2026-10-21) ASIG 6 con fisico 2 → 2 (no 6).
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

describe('v1394 §40.2 reservadasTotal cap por físico', () => {
  it('caso BENGOCHEA 597151: ASIG 6 fisico 2 → reservadas 2 (no 6)', () => {
    const deps = makeDeps({
      fisico: 2,
      pedidos: [
        {
          _fsId: 'EFw2AM0lhfp8VRB52KmG',
          closedAt: null,
          clientCardCode: 'C20293164852',
          clientName: 'BENGOCHEA',
          createdAt: nowIso,
          lines: [{ code: '597151', state: 'ASIG', qtyOpen: 6, asigReserva: true, asigAt: nowIso }],
        },
      ],
    });
    const b = getStockBreakdown('597151', deps, { now: NOW });
    expect(b.fisicoDep11).toBe(2);
    expect(b.asignadas.total).toBe(6); // nominal sigue siendo 6
    expect(b.reservadasTotal).toBe(2); // cap por fisico
    expect(b.libre).toBe(0);
  });

  it('sin sobre-reserva: nominal igual al cap (ASIG 2 fisico 10)', () => {
    const deps = makeDeps({
      fisico: 10,
      pedidos: [
        {
          _fsId: 'p1',
          closedAt: null,
          clientCardCode: 'CA',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: nowIso }],
        },
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(2);
    expect(b.reservadasTotal).toBe(2); // min(2, 10) = 2
    expect(b.libre).toBe(8);
  });

  it('confirmed + ASIG mix cap por fisico', () => {
    const deps = makeDeps({
      fisico: 3,
      pedidos: [
        {
          _fsId: 'p1',
          closedAt: null,
          clientCardCode: 'CA',
          confirmedAt: nowIso,
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }],
        },
        {
          _fsId: 'p2',
          closedAt: null,
          clientCardCode: 'CB',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 3, asigReserva: true, asigAt: nowIso }],
        },
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(3);
    expect(b.confirmadasSinFacturar.total).toBe(5);
    // nominal = 8, cap por fisico = 3.
    expect(b.reservadasTotal).toBe(3);
    expect(b.libre).toBe(0);
  });

  it('fisico 0: reservadasTotal = 0 (cap aún con reservas nominales)', () => {
    const deps = makeDeps({
      fisico: 0,
      pedidos: [
        {
          _fsId: 'p1',
          closedAt: null,
          clientCardCode: 'CA',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 10, asigReserva: true, asigAt: nowIso }],
        },
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(10); // nominal
    expect(b.reservadasTotal).toBe(0); // cap por fisico=0
    expect(b.libre).toBe(0);
  });

  it('_version=5', () => {
    const b = getStockBreakdown('X', makeDeps({}), { now: NOW });
    expect(b._version).toBe(7);
  });

  it('sync: espejo functions/core también cap por fisico', () => {
    const deps = makeDeps({
      fisico: 2,
      pedidos: [
        {
          _fsId: 'p1',
          closedAt: null,
          clientCardCode: 'C',
          createdAt: nowIso,
          lines: [{ code: 'X', state: 'ASIG', qtyOpen: 6, asigReserva: true, asigAt: nowIso }],
        },
      ],
    });
    const bSrc = getStockBreakdown('X', deps, { now: NOW });
    const bCF = getStockBreakdownCF('X', deps, { now: NOW });
    expect(bSrc.reservadasTotal).toBe(2);
    expect(bCF.reservadasTotal).toBe(2);
    expect(bSrc.libre).toBe(bCF.libre);
  });
});

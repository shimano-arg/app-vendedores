// @ts-check
/**
 * v1402 §40.10 — ASIG siempre reserva (sin excepción). El flag `asigReserva=false`
 * ya NO libera el stock para `state='ASIG'`. Si Pablo decide no reservarle,
 * la línea revierte a BO (closedReason='asig_destildada_por_admin') y
 * desaparece del modal Stock Asignado.
 *
 * Pre-fix había 0 líneas en prod con `asigReserva=false` + marker (verificado
 * por script N 2026-10-21), así que el cambio no libera unidades. Es puramente
 * defensivo + consistencia con §40.
 */
import { describe, expect, it } from 'vitest';
import { lineReservesStock as lineReservesStockCF } from '../../../functions/core/pedido-snapshot-core.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';

const NOW = Date.parse('2026-10-21T20:00:00Z');
const asigIso = new Date(NOW - 2 * 24 * 3600 * 1000).toISOString();

function ped(opts = {}) {
  return {
    _fsId: 'p1',
    closedAt: null,
    clientCardCode: 'C1',
    clientName: 'C',
    createdAt: asigIso,
    lines: [Object.assign({ code: 'X', state: 'ASIG', qty: 2, qtyOpen: 2, asigAt: asigIso }, opts)],
  };
}

describe('v1402 §40.10 ASIG siempre reserva (sin excepción)', () => {
  it('ASIG con asigReserva=true → reserva', () => {
    const p = ped({ asigReserva: true });
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(true);
  });

  it('ASIG con asigReserva=undefined (default) → reserva', () => {
    const p = ped({});
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(true);
  });

  it('ASIG con asigReserva=false → AHORA RESERVA (regla §40.10)', () => {
    const p = ped({ asigReserva: false });
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(true);
  });

  it('ASIG con asigReserva=0 (SAP serializa como int) → AHORA RESERVA', () => {
    const p = ped({ asigReserva: 0 });
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(true);
  });

  it('ASIG con asigReserva=false + asigReservaChangedAt (destildada manual legacy) → AHORA RESERVA', () => {
    const p = ped({
      asigReserva: false,
      asigReservaChangedAt: '2026-10-20T10:00:00Z',
      asigReservaChangedBy: 'admin@shimano.com.ar',
    });
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(true);
  });

  it('ASIG expirada (asigAt > 7d) → NO reserva (TTL, independiente de asigReserva)', () => {
    const old = new Date(NOW - 10 * 24 * 3600 * 1000).toISOString();
    const p = ped({ asigAt: old });
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(false);
  });

  it('BO revertida con asig_destildada_por_admin → NO reserva (BO no reserva, §40)', () => {
    const p = {
      _fsId: 'p1',
      closedAt: null,
      clientCardCode: 'C1',
      createdAt: asigIso,
      lines: [
        {
          code: 'X',
          state: 'BO',
          qty: 2,
          qtyOpen: 2,
          asigRevertidaReason: 'asig_destildada_por_admin',
          asigRevertidaAt: NOW,
        },
      ],
    };
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(false);
  });

  it('mirror functions/core: mismo comportamiento', () => {
    const p = ped({ asigReserva: false });
    expect(lineReservesStockCF(p.lines[0], NOW, p)).toBe(true);
  });

  it('breakdown: ASIG con asigReserva=false cuenta en asignadas.total y reduce libre', () => {
    const p = ped({ asigReserva: false });
    const b = getStockBreakdown(
      'X',
      {
        getStockFisico: () => 5,
        pedidos: [p],
      },
      { now: NOW }
    );
    expect(b.asignadas.total).toBe(2);
    expect(b.libre).toBe(3);
  });

  it('breakdown: línea revertida a BO con asig_destildada_por_admin NO cuenta en asignadas', () => {
    const p = {
      _fsId: 'p1',
      closedAt: null,
      clientCardCode: 'C1',
      createdAt: asigIso,
      lines: [
        {
          code: 'X',
          state: 'BO',
          qty: 2,
          qtyOpen: 2,
          asigRevertidaReason: 'asig_destildada_por_admin',
        },
      ],
    };
    const b = getStockBreakdown(
      'X',
      {
        getStockFisico: () => 5,
        pedidos: [p],
      },
      { now: NOW }
    );
    expect(b.asignadas.total).toBe(0);
    expect(b.backorderApp.total).toBe(2); // sigue como demanda BO
    expect(b.libre).toBe(5);
  });

  it('caso real BOSCHETTO LDM64TE2020030G 2u: asigReserva=true → reserva', () => {
    // Línea real pre-fix (verificada en prod 2026-10-21).
    const p = {
      _fsId: '6XQDqxFb4aBICVOTxfKC',
      closedAt: null,
      clientName: 'MARCELO DANIEL BOSCHETTO',
      clientCardCode: 'C20170998406',
      createdAt: asigIso,
      lines: [
        {
          code: 'LDM64TE2020030G',
          state: 'ASIG',
          qty: 2,
          qtyOpen: 2,
          asigReserva: true,
          asigAt: '2026-10-16T21:14:08.458Z',
          asigReservaChangedAt: '2026-10-21T14:29:27.718Z',
        },
      ],
    };
    expect(lineReservesStock(p.lines[0], NOW, p)).toBe(true);
  });
});

describe('v1402 §40.10 toggle destildar → revert ASIG→BO (handler _toggleAsigReserva)', () => {
  // Simulación conceptual del handler (idéntico patrón §40.5 reversión).
  function simulateDestildar(line) {
    if (!line || line.state !== 'ASIG') return { line, changed: false };
    if (line.state === 'BO' && line.asigRevertidaReason === 'asig_destildada_por_admin') {
      return { line, changed: false };
    }
    const newLine = Object.assign({}, line, {
      state: 'BO',
      asigReserva: false,
      asigRevertidaAt: '2026-10-21T20:00:00Z',
      asigRevertidaBy: 'admin@shimano.com.ar',
      asigRevertidaReason: 'asig_destildada_por_admin',
    });
    return { line: newLine, changed: true };
  }

  it('destildar ASIG viva → mutar a BO con audit', () => {
    const original = { code: 'X', state: 'ASIG', qty: 2, qtyOpen: 2, asigReserva: true };
    const { line, changed } = simulateDestildar(original);
    expect(changed).toBe(true);
    expect(line.state).toBe('BO');
    expect(line.asigReserva).toBe(false);
    expect(line.asigRevertidaReason).toBe('asig_destildada_por_admin');
    expect(line.qtyOpen).toBe(2); // BO conserva qtyOpen (es cola)
  });

  it('destildar línea ya BO con reason → no-op (idempotencia)', () => {
    const original = {
      code: 'X',
      state: 'BO',
      qtyOpen: 2,
      asigRevertidaReason: 'asig_destildada_por_admin',
    };
    const { changed } = simulateDestildar(original);
    expect(changed).toBe(false);
  });

  it('destildar línea en otro state (invoiced/cancelled): skip (no se fuerza)', () => {
    const inv = { code: 'X', state: 'invoiced', qty: 2, qtyOpen: 0 };
    expect(simulateDestildar(inv).changed).toBe(false);
    const can = { code: 'X', state: 'cancelled', qty: 2, qtyOpen: 0 };
    expect(simulateDestildar(can).changed).toBe(false);
  });
});

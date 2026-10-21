// @ts-check
/**
 * E1 v1384 (2026-10-21): guard defensivo — línea confirmed sin fecha de
 * referencia no reserva. CLAUDE.md §36.
 */
import { describe, expect, it } from 'vitest';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';

const NOW = Date.parse('2026-10-21T00:00:00Z');

describe('TTL guard: confirmed sin confirmedAt no reserva (v1384)', () => {
  it('line confirmed con pedido={} (sin confirmedAt) → false', () => {
    const line = { state: 'confirmed', qtyOpen: 2 };
    expect(lineReservesStock(line, NOW, {})).toBe(false);
  });

  it('line confirmed con pedido=null → false', () => {
    const line = { state: 'confirmed', qtyOpen: 2 };
    expect(lineReservesStock(line, NOW, null)).toBe(false);
  });

  it('line confirmed con confirmedAt reciente (3d) → true (preserva TTL)', () => {
    const line = { state: 'confirmed', qtyOpen: 2 };
    const pedido = { confirmedAt: '2026-10-18T00:00:00Z' };
    expect(lineReservesStock(line, NOW, pedido)).toBe(true);
  });

  it('line confirmed con confirmedAt 15d (TTL vencido) → false (preserva v963)', () => {
    const line = { state: 'confirmed', qtyOpen: 2 };
    const pedido = { confirmedAt: '2026-10-06T00:00:00Z' };
    expect(lineReservesStock(line, NOW, pedido)).toBe(false);
  });

  it('line confirmed con asigReserva=false → false (preserva v1269)', () => {
    const line = { state: 'confirmed', qtyOpen: 2, asigReserva: false };
    const pedido = { confirmedAt: '2026-10-20T00:00:00Z' };
    expect(lineReservesStock(line, NOW, pedido)).toBe(false);
  });
});

// @ts-check
/**
 * v1388 (2026-10-21) — CLAUDE.md §37 + §38:
 *   - BO no vence a 7d, red de seguridad 90d.
 *   - ASIG sigue con 7d.
 *   - confirmed sigue con 7d + hard cap 60d.
 */
import { describe, expect, it } from 'vitest';
import { lineReservesStock as lineReservesStockCF } from '../../../functions/core/pedido-snapshot-core.js';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

describe('v1388 §37 BO sin TTL 7d', () => {
  it('BO con createdAt 30d atras SIGUE reservando (regla §37)', () => {
    const line = { state: 'BO', qtyOpen: 1 };
    const pedido = { createdAt: daysAgo(30) };
    expect(lineReservesStock(line, NOW, pedido)).toBe(true);
    expect(lineReservesStockCF(line, NOW, pedido)).toBe(true);
  });

  it('BO con createdAt 89d atras SIGUE reservando (red de seguridad 90d, cae justo)', () => {
    const line = { state: 'BO', qtyOpen: 1 };
    const pedido = { createdAt: daysAgo(89) };
    expect(lineReservesStock(line, NOW, pedido)).toBe(true);
    expect(lineReservesStockCF(line, NOW, pedido)).toBe(true);
  });

  it('BO con createdAt 91d atras YA NO reserva (red de seguridad)', () => {
    const line = { state: 'BO', qtyOpen: 1 };
    const pedido = { createdAt: daysAgo(91) };
    expect(lineReservesStock(line, NOW, pedido)).toBe(false);
    expect(lineReservesStockCF(line, NOW, pedido)).toBe(false);
  });

  it('BO sin pedido sigue reservando (edge compat)', () => {
    const line = { state: 'BO', qtyOpen: 1 };
    expect(lineReservesStock(line, NOW)).toBe(true);
    expect(lineReservesStockCF(line, NOW)).toBe(true);
  });
});

describe('v1388 §38 confirmed hard cap 60d', () => {
  it('confirmed 30d atras NO reserva (ya supera soft 7d)', () => {
    const line = { state: 'confirmed', qtyOpen: 1 };
    const pedido = { confirmedAt: daysAgo(30) };
    expect(lineReservesStock(line, NOW, pedido)).toBe(false);
    expect(lineReservesStockCF(line, NOW, pedido)).toBe(false);
  });

  it('confirmed 61d atras NO reserva (fuera del hard cap 60d)', () => {
    const line = { state: 'confirmed', qtyOpen: 1 };
    const pedido = { confirmedAt: daysAgo(61) };
    expect(lineReservesStock(line, NOW, pedido)).toBe(false);
    expect(lineReservesStockCF(line, NOW, pedido)).toBe(false);
  });

  it('confirmed 3d atras SI reserva (dentro del soft 7d)', () => {
    const line = { state: 'confirmed', qtyOpen: 1 };
    const pedido = { confirmedAt: daysAgo(3) };
    expect(lineReservesStock(line, NOW, pedido)).toBe(true);
    expect(lineReservesStockCF(line, NOW, pedido)).toBe(true);
  });
});

describe('v1388 ASIG sigue con TTL 7d (regla §37 NO cambia ASIG)', () => {
  it('ASIG 30d atras NO reserva (TTL 7d)', () => {
    const line = { state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(30) };
    expect(lineReservesStock(line, NOW, {})).toBe(false);
    expect(lineReservesStockCF(line, NOW, {})).toBe(false);
  });

  it('ASIG 3d atras SI reserva', () => {
    const line = { state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(3) };
    expect(lineReservesStock(line, NOW, {})).toBe(true);
    expect(lineReservesStockCF(line, NOW, {})).toBe(true);
  });
});

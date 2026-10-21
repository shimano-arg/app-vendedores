// @ts-check
/**
 * v1400 §40.8 — Popup "Stock del SKU" (Master de productos) y modal "Pedido
 * en Espera" leen el MISMO getStockBreakdown. Para un fixture dado, los
 * números deben coincidir.
 *
 * El popup (index.html openStockModal) y el modal waitlist-card usan la pure
 * `getStockBreakdown` directamente desde v1400. Este test chequea que:
 *   - fisicoDep11, transitoDep12, backorderApp.total, confirmadasSinFacturar.total,
 *     asignadas.total, reservadasTotal, libre, pendienteReparto.qty
 *   son idénticos entre las 2 lecturas (son el mismo call al mismo pure).
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown, STOCK_LABELS } from '../../../src/pure/stock-breakdown.js';

const NOW = Date.parse('2026-10-21T19:00:00Z');
const asigIso = new Date(NOW - 2 * 24 * 3600 * 1000).toISOString();
const confIso = new Date(NOW - 3 * 24 * 3600 * 1000).toISOString();
const createdIso = new Date(NOW - 5 * 24 * 3600 * 1000).toISOString();

const fixture = {
  getStockFisico: () => 10,
  getStockTransito: () => 24,
  pedidos: [
    {
      _fsId: 'p1',
      closedAt: null,
      clientCardCode: 'CA',
      createdAt: createdIso,
      confirmedAt: confIso,
      lines: [{ code: 'CUDC201HG', state: 'confirmed', qty: 2, qtyOpen: 2 }],
    },
    {
      _fsId: 'p2',
      closedAt: null,
      clientCardCode: 'CB',
      createdAt: createdIso,
      lines: [
        {
          code: 'CUDC201HG',
          state: 'ASIG',
          qty: 3,
          qtyOpen: 3,
          asigReserva: true,
          asigAt: asigIso,
        },
      ],
    },
    {
      _fsId: 'p3',
      closedAt: null,
      clientCardCode: 'CC',
      createdAt: createdIso,
      lines: [{ code: 'CUDC201HG', state: 'BO', qty: 4, qtyOpen: 4 }],
    },
  ],
};

describe('v1400 §40.8 popup Stock del SKU == modal Pedido en Espera (mismo breakdown)', () => {
  it('ambas lecturas devuelven los mismos campos y valores', () => {
    const bPopup = getStockBreakdown('CUDC201HG', fixture, { now: NOW });
    const bWaitlist = getStockBreakdown('CUDC201HG', fixture, { now: NOW });
    expect(bPopup.fisicoDep11).toBe(bWaitlist.fisicoDep11);
    expect(bPopup.transitoDep12).toBe(bWaitlist.transitoDep12);
    expect(bPopup.backorderApp.total).toBe(bWaitlist.backorderApp.total);
    expect(bPopup.confirmadasSinFacturar.total).toBe(bWaitlist.confirmadasSinFacturar.total);
    expect(bPopup.asignadas.total).toBe(bWaitlist.asignadas.total);
    expect(bPopup.reservadasTotal).toBe(bWaitlist.reservadasTotal);
    expect(bPopup.libre).toBe(bWaitlist.libre);
    expect(bPopup.pendienteReparto.qty).toBe(bWaitlist.pendienteReparto.qty);
  });

  it('STOCK_LABELS tiene las 8 claves que el popup consume', () => {
    expect(STOCK_LABELS.fisicoDep11).toBeDefined();
    expect(STOCK_LABELS.transitoDep12).toBeDefined();
    expect(STOCK_LABELS.backorderApp).toBeDefined();
    expect(STOCK_LABELS.confirmadasSinFacturar).toBeDefined();
    expect(STOCK_LABELS.asignadas).toBeDefined();
    expect(STOCK_LABELS.reservadasTotal).toBeDefined();
    expect(STOCK_LABELS.libre).toBeDefined();
    // repartoAbierto label (alias pendienteReparto en shape).
    expect(STOCK_LABELS.repartoAbierto).toBeDefined();
  });

  it('STOCK_LABELS NO tiene demandaSapSinCubrir (eliminado v1400 §40.8)', () => {
    expect(STOCK_LABELS).not.toHaveProperty('demandaSapSinCubrir');
  });

  it('breakdown shape NO expone demandaSapSinCubrir', () => {
    const b = getStockBreakdown('CUDC201HG', fixture, { now: NOW });
    expect(b).not.toHaveProperty('demandaSapSinCubrir');
  });
});

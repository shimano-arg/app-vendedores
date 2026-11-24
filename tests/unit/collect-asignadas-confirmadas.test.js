// @ts-check
/**
 * §39 FIX v9 — tests del helper que corre en syncSapCatalogStockCF.
 * Valida TTLs §38/§40, exclusión §E1 tránsito, cap §40.8 orderDocEntry SAP.
 */
import { describe, expect, it } from 'vitest';
import {
  collectAsignadasConfirmadasFromPedidos,
  lineReservesStockFisico,
  normalizeSku,
} from '../../functions/core/collect-asignadas-confirmadas-from-pedidos.js';

const NOW = Date.parse('2026-11-24T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

describe('normalizeSku', () => {
  it('trim + uppercase', () => {
    expect(normalizeSku('  skuA  ')).toBe('SKUA');
    expect(normalizeSku('sku-B')).toBe('SKU-B');
  });
  it('null/undefined/empty → ""', () => {
    expect(normalizeSku(null)).toBe('');
    expect(normalizeSku(undefined)).toBe('');
    expect(normalizeSku('')).toBe('');
    expect(normalizeSku('   ')).toBe('');
  });
});

describe('lineReservesStockFisico', () => {
  it('ASIG dentro TTL 7d reserva', () => {
    expect(
      lineReservesStockFisico(
        { state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(3) },
        { createdAt: daysAgo(3) },
        NOW
      )
    ).toBe(true);
  });
  it('ASIG fuera TTL 7d NO reserva', () => {
    expect(
      lineReservesStockFisico(
        { state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(10) },
        { createdAt: daysAgo(10) },
        NOW
      )
    ).toBe(false);
  });
  it('ASIG enTransito=true NO reserva (es §E1 tránsito)', () => {
    expect(
      lineReservesStockFisico(
        { state: 'ASIG', qtyOpen: 3, enTransito: true, asigAt: daysAgo(1) },
        { createdAt: daysAgo(1) },
        NOW
      )
    ).toBe(false);
  });
  it('confirmed dentro TTL 7d reserva', () => {
    expect(
      lineReservesStockFisico({ state: 'confirmed', qtyOpen: 3 }, { confirmedAt: daysAgo(3) }, NOW)
    ).toBe(true);
  });
  it('confirmed fuera TTL soft 7d NO reserva', () => {
    expect(
      lineReservesStockFisico({ state: 'confirmed', qtyOpen: 3 }, { confirmedAt: daysAgo(10) }, NOW)
    ).toBe(false);
  });
  it('confirmed con orderDocEntry SAP NO reserva (§40.8)', () => {
    expect(
      lineReservesStockFisico(
        { state: 'confirmed', qtyOpen: 3 },
        { confirmedAt: daysAgo(3), transferidoSAP: { orderDocEntry: 12345 } },
        NOW
      )
    ).toBe(false);
  });
  it('confirmed con asigReserva=false NO reserva (§36)', () => {
    expect(
      lineReservesStockFisico(
        { state: 'confirmed', qtyOpen: 3, asigReserva: false },
        { confirmedAt: daysAgo(3) },
        NOW
      )
    ).toBe(false);
  });
  it('BO NO reserva (§40)', () => {
    expect(
      lineReservesStockFisico({ state: 'BO', qtyOpen: 3 }, { createdAt: daysAgo(1) }, NOW)
    ).toBe(false);
  });
  it('cancelled NO reserva', () => {
    expect(
      lineReservesStockFisico({ state: 'cancelled', qtyOpen: 0 }, { createdAt: daysAgo(1) }, NOW)
    ).toBe(false);
  });
});

describe('collectAsignadasConfirmadasFromPedidos', () => {
  it('agrega por SKU uppercase + skip closedAt', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(1),
        lines: [
          { code: 'sku-A', state: 'ASIG', qtyOpen: 2, asigAt: daysAgo(1) },
          { code: 'SKU-B', state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(1) },
        ],
      },
      {
        closedAt: new Date(NOW - DAY).toISOString(),
        createdAt: daysAgo(1),
        lines: [{ code: 'SKU-A', state: 'ASIG', qtyOpen: 100, asigAt: daysAgo(1) }],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.asignadasBySku).toEqual({ 'SKU-A': 2, 'SKU-B': 3 });
    expect(r.confirmadasBySku).toEqual({});
    expect(r.totalesStats.pedidosScanned).toBe(1); // closedAt skip
  });

  it('agrega ASIG + confirmed en 2 maps separados', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(1),
        confirmedAt: daysAgo(1),
        lines: [
          { code: 'SKU-X', state: 'ASIG', qtyOpen: 4, asigAt: daysAgo(1) },
          { code: 'SKU-X', state: 'confirmed', qtyOpen: 2 },
        ],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.asignadasBySku).toEqual({ 'SKU-X': 4 });
    expect(r.confirmadasBySku).toEqual({ 'SKU-X': 2 });
  });

  it('skip líneas enTransito (v8 §E1)', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(1),
        lines: [
          { code: 'SKU-X', state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(1) },
          { code: 'SKU-X', state: 'ASIG', qtyOpen: 7, asigAt: daysAgo(1), enTransito: true },
        ],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.asignadasBySku).toEqual({ 'SKU-X': 3 });
  });

  it('skip ASIG fuera TTL 7d', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(10),
        lines: [{ code: 'SKU-X', state: 'ASIG', qtyOpen: 5, asigAt: daysAgo(10) }],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.asignadasBySku).toEqual({});
  });

  it('skip confirmed con orderDocEntry SAP (doble conteo §40.8)', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(1),
        confirmedAt: daysAgo(1),
        transferidoSAP: { orderDocEntry: 9999 },
        lines: [{ code: 'SKU-X', state: 'confirmed', qtyOpen: 3 }],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.confirmadasBySku).toEqual({});
  });

  it('múltiples pedidos → suma por SKU', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(1),
        lines: [{ code: 'SKU-A', state: 'ASIG', qtyOpen: 2, asigAt: daysAgo(1) }],
      },
      {
        closedAt: null,
        createdAt: daysAgo(1),
        lines: [{ code: 'SKU-A', state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(1) }],
      },
      {
        closedAt: null,
        createdAt: daysAgo(1),
        lines: [{ code: 'SKU-A', state: 'ASIG', qtyOpen: 5, asigAt: daysAgo(1) }],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.asignadasBySku['SKU-A']).toBe(10);
  });

  it('input vacío devuelve maps vacíos', () => {
    const r = collectAsignadasConfirmadasFromPedidos([], NOW);
    expect(r.asignadasBySku).toEqual({});
    expect(r.confirmadasBySku).toEqual({});
    expect(r.totalesStats.pedidosScanned).toBe(0);
  });

  it('input null/undefined no rompe', () => {
    const r = collectAsignadasConfirmadasFromPedidos(null, NOW);
    expect(r.asignadasBySku).toEqual({});
  });

  it('lines con code null/empty se saltan', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(1),
        lines: [
          { code: '', state: 'ASIG', qtyOpen: 5, asigAt: daysAgo(1) },
          { code: null, state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(1) },
          { code: 'SKU-X', state: 'ASIG', qtyOpen: 1, asigAt: daysAgo(1) },
        ],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.asignadasBySku).toEqual({ 'SKU-X': 1 });
  });

  it('stats incluye counts y qty totales', () => {
    const pedidos = [
      {
        closedAt: null,
        createdAt: daysAgo(1),
        confirmedAt: daysAgo(1),
        lines: [
          { code: 'SKU-A', state: 'ASIG', qtyOpen: 2, asigAt: daysAgo(1) },
          { code: 'SKU-B', state: 'confirmed', qtyOpen: 5 },
        ],
      },
    ];
    const r = collectAsignadasConfirmadasFromPedidos(pedidos, NOW);
    expect(r.totalesStats.asignadasSkuCount).toBe(1);
    expect(r.totalesStats.confirmadasSkuCount).toBe(1);
    expect(r.totalesStats.asignadasQty).toBe(2);
    expect(r.totalesStats.confirmadasQty).toBe(5);
    expect(r.totalesStats.pedidosScanned).toBe(1);
    expect(r.totalesStats.linesScanned).toBe(2);
  });
});

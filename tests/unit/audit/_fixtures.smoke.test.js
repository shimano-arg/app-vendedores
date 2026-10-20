// @ts-check
/**
 * Smoke test del fixture — asegura que importa y los helpers responden.
 * Se borra al final de la auditoria (es solo para gate de E1).
 */
import { describe, expect, it } from 'vitest';
import {
  AT_NOW,
  lineASIG,
  lineBO,
  lineConfirmed,
  makeDeps,
  NORTE,
  OESTE,
  pedidoOpen,
  SKU_STRADIC,
  SUR,
  waitlistCPST,
} from './_fixtures.js';
import { getStockPorCliente, getStockRealmenteDisponible } from '../../../src/pure/stock-realmente-disponible.js';

describe('[audit fixtures smoke]', () => {
  it('escenario trivial 3 fisico / 0 reservas → disp 3', () => {
    const deps = makeDeps({ fisicoBySku: { [SKU_STRADIC]: 3 }, pedidos: [] });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(3);
  });

  it('ASIG a Oeste 1u resta del disponible general', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(0);
  });

  it('para el propio cliente Oeste: libreParaCliente = fisico (1), disponibleReal = 0', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const r = getStockPorCliente(SKU_STRADIC, OESTE, deps, AT_NOW);
    expect(r.fisico).toBe(1);
    expect(r.reservadasPorCliente).toBe(1);
    expect(r.reservadasPorOtros).toBe(0);
    expect(r.libreParaCliente).toBe(1); // utilizable(Oeste)
    expect(r.disponibleReal).toBe(0); // demanda total
  });

  it('mix: Sur tiene BO 1u, Oeste tiene ASIG 1u, fisico 1 → el codigo trata BO como reserva (observacion AUDIT-01)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)]),
      ],
    });
    // Codigo real: BO + ASIG = 2, fisico 1, disp = max(0, 1-2) = 0
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(0);
    const rOeste = getStockPorCliente(SKU_STRADIC, OESTE, deps, AT_NOW);
    expect(rOeste.reservadasPorCliente).toBe(1); // Oeste ASIG
    expect(rOeste.reservadasPorOtros).toBe(1); // Sur BO
    // AUDIT-01: libreParaCliente(Oeste) = fisico - otros = 1 - 1 = 0.
    // El prompt dice "Utilizable(Oeste) = 1" en PASO 7 porque considera BO
    // como "no reserva fisica". El codigo considera BO como reserva.
    // Documentar como divergencia semantica en el informe.
    expect(rOeste.libreParaCliente).toBe(0);
  });

  it('waitlist CPST source=stock-asignado-batch reserva stock', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [],
      waitlistEntries: [waitlistCPST(NORTE, [{ code: SKU_STRADIC, qty: 1 }])],
    });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(0);
  });

  it('line BO sin pedido padre createdAt pasado reciente: reserva', () => {
    // Sanity: TTL 7d, pedido creado hace 2 dias, nowMs al día 20
    const deps = makeDeps({
      fisicoBySku: { X: 10 },
      pedidos: [pedidoOpen('p1', NORTE, [lineBO('X', 5)])],
    });
    expect(getStockRealmenteDisponible('X', deps, AT_NOW)).toBe(5);
  });

  it('line confirmed reserva', () => {
    const deps = makeDeps({
      fisicoBySku: { X: 10 },
      pedidos: [pedidoOpen('p1', NORTE, [lineConfirmed('X', 3, { confirmedAt: '2026-10-18T10:00:00.000Z' })], { confirmedAt: '2026-10-18T10:00:00.000Z' })],
    });
    expect(getStockRealmenteDisponible('X', deps, AT_NOW)).toBe(7);
  });
});

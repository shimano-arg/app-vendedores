// @ts-check
/**
 * waitlist-has-exceed.test.js (v1388, 2026-10-21)
 *
 * Tests para src/pure/waitlist-has-exceed.js — fix card-stock-asig-color.
 * Branch: fix-card-stock-asig-color. Reporte Mariano 2026-10-21: cards cpst
 * marcadas naranja/amarillo inconsistente porque el renderer usaba la
 * formula global sin cardCode (bug H1 visto desde el sidebar).
 */
import { describe, expect, it } from 'vitest';
import { computeHasExceed } from '../../src/pure/waitlist-has-exceed.js';
import { AT_NOW, lineASIG, makeDeps, OESTE, pedidoOpen, SKU_STRADIC } from './audit/_fixtures.js';

// =============================================================================
// Caso principal 1 (pedido Mariano): card cpst con qty=1, fisico=1, ASIG propia=1
// NO debe marcar has-exceed. La formula por cliente respeta la reserva propia.
// =============================================================================
describe('card cpst con ASIG propia que cubre el pedido', () => {
  it('qty=1 fisico=1 ASIG propia=1 → hasExceed=false (ASIG propia cubre, no es excedente)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const waitlist = {
      source: 'stock-asignado-batch',
      clientCardCode: OESTE,
      items: [{ code: SKU_STRADIC, qty: 1 }],
    };
    const r = computeHasExceed(waitlist, deps, AT_NOW);
    expect(r.excedentes).toBe(0);
    expect(r.hasExceed).toBe(false);
  });

  it('qty exacta a reserva propia + fisico = reserva propia → hasExceed=false', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 3 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 3)])],
    });
    const waitlist = {
      source: 'stock-asignado-batch',
      clientCardCode: OESTE,
      items: [{ code: SKU_STRADIC, qty: 3 }],
    };
    expect(computeHasExceed(waitlist, deps, AT_NOW).hasExceed).toBe(false);
  });
});

// =============================================================================
// Caso principal 2 (pedido Mariano): card NORMAL con qty=1 y disponible=0
// SÍ debe marcar has-exceed. Formula global cuenta la reserva como ajena.
// =============================================================================
describe('card normal (manual) sin stock disponible', () => {
  it('qty=1 fisico=0 → hasExceed=true (sin stock, excede)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 0 },
      pedidos: [],
    });
    const waitlist = {
      source: 'manual',
      clientCardCode: OESTE,
      items: [{ code: SKU_STRADIC, qty: 1 }],
    };
    const r = computeHasExceed(waitlist, deps, AT_NOW);
    expect(r.excedentes).toBe(1);
    expect(r.hasExceed).toBe(true);
  });

  it('qty=1 fisico=1 pero ASIG propia=1 (pedido normal, no cpst) → hasExceed=true', () => {
    // Pedido normal con ASIG propia NO se filtra al fix H1 (CLAUDE §33).
    // La formula global cuenta la ASIG propia como reserva → disp=0 → excede.
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const waitlist = {
      source: 'manual',
      clientCardCode: OESTE,
      items: [{ code: SKU_STRADIC, qty: 1 }],
    };
    expect(computeHasExceed(waitlist, deps, AT_NOW).hasExceed).toBe(true);
  });
});

// =============================================================================
// Edge case: card cpst SIN clientCardCode → señal muerta (hasExceed=false).
// Mejor false que señal mentirosa — el border rojo tiene que significar algo real.
// =============================================================================
describe('cpst sin clientCardCode (edge case)', () => {
  it('source=cpst + clientCardCode=undefined → hasExceed=false', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 0 },
      pedidos: [],
    });
    const waitlist = {
      source: 'stock-asignado-batch',
      // clientCardCode omitido
      items: [{ code: SKU_STRADIC, qty: 1 }],
    };
    expect(computeHasExceed(waitlist, deps, AT_NOW).hasExceed).toBe(false);
  });

  it('source=cpst + clientCardCode="" → hasExceed=false', () => {
    const deps = makeDeps({ fisicoBySku: {}, pedidos: [] });
    const waitlist = {
      source: 'stock-asignado-batch',
      clientCardCode: '  ',
      items: [{ code: SKU_STRADIC, qty: 1 }],
    };
    expect(computeHasExceed(waitlist, deps, AT_NOW).hasExceed).toBe(false);
  });
});

// =============================================================================
// Guard: input defectuoso.
// =============================================================================
describe('inputs defectuosos', () => {
  it('waitlist=null → hasExceed=false', () => {
    const deps = makeDeps({ fisicoBySku: {}, pedidos: [] });
    expect(computeHasExceed(null, deps, AT_NOW).hasExceed).toBe(false);
  });

  it('items=undefined → hasExceed=false', () => {
    const deps = makeDeps({ fisicoBySku: {}, pedidos: [] });
    expect(computeHasExceed({ source: 'manual' }, deps, AT_NOW).hasExceed).toBe(false);
  });

  it('items vacio → hasExceed=false', () => {
    const deps = makeDeps({ fisicoBySku: {}, pedidos: [] });
    expect(computeHasExceed({ source: 'manual', items: [] }, deps, AT_NOW).hasExceed).toBe(false);
  });

  it('item con qty=0 → no cuenta como excedente', () => {
    const deps = makeDeps({ fisicoBySku: { [SKU_STRADIC]: 0 }, pedidos: [] });
    const waitlist = {
      source: 'manual',
      items: [{ code: SKU_STRADIC, qty: 0 }],
    };
    expect(computeHasExceed(waitlist, deps, AT_NOW).hasExceed).toBe(false);
  });
});

// =============================================================================
// Multiples items — basta UNO para marcar has-exceed.
// =============================================================================
describe('multiples items', () => {
  it('cpst con 2 items: 1 cubre, 1 excede → hasExceed=true', () => {
    const SKU_A = 'A';
    const SKU_B = 'B';
    const deps = makeDeps({
      fisicoBySku: { [SKU_A]: 10, [SKU_B]: 0 },
      pedidos: [],
    });
    const waitlist = {
      source: 'stock-asignado-batch',
      clientCardCode: OESTE,
      items: [
        { code: SKU_A, qty: 1 },
        { code: SKU_B, qty: 1 }, // excede
      ],
    };
    const r = computeHasExceed(waitlist, deps, AT_NOW);
    expect(r.excedentes).toBe(1);
    expect(r.hasExceed).toBe(true);
  });

  it('cpst con 2 items: ambos cubiertos por ASIG propia + stock → hasExceed=false', () => {
    const SKU_A = 'A';
    const SKU_B = 'B';
    const deps = makeDeps({
      fisicoBySku: { [SKU_A]: 1, [SKU_B]: 5 },
      pedidos: [pedidoOpen('p1', OESTE, [lineASIG(SKU_A, 1), lineASIG(SKU_B, 2)])],
    });
    const waitlist = {
      source: 'stock-asignado-batch',
      clientCardCode: OESTE,
      items: [
        { code: SKU_A, qty: 1 }, // cubierto por ASIG propia
        { code: SKU_B, qty: 2 }, // cubierto por ASIG propia
      ],
    };
    expect(computeHasExceed(waitlist, deps, AT_NOW).hasExceed).toBe(false);
  });
});

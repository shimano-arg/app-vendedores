// @ts-check
/**
 * E2 — Tests del fix H1 (T1-T4 del plan fix-stock-cardcode-h1).
 *
 * Verifica que el fix se aplica SOLO a pedidos ex-ASIG y NO se filtra a
 * pedidos normales (evita crear bug H2 "reservas fantasma").
 */
import { describe, expect, it } from 'vitest';
import { splitPedidoLine } from '../../../src/pure/pedido-split.js';
import {
  getStockRealmenteDisponible,
  getStockUtilizableParaClienteExAsig,
} from '../../../src/pure/stock-realmente-disponible.js';
import { AT_NOW, lineASIG, makeDeps, OESTE, pedidoOpen, SKU_STRADIC } from './_fixtures.js';

/**
 * Helper: simula el call-site de doConfirmPedido.getDisp (post-fix).
 *
 * @param {{isExAsig: boolean, cardCode: string|null, deps: any}} args
 */
function getDispPostFix({ isExAsig, cardCode, deps }) {
  return (sku) => {
    if (isExAsig && cardCode) {
      return Math.max(getStockUtilizableParaClienteExAsig(sku, cardCode, deps, AT_NOW), 0);
    }
    return Math.max(getStockRealmenteDisponible(sku, deps, AT_NOW), 0);
  };
}

// =============================================================================
// T1 — Pedido NORMAL con ASIG propia del mismo cliente: fix NO se filtra.
//      disp sigue siendo 0, la línea va a BO y la ASIG propia queda viva.
// =============================================================================
describe('T1 — pedido normal con ASIG propia: fix NO filtra', () => {
  it('fisico=1, Oeste tiene ASIG 1u, pedido normal de Oeste pide 1 → BO (ASIG queda viva)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    // Pedido NUEVO de Oeste (no ex-ASIG) → isExAsig=false.
    const getDisp = getDispPostFix({ isExAsig: false, cardCode: OESTE, deps });
    expect(getDisp(SKU_STRADIC)).toBe(0); // formula global, su ASIG se cuenta como reserva
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
    // Si T1 pasara 'confirmed', el fix se habria filtrado a pedidos normales
    // y crearia bug H2 (la ASIG original NO se cancela en el flow normal,
    // bloque v1280 solo corre con pedidosOrigenes[]).
  });
});

// =============================================================================
// T2 — Pedido ex-ASIG qty=1 fisico=1 ASIG=1 → confirmed. Fix H1 primary.
// =============================================================================
describe('T2 — pedido ex-ASIG qty=1 fisico=1 ASIG(propia)=1 → confirmed', () => {
  it('va a SAP confirmed; la ASIG original queda viva hasta que el bloque v1280 la cancele post-add', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const getDisp = getDispPostFix({ isExAsig: true, cardCode: OESTE, deps });
    expect(getDisp(SKU_STRADIC)).toBe(1); // formula por cliente: firmesPropias(1) + residual(0)
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed');
    expect(lines[0].qty).toBe(1);
  });
});

// =============================================================================
// T3 — Pedido ex-ASIG qty=2 fisico=1 ASIG(propia)=1: split 1 confirmed + 1 BO.
//      Verifica que la fórmula no infla disp más allá del físico (I7 preserved).
// =============================================================================
describe('T3 — pedido ex-ASIG qty=2 fisico=1 ASIG(propia)=1 → split 1+1', () => {
  it('utilizable=1 (acotado por fisico), split en {1 confirmed, 1 BO}', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const getDisp = getDispPostFix({ isExAsig: true, cardCode: OESTE, deps });
    expect(getDisp(SKU_STRADIC)).toBe(1); // Math.min(fisico=1, firmesPropias+residual=1+0)
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 2, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 1, state: 'confirmed' });
    expect(lines[1]).toMatchObject({ qty: 1, state: 'BO' });
  });
});

// =============================================================================
// T4 — currentOrderClient null → fallback al global sin romper.
// =============================================================================
describe('T4 — cardCode null/undefined → fallback global', () => {
  it('isExAsig=true pero cardCode="" → cae al global sin romper', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const getDisp = getDispPostFix({ isExAsig: true, cardCode: '', deps });
    // cardCode vacio → cae al global. disp = max(0, 1 - 1 ASIG) = 0 (el bug
    // original se mantiene en este edge case, pero no rompe).
    expect(getDisp(SKU_STRADIC)).toBe(0);
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
  });

  it('isExAsig=true + cardCode valido pero deps sin pedidos → disp=fisico', () => {
    const deps = makeDeps({ fisicoBySku: { [SKU_STRADIC]: 3 }, pedidos: [] });
    const getDisp = getDispPostFix({ isExAsig: true, cardCode: OESTE, deps });
    expect(getDisp(SKU_STRADIC)).toBe(3);
  });
});

// @ts-check
/**
 * T0 — Regresión bug H1/H2 por "Unificar orden" (feat-unificar-lineas-asig).
 *
 * Reproduce 2 defectos del flow unificación cuando una orden CPST
 * (source='stock-asignado-batch') es absorbida dentro de una orden normal:
 *
 *   P2 — La fórmula del fix H1 (v1380) decide por pedido leyendo
 *        _pendingPedidoSource global. Una orden unificada es normal → su
 *        getDisp cae en fórmula global → bug H1 reaparece.
 *
 *   P3 — mergeLinesFromOrders no agrega identidad ASIG por línea
 *        (asigRefs). Al confirmar, el bloque v1280 no sabe qué ASIG
 *        cancelar → quedan vivas = bug H2 fabricado por unificación.
 *
 * Estos tests DEBEN FALLAR hoy (pre-fix) y pasar a verde en E3 (T0-P2) y
 * E2 (T0-P3) del plan feat-unificar-lineas-asig.
 */
import { describe, expect, it } from 'vitest';
import { splitPedidoLine } from '../../../src/pure/pedido-split.js';
import {
  getStockRealmenteDisponible,
  getStockUtilizableParaClienteExAsig,
} from '../../../src/pure/stock-realmente-disponible.js';
import { mergeLinesFromOrders } from '../../../src/pure/unificar-ordenes.js';
import { AT_NOW, lineASIG, makeDeps, OESTE, pedidoOpen, SKU_STRADIC } from './_fixtures.js';

// =============================================================================
// T0-P2 — Fórmula del fix H1 decide por documento, no por línea.
// =============================================================================
describe('T0-P2 (RED): orden unificada pierde identidad ASIG → bug H1 reaparece', () => {
  /**
   * Escenario:
   * - Oeste tiene ASIG viva de 1u STRADIC (reservada por Pablo), stock físico 1.
   * - CPST 332 creado para Oeste con 1u STRADIC (source='stock-asignado-batch',
   *   pedidosOrigenes=[{pedidoId:'p-oeste-asig', lineIndex:0, sku:STRADIC, qtyAsignada:1}]).
   * - Oeste crea orden NORMAL 460 (sin stock asignado).
   * - Click "Unificar orden" → absorbe 332 dentro de 460.
   * - VDE confirma 460.
   *
   * Hoy: pedido 460 unificado no es CPST → _pendingPedidoSource no es
   *      'stock-asignado-batch' → getDisp cae en fórmula global
   *      → disp(STRADIC) = max(0, 1 - 1 ASIG viva) = 0 → línea va a BO.
   *
   * Post-fix: la línea importada de 332 trae origen='stock-asignado' + asigRefs,
   *      → getDisp decide por línea → fórmula por cliente → disp = 1
   *      → línea va a confirmed → SAP recibe 1.
   */

  it('(RED hoy) mergedLines[importada] tiene origen="stock-asignado"', () => {
    const baseLines = []; // orden 460 vacía (solo items importados)
    const cpstOrder = {
      orderNumber: 332,
      pedidoId: 'cpst-332',
      source: 'stock-asignado-batch', // ← debe ser leído por mergeLinesFromOrders post-fix
      pedidosOrigenes: [
        { pedidoId: 'p-oeste-asig', lineIndex: 0, sku: SKU_STRADIC, qtyAsignada: 1 },
      ],
      lines: [{ code: SKU_STRADIC, qty: 1, desc: 'Reel STRADIC' }],
    };
    const { mergedLines } = mergeLinesFromOrders(baseLines, [cpstOrder]);
    expect(mergedLines).toHaveLength(1);
    // POST-fix: debe tener origen y asigRefs
    expect(mergedLines[0].origen).toBe('stock-asignado'); // ← FAIL hoy (undefined)
  });

  it('(RED hoy) mergedLines[importada] tiene asigRefs con la ASIG original', () => {
    const cpstOrder = {
      orderNumber: 332,
      pedidoId: 'cpst-332',
      source: 'stock-asignado-batch',
      pedidosOrigenes: [
        { pedidoId: 'p-oeste-asig', lineIndex: 0, sku: SKU_STRADIC, qtyAsignada: 1 },
      ],
      lines: [{ code: SKU_STRADIC, qty: 1 }],
    };
    const { mergedLines } = mergeLinesFromOrders([], [cpstOrder]);
    expect(Array.isArray(mergedLines[0].asigRefs)).toBe(true); // ← FAIL hoy
    expect(mergedLines[0].asigRefs[0]).toMatchObject({
      pedidoId: 'p-oeste-asig',
      lineIndex: 0,
      qtyAsignada: 1,
    });
  });

  it('(RED hoy) al confirmar pedido unificado, línea importada va a confirmed (bug H1 NO reaparece)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const cpstOrder = {
      orderNumber: 332,
      pedidoId: 'cpst-332',
      source: 'stock-asignado-batch',
      pedidosOrigenes: [
        { pedidoId: 'p-oeste-asig', lineIndex: 0, sku: SKU_STRADIC, qtyAsignada: 1 },
      ],
      lines: [{ code: SKU_STRADIC, qty: 1, precio: 1000 }],
    };
    const { mergedLines } = mergeLinesFromOrders([], [cpstOrder]);
    // Simula el call-site POST-FIX de doConfirmPedido: decide por línea.
    const rawLine = mergedLines[0];
    const isExAsig = rawLine.origen === 'stock-asignado';
    const getDispLine = (sku) =>
      isExAsig
        ? Math.max(getStockUtilizableParaClienteExAsig(sku, OESTE, deps, AT_NOW), 0)
        : Math.max(getStockRealmenteDisponible(sku, deps, AT_NOW), 0);
    const lines = splitPedidoLine(rawLine, { getDisp: getDispLine, flagEnabled: true });
    expect(lines[0].state).toBe('confirmed'); // ← FAIL hoy (va a BO porque isExAsig=false)
  });
});

// =============================================================================
// T0-P3 — Cancelación ASIG hoy depende de _pendingPedidoOrigenes global.
// =============================================================================
describe('T0-P3 (RED): asigRefs permite cancelar ASIG desde líneas (no desde documento)', () => {
  /**
   * Simula el collector de _origenesACancelar que el bloque v1280 debería
   * usar POST-fix: unir window._pendingPedidoOrigenes (puede ser null para
   * órdenes unificadas) con docData.lines[].asigRefs (nuevo).
   */
  function collectOrigenesACancelar(docDataLines, pendingOrigenes) {
    const result = [];
    const seen = new Set();
    const push = (ref) => {
      const key = `${ref.pedidoId}|${ref.lineIndex}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(ref);
    };
    if (Array.isArray(pendingOrigenes)) {
      for (const r of pendingOrigenes) push(r);
    }
    if (Array.isArray(docDataLines)) {
      for (const line of docDataLines) {
        if (Array.isArray(line.asigRefs)) {
          for (const r of line.asigRefs) push(r);
        }
      }
    }
    return result;
  }

  it('orden unificada (sin _pendingPedidoOrigenes): recolecta ASIG refs desde líneas', () => {
    // POST-fix: mergeLinesFromOrders debería poblar asigRefs en cada línea
    // importada de un CPST. Hoy no lo hace → el collector no encuentra nada
    // → el bloque v1280 no corre → ASIG queda viva.
    const cpstOrder = {
      orderNumber: 332,
      pedidoId: 'cpst-332',
      source: 'stock-asignado-batch',
      pedidosOrigenes: [
        { pedidoId: 'p-oeste-asig', lineIndex: 0, sku: SKU_STRADIC, qtyAsignada: 1 },
      ],
      lines: [{ code: SKU_STRADIC, qty: 1 }],
    };
    const { mergedLines } = mergeLinesFromOrders([], [cpstOrder]);
    const origenes = collectOrigenesACancelar(mergedLines, null);
    expect(origenes).toHaveLength(1); // ← FAIL hoy (mergedLines[0].asigRefs undefined)
    expect(origenes[0]).toMatchObject({
      pedidoId: 'p-oeste-asig',
      lineIndex: 0,
      qtyAsignada: 1,
    });
  });

  it('dedupe: _pendingPedidoOrigenes + asigRefs del mismo (pedidoId,lineIndex) cuenta 1 vez', () => {
    const pending = [{ pedidoId: 'p-oeste-asig', lineIndex: 0, qtyAsignada: 1 }];
    const lines = [
      { code: SKU_STRADIC, asigRefs: [{ pedidoId: 'p-oeste-asig', lineIndex: 0, qtyAsignada: 1 }] },
    ];
    const origenes = collectOrigenesACancelar(lines, pending);
    expect(origenes).toHaveLength(1); // dedupe por (pedidoId, lineIndex)
  });
});

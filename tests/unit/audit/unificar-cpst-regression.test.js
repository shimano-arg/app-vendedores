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
import {
  computeDuplicateCodes,
  getRowColorClass,
  mergeLinesFromOrders,
} from '../../../src/pure/unificar-ordenes.js';
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
// T2 — Unificar 2 órdenes NORMALES (sin source CPST): ninguna línea tiene origen
// =============================================================================
describe('T2 — órdenes normales → sin origen (no se filtra el fix)', () => {
  it('mergedLines[importada] NO tiene origen cuando otherOrder no es CPST', () => {
    const baseLines = [{ code: SKU_STRADIC, qty: 2 }];
    const otherOrder = {
      orderNumber: 100,
      pedidoId: 'orden-normal-1',
      // source ausente, pedidosOrigenes ausente
      lines: [{ code: 'OTRO-SKU', qty: 3 }],
    };
    const { mergedLines } = mergeLinesFromOrders(baseLines, [otherOrder]);
    expect(mergedLines).toHaveLength(2);
    // Línea base: sin origen (nunca tuvo)
    expect(mergedLines[0].origen).toBeUndefined();
    expect(mergedLines[0].asigRefs).toBeUndefined();
    // Línea importada: tiene importedFromOrder pero NO origen/asigRefs
    expect(mergedLines[1].importedFromOrder).toBe(100);
    expect(mergedLines[1].origen).toBeUndefined();
    expect(mergedLines[1].asigRefs).toBeUndefined();
  });
});

// =============================================================================
// T3 — orden unificada mixta (1 reservada + 1 normal): disp per-line
// =============================================================================
describe('T3 — orden mixta: disp por línea, no por documento', () => {
  it('línea reservada va a confirmed; línea normal va a BO; mismo pedido unificado', () => {
    // Fisico STRADIC=1, Oeste ASIG(STRADIC)=1 (reserva propia).
    // Fisico OTRO=0, otro cliente tiene BO reserva (fisico 0 bloqueado).
    const otherSku = 'OTRO-SKU';
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1, [otherSku]: 0 },
      pedidos: [pedidoOpen('p-oeste-asig', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    // Simula el call-site POST-FIX de doConfirmPedido: decide por línea.
    const buildGetDisp = (l) => {
      const isExAsig = l && l.origen === 'stock-asignado';
      return (sku) =>
        isExAsig
          ? Math.max(getStockUtilizableParaClienteExAsig(sku, OESTE, deps, AT_NOW), 0)
          : Math.max(getStockRealmenteDisponible(sku, deps, AT_NOW), 0);
    };
    // Línea 1: reservada (importada de CPST)
    const lineReservada = {
      code: SKU_STRADIC,
      qty: 1,
      precio: 1000,
      origen: 'stock-asignado',
      asigRefs: [{ pedidoId: 'p-oeste-asig', lineIndex: 0, qtyAsignada: 1 }],
    };
    const outReservada = splitPedidoLine(lineReservada, { getDisp: buildGetDisp(lineReservada), flagEnabled: true });
    expect(outReservada[0].state).toBe('confirmed');
    // Línea 2: normal (sin origen)
    const lineNormal = { code: otherSku, qty: 1, precio: 1000 };
    const outNormal = splitPedidoLine(lineNormal, { getDisp: buildGetDisp(lineNormal), flagEnabled: true });
    expect(outNormal[0].state).toBe('BO'); // fisico=0 → sin stock
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

  // T4 — idempotencia: 2 líneas distintas con asigRefs al mismo (pedidoId, lineIndex)
  //      no cancelan 2 veces (ej: VDE sumó manualmente duplicados).
  it('T4 idempotencia: 2 líneas con mismo asigRef (pedidoId,lineIndex) → cancel 1 vez', () => {
    const lines = [
      { code: SKU_STRADIC, qty: 1, asigRefs: [{ pedidoId: 'p-a', lineIndex: 5, qtyAsignada: 1 }] },
      { code: SKU_STRADIC, qty: 1, asigRefs: [{ pedidoId: 'p-a', lineIndex: 5, qtyAsignada: 1 }] },
    ];
    const origenes = collectOrigenesACancelar(lines, null);
    expect(origenes).toHaveLength(1);
    expect(origenes[0]).toMatchObject({ pedidoId: 'p-a', lineIndex: 5 });
  });

  // T5 — SKU duplicado con reserva: original va a 'duplicate-original' (roja);
  //      importada reservada va a 'duplicate-reservado' (azul).
  it('T5 duplicado con reserva: fila original rojo, importada reservada azul', () => {
    const baseLines = [{ code: SKU_STRADIC, qty: 2 }]; // original en orden nueva
    const cpstOrder = {
      orderNumber: 332,
      pedidoId: 'cpst-332',
      source: 'stock-asignado-batch',
      pedidosOrigenes: [
        { pedidoId: 'p-oeste-asig', lineIndex: 0, sku: SKU_STRADIC, qtyAsignada: 1 },
      ],
      lines: [{ code: SKU_STRADIC, qty: 1 }],
    };
    const { mergedLines, duplicateCodes } = mergeLinesFromOrders(baseLines, [cpstOrder]);
    expect(mergedLines).toHaveLength(2);
    // mergedLines[0] = original (sin origen), merged duplicate-original
    expect(getRowColorClass(mergedLines[0], duplicateCodes)).toBe('duplicate-original');
    // mergedLines[1] = importada reservada, duplicate-reservado
    expect(mergedLines[1].origen).toBe('stock-asignado');
    expect(getRowColorClass(mergedLines[1], duplicateCodes)).toBe('duplicate-reservado');
  });

  // T6 — Borrar fila reservada del waitlist NO cancela la ASIG original.
  //      La ASIG se cancela solo via bloque v1280 al confirmar + enviar a SAP
  //      o via CF expireAsigLinesTTLCF. Verificamos que mergeLinesFromOrders +
  //      la lógica de collector (no definida acá) NO disparan cancelación por
  //      remoción. Representamos "borrar" como una línea filtrada del output.
  it('T6 borrar fila reservada: no hay cancellation side-effect en la data', () => {
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
    expect(mergedLines).toHaveLength(1);
    // "borrar" la línea del waitlist: filtrar
    const afterDelete = mergedLines.filter((_l) => false);
    expect(afterDelete).toHaveLength(0);
    // Importante: la data del pedidosOrigenes original (en Firestore) NO fue
    // mutada. mergeLinesFromOrders no muta inputs — eso es la garantía.
    expect(cpstOrder.pedidosOrigenes[0].qtyAsignada).toBe(1); // intacto
    // La cancelación de la ASIG original depende del bloque v1280 al confirmar
    // el pedido. Si no se confirma (la fila fue borrada), la ASIG queda viva.
    // El TTL 7d la expirará si nadie la toca.
  });

  it('T4 N refs distintos: 1 línea con 2 asigRefs distintos (ej: Pablo asignó 2+1 desde pedidos distintos)', () => {
    const lines = [
      {
        code: SKU_STRADIC,
        qty: 3,
        asigRefs: [
          { pedidoId: 'p-a', lineIndex: 5, qtyAsignada: 2 },
          { pedidoId: 'p-b', lineIndex: 3, qtyAsignada: 1 },
        ],
      },
    ];
    const origenes = collectOrigenesACancelar(lines, null);
    expect(origenes).toHaveLength(2); // 2 refs distintas = 2 cancels
  });
});

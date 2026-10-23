// @ts-check
/**
 * v1435 §56 (2026-10-24): test que documenta el comportamiento esperado
 * de `commitPedidoCore` cuando una línea tiene `asigRefs qty=2` pero el
 * cliente pide `qty=5`.
 *
 * Según el flow actual (CLAUDE.md §33 + §35):
 *   - utilizable = breakdown.utilizablePara(cardCode)
 *     = libre + reservas propias (ASIG + confirmed del mismo cliente)
 *   - qtyConfirmed = min(cantidad, utilizable)
 *   - qtyBO = cantidad - qtyConfirmed
 *
 * Esperado:
 *   - 2u (de reserva propia del cliente) → qty confirmed.
 *   - 3u → camino normal (si hay libre, confirmed; sino BO).
 *   - El bloque CPST cancela SOLO las ASIG originales (2u totales referenciadas
 *     por asigRefs).
 *
 * NO toco commitPedidoCore. Solo verifico el modelo mental con la pure fn
 * `getStockUtilizableParaClienteExAsig` + el breakdown.
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';
import { getStockUtilizableParaClienteExAsig } from '../../../src/pure/stock-realmente-disponible.js';

const now = new Date('2026-10-24T15:00:00.000Z').toISOString();
const nowMs = Date.parse(now);

/**
 * Deps estándar para getStockBreakdown.
 * @param {{fisico:number, pedidos:any[]}} opts
 */
function makeDeps({ fisico, pedidos }) {
  return {
    getStockFisico: () => fisico,
    getStockTransito: () => 0,
    pedidos,
    ingresosRepartoActivos: [],
  };
}

const CLIENTE_A = 'C001';
const CLIENTE_B = 'C002';
const SKU = 'STRADIC4000';

describe('commitPedidoCore: línea con asigRefs qty=2, cantidad=5 (contrato §33+§35)', () => {
  it('escenario base: cliente A tiene ASIG=2 propio, físico=5 (3 libres)', () => {
    const pedidos = [
      {
        _fsId: 'p-asig-A',
        closedAt: null,
        clientCardCode: CLIENTE_A,
        lines: [
          {
            state: 'ASIG',
            code: SKU,
            qty: 2,
            qtyOpen: 2,
            asigAt: now,
            asigReserva: true,
            cardCode: CLIENTE_A,
          },
        ],
      },
    ];
    const b = getStockBreakdown(SKU, makeDeps({ fisico: 5, pedidos }), { nowMs });
    // Para el cliente A: 2 propias + 3 libres restantes = 5 utilizables.
    const utilizableA = b.utilizablePara(CLIENTE_A);
    expect(utilizableA).toBe(5);
    // Confirmed = min(5, 5) = 5; BO = 0.
    expect(Math.min(5, utilizableA)).toBe(5);
    expect(5 - Math.min(5, utilizableA)).toBe(0);
  });

  it('escenario pedido ≤ reserva propia: cantidad=2 con ASIG=2 propio y físico=2 → confirmed=2, BO=0', () => {
    const pedidos = [
      {
        _fsId: 'p-asig-A',
        closedAt: null,
        clientCardCode: CLIENTE_A,
        lines: [
          {
            state: 'ASIG',
            code: SKU,
            qty: 2,
            qtyOpen: 2,
            asigAt: now,
            asigReserva: true,
            cardCode: CLIENTE_A,
          },
        ],
      },
    ];
    const utilizable = getStockUtilizableParaClienteExAsig(
      SKU,
      CLIENTE_A,
      makeDeps({ fisico: 2, pedidos }),
      { nowMs }
    );
    expect(utilizable).toBe(2);
    const confirmed = Math.min(2, utilizable);
    const bo = 2 - confirmed;
    expect(confirmed).toBe(2);
    expect(bo).toBe(0);
  });

  it('escenario crítico: cantidad=5 pero ASIG propia=2 y físico=2 (nada libre) → confirmed=2, BO=3', () => {
    // Cliente A tiene ASIG=2 propio. Físico=2 (justo cubre su propia reserva).
    // No hay libre para los extras. Pide 5.
    const pedidos = [
      {
        _fsId: 'p-asig-A',
        closedAt: null,
        clientCardCode: CLIENTE_A,
        lines: [
          {
            state: 'ASIG',
            code: SKU,
            qty: 2,
            qtyOpen: 2,
            asigAt: now,
            asigReserva: true,
            cardCode: CLIENTE_A,
          },
        ],
      },
    ];
    const b = getStockBreakdown(SKU, makeDeps({ fisico: 2, pedidos }), { nowMs });
    const utilizable = b.utilizablePara(CLIENTE_A);
    // utilizablePara = min(fisico, libre + reservasPropias). libre=0, reservas=2 → 2.
    expect(utilizable).toBe(2);
    const cantidad = 5;
    const confirmed = Math.min(cantidad, utilizable);
    const bo = cantidad - confirmed;
    expect(confirmed).toBe(2); // 2u por reserva propia
    expect(bo).toBe(3); // 3u a BO (sin libre)
  });

  it('escenario con libre adicional: cantidad=5, ASIG propia=2, físico=5 → confirmed=5, BO=0', () => {
    const pedidos = [
      {
        _fsId: 'p-asig-A',
        closedAt: null,
        clientCardCode: CLIENTE_A,
        lines: [
          {
            state: 'ASIG',
            code: SKU,
            qty: 2,
            qtyOpen: 2,
            asigAt: now,
            asigReserva: true,
            cardCode: CLIENTE_A,
          },
        ],
      },
    ];
    const utilizable = getStockUtilizableParaClienteExAsig(
      SKU,
      CLIENTE_A,
      makeDeps({ fisico: 5, pedidos }),
      { nowMs }
    );
    expect(utilizable).toBe(5); // 2 propias + 3 libres
    const cantidad = 5;
    const confirmed = Math.min(cantidad, utilizable);
    expect(confirmed).toBe(5);
    expect(cantidad - confirmed).toBe(0);
  });

  it('cliente B (ajeno) con ASIG=2 ajena, físico=5 → cliente B solo ve libre, no reservas de A', () => {
    const pedidos = [
      {
        _fsId: 'p-asig-A',
        closedAt: null,
        clientCardCode: CLIENTE_A,
        lines: [
          {
            state: 'ASIG',
            code: SKU,
            qty: 2,
            qtyOpen: 2,
            asigAt: now,
            asigReserva: true,
            cardCode: CLIENTE_A,
          },
        ],
      },
    ];
    const utilizableB = getStockUtilizableParaClienteExAsig(
      SKU,
      CLIENTE_B,
      makeDeps({ fisico: 5, pedidos }),
      { nowMs }
    );
    // Cliente B no es dueño de la ASIG — solo ve libre = físico - reservas ajenas = 5 - 2 = 3.
    expect(utilizableB).toBe(3);
  });
});

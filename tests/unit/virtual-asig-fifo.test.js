import { describe, expect, it } from 'vitest';
import { computeVirtualAsigFifo } from '../../src/pure/virtual-asig-fifo.js';

function mkPedido(fsId, clientCardCode, lines, createdAtMs = 0, closedAt = null) {
  return {
    _fsId: fsId,
    clientCardCode,
    lines,
    createdAt: createdAtMs ? { toMillis: () => createdAtMs } : null,
    closedAt,
  };
}

const stockMap = (m) => (sku) => m[String(sku).toUpperCase()] || 0;

describe('computeVirtualAsigFifo', () => {
  it('devuelve Map vacio con inputs vacios', () => {
    expect(computeVirtualAsigFifo([], stockMap({}))).toEqual(new Map());
  });

  it('devuelve Map vacio con inputs invalidos', () => {
    expect(computeVirtualAsigFifo(null, stockMap({}))).toEqual(new Map());
    expect(computeVirtualAsigFifo([], null)).toEqual(new Map());
  });

  it('BO de 4u con stock 1u -> virtual ASIG = 1u (cap al stock disp)', () => {
    const pedidos = [mkPedido('p1', 'C1', [{ code: 'CU3801HGK', state: 'BO', qtyOpen: 4 }], 1000)];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ CU3801HGK: 1 }));
    expect(result.get('p1:0')).toBe(1);
  });

  it('BO con stock 0 -> no entra en el map (va a BACKORDER)', () => {
    const pedidos = [mkPedido('p1', 'C1', [{ code: 'SKU', state: 'BO', qtyOpen: 4 }], 1000)];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 0 }));
    expect(result.has('p1:0')).toBe(false);
  });

  it('BO con stock >= qtyOpen -> virtual ASIG = qtyOpen (sin cap)', () => {
    const pedidos = [mkPedido('p1', 'C1', [{ code: 'SKU', state: 'BO', qtyOpen: 2 }], 1000)];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 10 }));
    expect(result.get('p1:0')).toBe(2);
  });

  it('FIFO cross-cliente: cliente MAS VIEJO gana el stock, segundo se queda sin virtual ASIG', () => {
    const pedidos = [
      mkPedido('pOld', 'C1', [{ code: 'SKU', state: 'BO', qtyOpen: 2 }], 1000),
      mkPedido('pNew', 'C2', [{ code: 'SKU', state: 'BO', qtyOpen: 2 }], 2000),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 1 }));
    expect(result.get('pOld:0')).toBe(1);
    expect(result.has('pNew:0')).toBe(false);
  });

  it('FIFO: 3 clientes compitiendo por 1u -> solo el mas viejo gana', () => {
    const pedidos = [
      mkPedido('pMid', 'C2', [{ code: 'SKU', state: 'BO', qtyOpen: 2 }], 2000),
      mkPedido('pOld', 'C1', [{ code: 'SKU', state: 'BO', qtyOpen: 2 }], 1000),
      mkPedido('pNew', 'C3', [{ code: 'SKU', state: 'BO', qtyOpen: 2 }], 3000),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 1 }));
    expect(result.get('pOld:0')).toBe(1);
    expect(result.has('pMid:0')).toBe(false);
    expect(result.has('pNew:0')).toBe(false);
  });

  it('ASIG consume stock PRIMERO; lo que sobra va a BO virtual', () => {
    const pedidos = [
      mkPedido('pAsig', 'C1', [{ code: 'SKU', state: 'ASIG', qtyOpen: 3 }], 1000),
      mkPedido('pBo', 'C2', [{ code: 'SKU', state: 'BO', qtyOpen: 10 }], 2000),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 5 }));
    // ASIG consume 3 de 5 fisico -> remain 2 para BO
    expect(result.get('pBo:0')).toBe(2);
    // ASIG no entra en el map (es una ASIG real, no virtual)
    expect(result.has('pAsig:0')).toBe(false);
  });

  it('ASIG > stock -> BO lines no reciben nada (ASIG committed gana)', () => {
    const pedidos = [
      mkPedido('pAsig', 'C1', [{ code: 'SKU', state: 'ASIG', qtyOpen: 10 }], 1000),
      mkPedido('pBo', 'C2', [{ code: 'SKU', state: 'BO', qtyOpen: 5 }], 2000),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 3 }));
    expect(result.has('pBo:0')).toBe(false);
  });

  it('pedidos con closedAt se ignoran (ni consumen stock ni compiten)', () => {
    const pedidos = [
      mkPedido('pClosed', 'C1', [{ code: 'SKU', state: 'ASIG', qtyOpen: 100 }], 500, {
        seconds: 1,
      }),
      mkPedido('pOpen', 'C2', [{ code: 'SKU', state: 'BO', qtyOpen: 2 }], 1000),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 2 }));
    expect(result.get('pOpen:0')).toBe(2);
  });

  it('lines con state distinto a ASIG/BO se ignoran (confirmed, pending, recycled, cancelled)', () => {
    const pedidos = [
      mkPedido(
        'p1',
        'C1',
        [
          { code: 'SKU', state: 'confirmed', qtyOpen: 100 },
          { code: 'SKU', state: 'pending', qtyOpen: 100 },
          { code: 'SKU', state: 'recycled', qtyOpen: 100 },
          { code: 'SKU', state: 'cancelled', qtyOpen: 100 },
          { code: 'SKU', state: 'BO', qtyOpen: 3 },
        ],
        1000
      ),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 10 }));
    expect(result.get('p1:4')).toBe(3);
  });

  it('qtyOpen <= 0 o code vacio se ignoran', () => {
    const pedidos = [
      mkPedido(
        'p1',
        'C1',
        [
          { code: 'SKU', state: 'BO', qtyOpen: 0 },
          { code: '', state: 'BO', qtyOpen: 5 },
          { code: 'SKU', state: 'BO', qtyOpen: 2 },
        ],
        1000
      ),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 10 }));
    expect(result.get('p1:2')).toBe(2);
    expect(result.has('p1:0')).toBe(false);
    expect(result.has('p1:1')).toBe(false);
  });

  it('SKU case-insensitive para el matching con stock', () => {
    const pedidos = [mkPedido('p1', 'C1', [{ code: 'cu3801hgk', state: 'BO', qtyOpen: 4 }], 1000)];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ CU3801HGK: 1 }));
    expect(result.get('p1:0')).toBe(1);
  });

  it('tie en createdAt se rompe por pedidoId para determinismo', () => {
    const pedidos = [
      mkPedido('pB', 'C2', [{ code: 'SKU', state: 'BO', qtyOpen: 1 }], 1000),
      mkPedido('pA', 'C1', [{ code: 'SKU', state: 'BO', qtyOpen: 1 }], 1000),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 1 }));
    // pA < pB alfabetico -> pA gana
    expect(result.get('pA:0')).toBe(1);
    expect(result.has('pB:0')).toBe(false);
  });

  it('pedido sin createdAt usa 0 (gana por antiguedad)', () => {
    const pedidos = [
      mkPedido('pNew', 'C1', [{ code: 'SKU', state: 'BO', qtyOpen: 1 }], 5000),
      mkPedido('pNoDate', 'C2', [{ code: 'SKU', state: 'BO', qtyOpen: 1 }], 0),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 1 }));
    expect(result.get('pNoDate:0')).toBe(1);
    expect(result.has('pNew:0')).toBe(false);
  });

  it('un mismo pedido con 2 lineas BO del mismo SKU: ambas lineas allocan FIFO en orden de index', () => {
    const pedidos = [
      mkPedido(
        'p1',
        'C1',
        [
          { code: 'SKU', state: 'BO', qtyOpen: 3 },
          { code: 'SKU', state: 'BO', qtyOpen: 5 },
        ],
        1000
      ),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ SKU: 4 }));
    // Primera linea: 3u (completa). Segunda: 1u (lo que queda).
    expect(result.get('p1:0')).toBe(3);
    expect(result.get('p1:1')).toBe(1);
  });

  it('escenario Alan Oscar Nicolas Rodriguez: 4u BO con stock 1u -> 1u virtual + 3u BO real', () => {
    const pedidos = [
      mkPedido('K88WVs', 'C_ALAN', [{ code: 'CU3801HGK', state: 'BO', qtyOpen: 4 }], 1700000000000),
    ];
    const result = computeVirtualAsigFifo(pedidos, stockMap({ CU3801HGK: 1 }));
    expect(result.get('K88WVs:0')).toBe(1);
  });
});

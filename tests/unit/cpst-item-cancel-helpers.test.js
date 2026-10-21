// @ts-check
/**
 * v1399 §40.7 — tests para collectAsigRefsForItemCancel, sumQtyBySku y
 * computeRecorteVendedorPlan.
 */
import { describe, expect, it } from 'vitest';
import {
  collectAsigRefsForItemCancel,
  computeRecorteVendedorPlan,
  sumQtyBySku,
} from '../../src/pure/cpst-item-cancel-helpers.js';

describe('v1399 §40.7 collectAsigRefsForItemCancel', () => {
  it('item con asigRefs → extrae', () => {
    const w = {
      items: [
        {
          code: 'CLC70MHAAR',
          asigRefs: [
            { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 },
            { pedidoId: 'p2', lineIndex: 1, qtyAsignada: 3 },
          ],
        },
      ],
    };
    const refs = collectAsigRefsForItemCancel(w, 0);
    expect(refs).toHaveLength(2);
    expect(refs[0].qtyAsignada).toBe(2);
    expect(refs[1].qtyAsignada).toBe(3);
  });

  it('item sin asigRefs: fallback a w.pedidosOrigenes filtrado por SKU', () => {
    const w = {
      items: [{ code: 'EXGC66HBAR' }],
      pedidosOrigenes: [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2, sku: 'EXGC66HBAR' },
        { pedidoId: 'p2', lineIndex: 1, qtyAsignada: 5, sku: 'OTRO_SKU' }, // skip
      ],
    };
    const refs = collectAsigRefsForItemCancel(w, 0);
    expect(refs).toHaveLength(1);
    expect(refs[0].pedidoId).toBe('p1');
    expect(refs[0].qtyAsignada).toBe(2);
  });

  it('mezcla asigRefs + pedidosOrigenes: unión dedupe', () => {
    const w = {
      items: [
        {
          code: 'X',
          asigRefs: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
        },
      ],
      pedidosOrigenes: [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 3, sku: 'X' }, // dedupe (max qty)
        { pedidoId: 'p3', lineIndex: 2, qtyAsignada: 1, sku: 'X' },
      ],
    };
    const refs = collectAsigRefsForItemCancel(w, 0);
    expect(refs).toHaveLength(2);
    const r0 = refs.find((r) => r.pedidoId === 'p1');
    expect(r0.qtyAsignada).toBe(3); // max
    const r3 = refs.find((r) => r.pedidoId === 'p3');
    expect(r3.qtyAsignada).toBe(1);
  });

  it('item sin reserva → []', () => {
    const w = { items: [{ code: 'X', qty: 1 }] };
    expect(collectAsigRefsForItemCancel(w, 0)).toEqual([]);
  });

  it('índice inválido → []', () => {
    const w = { items: [{ code: 'X' }] };
    expect(collectAsigRefsForItemCancel(w, 99)).toEqual([]);
    expect(collectAsigRefsForItemCancel(null, 0)).toEqual([]);
  });
});

describe('v1399 §40.7 sumQtyBySku', () => {
  it('suma qty por SKU (lowercase/uppercase)', () => {
    const r = sumQtyBySku([
      { code: 'X', qty: 3 },
      { code: 'x', qty: 2 }, // normaliza case
      { code: 'Y', qty: 5 },
    ]);
    expect(r.X).toBe(5);
    expect(r.Y).toBe(5);
  });

  it('array vacío → {}', () => {
    expect(sumQtyBySku([])).toEqual({});
    expect(sumQtyBySku(null)).toEqual({});
  });
});

describe('v1399 §40.7 computeRecorteVendedorPlan', () => {
  it('T: reserva 5 editada a 3 → qtyConsumed=3 qtyRecortado=2', () => {
    const origenes = [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 5, sku: 'ALV6000FA' }];
    const qtyConsumedBySku = { ALV6000FA: 3 };
    const plan = computeRecorteVendedorPlan(origenes, qtyConsumedBySku);
    expect(plan).toHaveLength(1);
    expect(plan[0].qtyConsumed).toBe(3);
    expect(plan[0].qtyRecortado).toBe(2);
  });

  it('reserva 5 editada a 7 → qtyConsumed=5 qtyRecortado=0 (excedente va a BO en pedido B, fuera de este plan)', () => {
    const origenes = [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 5, sku: 'X' }];
    const qtyConsumedBySku = { X: 7 };
    const plan = computeRecorteVendedorPlan(origenes, qtyConsumedBySku);
    expect(plan[0].qtyConsumed).toBe(5);
    expect(plan[0].qtyRecortado).toBe(0);
  });

  it('reserva 5 editada a 0 (quitada) → qtyConsumed=0 qtyRecortado=5', () => {
    const origenes = [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 5, sku: 'X' }];
    const qtyConsumedBySku = {}; // X ausente
    const plan = computeRecorteVendedorPlan(origenes, qtyConsumedBySku);
    expect(plan[0].qtyConsumed).toBe(0);
    expect(plan[0].qtyRecortado).toBe(5);
  });

  it('2 refs del mismo SKU: distribuye FIFO contra qtyConsumedBySku', () => {
    const origenes = [
      { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 3, sku: 'X' },
      { pedidoId: 'p2', lineIndex: 1, qtyAsignada: 3, sku: 'X' },
    ];
    const qtyConsumedBySku = { X: 4 };
    const plan = computeRecorteVendedorPlan(origenes, qtyConsumedBySku);
    // Primera ref consume 3 (todo). Segunda consume 1, recorta 2.
    expect(plan[0].qtyConsumed).toBe(3);
    expect(plan[0].qtyRecortado).toBe(0);
    expect(plan[1].qtyConsumed).toBe(1);
    expect(plan[1].qtyRecortado).toBe(2);
  });

  it('qtyConsumedBySku no mutable: pasa copia', () => {
    const origenes = [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2, sku: 'X' }];
    const consumed = { X: 5 };
    computeRecorteVendedorPlan(origenes, consumed);
    expect(consumed.X).toBe(5); // sin mutación external
  });

  it('caso real SNAKE S.R.L. ALV6000FA 1u reservada, editada a 1 → consumed=1', () => {
    const origenes = [{ pedidoId: 'xyz', lineIndex: 0, qtyAsignada: 1, sku: 'ALV6000FA' }];
    const consumed = { ALV6000FA: 1 };
    const plan = computeRecorteVendedorPlan(origenes, consumed);
    expect(plan[0].qtyConsumed).toBe(1);
    expect(plan[0].qtyRecortado).toBe(0);
  });

  it('caso real SNAKE S.R.L. ALV6000FA 1u reservada, VDE edita a 0 (quita) → recortado=1', () => {
    const origenes = [{ pedidoId: 'xyz', lineIndex: 0, qtyAsignada: 1, sku: 'ALV6000FA' }];
    const consumed = {}; // VDE eliminó la línea
    const plan = computeRecorteVendedorPlan(origenes, consumed);
    expect(plan[0].qtyConsumed).toBe(0);
    expect(plan[0].qtyRecortado).toBe(1);
  });
});

// @ts-check
/**
 * Tarea L (v1457 2026-10-25) — Unit tests `src/pure/bo_entry_logic.js`.
 */
import { describe, expect, it } from 'vitest';
import {
  computeBoEntryRows,
  findIdenticalOpenOrder,
  isExcelIdenticalToOpenOrder,
  setBoEntryRowResolution,
  unresolvedBoEntryRows,
} from '../../src/pure/bo_entry_logic.js';

describe('computeBoEntryRows', () => {
  it('T1: devuelve [] si no hay items', () => {
    const r = computeBoEntryRows({
      items: [],
      boVigente: [{ sku: 'X', cantidad: 5, fechaIso: '2026-10-12T00:00:00Z' }],
    });
    expect(r).toEqual([]);
  });

  it('T2: devuelve [] si no hay BO', () => {
    const r = computeBoEntryRows({
      items: [{ code: 'X', qty: 5 }],
      boVigente: [],
    });
    expect(r).toEqual([]);
  });

  it('T3: match: 1 SKU con BO + 1 sin BO → 1 fila roja', () => {
    const r = computeBoEntryRows({
      items: [
        { code: '9691', qty: 20 },
        { code: '7777', qty: 5 },
      ],
      boVigente: [{ sku: '9691', cantidad: 20, fechaIso: '2026-10-12T00:00:00Z' }],
    });
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('9691');
    expect(r[0].cantidadNueva).toBe(20);
    expect(r[0].cantidadBoPrevia).toBe(20);
    expect(r[0].resolved).toBe(null);
    expect(r[0].resolvedQty).toBe(20);
  });

  it('T4: SKU case-insensitive matching', () => {
    const r = computeBoEntryRows({
      items: [{ code: 'FC-M8100', qty: 2 }],
      boVigente: [{ sku: 'fc-m8100', cantidad: 3, fechaIso: '2026-10-10T00:00:00Z' }],
    });
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('fc-m8100');
    expect(r[0].cantidadBoPrevia).toBe(3);
  });

  it('T5: BO con dos entries mismo SKU → suma cantidad + fecha más vieja', () => {
    const r = computeBoEntryRows({
      items: [{ code: '9691', qty: 10 }],
      boVigente: [
        { sku: '9691', cantidad: 10, fechaIso: '2026-10-12T00:00:00Z' },
        { sku: '9691', cantidad: 5, fechaIso: '2026-10-10T00:00:00Z' },
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0].cantidadBoPrevia).toBe(15);
    expect(r[0].fechaBoPrevio).toBe('2026-10-10T00:00:00Z');
  });

  it('T6: items duplicados por code → suma qty', () => {
    const r = computeBoEntryRows({
      items: [
        { code: '9691', qty: 10 },
        { code: '9691', qty: 5 },
      ],
      boVigente: [{ sku: '9691', cantidad: 20, fechaIso: '2026-10-12T00:00:00Z' }],
    });
    expect(r).toHaveLength(1);
    expect(r[0].cantidadNueva).toBe(15);
  });

  it('T7: piso ASIG se propaga desde items', () => {
    const r = computeBoEntryRows({
      items: [{ code: '9691', qty: 20, qtyAsignadaPrevia: 10 }],
      boVigente: [{ sku: '9691', cantidad: 20, fechaIso: '2026-10-12T00:00:00Z' }],
    });
    expect(r[0].piso).toBe(10);
  });

  it('T8: null safety', () => {
    expect(computeBoEntryRows(null)).toEqual([]);
    expect(computeBoEntryRows({ items: null, boVigente: null })).toEqual([]);
  });

  it('T9: BO cantidad=0 se ignora', () => {
    const r = computeBoEntryRows({
      items: [{ code: '9691', qty: 20 }],
      boVigente: [{ sku: '9691', cantidad: 0, fechaIso: '2026-10-12T00:00:00Z' }],
    });
    expect(r).toEqual([]);
  });

  it('T10: items qty<=0 se ignoran', () => {
    const r = computeBoEntryRows({
      items: [{ code: '9691', qty: 0 }],
      boVigente: [{ sku: '9691', cantidad: 5, fechaIso: '2026-10-12T00:00:00Z' }],
    });
    expect(r).toEqual([]);
  });

  it('T11: output ordenado por sku ascendente', () => {
    const r = computeBoEntryRows({
      items: [
        { code: 'ZZZ', qty: 1 },
        { code: 'AAA', qty: 1 },
      ],
      boVigente: [
        { sku: 'ZZZ', cantidad: 2 },
        { sku: 'AAA', cantidad: 2 },
      ],
    });
    expect(r.map((x) => x.sku)).toEqual(['aaa', 'zzz']);
  });

  it('T12: idempotencia — misma input, mismo output', () => {
    const args = {
      items: [{ code: '9691', qty: 20 }],
      boVigente: [{ sku: '9691', cantidad: 20, fechaIso: '2026-10-12T00:00:00Z' }],
    };
    const r1 = computeBoEntryRows(args);
    const r2 = computeBoEntryRows(args);
    expect(r1).toEqual(r2);
  });
});

describe('setBoEntryRowResolution', () => {
  const base = () => ({
    sku: '9691',
    cantidadNueva: 10,
    cantidadBoPrevia: 20,
    fechaBoPrevio: '2026-10-12T00:00:00Z',
    piso: 0,
    resolved: /** @type {'same' | 'additional' | null} */ (null),
    resolvedQty: 10,
  });

  it('T1: "same" sin piso → cantidadNueva', () => {
    const r = setBoEntryRowResolution(base(), 'same');
    expect(r.resolved).toBe('same');
    expect(r.resolvedQty).toBe(10);
  });

  it('T2: "same" con piso > cantidadNueva → piso', () => {
    const row = base();
    row.piso = 15;
    const r = setBoEntryRowResolution(row, 'same');
    expect(r.resolvedQty).toBe(15);
  });

  it('T3: "additional" sin piso → nueva + previa', () => {
    const r = setBoEntryRowResolution(base(), 'additional');
    expect(r.resolved).toBe('additional');
    expect(r.resolvedQty).toBe(30);
  });

  it('T4: "additional" con piso bajo → suma', () => {
    const row = base();
    row.piso = 5;
    const r = setBoEntryRowResolution(row, 'additional');
    expect(r.resolvedQty).toBe(30);
  });

  it('T5: "additional" con piso > suma → piso', () => {
    const row = base();
    row.cantidadNueva = 1;
    row.cantidadBoPrevia = 1;
    row.piso = 10;
    const r = setBoEntryRowResolution(row, 'additional');
    expect(r.resolvedQty).toBe(10);
  });

  it('T6: choice inválido no modifica row', () => {
    const row = base();
    // @ts-expect-error — testing invalid input
    const r = setBoEntryRowResolution(row, 'wrong');
    expect(r).toBe(row);
  });

  it('T7: null safe', () => {
    // @ts-expect-error — testing null input
    expect(setBoEntryRowResolution(null, 'same')).toBe(null);
  });
});

describe('unresolvedBoEntryRows', () => {
  it('T1: filtra solo las resolved===null', () => {
    const rows = [
      { resolved: null, sku: 'A' },
      { resolved: 'same', sku: 'B' },
      { resolved: null, sku: 'C' },
    ];
    const r = unresolvedBoEntryRows(/** @type {any} */ (rows));
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.sku)).toEqual(['A', 'C']);
  });

  it('T2: null safe', () => {
    expect(unresolvedBoEntryRows(/** @type {any} */ (null))).toEqual([]);
  });
});

describe('isExcelIdenticalToOpenOrder', () => {
  it('T1: Excel y orden tienen mismos SKUs + qty → identical=true', () => {
    const r = isExcelIdenticalToOpenOrder({
      items: [
        { code: '9691', qty: 20 },
        { code: '7777', qty: 5 },
      ],
      openOrder: {
        _id: 'o1',
        orderNumber: 435,
        items: [
          { code: '9691', qty: 20 },
          { code: '7777', qty: 5 },
        ],
        createdAt: '2026-10-12T00:00:00Z',
      },
    });
    expect(r.identical).toBe(true);
    expect(r.openOrderNumber).toBe(435);
    expect(r.fechaCargaOpenOrder).toBe('2026-10-12T00:00:00Z');
  });

  it('T2: cantidades distintas → false', () => {
    const r = isExcelIdenticalToOpenOrder({
      items: [{ code: '9691', qty: 20 }],
      openOrder: {
        _id: 'o1',
        orderNumber: 435,
        items: [{ code: '9691', qty: 5 }],
      },
    });
    expect(r.identical).toBe(false);
  });

  it('T3: SKU extra en Excel → false', () => {
    const r = isExcelIdenticalToOpenOrder({
      items: [
        { code: '9691', qty: 20 },
        { code: '8888', qty: 5 },
      ],
      openOrder: { _id: 'o1', orderNumber: 435, items: [{ code: '9691', qty: 20 }] },
    });
    expect(r.identical).toBe(false);
  });

  it('T4: SKU case-insensitive', () => {
    const r = isExcelIdenticalToOpenOrder({
      items: [{ code: 'FC-M8100', qty: 2 }],
      openOrder: { _id: 'o1', orderNumber: 435, items: [{ code: 'fc-m8100', qty: 2 }] },
    });
    expect(r.identical).toBe(true);
  });

  it('T5: items vacío → false', () => {
    expect(isExcelIdenticalToOpenOrder({ items: [], openOrder: { items: [] } }).identical).toBe(
      false
    );
  });

  it('T6: null safe', () => {
    expect(isExcelIdenticalToOpenOrder(/** @type {any} */ (null)).identical).toBe(false);
  });

  it('T7: items repetidos en Excel se suman antes de comparar', () => {
    const r = isExcelIdenticalToOpenOrder({
      items: [
        { code: '9691', qty: 10 },
        { code: '9691', qty: 10 },
      ],
      openOrder: { _id: 'o1', orderNumber: 435, items: [{ code: '9691', qty: 20 }] },
    });
    expect(r.identical).toBe(true);
  });

  it('T8: createdAt Date objeto se formatea a ISO', () => {
    const d = new Date('2026-10-12T00:00:00Z');
    const r = isExcelIdenticalToOpenOrder({
      items: [{ code: '9691', qty: 20 }],
      openOrder: { _id: 'o1', orderNumber: 435, items: [{ code: '9691', qty: 20 }], createdAt: d },
    });
    expect(r.fechaCargaOpenOrder).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('findIdenticalOpenOrder', () => {
  it('T1: match primera orden idéntica, devuelve openOrderId', () => {
    const r = findIdenticalOpenOrder({
      items: [{ code: '9691', qty: 20 }],
      openOrders: [
        { _id: 'o1', orderNumber: 435, items: [{ code: '9999', qty: 1 }] },
        { _id: 'o2', orderNumber: 436, items: [{ code: '9691', qty: 20 }] },
      ],
    });
    expect(r.identical).toBe(true);
    expect(r.openOrderId).toBe('o2');
  });

  it('T2: ninguna identica → identical=false', () => {
    const r = findIdenticalOpenOrder({
      items: [{ code: '9691', qty: 20 }],
      openOrders: [{ _id: 'o1', orderNumber: 435, items: [{ code: '9999', qty: 1 }] }],
    });
    expect(r.identical).toBe(false);
  });

  it('T3: openOrders vacío → false', () => {
    expect(findIdenticalOpenOrder({ items: [{ code: 'A', qty: 1 }], openOrders: [] }).identical).toBe(
      false
    );
  });
});

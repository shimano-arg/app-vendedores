// @ts-check
/**
 * Tarea L (v1457 2026-10-25) — §57 Test de sincronía entre
 * `src/pure/bo_entry_logic.js` y `functions/core/bo_entry_logic.js`.
 *
 * Si los dos archivos divergen (en comportamiento o en API pública), este
 * test falla.
 */
import { describe, expect, it } from 'vitest';
import * as mirror from '../../../functions/core/bo_entry_logic.js';
import * as pure from '../../../src/pure/bo_entry_logic.js';

const BO_FIXTURES = [
  // Sin items, sin BO.
  { items: [], boVigente: [], clienteCardCode: 'C001' },
  // Items pero sin BO.
  {
    items: [{ code: '9691', qty: 20 }],
    boVigente: [],
    clienteCardCode: 'C001',
  },
  // BO pero sin match de SKU.
  {
    items: [{ code: '9691', qty: 20 }],
    boVigente: [{ sku: 'XXXX', cantidad: 5, fechaIso: '2026-10-12T00:00:00Z' }],
    clienteCardCode: 'C001',
  },
  // Match: 1 SKU con BO + 1 sin BO.
  {
    items: [
      { code: '9691', qty: 20 },
      { code: '7777', qty: 5 },
    ],
    boVigente: [{ sku: '9691', cantidad: 20, fechaIso: '2026-10-12T00:00:00Z' }],
    clienteCardCode: 'C001',
  },
  // Match + piso ASIG previo.
  {
    items: [{ code: '9691', qty: 20, qtyAsignadaPrevia: 10 }],
    boVigente: [{ sku: '9691', cantidad: 20, fechaIso: '2026-10-12T00:00:00Z' }],
    clienteCardCode: 'C001',
  },
  // BO duplicado por SKU (dos entries) — se suma.
  {
    items: [{ code: '9691', qty: 20 }],
    boVigente: [
      { sku: '9691', cantidad: 10, fechaIso: '2026-10-10T00:00:00Z' },
      { sku: '9691', cantidad: 5, fechaIso: '2026-10-12T00:00:00Z' },
    ],
    clienteCardCode: 'C001',
  },
  // SKU case-insensitive.
  {
    items: [{ code: 'FC-M8100', qty: 2 }],
    boVigente: [{ sku: 'fc-m8100', cantidad: 3, fechaIso: '2026-10-12T00:00:00Z' }],
    clienteCardCode: 'C001',
  },
  // Items duplicados por code — se suma.
  {
    items: [
      { code: '9691', qty: 10 },
      { code: '9691', qty: 5 },
    ],
    boVigente: [{ sku: '9691', cantidad: 20, fechaIso: '2026-10-12T00:00:00Z' }],
    clienteCardCode: 'C001',
  },
  // Null safety.
  { items: null, boVigente: null },
];

const EXCEL_FIXTURES = [
  // Nada.
  { items: [], openOrder: { items: [] } },
  // Mismos items + mismas qty.
  {
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
  },
  // Mismos SKUs, qty distinta.
  {
    items: [{ code: '9691', qty: 20 }],
    openOrder: {
      _id: 'o1',
      orderNumber: 435,
      items: [{ code: '9691', qty: 5 }],
      createdAt: '2026-10-12T00:00:00Z',
    },
  },
  // SKU extra en Excel.
  {
    items: [
      { code: '9691', qty: 20 },
      { code: '8888', qty: 5 },
    ],
    openOrder: {
      _id: 'o1',
      orderNumber: 435,
      items: [{ code: '9691', qty: 20 }],
    },
  },
  // SKU case-insensitive match.
  {
    items: [{ code: 'FC-M8100', qty: 2 }],
    openOrder: {
      _id: 'o1',
      orderNumber: 435,
      items: [{ code: 'fc-m8100', qty: 2 }],
      createdAt: '2026-10-12T00:00:00Z',
    },
  },
];

describe('tarea L §57 bo_entry_logic sync: src/pure vs functions/core', () => {
  it('ambos exportan computeBoEntryRows', () => {
    expect(typeof pure.computeBoEntryRows).toBe('function');
    expect(typeof mirror.computeBoEntryRows).toBe('function');
  });

  it('ambos exportan setBoEntryRowResolution', () => {
    expect(typeof pure.setBoEntryRowResolution).toBe('function');
    expect(typeof mirror.setBoEntryRowResolution).toBe('function');
  });

  it('ambos exportan unresolvedBoEntryRows', () => {
    expect(typeof pure.unresolvedBoEntryRows).toBe('function');
    expect(typeof mirror.unresolvedBoEntryRows).toBe('function');
  });

  it('ambos exportan isExcelIdenticalToOpenOrder', () => {
    expect(typeof pure.isExcelIdenticalToOpenOrder).toBe('function');
    expect(typeof mirror.isExcelIdenticalToOpenOrder).toBe('function');
  });

  it('ambos exportan findIdenticalOpenOrder', () => {
    expect(typeof pure.findIdenticalOpenOrder).toBe('function');
    expect(typeof mirror.findIdenticalOpenOrder).toBe('function');
  });

  for (let i = 0; i < BO_FIXTURES.length; i++) {
    const f = BO_FIXTURES[i];
    it(`computeBoEntryRows fixture[${i}] → mismo output`, () => {
      const rPure = pure.computeBoEntryRows(f);
      const rMirror = mirror.computeBoEntryRows(f);
      expect(rPure).toEqual(rMirror);
    });
  }

  for (let i = 0; i < EXCEL_FIXTURES.length; i++) {
    const f = EXCEL_FIXTURES[i];
    it(`isExcelIdenticalToOpenOrder fixture[${i}] → mismo output`, () => {
      const rPure = pure.isExcelIdenticalToOpenOrder(f);
      const rMirror = mirror.isExcelIdenticalToOpenOrder(f);
      expect(rPure).toEqual(rMirror);
    });
  }

  it('setBoEntryRowResolution: "same" preserva piso', () => {
    const row = {
      sku: '9691',
      cantidadNueva: 10,
      cantidadBoPrevia: 20,
      fechaBoPrevio: '2026-10-12T00:00:00Z',
      piso: 15,
      resolved: null,
      resolvedQty: 10,
    };
    const rPure = pure.setBoEntryRowResolution(row, 'same');
    const rMirror = mirror.setBoEntryRowResolution(row, 'same');
    expect(rPure).toEqual(rMirror);
    expect(rPure.resolvedQty).toBe(15); // max(10, 15)
  });

  it('setBoEntryRowResolution: "additional" suma + piso', () => {
    const row = {
      sku: '9691',
      cantidadNueva: 10,
      cantidadBoPrevia: 20,
      fechaBoPrevio: '2026-10-12T00:00:00Z',
      piso: 5,
      resolved: null,
      resolvedQty: 10,
    };
    const rPure = pure.setBoEntryRowResolution(row, 'additional');
    const rMirror = mirror.setBoEntryRowResolution(row, 'additional');
    expect(rPure).toEqual(rMirror);
    expect(rPure.resolvedQty).toBe(30); // 10+20
  });

  it('unresolvedBoEntryRows: solo las null', () => {
    const rows = [
      { resolved: null, sku: 'A' },
      { resolved: 'same', sku: 'B' },
      { resolved: 'additional', sku: 'C' },
      { resolved: null, sku: 'D' },
    ];
    const rPure = pure.unresolvedBoEntryRows(rows);
    const rMirror = mirror.unresolvedBoEntryRows(rows);
    expect(rPure).toEqual(rMirror);
    expect(rPure).toHaveLength(2);
  });

  it('findIdenticalOpenOrder: match primera orden idéntica', () => {
    const args = {
      items: [{ code: '9691', qty: 20 }],
      openOrders: [
        { _id: 'o1', orderNumber: 435, items: [{ code: '9999', qty: 1 }] },
        {
          _id: 'o2',
          orderNumber: 436,
          items: [{ code: '9691', qty: 20 }],
          createdAt: '2026-10-12T00:00:00Z',
        },
      ],
    };
    const rPure = pure.findIdenticalOpenOrder(args);
    const rMirror = mirror.findIdenticalOpenOrder(args);
    expect(rPure).toEqual(rMirror);
    expect(rPure.identical).toBe(true);
    expect(rPure.openOrderId).toBe('o2');
  });
});

// @ts-check
import { describe, expect, it } from 'vitest';
import {
  buildRepartoExcelFileName,
  computeRepartoExcelExportRows,
  filterIngresosForExcelExport,
  safeNum,
  safeStr,
} from '../../src/pure/reparto-excel-export-rows.js';

function ing(overrides = {}) {
  return {
    _id: 'ING-1',
    sku: 'SKU-A',
    qtyIngresada: 10,
    status: 'pending',
    clientesBO: [
      { clientCardCode: 'C001', clientName: 'ACME', clientLocality: 'CABA', qtyBackorder: 3 },
    ],
    ...overrides,
  };
}

describe('safeStr / safeNum', () => {
  it('safeStr vacío -> "-"', () => {
    expect(safeStr(null)).toBe('-');
    expect(safeStr('')).toBe('-');
    expect(safeStr('ABC')).toBe('ABC');
  });
  it('safeNum NaN -> 0', () => {
    expect(safeNum(undefined)).toBe(0);
    expect(safeNum('abc')).toBe(0);
    expect(safeNum('5')).toBe(5);
    expect(safeNum(3.14)).toBe(3.14);
  });
});

describe('computeRepartoExcelExportRows — 1 reparto 1 cliente', () => {
  it('devuelve 1 fila con las 9 columnas correctas', () => {
    const res = computeRepartoExcelExportRows(
      [ing()],
      {},
      {
        getStockFisico: () => 7,
      }
    );
    expect(res.rows.length).toBe(1);
    const r = res.rows[0];
    expect(r.Codigo).toBe('SKU-A');
    expect(r.Cliente).toBe('ACME');
    expect(r.Backorder).toBe(3);
    expect(r.StockDisponible).toBe(7);
    expect(r.Asignado).toBe(0);
    expect(r.VueleABackorder).toBe('=C2-E2-G2');
    expect(r.Eliminar).toBe(0);
    expect(r.RepartoId).toBe('ING-1');
    expect(r.CardCode).toBe('C001');
  });
});

describe('computeRepartoExcelExportRows — múltiples clientes mismo SKU', () => {
  it('devuelve N filas con mismo RepartoId + Codigo pero distintos CardCode', () => {
    const ingreso = ing({
      clientesBO: [
        { clientCardCode: 'C001', clientName: 'ALPHA', qtyBackorder: 3 },
        { clientCardCode: 'C002', clientName: 'BETA', qtyBackorder: 2 },
        { clientCardCode: 'C003', clientName: 'GAMMA', qtyBackorder: 1 },
      ],
    });
    const res = computeRepartoExcelExportRows([ingreso], {}, { getStockFisico: () => 10 });
    expect(res.rows.length).toBe(3);
    expect(res.rows.map((r) => r.CardCode).sort()).toEqual(['C001', 'C002', 'C003']);
    expect(res.rows.every((r) => r.Codigo === 'SKU-A')).toBe(true);
    expect(res.rows.every((r) => r.RepartoId === 'ING-1')).toBe(true);
    // Fórmulas con fila incrementales (2, 3, 4).
    const formulas = res.rows.map((r) => r.VueleABackorder);
    expect(formulas).toContain('=C2-E2-G2');
    expect(formulas).toContain('=C3-E3-G3');
    expect(formulas).toContain('=C4-E4-G4');
  });
});

describe('computeRepartoExcelExportRows — mismo SKU en 3 repartos distintos', () => {
  it('devuelve 3 filas con distintos Reparto ID', () => {
    const ings = [
      ing({ _id: 'ING-A', sku: 'CLC66HAR' }),
      ing({ _id: 'ING-B', sku: 'CLC66HAR' }),
      ing({ _id: 'ING-C', sku: 'CLC66HAR' }),
    ];
    const res = computeRepartoExcelExportRows(ings, {}, { getStockFisico: () => 5 });
    expect(res.rows.length).toBe(3);
    const ids = res.rows.map((r) => r.RepartoId).sort();
    expect(ids).toEqual(['ING-A', 'ING-B', 'ING-C']);
    expect(res.rows.every((r) => r.Codigo === 'CLC66HAR')).toBe(true);
  });
});

describe('computeRepartoExcelExportRows — filtro search', () => {
  it('filtra por SKU', () => {
    const ings = [
      ing({
        _id: 'ING-A',
        sku: 'ABC',
        clientesBO: [{ clientCardCode: 'C001', clientName: 'ACME', qtyBackorder: 1 }],
      }),
      ing({
        _id: 'ING-B',
        sku: 'XYZ',
        clientesBO: [{ clientCardCode: 'C002', clientName: 'OTHER', qtyBackorder: 1 }],
      }),
    ];
    const res = computeRepartoExcelExportRows(ings, { search: 'ABC' }, { getStockFisico: () => 5 });
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].Codigo).toBe('ABC');
  });
  it('filtra por nombre de cliente', () => {
    const ings = [
      ing({
        _id: 'ING-A',
        clientesBO: [
          { clientCardCode: 'C001', clientName: 'ACME SA', qtyBackorder: 1 },
          { clientCardCode: 'C002', clientName: 'OTHER SA', qtyBackorder: 2 },
        ],
      }),
    ];
    const res = computeRepartoExcelExportRows(
      ings,
      { search: 'acme' },
      { getStockFisico: () => 5 }
    );
    // Nota: filtro es a nivel ingreso (match_any). El ingreso entra si algún cliente matchea,
    // pero todas las filas del ingreso quedan en el export (como la UI del modal).
    expect(res.rows.length).toBe(2);
  });
});

describe('computeRepartoExcelExportRows — filtro hideNoStock', () => {
  it('oculta SKUs sin stock físico cuando hideNoStock=true', () => {
    const ings = [ing({ _id: 'ING-A', sku: 'HAS-STOCK' }), ing({ _id: 'ING-B', sku: 'NO-STOCK' })];
    const stockMap = { 'HAS-STOCK': 10, 'NO-STOCK': 0 };
    const res = computeRepartoExcelExportRows(
      ings,
      { hideNoStock: true },
      { getStockFisico: (sku) => stockMap[sku] || 0 }
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].Codigo).toBe('HAS-STOCK');
  });
  it('incluye todos cuando hideNoStock=false', () => {
    const ings = [ing({ _id: 'ING-A', sku: 'HAS-STOCK' }), ing({ _id: 'ING-B', sku: 'NO-STOCK' })];
    const stockMap = { 'HAS-STOCK': 10, 'NO-STOCK': 0 };
    const res = computeRepartoExcelExportRows(
      ings,
      { hideNoStock: false },
      { getStockFisico: (sku) => stockMap[sku] || 0 }
    );
    expect(res.rows.length).toBe(2);
  });
});

describe('computeRepartoExcelExportRows — Asignado/Eliminar inicial 0', () => {
  it('todas las filas arrancan con Asignado=0 y Eliminar=0', () => {
    const res = computeRepartoExcelExportRows([ing()], {}, { getStockFisico: () => 5 });
    expect(res.rows[0].Asignado).toBe(0);
    expect(res.rows[0].Eliminar).toBe(0);
  });
});

describe('computeRepartoExcelExportRows — fórmula Excel string', () => {
  it('VueleABackorder es string "=C{row}-E{row}-G{row}"', () => {
    const ings = [
      ing({
        _id: 'ING-A',
        clientesBO: [
          { clientCardCode: 'C001', clientName: 'A', qtyBackorder: 5 },
          { clientCardCode: 'C002', clientName: 'B', qtyBackorder: 7 },
        ],
      }),
    ];
    const res = computeRepartoExcelExportRows(ings, {}, { getStockFisico: () => 5 });
    expect(res.rows[0].VueleABackorder).toBe('=C2-E2-G2');
    expect(res.rows[1].VueleABackorder).toBe('=C3-E3-G3');
    expect(typeof res.rows[0].VueleABackorder).toBe('string');
  });
});

describe('filterIngresosForExcelExport', () => {
  it('descarta ingresos sin clientesBO', () => {
    const ings = [ing({ _id: 'A', clientesBO: [] }), ing({ _id: 'B' })];
    const out = filterIngresosForExcelExport(ings, { hideNoStock: false });
    expect(out.length).toBe(1);
    expect(out[0]._id).toBe('B');
  });
  it('idempotente: aplicar 2 veces devuelve igual', () => {
    const ings = [ing()];
    const once = filterIngresosForExcelExport(ings, { search: '', hideNoStock: false });
    const twice = filterIngresosForExcelExport(once, { search: '', hideNoStock: false });
    expect(twice).toEqual(once);
  });
});

describe('buildRepartoExcelFileName', () => {
  it('formatea Reparto_YYYY-MM-DD_HHMM.xlsx', () => {
    const d = new Date(2026, 9, 28, 14, 30); // Oct 28 2026 14:30 (JS months 0-indexed)
    expect(buildRepartoExcelFileName(d)).toBe('Reparto_2026-10-28_1430.xlsx');
  });
  it('con fecha actual si no se pasa arg', () => {
    const out = buildRepartoExcelFileName();
    expect(out).toMatch(/^Reparto_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
  });
});

// @ts-check
/**
 * v1497 §96 (2026-10-27) — tests pure fn computeRepartoExportRows.
 *
 * Fixtures incluyen filas con campos faltantes (cliente sin nombre, sin
 * localidad, sin cardCode) para validar que el export NO rompe.
 */
import { describe, expect, it } from 'vitest';
import {
  computeRepartoExportRows,
  filterIngresosForExport,
  formatRepartoFiltrosHeader,
  safeNum,
  safeStr,
  safeTs,
} from '../../src/pure/reparto-export-rows.js';

describe('v1497 §96 — safeStr / safeNum / safeTs', () => {
  it('T1 safeStr fallback a "-"', () => {
    expect(safeStr(undefined)).toBe('-');
    expect(safeStr(null)).toBe('-');
    expect(safeStr('')).toBe('-');
    expect(safeStr('   ')).toBe('-');
    expect(safeStr('OK')).toBe('OK');
    expect(safeStr('  foo  ')).toBe('foo');
  });

  it('T2 safeNum fallback a 0', () => {
    expect(safeNum(undefined)).toBe(0);
    expect(safeNum(null)).toBe(0);
    expect(safeNum('abc')).toBe(0);
    expect(safeNum('5')).toBe(5);
    expect(safeNum(5)).toBe(5);
    expect(safeNum(NaN)).toBe(0);
    expect(safeNum(Infinity)).toBe(0);
  });

  it('T3 safeTs string ISO → "YYYY-MM-DD HH:mm:ss"', () => {
    expect(safeTs('2026-10-27T16:55:15.123Z')).toBe('2026-10-27 16:55:15');
  });

  it('T4 safeTs Firestore Timestamp {seconds, nanoseconds}', () => {
    const ts = { seconds: 1761584115, nanoseconds: 0 };
    const r = safeTs(ts);
    expect(r).toMatch(/^2025-10-27 /);
  });

  it('T5 safeTs undefined / null → "-"', () => {
    expect(safeTs(undefined)).toBe('-');
    expect(safeTs(null)).toBe('-');
    expect(safeTs('')).toBe('-');
    expect(safeTs(NaN)).toBe('-');
  });

  it('T6 safeTs Date instance', () => {
    const d = new Date('2026-10-27T16:55:15Z');
    expect(safeTs(d)).toBe('2026-10-27 16:55:15');
  });
});

describe('v1497 §96 — filterIngresosForExport', () => {
  const ingresos = [
    { sku: 'A1', qtyIngresada: 2, clientesBO: [{ clientName: 'X', qtyBO: 1 }] },
    { sku: 'B2', qtyIngresada: 5, clientesBO: [{ clientName: 'Y', qtyBO: 3 }] },
    { sku: 'C3', qtyIngresada: 10, clientesBO: [] }, // sin clientes → filtered out
    { sku: 'D4', qtyIngresada: 0, clientesBO: [{ clientName: 'ARMERIA', qtyBO: 2 }] },
  ];

  it('T10 filtra ingresos sin clientesBO', () => {
    const r = filterIngresosForExport(ingresos, {}, () => 10);
    const skus = r.map((x) => x.sku);
    expect(skus).not.toContain('C3');
  });

  it('T11 hideNoStock=true filtra SKUs con stock=0', () => {
    const r = filterIngresosForExport(ingresos, { hideNoStock: true }, (sku) =>
      sku === 'A1' ? 0 : 5
    );
    expect(r.map((x) => x.sku)).not.toContain('A1');
    expect(r.map((x) => x.sku)).toContain('B2');
  });

  it('T12 hideNoStock=false NO filtra por stock', () => {
    const r = filterIngresosForExport(ingresos, { hideNoStock: false }, (_sku) => 0);
    expect(r.length).toBeGreaterThan(0); // ninguno filtrado por stock=0
  });

  it('T13 search filtra por SKU case-insensitive', () => {
    const r = filterIngresosForExport(ingresos, { search: 'b2', hideNoStock: false });
    expect(r.map((x) => x.sku)).toEqual(['B2']);
  });

  it('T14 search filtra por clientName', () => {
    const r = filterIngresosForExport(ingresos, { search: 'armeria', hideNoStock: false });
    expect(r.map((x) => x.sku)).toContain('D4');
  });

  it('T15 sort por qty asc + SKU asc', () => {
    const r = filterIngresosForExport(ingresos, { hideNoStock: false });
    const skus = r.map((x) => x.sku);
    // D4 qty=0, A1 qty=2, B2 qty=5
    expect(skus[0]).toBe('D4');
    expect(skus[1]).toBe('A1');
    expect(skus[2]).toBe('B2');
  });
});

describe('v1497 §96 — computeRepartoExportRows: fixture con campos faltantes', () => {
  it('T20 cliente sin nombre, sin localidad, sin cardCode → "-" en todas las celdas', () => {
    const ingresos = [
      {
        sku: 'FXS70M2',
        qtyIngresada: 3,
        status: 'pending',
        detectedAt: '2026-10-27T16:00:00Z',
        clientesBO: [
          { clientName: 'CLIENTE OK', cardCode: 'C001', locality: 'LANUS', qtyBO: 1 },
          { /* todo vacío */ qtyBO: 2 },
          { clientName: null, cardCode: undefined, locality: null, qtyBO: 1 },
        ],
      },
    ];
    const result = computeRepartoExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 10,
        getProductDesc: () => 'Caña Shimano FX',
      }
    );
    expect(result.detalleRows.length).toBe(3 + 1); // 3 clientes + fila TOTAL
    const row1 = result.detalleRows[0];
    expect(row1.Cliente).toBe('CLIENTE OK');
    expect(row1.CardCode).toBe('C001');
    expect(row1.Localidad).toBe('LANUS');
    const row2 = result.detalleRows[1];
    expect(row2.Cliente).toBe('-');
    expect(row2.CardCode).toBe('-');
    expect(row2.Localidad).toBe('-');
    expect(row2.Qty_BO_solicitada).toBe(2);
    const row3 = result.detalleRows[2];
    expect(row3.Cliente).toBe('-');
    expect(row3.CardCode).toBe('-');
    expect(row3.Localidad).toBe('-');
  });

  it('T21 ingreso sin status, sin detectedAt → "-"', () => {
    const ingresos = [
      {
        sku: 'X',
        qtyIngresada: 1,
        clientesBO: [{ clientName: 'A', qtyBO: 1 }],
      },
    ];
    const result = computeRepartoExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 5,
      }
    );
    expect(result.resumenRows[0].Status).toBe('-');
    expect(result.resumenRows[0].Ingreso_detectado).toBe('-');
  });

  it('T22 TOTAL row es último + suma correcta de qty', () => {
    const ingresos = [
      { sku: 'A', qtyIngresada: 5, clientesBO: [{ clientName: 'X', qtyBO: 2 }] },
      { sku: 'B', qtyIngresada: 3, clientesBO: [{ clientName: 'Y', qtyBO: 3 }] },
    ];
    const result = computeRepartoExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 10,
      }
    );
    const totalRow = result.resumenRows[result.resumenRows.length - 1];
    expect(totalRow.SKU).toBe('TOTAL');
    expect(totalRow.Qty_ingresada).toBe(8);
    expect(totalRow.Suma_BO_solicitada).toBe(5);
  });

  it('T23 columnas Vuelve_a_BO: max(0, sumaBO - stockFisico)', () => {
    const ingresos = [{ sku: 'X', qtyIngresada: 10, clientesBO: [{ clientName: 'A', qtyBO: 7 }] }];
    const r1 = computeRepartoExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 3, // stock < sumaBO → vuelve = 4
      }
    );
    expect(r1.resumenRows[0].Vuelve_a_BO).toBe(4);
    const r2 = computeRepartoExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 15, // stock > sumaBO → vuelve = 0
      }
    );
    expect(r2.resumenRows[0].Vuelve_a_BO).toBe(0);
  });

  it('T24 NO rompe con ingreso completamente vacío', () => {
    const ingresos = [{}, null, undefined, { sku: null, clientesBO: null }];
    const result = computeRepartoExportRows(
      /** @type {any} */ (ingresos),
      { hideNoStock: false },
      {
        getStockFisico: () => 0,
      }
    );
    // Todos filtrados por falta de clientesBO.
    expect(result.resumenRows.length).toBe(1); // solo fila TOTAL
    expect(result.detalleRows.length).toBe(1); // solo fila TOTAL
  });

  it('T25 nunca propaga undefined/null a las celdas (anti-regresión ExcelJS)', () => {
    const ingresos = [
      {
        sku: undefined,
        qtyIngresada: undefined,
        status: null,
        detectedAt: null,
        clientesBO: [{ clientName: undefined, cardCode: null, qtyBO: undefined }],
      },
    ];
    const result = computeRepartoExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 0,
      }
    );
    for (const row of [...result.resumenRows, ...result.detalleRows]) {
      for (const key of Object.keys(row)) {
        const v = row[key];
        expect(v).not.toBeUndefined();
        expect(v).not.toBeNull();
      }
    }
  });
});

describe('v1497 §96 — formatRepartoFiltrosHeader', () => {
  it('T30 sin búsqueda → "solo con stock físico > 0"', () => {
    const s = formatRepartoFiltrosHeader({ hideNoStock: true });
    expect(s).toContain('Filtros:');
    expect(s).toContain('solo con stock físico > 0');
  });

  it('T31 con búsqueda', () => {
    const s = formatRepartoFiltrosHeader({ search: 'zodias', hideNoStock: true });
    expect(s).toContain('búsqueda="zodias"');
    expect(s).toContain('solo con stock físico > 0');
  });

  it('T32 hideNoStock false → "incluye sin stock"', () => {
    const s = formatRepartoFiltrosHeader({ hideNoStock: false });
    expect(s).toContain('incluye sin stock');
  });
});

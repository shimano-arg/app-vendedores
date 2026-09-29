// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  normalizeMonthLabel,
  findHeaderRow,
  detectColumns,
  parseSalesPlanSheet,
} from '../../src/pure/sales-plan-parser.js';

describe('normalizeMonthLabel', () => {
  it('parsea variantes en ingles', () => {
    expect(normalizeMonthLabel('Jan 2027')).toBe('2027-01');
    expect(normalizeMonthLabel('May 2027')).toBe('2027-05');
    expect(normalizeMonthLabel('December 2026')).toBe('2026-12');
    expect(normalizeMonthLabel('may-27')).toBe('2027-05');
    expect(normalizeMonthLabel('jan/2027')).toBe('2027-01');
    expect(normalizeMonthLabel('MAY27')).toBe('2027-05');
    expect(normalizeMonthLabel('May.2027')).toBe('2027-05');
  });
  it('parsea variantes en español', () => {
    expect(normalizeMonthLabel('Ene 2027')).toBe('2027-01');
    expect(normalizeMonthLabel('mayo 2027')).toBe('2027-05');
    expect(normalizeMonthLabel('AGO-27')).toBe('2027-08');
    expect(normalizeMonthLabel('Dic 2026')).toBe('2026-12');
  });
  it('parsea numerico', () => {
    expect(normalizeMonthLabel('2027-01')).toBe('2027-01');
    expect(normalizeMonthLabel('2027/12')).toBe('2027-12');
    expect(normalizeMonthLabel('01/2027')).toBe('2027-01');
    expect(normalizeMonthLabel('12-2027')).toBe('2027-12');
  });
  it('null en input invalido', () => {
    expect(normalizeMonthLabel('')).toBeNull();
    expect(normalizeMonthLabel(null)).toBeNull();
    expect(normalizeMonthLabel(undefined)).toBeNull();
    expect(normalizeMonthLabel('Description')).toBeNull();
    expect(normalizeMonthLabel('SKU')).toBeNull();
    expect(normalizeMonthLabel('Base FOB(USD)')).toBeNull();
  });
});

describe('findHeaderRow', () => {
  it('encuentra header por "SKU Code/Part No"', () => {
    const rows = [
      ['SUR 2027 1H Rods Sales Plan', '', '', ''],
      ['', '', '', ''],
      ['Description', 'SKU Code/Part No', 'MOQ 12 months', 'Jan 2027'],
      ['ITEM 1', 'ABC123', 30, 100],
    ];
    expect(findHeaderRow(rows)).toBe(2);
  });
  it('encuentra header por "SKU" solo', () => {
    const rows = [
      ['x', 'y'],
      ['SKU', 'Jan 2027'],
      ['A', 10],
    ];
    expect(findHeaderRow(rows)).toBe(1);
  });
  it('-1 si no hay header', () => {
    const rows = [['foo', 'bar'], ['baz', 'qux']];
    expect(findHeaderRow(rows)).toBe(-1);
  });
});

describe('detectColumns', () => {
  it('detecta SKU + Description + MOQ + meses', () => {
    const header = ['Description', 'SKU Code/Part No', 'MOQ 12 months', 'Jan 2027', 'Feb 2027', 'Mar 2027'];
    const cols = detectColumns(header, null);
    expect(cols.skuIdx).toBe(1);
    expect(cols.descIdx).toBe(0);
    expect(cols.moqIdx).toBe(2);
    expect(cols.monthColumns.length).toBe(3);
    expect(cols.monthColumns[0]).toEqual({ colIdx: 3, monthKey: '2027-01' });
    expect(cols.detectedMonths).toEqual(['2027-01', '2027-02', '2027-03']);
  });
  it('combina año de la fila arriba + mes de la fila header', () => {
    const above = ['', '', '', '2027', '2027', '2027'];
    const header = ['Description', 'SKU', 'MOQ', 'Jan', 'Feb', 'Mar'];
    const cols = detectColumns(header, above);
    expect(cols.monthColumns.length).toBe(3);
    expect(cols.monthColumns[0].monthKey).toBe('2027-01');
    expect(cols.monthColumns[2].monthKey).toBe('2027-03');
  });
  it('ignora columnas no reconocidas (Factory, Discount, etc)', () => {
    const header = ['SKU', 'Factory', 'Discount', 'Base FOB(USD)', 'Jan 2027'];
    const cols = detectColumns(header, null);
    expect(cols.skuIdx).toBe(0);
    expect(cols.monthColumns.length).toBe(1);
    expect(cols.monthColumns[0].colIdx).toBe(4);
  });
});

describe('parseSalesPlanSheet', () => {
  it('parsea un sheet minimal', () => {
    const rows = [
      ['SUR 2027 1H Rods Sales Plan'],
      ['Description', 'SKU Code/Part No', 'MOQ 12 months', 'Jan 2027', 'Feb 2027', 'May 2027'],
      ['STELLA FX 3000', 'FX3000FC', 30, 10, 20, 50],
      ['STELLA FX 4000', 'FX4000FC', 30, 5, 15, 25],
      ['', '', '', '', '', ''], // fila vacia -> skip
      ['TOTAL', '', '', 15, 35, 75], // fila total -> skip
    ];
    const out = parseSalesPlanSheet(rows);
    expect(out.rowsCount).toBe(2);
    expect(out.headerRowIndex).toBe(1);
    expect(out.detectedMonths).toEqual(['2027-01', '2027-02', '2027-05']);
    expect(out.rows[0]).toEqual({
      sku: 'FX3000FC',
      description: 'STELLA FX 3000',
      moq: 30,
      months: { '2027-01': 10, '2027-02': 20, '2027-05': 50 },
    });
    expect(out.rows[1].sku).toBe('FX4000FC');
    expect(out.rows[1].months['2027-05']).toBe(25);
  });

  it('omite meses con qty=0 o negativos', () => {
    const rows = [
      ['SKU', 'Jan 2027', 'Feb 2027', 'Mar 2027'],
      ['A', 10, 0, -5],
    ];
    const out = parseSalesPlanSheet(rows);
    expect(out.rows[0].months).toEqual({ '2027-01': 10 });
  });

  it('dedupe SKU repetido (usa el primero)', () => {
    const rows = [
      ['SKU', 'Jan 2027'],
      ['A', 10],
      ['A', 999], // duplicado, se ignora
      ['B', 20],
    ];
    const out = parseSalesPlanSheet(rows);
    expect(out.rowsCount).toBe(2);
    expect(out.rows[0]).toMatchObject({ sku: 'A', months: { '2027-01': 10 } });
    expect(out.rows[1].sku).toBe('B');
  });

  it('MOQ ausente -> 0', () => {
    const rows = [
      ['SKU', 'Jan 2027'],
      ['A', 10],
    ];
    const out = parseSalesPlanSheet(rows);
    expect(out.rows[0].moq).toBe(0);
  });

  it('MOQ negativo o no numerico -> 0', () => {
    const rows = [
      ['SKU', 'MOQ', 'Jan 2027'],
      ['A', -30, 10],
      ['B', 'NA', 20],
      ['C', 30, 30],
    ];
    const out = parseSalesPlanSheet(rows);
    expect(out.rows[0].moq).toBe(0);
    expect(out.rows[1].moq).toBe(0);
    expect(out.rows[2].moq).toBe(30);
  });

  it('lanza si sheet vacio', () => {
    expect(() => parseSalesPlanSheet([])).toThrow(/vacio/);
  });

  it('lanza si no encuentra header row', () => {
    expect(() => parseSalesPlanSheet([['foo'], ['bar']])).toThrow(/headers/);
  });

  it('lanza si no hay columnas de meses', () => {
    const rows = [
      ['SKU', 'Description', 'MOQ'],
      ['A', 'foo', 30],
    ];
    expect(() => parseSalesPlanSheet(rows)).toThrow(/meses/);
  });
});

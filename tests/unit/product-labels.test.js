// @ts-check
/**
 * v1495 §94 (2026-10-27) — product-labels pure fn tests.
 */
import { describe, expect, it } from 'vitest';
import {
  formatProductCatLineParts,
  formatProductDesc,
  hasFullClassification,
} from '../../src/pure/product-labels.js';

describe('v1495 §94 — formatProductCatLineParts', () => {
  it('T1 producto completo → 3 partes en orden cat → fam → sub', () => {
    const r = formatProductCatLineParts({
      code: 'FXS70M2',
      desc: 'Caña Shimano FX',
      cat: 'CAÑAS',
      fam: 'FW Spinning',
      sub: 'FX',
    });
    expect(r).toEqual(['CAÑAS', 'FW Spinning', 'FX']);
  });

  it('T2 cat/fam/sub undefined → array vacío', () => {
    expect(formatProductCatLineParts({ code: '26ZODIAS160MH', desc: 'Something' })).toEqual([]);
  });

  it('T3 cat/fam/sub explicitamente null → array vacío', () => {
    expect(formatProductCatLineParts({ code: 'X', cat: null, fam: null, sub: null })).toEqual([]);
  });

  it('T4 cat/fam/sub string vacío → array vacío', () => {
    expect(formatProductCatLineParts({ code: 'X', cat: '', fam: '  ', sub: '\t' })).toEqual([]);
  });

  it('T5 solo cat populado → devuelve ["CAÑAS"]', () => {
    expect(formatProductCatLineParts({ code: 'X', cat: 'CAÑAS' })).toEqual(['CAÑAS']);
  });

  it('T6 cat + sub (sin fam) → devuelve 2 partes', () => {
    expect(formatProductCatLineParts({ code: 'X', cat: 'CAÑAS', fam: null, sub: 'FX' })).toEqual([
      'CAÑAS',
      'FX',
    ]);
  });

  it('T7 trim de valores', () => {
    expect(
      formatProductCatLineParts({ code: 'X', cat: '  CAÑAS  ', fam: ' FW ', sub: ' FX ' })
    ).toEqual(['CAÑAS', 'FW', 'FX']);
  });

  it('T8 null/undefined input → array vacío', () => {
    expect(formatProductCatLineParts(null)).toEqual([]);
    expect(formatProductCatLineParts(undefined)).toEqual([]);
    expect(formatProductCatLineParts('')).toEqual([]);
    expect(formatProductCatLineParts(42)).toEqual([]);
  });

  it('T9 nunca devuelve string "undefined" (anti-regresión)', () => {
    const r = formatProductCatLineParts({
      code: 'X',
      cat: undefined,
      fam: undefined,
      sub: undefined,
    });
    expect(r).not.toContain('undefined');
    expect(r.length).toBe(0);
  });
});

describe('v1495 §94 — formatProductDesc', () => {
  it('T20 desc populada → devuelve desc trimeado', () => {
    expect(formatProductDesc({ code: 'FX1', desc: '  Caña Shimano  ' })).toBe('Caña Shimano');
  });

  it('T21 desc vacía → fallback al SKU', () => {
    expect(formatProductDesc({ code: '26ZODIAS160MH', desc: '' })).toBe('26ZODIAS160MH');
    expect(formatProductDesc({ code: 'LUGC22' })).toBe('LUGC22');
    expect(formatProductDesc({ code: 'X', desc: null })).toBe('X');
  });

  it('T22 desc y code vacíos → string vacío', () => {
    expect(formatProductDesc({ desc: '', code: '' })).toBe('');
    expect(formatProductDesc({})).toBe('');
  });

  it('T23 nunca devuelve "undefined" literal', () => {
    expect(formatProductDesc({ code: 'X', desc: undefined })).toBe('X');
    expect(formatProductDesc(null)).toBe('');
    expect(formatProductDesc(undefined)).toBe('');
  });
});

describe('v1495 §94 — hasFullClassification', () => {
  it('T30 producto con los 3 campos populated → true', () => {
    expect(hasFullClassification({ code: 'X', cat: 'CAÑAS', fam: 'FW', sub: 'FX' })).toBe(true);
  });

  it('T31 falta cualquiera de los 3 → false', () => {
    expect(hasFullClassification({ code: 'X', cat: 'CAÑAS', fam: 'FW' })).toBe(false);
    expect(hasFullClassification({ code: 'X', cat: 'CAÑAS', sub: 'FX' })).toBe(false);
    expect(hasFullClassification({ code: 'X' })).toBe(false);
    expect(hasFullClassification({})).toBe(false);
  });

  it('T32 string vacío cuenta como falta', () => {
    expect(hasFullClassification({ code: 'X', cat: '', fam: 'FW', sub: 'FX' })).toBe(false);
  });
});

/**
 * Tests unit de funciones puras del modulo meli (src/domains/meli.js).
 * Ver docs/specs/2026-09-18-mercadolibre-crm-section-design.md § 6.2.
 */
import { describe, expect, it } from 'vitest';
import {
  filterProducts,
  formatSnapshotAge,
  getSeverityColor,
  sortMapAlerts,
} from '../../src/domains/meli.js';

describe('formatSnapshotAge', () => {
  const nowRef = new Date('2026-09-18T14:00:00Z');

  it('devuelve "hoy HH:mm" si el sync fue hoy', () => {
    const syncAt = new Date('2026-09-18T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toMatch(/^hoy \d{2}:\d{2}$/);
  });

  it('devuelve "hace 1 día" si fue ayer', () => {
    const syncAt = new Date('2026-09-17T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toBe('hace 1 día');
  });

  it('devuelve "hace N días" si fue hace más de 1 día', () => {
    const syncAt = new Date('2026-09-15T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toBe('hace 3 días');
  });

  it('devuelve "hace más de 7 días" si fue hace 8+ días', () => {
    const syncAt = new Date('2026-09-05T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toBe('hace más de 7 días');
  });

  it('devuelve "—" si el date es null o inválido', () => {
    expect(formatSnapshotAge(null, nowRef)).toBe('—');
    expect(formatSnapshotAge(undefined, nowRef)).toBe('—');
  });
});

describe('sortMapAlerts', () => {
  const alerts = [
    { seller_nickname: 'A', diferencia_pct: -3.2 },
    { seller_nickname: 'B', diferencia_pct: -10.5 },
    { seller_nickname: 'C', diferencia_pct: -0.9 },
    { seller_nickname: 'D', diferencia_pct: -5.5 },
  ];

  it('ordena por diferencia_pct ascendente (peor primero)', () => {
    const out = sortMapAlerts(alerts);
    expect(out.map(a => a.seller_nickname)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('no muta el array original', () => {
    const original = [...alerts];
    sortMapAlerts(alerts);
    expect(alerts).toEqual(original);
  });

  it('devuelve [] si input es [] o null', () => {
    expect(sortMapAlerts([])).toEqual([]);
    expect(sortMapAlerts(null)).toEqual([]);
  });
});

describe('filterProducts', () => {
  const products = [
    { catalog_product_id: '1', name: 'Reel Miravel C5000XG', category_name: 'Reeles' },
    { catalog_product_id: '2', name: 'Caña Stimula 7', category_name: 'Cañas' },
    { catalog_product_id: '3', name: 'Reel Sedona 1000', category_name: 'Reeles' },
  ];

  it('sin filtros devuelve todos', () => {
    expect(filterProducts(products, {}).length).toBe(3);
  });

  it('filtra por categoría', () => {
    const out = filterProducts(products, { category: 'Reeles' });
    expect(out.length).toBe(2);
    expect(out.map(p => p.catalog_product_id)).toEqual(['1', '3']);
  });

  it('filtra por search case-insensitive', () => {
    expect(filterProducts(products, { search: 'stimula' }).length).toBe(1);
    expect(filterProducts(products, { search: 'REEL' }).length).toBe(2);
  });

  it('combina categoría + search', () => {
    const out = filterProducts(products, { category: 'Reeles', search: 'sedona' });
    expect(out.length).toBe(1);
    expect(out[0].catalog_product_id).toBe('3');
  });

  it('devuelve [] si nada matchea', () => {
    expect(filterProducts(products, { search: 'xxxxx' })).toEqual([]);
  });
});

describe('getSeverityColor', () => {
  it('rojo si Δ ≤ -10%', () => {
    expect(getSeverityColor(-10)).toBe('red');
    expect(getSeverityColor(-15)).toBe('red');
    expect(getSeverityColor(-64)).toBe('red');
  });
  it('ámbar si -10 < Δ ≤ -2', () => {
    expect(getSeverityColor(-9.9)).toBe('amber');
    expect(getSeverityColor(-5.5)).toBe('amber');
    expect(getSeverityColor(-2)).toBe('amber');
  });
  it('gris si Δ > -2', () => {
    expect(getSeverityColor(-1.9)).toBe('gray');
    expect(getSeverityColor(-0.9)).toBe('gray');
    expect(getSeverityColor(0)).toBe('gray');
  });
});

// @ts-check
/**
 * E1 v1391 — Sync test entre src/pure/stock-breakdown.js y la copia
 * espejo en functions/core/pedido-snapshot-core.js. Si divergen, el
 * test falla y hay que resincronizar manualmente (functions no puede
 * importar de src/pure por ser deploy standalone).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync('src/pure/stock-breakdown.js', 'utf8');
const CF = readFileSync('functions/core/pedido-snapshot-core.js', 'utf8');

describe('stock-breakdown sync src/pure vs functions/core', () => {
  it('ambos exportan getStockBreakdown', () => {
    expect(SRC).toMatch(/export function getStockBreakdown/);
    expect(CF).toMatch(/export function getStockBreakdown/);
  });

  it('ambos exportan los mismos conceptos del shape', () => {
    const conceptos = [
      'fisicoDep11',
      'transitoDep12',
      'demandaSapSinCubrir',
      'backorderApp',
      'confirmadasSinFacturar',
      'asignadas',
      'waitlistCpst',
      'reservadasTotal',
      'libre',
      'utilizablePara',
      'pendienteReparto',
    ];
    for (const c of conceptos) {
      expect(SRC.includes(c), `src/pure debe incluir ${c}`).toBe(true);
      expect(CF.includes(c), `functions/core debe incluir ${c}`).toBe(true);
    }
  });

  it('ambos usan includeStale para demandaSapSinCubrir', () => {
    expect(SRC).toMatch(/includeStale/);
    expect(CF).toMatch(/includeStale/);
  });

  it('ambos aplican reglas §37 (BO 90d via lineReservesStock)', () => {
    // Ambos deben llamar lineReservesStock, no reimplementar TTL.
    expect(SRC).toMatch(/lineReservesStock/);
    expect(CF).toMatch(/lineReservesStock/);
  });

  it('ambos tienen _version=1', () => {
    expect(SRC).toMatch(/_version:\s*1/);
    expect(CF).toMatch(/_version:\s*1/);
  });

  it('src/pure tiene STOCK_LABELS; functions/core tiene STOCK_LABELS_SERVER (nombres diferentes OK)', () => {
    expect(SRC).toMatch(/export const STOCK_LABELS/);
    expect(CF).toMatch(/export const STOCK_LABELS_SERVER/);
    // Pero los valores de los labels deben coincidir.
    const labelsSrc = SRC.match(/demandaSapSinCubrir:\s*'([^']+)'/);
    const labelsCf = CF.match(/demandaSapSinCubrir:\s*'([^']+)'/);
    expect(labelsSrc && labelsSrc[1]).toBe('Demanda SAP sin cubrir');
    expect(labelsCf && labelsCf[1]).toBe('Demanda SAP sin cubrir');
  });

  it('fórmula pendienteReparto idéntica en ambos (max(0, fisico - asig - confirmed) si BO>0)', () => {
    const pattern =
      /backorderApp\.total\s*>\s*0\s*\?\s*Math\.max\(0,\s*fisicoDep11\s*-\s*asignadas\.total\s*-\s*confirmadasSinFacturar\.total\)/;
    expect(SRC).toMatch(pattern);
    expect(CF).toMatch(pattern);
  });

  it('fórmula libre idéntica en ambos (max(0, fisico - reservadasTotal))', () => {
    const pattern = /Math\.max\(0,\s*fisicoDep11\s*-\s*reservadasTotal\)/;
    expect(SRC).toMatch(pattern);
    expect(CF).toMatch(pattern);
  });

  it('fórmula utilizablePara idéntica (min(fisico, libre + reservasPropias))', () => {
    const pattern = /Math\.min\(fisicoDep11,\s*libre\s*\+\s*reservasPropias\)/;
    expect(SRC).toMatch(pattern);
    expect(CF).toMatch(pattern);
  });
});

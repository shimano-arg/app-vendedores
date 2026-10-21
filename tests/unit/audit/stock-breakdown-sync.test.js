// @ts-check
/**
 * v1392 §40 — Sync test entre src/pure/stock-breakdown.js y la copia
 * espejo en functions/core/pedido-snapshot-core.js.
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

  it('ambos exportan los mismos conceptos del shape (v1392 incluye repartoAbierto)', () => {
    const conceptos = [
      'fisicoDep11',
      'transitoDep12',
      'backorderApp',
      'confirmadasSinFacturar',
      'asignadas',
      'waitlistCpst',
      'repartoAbierto',
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

  it('ambos tienen _version=7 (v1403 §40.11)', () => {
    expect(SRC).toMatch(/_version:\s*7/);
    expect(CF).toMatch(/_version:\s*7/);
  });

  it('ambos aplican §40: reservadasTotal NO incluye backorderApp', () => {
    // La fórmula debe ser: asignadas + confirmed + waitlistCpst (sin BO).
    // Busco multi-línea con 's' flag.
    const srcMatch = SRC.match(/const\s+reservadasTotal\s*=([\s\S]*?);/);
    const cfMatch = CF.match(/const\s+reservadasTotal\s*=([\s\S]*?);/);
    expect(srcMatch && !srcMatch[1].includes('backorderApp')).toBe(true);
    expect(cfMatch && !cfMatch[1].includes('backorderApp')).toBe(true);
  });

  it('ambos tienen repartoAbierto como bucket informativo (NO suma a reservadasTotal)', () => {
    expect(SRC).toMatch(/repartoAbierto\s*=\s*\{/);
    expect(CF).toMatch(/repartoAbierto\s*=\s*\{/);
  });

  it('src/pure tiene STOCK_LABELS con repartoAbierto; functions/core tiene STOCK_LABELS_SERVER', () => {
    expect(SRC).toMatch(/export const STOCK_LABELS/);
    expect(CF).toMatch(/export const STOCK_LABELS_SERVER/);
    const labelsSrc = SRC.match(/repartoAbierto:\s*'([^']+)'/);
    const labelsCf = CF.match(/repartoAbierto:\s*'([^']+)'/);
    expect(labelsSrc && labelsSrc[1]).toBe('En reparto pendiente (no reserva)');
    expect(labelsCf && labelsCf[1]).toBe('En reparto pendiente (no reserva)');
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

  it('ambos tienen pendienteReparto como alias de repartoAbierto', () => {
    expect(SRC).toMatch(/pendienteReparto:\s*\{\s*qty:\s*repartoAbierto\.qty/);
    expect(CF).toMatch(/pendienteReparto:\s*\{\s*qty:\s*repartoAbierto\.qty/);
  });
});

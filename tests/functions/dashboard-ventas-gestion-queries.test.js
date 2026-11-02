// @ts-check
/**
 * Dashboard de Ventas fase 2 — tests de las queries de gestión.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { normalizeFilters } from '../../functions/core/dashboard-ventas-core.js';
import {
  buildGestionQueries,
  MAX_INTERACCIONES,
  ventanaBaseActiva,
} from '../../functions/core/dashboard-ventas-queries-gestion.js';

// 2026-10-29 15:00 ART = 18:00 UTC.
const NOW = Date.parse('2026-10-29T18:00:00Z');

describe('ventanaBaseActiva', () => {
  it('mes cerrado = 90 días inclusive terminando el último día del mes', () => {
    expect(ventanaBaseActiva('2026-09', NOW)).toEqual({ desde: '2026-07-03', hasta: '2026-09-30' });
  });
  it('mes en curso termina hoy (ART)', () => {
    // 90 días inclusive: hasta - 89 días (el ejemplo del brief decía 07-31, error de cuenta).
    expect(ventanaBaseActiva('2026-10', NOW)).toEqual({ desde: '2026-08-01', hasta: '2026-10-29' });
  });
  it('mes en curso con UTC ya en el día siguiente usa la fecha ART', () => {
    expect(ventanaBaseActiva('2026-10', Date.parse('2026-10-30T02:00:00Z')).hasta).toBe(
      '2026-10-29'
    );
  });
});

describe('buildGestionQueries', () => {
  const f = () =>
    normalizeFilters(
      { mes: '2026-09', vendedores: ['PACHI'], clientes: ['C1'], skus: ['X'], categorias: ['F'] },
      NOW
    );

  it('cada query arranca con su marcador', () => {
    const qs = buildGestionQueries(f(), NOW);
    for (const k of ['target', 'rendiciones', 'actividad', 'interacciones', 'baseActiva']) {
      expect(qs[/** @type {'target'} */ (k)].query.startsWith(`-- dashboard:${k}\n`)).toBe(true);
    }
  });

  it('ningún parámetro llega vacío a BigQuery', () => {
    const req = createRequire(new URL('../../functions/package.json', import.meta.url));
    const { BigQuery } = req('@google-cloud/bigquery');
    const qs = buildGestionQueries(f(), NOW);
    for (const [name, q] of Object.entries(qs)) {
      for (const [k, v] of Object.entries(q.params)) {
        const t = q.types && q.types[k];
        const p = BigQuery.valueToQueryParameter_(v, t);
        const val = p.parameterValue;
        const vacio = val.value === undefined && !Array.isArray(val.arrayValues);
        expect(vacio, `${name}.${k} (${JSON.stringify(t)}) llega vacío`).toBe(false);
      }
      expect(q.query).not.toMatch(/'DATE'/);
    }
  });

  it('target y rendiciones solo filtran por vendedor + mes', () => {
    const qs = buildGestionQueries(f(), NOW);
    for (const k of /** @type {const} */ (['target', 'rendiciones'])) {
      const keys = Object.keys(qs[k].params);
      for (const x of ['clientes', 'skus', 'categorias', 'provincias']) {
        expect(keys).not.toContain(x);
      }
      expect(keys).toContain('vendedores');
    }
  });

  it('actividad e interacciones filtran por vendedor + mes + clientes, sin sku/categoría/provincia', () => {
    const qs = buildGestionQueries(f(), NOW);
    for (const k of /** @type {const} */ (['actividad', 'interacciones'])) {
      const keys = Object.keys(qs[k].params);
      expect(keys).toContain('vendedores');
      expect(keys).toContain('clientes');
      for (const x of ['skus', 'categorias', 'provincias']) expect(keys).not.toContain(x);
      expect(qs[k].query).toContain('v_visitas_full');
      expect(qs[k].query).toMatch(/card_code/);
    }
  });

  it('target compara vendedor normalizado y mes/año', () => {
    const q = buildGestionQueries(f(), NOW).target;
    expect(q.query).toContain('v_targets');
    expect(q.query).toContain('UPPER(TRIM(vendedor))');
    expect(q.params.anio).toBe(2026);
    expect(q.params.mesNum).toBe(9);
  });

  it('rendiciones usa fechas string + DATE() sobre fecha_gasto', () => {
    const q = buildGestionQueries(f(), NOW).rendiciones;
    expect(q.query).toContain('v_rendiciones');
    expect(q.query).toContain('DATE(@desde)');
    expect(q.query).toContain('monto_ars');
    // Gastos rechazados no cuentan.
    expect(q.query).toContain('rechazada');
    expect(q.types.desde).toBe('STRING');
    expect(q.params.desde).toBe('2026-09-01');
    expect(q.params.hasta).toBe('2026-09-30');
  });

  it('interacciones: orden estable con vendedor como desempate final', () => {
    const q = buildGestionQueries(f(), NOW).interacciones.query;
    expect(q).toMatch(/ORDER BY fecha_visita DESC, cliente, vendedor\s+LIMIT/);
  });

  it('interacciones: LIMIT 500 y total con COUNT(*) OVER()', () => {
    const q = buildGestionQueries(f(), NOW).interacciones.query;
    expect(MAX_INTERACCIONES).toBe(500);
    expect(q).toContain('LIMIT 500');
    expect(q).toMatch(/COUNT\(\*\) OVER\s*\(\)/);
  });

  it('baseActiva usa todos los filtros de ventas, INVOICE y la ventana', () => {
    const q = buildGestionQueries(f(), NOW).baseActiva;
    expect(q.query).toContain("doc_kind = 'INVOICE'");
    expect(q.query).toContain('is_pesca = TRUE');
    for (const k of ['vendedores', 'clientes', 'provincias', 'categorias', 'skus']) {
      expect(Object.keys(q.params)).toContain(k);
    }
    expect(q.params.desde).toBe('2026-07-03');
    expect(q.params.hasta).toBe('2026-09-30');
    expect(q.types.hasta).toBe('STRING');
  });
});

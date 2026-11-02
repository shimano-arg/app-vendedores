// @ts-check
/**
 * Dashboard de Ventas fase 2 — tests de la query de campañas activas.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { normalizeFilters } from '../../functions/core/dashboard-ventas-core.js';
import { buildCampaniasQuery } from '../../functions/core/dashboard-ventas-queries-campanias.js';

const NOW = Date.parse('2026-10-29T18:00:00Z');

/** @param {Record<string, any>} [extra] */
const f = (extra) =>
  normalizeFilters(
    {
      mes: '2026-09',
      vendedores: ['PACHI'],
      clientes: ['C1'],
      skus: ['X'],
      categorias: ['F'],
      provincias: ['CORDOBA'],
      ...(extra || {}),
    },
    NOW
  );

describe('buildCampaniasQuery', () => {
  it('arranca con su marcador y devuelve las columnas esperadas', () => {
    const q = buildCampaniasQuery(f(), NOW);
    expect(q.query.startsWith('-- dashboard:campanias\n')).toBe(true);
    for (const c of [
      'campaign_id',
      'nombre',
      'start_date',
      'end_date',
      'target_type',
      'target_amount',
      'realizado_qty',
      'realizado_ars',
    ]) {
      expect(q.query).toContain(c);
    }
    expect(q.query).toContain("FORMAT_DATE('%Y-%m-%d'");
    expect(q.query).toContain('activa = TRUE');
    expect(q.query).toMatch(/ORDER BY end_date ASC, nombre/);
  });

  it('ningún parámetro llega vacío a BigQuery', () => {
    const req = createRequire(new URL('../../functions/package.json', import.meta.url));
    const { BigQuery } = req('@google-cloud/bigquery');
    for (const filtros of [f(), f({ vendedores: [] })]) {
      const q = buildCampaniasQuery(filtros, NOW);
      for (const [k, v] of Object.entries(q.params)) {
        const t = q.types && q.types[k];
        const p = BigQuery.valueToQueryParameter_(v, t);
        const val = p.parameterValue;
        const vacio = val.value === undefined && !Array.isArray(val.arrayValues);
        expect(vacio, `${k} (${JSON.stringify(t)}) llega vacío`).toBe(false);
      }
      expect(q.query).not.toMatch(/'DATE'/);
    }
  });

  it('con vendedores filtra por alcance y suma desde el detalle de ventas', () => {
    const q = buildCampaniasQuery(f(), NOW);
    expect(q.params.vendedores).toEqual(['PACHI']);
    expect(q.types.vendedores).toEqual(['STRING']);
    expect(q.query).toContain('v_campanias_ventas_detalle');
    expect(q.query).toContain('v_cartera_vendor');
    expect(q.query).toContain("scope = 'all'");
    expect(q.query).toContain("scope = 'vendor'");
    expect(q.query).toContain("scope = 'province'");
    expect(q.query).toContain('UPPER(TRIM(');
    expect(q.query).toContain('UNNEST(@vendedores)');
  });

  it('el mes y los filtros de cliente/sku/categoría/provincia no aplican', () => {
    const q = buildCampaniasQuery(f(), NOW);
    expect(Object.keys(q.params)).toEqual(['vendedores']);
    expect(Object.keys(q.types)).toEqual(['vendedores']);
    expect(q.query).not.toMatch(/@(clientes|skus|categorias|provincias|anio|mesNum|mes)\b/);
  });
});

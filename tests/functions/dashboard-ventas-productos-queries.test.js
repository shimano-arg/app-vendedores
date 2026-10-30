// @ts-check
/**
 * Dashboard de Ventas fase 2 — tests de las queries de productos, cobertura y clientes.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { normalizeFilters } from '../../functions/core/dashboard-ventas-core.js';
import {
  buildProductosQueries,
  COBERTURA_DESDE,
} from '../../functions/core/dashboard-ventas-queries-productos.js';

const NOW = Date.parse('2026-10-29T18:00:00Z');

const f = () =>
  normalizeFilters(
    {
      mes: '2026-09',
      vendedores: ['PACHI'],
      clientes: ['C1'],
      skus: ['X'],
      categorias: ['F'],
      provincias: ['CORDOBA'],
    },
    NOW
  );

describe('buildProductosQueries', () => {
  it('cada query arranca con su marcador', () => {
    const qs = buildProductosQueries(f(), NOW);
    for (const k of ['productos', 'cobertura', 'clientes']) {
      expect(qs[/** @type {'productos'} */ (k)].query.startsWith(`-- dashboard:${k}\n`)).toBe(true);
    }
  });

  it('ningún parámetro llega vacío a BigQuery', () => {
    const req = createRequire(new URL('../../functions/package.json', import.meta.url));
    const { BigQuery } = req('@google-cloud/bigquery');
    for (const [name, q] of Object.entries(buildProductosQueries(f(), NOW))) {
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

  it('productos cruza ventas y back order con FULL OUTER JOIN y filtra ambos lados', () => {
    const q = buildProductosQueries(f(), NOW).productos;
    expect(q.query).toContain('FULL OUTER JOIN');
    expect(q.query).toContain('backorder_dashboard_actual');
    expect(q.query).toContain('v_sap_items_enriched');
    expect(q.query).toContain('anio_contable = @anio');
    for (const c of ['uds_vendidas', 'facturado', 'uds_backorder', 'categoria', 'sku']) {
      expect(q.query).toContain(c);
    }
    for (const k of ['vendedores', 'clientes', 'provincias', 'categorias', 'skus']) {
      expect(Object.keys(q.params)).toContain(k);
    }
    expect(q.params.anio).toBe(2026);
    expect(q.params.mesNum).toBe(9);
    expect(q.types.anio).toBe('INT64');
  });

  it('cobertura usa la fecha fija de inicio y el mes elegido como STRING', () => {
    const q = buildProductosQueries(f(), NOW).cobertura;
    expect(COBERTURA_DESDE).toBe('2026-06-01');
    expect(q.params.coberturaDesde).toBe('2026-06-01');
    expect(q.params.hasta).toBe('2026-09-01');
    expect(q.types.coberturaDesde).toBe('STRING');
    expect(q.types.hasta).toBe('STRING');
    expect(q.query).toContain('DATE(@coberturaDesde)');
    expect(q.query).toContain('LAST_DAY(DATE(@hasta))');
    expect(q.query).toContain('v_cartera_vendor');
    expect(q.query).toContain('card_code IS NOT NULL');
    expect(q.query).toContain("doc_kind = 'INVOICE'");
    expect(q.query).toContain('UPPER(TRIM(vendor_key))');
  });

  it('cobertura solo filtra por vendedor', () => {
    const q = buildProductosQueries(f(), NOW).cobertura;
    expect(Object.keys(q.params).sort()).toEqual(['coberturaDesde', 'hasta', 'vendedores']);
    for (const x of ['clientes', 'skus', 'categorias', 'provincias']) {
      expect(q.query).not.toContain(`@${x}`);
    }
  });

  it('productos ordena por facturado desc, back order desc y sku', () => {
    const q = buildProductosQueries(f(), NOW).productos;
    expect(q.query).toMatch(/ORDER BY facturado DESC, uds_backorder DESC, sku\s*$/);
  });

  it('clientes agrupa por card_code, mes + todos los filtros, orden desc', () => {
    const q = buildProductosQueries(f(), NOW).clientes;
    expect(q.query).toContain('GROUP BY card_code');
    expect(q.query).toMatch(/ORDER BY facturado DESC/);
    expect(q.query).toContain('ANY_VALUE(card_name)');
    expect(q.query).toContain('anio_contable = @anio');
    for (const k of ['vendedores', 'clientes', 'provincias', 'categorias', 'skus']) {
      expect(Object.keys(q.params)).toContain(k);
    }
  });
});

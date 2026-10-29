// @ts-check
/**
 * Dashboard de Ventas (2026-10-29) — tests del core puro.
 *
 * Cubre (plan Task 3):
 *   vendedor_forzado, vendedor_sin_vendor_rechaza, rol_desconocido_rechaza,
 *   admin_sin_filtros, comillas_como_param, mes_invalido_default,
 *   top_neto_negativo_al_final, sin_datos, mes_sin_dato_es_null,
 *   estimado_flag, cache_hit.
 *
 * El mock de runQuery identifica cada query por el marcador
 * `-- dashboard:<nombre>` que lleva la primera línea del SQL.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  applyRoleScope,
  buildQueries,
  dashboardVentasCore,
  normalizeFilters,
  runSeccion,
} from '../../functions/core/dashboard-ventas-core.js';
import { monthsBetween, SERIE_DESDE } from '../../functions/core/dashboard-ventas-queries.js';

// 2026-10-29 15:00 ART = 18:00 UTC.
const NOW = Date.parse('2026-10-29T18:00:00Z');

/** @param {string} sql */
function queryName(sql) {
  const m = /--\s*dashboard:(\w+)/.exec(sql);
  return m ? m[1] : '';
}

/**
 * @param {Record<string, any[]>} [rowsByName]
 * @param {{ role?: string, vendor?: string, mostrarEstimados?: boolean }} [opts]
 */
function makeDeps(rowsByName, opts) {
  const o = opts || {};
  /** @type {any[]} */
  const calls = [];
  const deps = {
    calls,
    cache: new Map(),
    now: () => NOW,
    getConfig: async () => ({ mostrarEstimados: o.mostrarEstimados !== false }),
    getUserRole: async () => ({
      role: o.role === undefined ? 'admin' : o.role,
      vendor: o.vendor === undefined ? '' : o.vendor,
    }),
    runQuery: async (/** @type {any} */ q) => {
      calls.push(q);
      const name = queryName(q.query);
      return (rowsByName && rowsByName[name]) || [];
    },
  };
  return deps;
}

const AUTH = { uid: 'u1' };

describe('dashboard-ventas-core', () => {
  it('vendedor_forzado: el vendedor solo ve lo suyo aunque pida otro', async () => {
    const deps = makeDeps({}, { role: 'vendedor', vendor: 'MAURICIO GIL' });
    await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { vendedores: ['PACHI'] },
    });
    expect(deps.calls.length).toBe(14);
    for (const q of deps.calls) {
      if (queryName(q.query) === 'opciones') {
        expect(q.params.scopeVendedores).toEqual(['MAURICIO GIL']);
        expect(q.types.scopeVendedores).toEqual(['STRING']);
        continue;
      }
      expect(q.params.vendedores).toEqual(['MAURICIO GIL']);
      expect(q.types.vendedores).toEqual(['STRING']);
    }
  });

  it('opciones_scope_por_rol: admin con Vendedor=A sigue viendo todos los vendedores', async () => {
    const deps = makeDeps({}, { role: 'admin' });
    await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { vendedores: ['A'] },
    });
    const opc = deps.calls.find((q) => queryName(q.query) === 'opciones');
    expect(opc.params.scopeVendedores).toEqual([]);
    expect(opc.params.vendedores).toBeUndefined();
    expect(opc.query).not.toContain('@vendedores');
    const kpis = deps.calls.find((q) => queryName(q.query) === 'kpis');
    expect(kpis.params.vendedores).toEqual(['A']);
    // gerente igual que admin.
    const f = applyRoleScope(normalizeFilters({ vendedores: ['A'] }, NOW), {
      role: 'gerente',
    });
    expect(f.scopeVendedores).toEqual([]);
  });

  it('vendedor_normalizado: mayúsculas y sin espacios en ambos lados', async () => {
    const deps = makeDeps({}, { role: 'vendedor', vendor: '  Mauricio Gil ' });
    await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    for (const q of deps.calls) {
      if (queryName(q.query) === 'opciones') {
        expect(q.params.scopeVendedores).toEqual(['MAURICIO GIL']);
        expect(q.query).toContain('UPPER(TRIM(assigned_vendor)) IN UNNEST(@scopeVendedores)');
      } else {
        expect(q.params.vendedores).toEqual(['MAURICIO GIL']);
      }
    }
    expect(normalizeFilters({ vendedores: [' pachi ', 'PACHI'] }, NOW).vendedores).toEqual([
      'PACHI',
    ]);
    const qs = buildQueries(normalizeFilters({}, NOW), NOW);
    expect(qs.kpis.query).toContain('UPPER(TRIM(assigned_vendor)) IN UNNEST(@vendedores)');
    expect(qs.serieBackorder.query).toContain(
      'UPPER(TRIM(s.assigned_vendor)) IN UNNEST(@vendedores)'
    );
    expect(qs.serieBackorder.query).toContain(
      'UPPER(TRIM(r.assigned_vendor)) IN UNNEST(@vendedores)'
    );
    // Ningún predicado compara assigned_vendor crudo contra el param.
    for (const name of ['kpis', 'topSkus', 'serieVentas', 'serieBackorder', 'opciones']) {
      const q = /** @type {any} */ (qs)[name];
      expect(q.query).not.toMatch(/[^(]assigned_vendor IN UNNEST/);
    }
  });

  it('array_vacio_null: todos los predicados usan COALESCE(ARRAY_LENGTH(...), 0)', () => {
    const qs = buildQueries(normalizeFilters({}, NOW), NOW);
    for (const name of ['kpis', 'topSkus', 'serieVentas', 'serieBackorder', 'opciones']) {
      const q = /** @type {any} */ (qs)[name];
      const all = q.query.match(/ARRAY_LENGTH\(@\w+\)/g) || [];
      const ok = q.query.match(/COALESCE\(ARRAY_LENGTH\(@\w+\), 0\) = 0/g) || [];
      expect(all.length).toBeGreaterThan(0);
      expect(ok.length).toBe(all.length);
    }
  });

  it('vendedor_sin_vendor_rechaza', async () => {
    const deps = makeDeps({}, { role: 'vendedor', vendor: '' });
    await expect(dashboardVentasCore(deps, { auth: AUTH, data: {} })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(deps.calls.length).toBe(0);
    expect(() => applyRoleScope(normalizeFilters({}, NOW), { role: 'vendedor' })).toThrow();
  });

  it('rol_desconocido_rechaza', async () => {
    const deps = makeDeps({}, { role: 'interno', vendor: 'X' });
    await expect(dashboardVentasCore(deps, { auth: AUTH, data: {} })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    const deps2 = makeDeps({}, { role: '' });
    await expect(dashboardVentasCore(deps2, { auth: AUTH, data: {} })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('sin auth rechaza unauthenticated', async () => {
    const deps = makeDeps({});
    await expect(dashboardVentasCore(deps, { auth: null, data: {} })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('admin_sin_filtros: arrays vacíos en params', async () => {
    const deps = makeDeps({}, { role: 'admin' });
    await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    const kpis = deps.calls.find((q) => queryName(q.query) === 'kpis');
    for (const k of ['vendedores', 'clientes', 'provincias', 'categorias', 'skus']) {
      expect(kpis.params[k]).toEqual([]);
      expect(kpis.types[k]).toEqual(['STRING']);
    }
    // gerente tampoco se restringe.
    const f = normalizeFilters({ vendedores: ['PACHI'] }, NOW);
    expect(applyRoleScope(f, { role: 'gerente', vendor: '' }).vendedores).toEqual(['PACHI']);
  });

  it("comillas_como_param: O'HIGGINS va en params, nunca en el texto", () => {
    const f = normalizeFilters({ provincias: ["O'HIGGINS"], mes: '2026-10' }, NOW);
    const qs = buildQueries(f, NOW);
    for (const name of ['kpis', 'topSkus', 'serieVentas', 'serieBackorder']) {
      const q = /** @type {any} */ (qs)[name];
      expect(q.params.provincias).toEqual(["O'HIGGINS"]);
      expect(q.query).not.toContain('HIGGINS');
      expect(q.query).toContain('(COALESCE(ARRAY_LENGTH(@provincias), 0) = 0 OR');
    }
    expect(qs.opciones.query).not.toContain('HIGGINS');
  });

  it('mes_invalido_default: mes inválido cae al mes en curso ART', () => {
    expect(normalizeFilters({ mes: '2026-13' }, NOW).mes).toBe('2026-10');
    expect(normalizeFilters({ mes: 'hola' }, NOW).mes).toBe('2026-10');
    expect(normalizeFilters({}, NOW).mes).toBe('2026-10');
    expect(normalizeFilters({ mes: '2026-03' }, NOW).mes).toBe('2026-03');
    // 2026-11-01 01:00 UTC = 2026-10-31 22:00 ART → sigue octubre.
    expect(normalizeFilters({}, Date.parse('2026-11-01T01:00:00Z')).mes).toBe('2026-10');
  });

  it('normalizeFilters: trim, sin vacíos, sin duplicados; >200 → invalid-argument', () => {
    const f = normalizeFilters({ skus: [' A ', '', 'A', 'B', null, 7] }, NOW);
    expect(f.skus).toEqual(['7', 'A', 'B']);
    // Orden estable para la clave de caché.
    expect(normalizeFilters({ skus: ['B', 'A'] }, NOW).skus).toEqual(['A', 'B']);
    const muchos = Array.from({ length: 201 }, (_, i) => 'S' + i);
    expect(() => normalizeFilters({ skus: muchos }, NOW)).toThrow();
    try {
      normalizeFilters({ skus: muchos }, NOW);
    } catch (e) {
      expect(/** @type {any} */ (e).code).toBe('invalid-argument');
    }
  });

  it('top_neto_negativo_al_final: SKU con ars < 0 queda último en topDinero', async () => {
    const deps = makeDeps({
      topSkus: [
        { sku: 'NEG', descr: 'Devuelto', uds: -2, ars: -5000 },
        { sku: 'A', descr: 'Reel A', uds: 3, ars: 1000 },
        { sku: 'B', descr: 'Reel B', uds: 10, ars: 9000 },
      ],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.topDinero.map((x) => x.sku)).toEqual(['B', 'A', 'NEG']);
    expect(r.topUnidades.map((x) => x.sku)).toEqual(['B', 'A', 'NEG']);
    expect(r.topDinero[0]).toEqual({
      sku: 'B',
      desc: 'Reel B',
      uds: 10,
      ars: 9000,
    });
  });

  it('sin_datos: runQuery vacío → kpis en 0, listas vacías', async () => {
    const deps = makeDeps({});
    const r = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { mes: '2026-10' },
    });
    expect(r.kpis).toEqual({
      facturado: 0,
      backorderArs: 0,
      pedidos: 0,
      pedidosUnicos: 0,
    });
    expect(r.topUnidades).toEqual([]);
    expect(r.topDinero).toEqual([]);
    expect(r.serieVentas.length).toBe(5);
    expect(r.serieVentas[0]).toEqual({ mes: '2026-06', valor: 0 });
    expect(r.serieVentas[4]).toEqual({ mes: '2026-10', valor: 0 });
    expect(r.serieBoUds.length).toBe(5);
    expect(r.serieBoUds.every((p) => p.valor === null)).toBe(true);
    expect(r.opciones).toEqual({
      vendedores: [],
      clientes: [],
      provincias: [],
      categorias: [],
      skus: [],
    });
    expect(typeof r.dataUpdatedAt).toBe('string');
  });

  it('kpis y opciones toman forma desde las filas', async () => {
    const deps = makeDeps({
      kpis: [
        {
          facturado: '123.5',
          pedidos: 4,
          pedidos_unicos: 2,
          backorder_ars: 77,
        },
      ],
      opciones: [
        { tipo: 'vendedor', code: 'PACHI', name: null },
        { tipo: 'cliente', code: 'C2', name: 'Bravo' },
        { tipo: 'cliente', code: 'C1', name: 'Alfa' },
        { tipo: 'provincia', code: 'CORDOBA', name: null },
        { tipo: 'categoria', code: 'REEL', name: null },
        { tipo: 'sku', code: 'S1', name: 'Reel 1' },
      ],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.kpis).toEqual({
      facturado: 123.5,
      backorderArs: 77,
      pedidos: 4,
      pedidosUnicos: 2,
    });
    expect(r.opciones.vendedores).toEqual(['PACHI']);
    expect(r.opciones.clientes).toEqual([
      { code: 'C1', name: 'Alfa' },
      { code: 'C2', name: 'Bravo' },
    ]);
    expect(r.opciones.skus).toEqual([{ code: 'S1', desc: 'Reel 1' }]);
    expect(r.opciones.provincias).toEqual(['CORDOBA']);
    expect(r.opciones.categorias).toEqual(['REEL']);
  });

  it('mes_sin_dato_es_null + foto real + vivo del mes en curso', async () => {
    const deps = makeDeps({
      serieBackorder: [
        { fuente: 'snapshot', mes: '2026-09', uds: 10, ars: 1000 },
        { fuente: 'vivo', mes: '2026-10', uds: 12, ars: 1200 },
      ],
    });
    const r = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { mes: '2026-10' },
    });
    const sep = r.serieBoUds.find((p) => p.mes === '2026-09');
    expect(sep).toEqual({ mes: '2026-09', valor: 10, estimado: false });
    const oct = r.serieBoArs.find((p) => p.mes === '2026-10');
    expect(oct).toEqual({ mes: '2026-10', valor: 1200, estimado: false });
    const ago = r.serieBoUds.find((p) => p.mes === '2026-08');
    expect(ago).toEqual({ mes: '2026-08', valor: null, estimado: false });
  });

  it('mes en curso con foto del día: gana la foto sobre el vivo', async () => {
    const deps = makeDeps({
      serieBackorder: [
        { fuente: 'snapshot', mes: '2026-10', uds: 5, ars: 500 },
        { fuente: 'vivo', mes: '2026-10', uds: 99, ars: 9900 },
      ],
    });
    const r = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { mes: '2026-10' },
    });
    expect(r.serieBoUds[4]).toEqual({
      mes: '2026-10',
      valor: 5,
      estimado: false,
    });
  });

  it('estimado_flag: mes reconstruido → estimado:true; mostrarEstimados=false → null', async () => {
    const rows = {
      serieBackorder: [
        { fuente: 'reconstruido', mes: '2026-07', uds: 8, ars: 800 },
        { fuente: 'snapshot', mes: '2026-09', uds: 10, ars: 1000 },
      ],
    };
    const r = await dashboardVentasCore(makeDeps(rows, { mostrarEstimados: true }), {
      auth: AUTH,
      data: { mes: '2026-10' },
    });
    expect(r.serieBoUds.find((p) => p.mes === '2026-07')).toEqual({
      mes: '2026-07',
      valor: 8,
      estimado: true,
    });
    const r2 = await dashboardVentasCore(makeDeps(rows, { mostrarEstimados: false }), {
      auth: AUTH,
      data: { mes: '2026-10' },
    });
    expect(r2.serieBoArs.find((p) => p.mes === '2026-07')).toEqual({
      mes: '2026-07',
      valor: null,
      estimado: true,
    });
    expect(r2.serieBoArs.find((p) => p.mes === '2026-09')).toEqual({
      mes: '2026-09',
      valor: 1000,
      estimado: false,
    });
  });

  it('monthsBetween: inclusive y con hasta < desde devuelve [hasta]', () => {
    expect(SERIE_DESDE).toBe('2026-06');
    expect(monthsBetween('2026-06', '2026-10')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(monthsBetween('2026-06', '2026-06')).toEqual(['2026-06']);
    expect(monthsBetween('2026-06', '2026-03')).toEqual(['2026-03']);
  });

  it('serieVentas va desde jun-26 hasta el mes elegido con los valores de BQ', async () => {
    const deps = makeDeps({
      serieVentas: [
        { anio: 2026, mes: 9, valor: 300 },
        { anio: 2026, mes: 6, valor: 100 },
      ],
    });
    const r = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { mes: '2026-10' },
    });
    expect(r.serieVentas.length).toBe(5);
    expect(r.serieVentas[0]).toEqual({ mes: '2026-06', valor: 100 });
    expect(r.serieVentas[3]).toEqual({ mes: '2026-09', valor: 300 });
    expect(r.serieVentas[4]).toEqual({ mes: '2026-10', valor: 0 });
  });

  it('serieVentas con un mes anterior a jun-26 tiene un solo punto', async () => {
    const deps = makeDeps({});
    const r = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { mes: '2026-03' },
    });
    expect(r.serieVentas.map((p) => p.mes)).toEqual(['2026-03']);
  });

  it('cache_hit: dos llamadas iguales dentro de 10 min → una sola corrida', async () => {
    const deps = makeDeps({});
    let t = NOW;
    deps.now = () => t;
    await dashboardVentasCore(deps, { auth: AUTH, data: { mes: '2026-10' } });
    t += 5 * 60 * 1000;
    await dashboardVentasCore(deps, { auth: AUTH, data: { mes: '2026-10' } });
    expect(deps.calls.length).toBe(14);
    // otro uid no comparte caché.
    await dashboardVentasCore(deps, {
      auth: { uid: 'u2' },
      data: { mes: '2026-10' },
    });
    expect(deps.calls.length).toBe(28);
    // vencido el TTL se vuelve a consultar.
    t += 6 * 60 * 1000;
    await dashboardVentasCore(deps, { auth: AUTH, data: { mes: '2026-10' } });
    expect(deps.calls.length).toBe(42);
  });

  it('buildQueries: params de mes y ventana desde jun-26', () => {
    const f = normalizeFilters({ mes: '2026-03' }, NOW);
    const qs = buildQueries(f, NOW);
    expect(qs.kpis.params.anio).toBe(2026);
    expect(qs.kpis.params.mesNum).toBe(3);
    expect(qs.serieVentas.params.desde).toBe('2026-03-01');
    expect(qs.serieVentas.params.hasta).toBe('2026-03-01');
    expect(
      buildQueries(normalizeFilters({ mes: '2026-10' }, NOW), NOW).serieVentas.params.desde
    ).toBe('2026-06-01');
    expect(qs.serieBackorder.params.mesActual).toBe('2026-10');
    expect(qs.serieVentas.types.desde).toBe('STRING');
    expect(qs.kpis.query).toContain('is_pesca = TRUE');
    expect(qs.kpis.query).toContain("doc_kind = 'INVOICE'");
  });

  it('ningún parámetro llega vacío a BigQuery (bug 29/10: DATE como string iba NULL)', () => {
    const req = createRequire(new URL('../../functions/package.json', import.meta.url));
    const { BigQuery } = req('@google-cloud/bigquery');
    const qs = buildQueries(normalizeFilters({ mes: '2026-09', vendedores: ['PACHI'] }, NOW), NOW);
    for (const [name, q] of Object.entries(qs)) {
      for (const [k, v] of Object.entries(q.params)) {
        const t = q.types && q.types[k];
        const p = BigQuery.valueToQueryParameter_(v, t);
        const val = p.parameterValue;
        const vacio = val.value === undefined && !Array.isArray(val.arrayValues);
        expect(vacio, `${name}.${k} (${JSON.stringify(t)}) llega vacío`).toBe(false);
      }
      expect(q.query).not.toMatch(/BETWEEN @desde|>= @desdeOpciones/);
    }
  });

  it('GROUP BY sin alias que choquen con columnas reales (anio/mes de v_ventas_lineas)', () => {
    const qs = buildQueries(normalizeFilters({ mes: '2026-10' }, NOW), NOW);
    expect(qs.serieVentas.query).toContain('GROUP BY anio_contable, mes_contable');
    for (const q of Object.values(qs)) {
      expect(q.query).not.toMatch(/GROUP BY anio\b/);
      expect(q.query).not.toMatch(/GROUP BY mes\b/);
    }
  });

  it('cache: mismo filtro en otro orden pega en caché; la respuesta es una copia', async () => {
    const deps = makeDeps({
      topSkus: [{ sku: 'A', descr: 'x', uds: 1, ars: 10 }],
    });
    const r1 = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { skus: ['B', 'A'] },
    });
    r1.topDinero.length = 0;
    r1.kpis.facturado = 999;
    const r2 = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { skus: ['A', 'B'] },
    });
    expect(deps.calls.length).toBe(14);
    expect(r2.topDinero.length).toBe(1);
    expect(r2.kpis.facturado).toBe(0);
    r2.topDinero.length = 0;
    const r3 = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { skus: ['A', 'B'] },
    });
    expect(r3.topDinero.length).toBe(1);
  });
});

describe('back order lee tablas materializadas, no las vistas lentas', () => {
  it('ninguna query usa v_backorder_dashboard ni v_backorder_reconstruido_mensual', async () => {
    const { buildQueries } = await import('../../functions/core/dashboard-ventas-queries.js');
    const qs = buildQueries({
      mes: '2026-09',
      vendedores: [],
      scopeVendedores: [],
      clientes: [],
      provincias: [],
      categorias: [],
      skus: [],
    });
    const all = Object.values(qs)
      .map((q) => q.query)
      .join('\n');
    expect(all).not.toMatch(/v_backorder_dashboard/);
    expect(all).not.toMatch(/v_backorder_reconstruido_mensual/);
    expect(all).toMatch(/backorder_dashboard_actual/);
    expect(all).toMatch(/backorder_reconstruido_mensual/);
  });
});

describe('dashboard-ventas-core: sección gestión', () => {
  const KPI = [{ facturado: 800000, backorder_ars: 0, pedidos: 4, pedidos_unicos: 4 }];

  it('cumplimiento = facturado / target', async () => {
    const deps = makeDeps({
      kpis: KPI,
      target: [{ target_ars: 1000000 }],
      rendiciones: [{ monto_ars: 5000 }],
      actividad: [{ visitas: 7, contactados: 3 }],
      interacciones: [
        {
          cliente: 'ACME',
          fecha: '2026-10-28',
          vendedor: 'PACHI',
          tipo: 'visita',
          total: 12,
        },
      ],
      baseActiva: [{ clientes: 40 }],
    });
    const r = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { mes: '2026-10' },
    });
    expect(r.gestion?.target).toBe(1000000);
    expect(r.gestion?.cumplimientoPct).toBe(80);
    expect(r.gestion?.rendicionesArs).toBe(5000);
    expect(r.gestion?.baseActiva).toBe(40);
    expect(r.gestion?.ticketPromedio).toBe(200000);
    expect(r.gestion?.visitas).toBe(7);
    expect(r.gestion?.contactados).toBe(3);
    expect(r.gestion?.interacciones).toBe(10);
    expect(r.gestion?.tablaInteracciones).toEqual({
      rows: [
        {
          cliente: 'ACME',
          fecha: '2026-10-28',
          vendedor: 'PACHI',
          tipo: 'visita',
        },
      ],
      total: 12,
    });
    expect(r.gestion?.filtrosNoAplican).toBe(false);
    expect(r.secciones).toEqual({});
  });

  it('cumplimiento redondea a 2 decimales', async () => {
    const deps = makeDeps({
      kpis: [{ facturado: 100, pedidos: 1 }],
      target: [{ target_ars: 300 }],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.gestion?.cumplimientoPct).toBe(33.33);
  });

  it('sin target → null, nunca Infinity', async () => {
    const deps = makeDeps({ kpis: KPI, target: [] });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.gestion?.target).toBeNull();
    expect(r.gestion?.cumplimientoPct).toBeNull();
    const deps0 = makeDeps({ kpis: KPI, target: [{ target_ars: 0 }] });
    const r0 = await dashboardVentasCore(deps0, { auth: AUTH, data: {} });
    expect(r0.gestion?.target).toBeNull();
    expect(r0.gestion?.cumplimientoPct).toBeNull();
  });

  it('ticket sin facturas = 0', async () => {
    const deps = makeDeps({ kpis: [{ facturado: 0, pedidos: 0 }] });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.gestion?.ticketPromedio).toBe(0);
  });

  it('falla de una query de gestión no rompe el resto', async () => {
    const deps = makeDeps({ kpis: KPI });
    const base = deps.runQuery;
    deps.runQuery = async (/** @type {any} */ q) => {
      if (queryName(q.query) === 'target') throw new Error('bq caído');
      return base(q);
    };
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.gestion).toBeNull();
    expect(r.secciones.gestion).toEqual({ error: true });
    expect(r.kpis.facturado).toBe(800000);
  });

  it('gestión exitosa deja secciones vacío', async () => {
    const deps = makeDeps({ kpis: KPI });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.secciones).toEqual({});
  });

  it('filtro cliente → filtrosNoAplican true', async () => {
    const deps = makeDeps({ kpis: KPI });
    const r = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { clientes: ['C1'] },
    });
    expect(r.gestion?.filtrosNoAplican).toBe(true);
    const r2 = await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { skus: ['S1'] },
    });
    expect(r2.gestion?.filtrosNoAplican).toBe(true);
  });

  it('vendedor: queries de gestión reciben solo su vendor', async () => {
    const deps = makeDeps({}, { role: 'vendedor', vendor: 'PACHI' });
    await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { vendedores: ['GONZALO DE LA ROSA'] },
    });
    const g = deps.calls.filter((q) =>
      ['target', 'rendiciones', 'actividad', 'interacciones', 'baseActiva'].includes(
        queryName(q.query)
      )
    );
    expect(g.length).toBe(5);
    for (const q of g) expect(q.params.vendedores).toEqual(['PACHI']);
  });

  it('runSeccion: ok con filas por nombre; falla → ok:false', async () => {
    const run = async (/** @type {any} */ q) => [{ n: queryName(q.query) }];
    const ok = await runSeccion(run, {
      a: { query: '-- dashboard:a', params: {} },
    });
    expect(ok).toEqual({ ok: true, rows: { a: [{ n: 'a' }] } });
    const bad = await runSeccion(
      async () => {
        throw new Error('x');
      },
      { a: { query: '-- dashboard:a', params: {} } }
    );
    expect(bad).toEqual({ ok: false });
  });
});

describe('dashboard-ventas-core: secciones productos, cobertura y clientes', () => {
  it('productos: mapea a camelCase; SKU solo con back order sale con udsVendidas 0', async () => {
    const deps = makeDeps({
      productos: [
        {
          categoria: 'REELS',
          familia: 'STELLA',
          sku: 'S1',
          uds_vendidas: 5,
          facturado: 1000,
          uds_backorder: 2,
        },
        {
          categoria: 'CAÑAS',
          familia: null,
          sku: 'S2',
          uds_vendidas: null,
          facturado: null,
          uds_backorder: 4,
        },
      ],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.productos).toEqual([
      {
        categoria: 'REELS',
        familia: 'STELLA',
        sku: 'S1',
        udsVendidas: 5,
        facturado: 1000,
        udsBackorder: 2,
      },
      {
        categoria: 'CAÑAS',
        familia: '',
        sku: 'S2',
        udsVendidas: 0,
        facturado: 0,
        udsBackorder: 4,
      },
    ]);
  });

  it('cobertura: pct 36/66 → 54.55; dadosAlta 0 → pct null; orden vendedor asc', async () => {
    const deps = makeDeps({
      cobertura: [
        { vendedor: 'PACHI', dados_alta: 0, compraron: 0 },
        { vendedor: 'GONZALO', dados_alta: 66, compraron: 36 },
      ],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.cobertura).toEqual([
      { vendedor: 'GONZALO', dadosAlta: 66, compraron: 36, pct: 54.55 },
      { vendedor: 'PACHI', dadosAlta: 0, compraron: 0, pct: null },
    ]);
  });

  it('clientes: mapea y respeta el orden del servidor', async () => {
    const deps = makeDeps({
      clientes: [
        { card_code: 'C2', nombre: 'Beta', facturado: 900 },
        { card_code: 'C1', nombre: null, facturado: 100 },
      ],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.clientes).toEqual([
      { code: 'C2', nombre: 'Beta', facturado: 900 },
      { code: 'C1', nombre: '', facturado: 100 },
    ]);
  });

  it('secciones exitosas: campos con datos y secciones vacío', async () => {
    const deps = makeDeps({});
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.productos).toEqual([]);
    expect(r.cobertura).toEqual([]);
    expect(r.clientes).toEqual([]);
    expect(r.secciones).toEqual({});
  });

  it('falla de cobertura no afecta productos ni clientes', async () => {
    const deps = makeDeps({
      productos: [
        {
          categoria: 'A',
          familia: 'B',
          sku: 'S1',
          uds_vendidas: 1,
          facturado: 1,
          uds_backorder: 0,
        },
      ],
    });
    const base = deps.runQuery;
    deps.runQuery = async (/** @type {any} */ q) => {
      if (queryName(q.query) === 'cobertura') throw new Error('bq caído');
      return base(q);
    };
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.cobertura).toBeNull();
    expect(r.secciones.cobertura).toEqual({ error: true });
    expect(r.productos?.length).toBe(1);
    expect(r.clientes).toEqual([]);
    expect(r.secciones.productos).toBeUndefined();
    expect(r.secciones.clientes).toBeUndefined();
  });

  it('vendedor: las 3 queries nuevas reciben solo su vendor', async () => {
    const deps = makeDeps({}, { role: 'vendedor', vendor: 'PACHI' });
    await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { vendedores: ['GONZALO DE LA ROSA'] },
    });
    const g = deps.calls.filter((q) =>
      ['productos', 'cobertura', 'clientes'].includes(queryName(q.query))
    );
    expect(g.length).toBe(3);
    for (const q of g) {
      expect(q.params.vendedores).toEqual(['PACHI']);
      expect(q.types.vendedores).toEqual(['STRING']);
    }
  });
});

describe('dashboard-ventas-core: sección campañas', () => {
  const fila = (/** @type {any} */ o) => ({
    campaign_id: 'c1',
    nombre: 'Camp',
    start_date: '2026-10-01',
    end_date: '2026-10-31',
    target_type: 'units',
    target_amount: 200,
    realizado_qty: 50,
    realizado_ars: 1000,
    ...o,
  });

  it('pct por tipo: units usa unidades, money usa pesos, redondeo a 2 decimales', async () => {
    const deps = makeDeps({
      campanias: [
        fila({}),
        fila({
          campaign_id: 'c2',
          target_type: 'money',
          target_amount: 3000,
          realizado_ars: 1000,
        }),
      ],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.campanias).toEqual([
      {
        id: 'c1',
        nombre: 'Camp',
        desde: '2026-10-01',
        hasta: '2026-10-31',
        objetivoTipo: 'units',
        objetivo: 200,
        uds: 50,
        ars: 1000,
        pct: 25,
      },
      {
        id: 'c2',
        nombre: 'Camp',
        desde: '2026-10-01',
        hasta: '2026-10-31',
        objetivoTipo: 'money',
        objetivo: 3000,
        uds: 50,
        ars: 1000,
        pct: 33.33,
      },
    ]);
  });

  it('objetivo 0 o nulo → pct null', async () => {
    const deps = makeDeps({
      campanias: [fila({ target_amount: 0 }), fila({ campaign_id: 'c2', target_amount: null })],
    });
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.campanias?.map((c) => c.pct)).toEqual([null, null]);
  });

  it('sin campañas activas → []', async () => {
    const r = await dashboardVentasCore(makeDeps({}), { auth: AUTH, data: {} });
    expect(r.campanias).toEqual([]);
  });

  it('falla de campañas no afecta el resto', async () => {
    const deps = makeDeps({});
    const base = deps.runQuery;
    deps.runQuery = async (/** @type {any} */ q) => {
      if (queryName(q.query) === 'campanias') throw new Error('bq caído');
      return base(q);
    };
    const r = await dashboardVentasCore(deps, { auth: AUTH, data: {} });
    expect(r.campanias).toBeNull();
    expect(r.secciones.campanias).toEqual({ error: true });
    expect(r.productos).toEqual([]);
    expect(r.gestion).not.toBeNull();
    expect(r.secciones.productos).toBeUndefined();
  });

  it('rol vendedor: la query recibe solo su vendor', async () => {
    const deps = makeDeps({}, { role: 'vendedor', vendor: 'PACHI' });
    await dashboardVentasCore(deps, {
      auth: AUTH,
      data: { vendedores: ['GONZALO DE LA ROSA'] },
    });
    const g = deps.calls.filter((q) => queryName(q.query) === 'campanias');
    expect(g.length).toBe(1);
    expect(g[0].params.vendedores).toEqual(['PACHI']);
    expect(g[0].types.vendedores).toEqual(['STRING']);
  });
});

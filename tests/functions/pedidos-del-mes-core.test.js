// v1540 APP-06: Pedidos del mes — core del callable pedidosDelMesCF.
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  agruparFacturacion,
  buildPedidosDelMesQuery,
  CACHE_TTL_MS,
  normalizePeriodo,
  pedidosDelMesCore,
  resolveAlcance,
} from '../../functions/core/pedidos-del-mes-core.js';

// 2026-11-02 11:00 ART = 14:00 UTC.
const NOW = Date.parse('2026-11-02T14:00:00Z');

/** Fila como la devuelve la query (cliente, SKU, documento). */
function fila(o) {
  return {
    card_code: 'C1',
    card_name: 'CLIENTE UNO',
    vendedor: 'PACHI',
    provincia: 'CORDOBA',
    localidad: 'ARROYITO',
    sku: 'SKU-A',
    descr: 'Reel A',
    doc_kind: 'INVOICE',
    doc_entry: 100,
    doc_num: 5000,
    fecha: '2026-10-05',
    uds: 1,
    ars: 1000,
    ...o,
  };
}

function mkDeps(rows, role) {
  return {
    runQuery: vi.fn(async () => rows),
    getUserRole: vi.fn(async () => role),
    cache: new Map(),
    now: () => NOW,
  };
}

describe('alcance por rol', () => {
  it('admin y gerente: nacional', () => {
    expect(resolveAlcance({ role: 'admin' })).toEqual({ nacional: true, vendedor: null });
    expect(resolveAlcance({ role: 'gerente', vendor: 'X' })).toEqual({
      nacional: true,
      vendedor: null,
    });
  });
  it('vendedor: su vendor normalizado', () => {
    expect(resolveAlcance({ role: 'vendedor', vendor: ' pachi ' })).toEqual({
      nacional: false,
      vendedor: 'PACHI',
    });
  });
  it('vendedor sin vendor, interno, viewer o sin rol: rechazado', () => {
    for (const r of [
      { role: 'vendedor' },
      { role: 'interno', vendor: 'X' },
      { role: 'viewer' },
      null,
    ]) {
      expect(() => resolveAlcance(r)).toThrow(
        expect.objectContaining({ code: 'permission-denied' })
      );
    }
  });
});

describe('período', () => {
  it('sin datos → mes actual en hora Argentina', () => {
    expect(normalizePeriodo({}, NOW)).toEqual({ anio: 2026, mes: 11 });
    // 2026-11-01 01:00 UTC = 31/10 22:00 ART → octubre.
    expect(normalizePeriodo(undefined, Date.parse('2026-11-01T01:00:00Z'))).toEqual({
      anio: 2026,
      mes: 10,
    });
  });
  it('histórico válido', () => {
    expect(normalizePeriodo({ anio: 2026, mes: 6 }, NOW)).toEqual({ anio: 2026, mes: 6 });
  });
  it('rechaza mes futuro, mes 13, año viejo y texto', () => {
    for (const d of [
      { anio: 2026, mes: 12 },
      { anio: 2026, mes: 13 },
      { anio: 2019, mes: 5 },
      { anio: '2026', mes: 'x' },
    ]) {
      expect(() => normalizePeriodo(d, NOW)).toThrow(
        expect.objectContaining({ code: 'invalid-argument' })
      );
    }
  });
});

describe('query', () => {
  it('filtra pesca, mes contable y vendedor como parámetro (nunca concatenado)', () => {
    const q = buildPedidosDelMesQuery(
      { anio: 2026, mes: 10 },
      { nacional: false, vendedor: "O'X" }
    );
    expect(q.query).toContain('v.is_pesca = TRUE');
    expect(q.query).toContain('v.anio_contable = @anio AND v.mes_contable = @mesNum');
    expect(q.query).toContain('IN UNNEST(@vendedores)');
    expect(q.query).not.toContain("O'X");
    expect(q.params).toEqual({ anio: 2026, mesNum: 10, vendedores: ["O'X"] });
  });
  it('agrupa por cliente, SKU y documento (cada línea una sola vez)', () => {
    const q = buildPedidosDelMesQuery({ anio: 2026, mes: 10 }, { nacional: true, vendedor: null });
    expect(q.query).toContain('GROUP BY v.card_code, v.item_code, v.doc_kind, v.doc_entry');
  });
  it('ningún parámetro llega vacío a BigQuery (nacional y vendedor)', () => {
    const req = createRequire(new URL('../../functions/package.json', import.meta.url));
    const { BigQuery } = req('@google-cloud/bigquery');
    for (const alc of [
      { nacional: true, vendedor: null },
      { nacional: false, vendedor: 'PACHI' },
    ]) {
      const q = buildPedidosDelMesQuery({ anio: 2026, mes: 10 }, alc);
      for (const [k, v] of Object.entries(q.params)) {
        const p = BigQuery.valueToQueryParameter_(v, q.types[k]);
        const val = p.parameterValue;
        expect(val.value === undefined && !Array.isArray(val.arrayValues), k).toBe(false);
      }
    }
  });
});

describe('agrupación', () => {
  it('cliente con una sola factura', () => {
    const { clientes, kpis } = agruparFacturacion([fila({ uds: 2, ars: 3000 })]);
    expect(clientes).toHaveLength(1);
    const c = clientes[0];
    expect(c).toMatchObject({
      cardCode: 'C1',
      nombre: 'CLIENTE UNO',
      localidad: 'ARROYITO',
      provincia: 'CORDOBA',
      vendedor: 'PACHI',
      totalUds: 2,
      totalArs: 3000,
      skuCount: 1,
      facturasCount: 1,
      notasCreditoCount: 0,
    });
    expect(c.skus[0]).toMatchObject({ sku: 'SKU-A', uds: 2, ars: 3000, precio: 1500 });
    expect(c.skus[0].facturas).toEqual([
      { tipo: 'FACTURA', numero: '5000', fecha: '2026-10-05', uds: 2, ars: 3000 },
    ]);
    expect(kpis).toEqual({ clientes: 1, skus: 1, uds: 2, ars: 3000, facturas: 1 });
  });

  it('varias facturas del mismo SKU se suman sin duplicar y se conservan las facturas', () => {
    const { clientes } = agruparFacturacion([
      fila({ doc_entry: 101, doc_num: 5001, uds: 1, ars: 1000 }),
      fila({ doc_entry: 102, doc_num: 5002, fecha: '2026-10-20', uds: 3, ars: 2400 }),
    ]);
    const s = clientes[0].skus[0];
    expect(s).toMatchObject({ uds: 4, ars: 3400, precio: 850 });
    expect(s.facturas.map((f) => f.numero)).toEqual(['5001', '5002']);
    expect(clientes[0].facturasCount).toBe(2);
  });

  it('varios SKU ordenados por importe', () => {
    const { clientes } = agruparFacturacion([
      fila({ sku: 'BAJO', ars: 100 }),
      fila({ sku: 'ALTO', ars: 9000 }),
    ]);
    expect(clientes[0].skus.map((s) => s.sku)).toEqual(['ALTO', 'BAJO']);
    expect(clientes[0].skuCount).toBe(2);
  });

  it('nota de crédito resta del SKU (neto) y se identifica', () => {
    const { clientes, kpis } = agruparFacturacion([
      fila({ uds: 5, ars: 5000 }),
      fila({ doc_kind: 'CREDIT_NOTE', doc_entry: 7, doc_num: 900, uds: -2, ars: -2000 }),
    ]);
    const c = clientes[0];
    expect(c.skus[0]).toMatchObject({ uds: 3, ars: 3000, precio: 1000 });
    expect(c.skus[0].facturas.map((f) => f.tipo)).toEqual(['FACTURA', 'NOTA_CREDITO']);
    expect(c.notasCreditoCount).toBe(1);
    expect(c.facturasCount).toBe(1);
    expect(kpis.facturas).toBe(1); // las NC no cuentan como facturas
  });

  it('SKU devuelto completo: cantidad 0, sin precio (no divide por cero)', () => {
    const { clientes } = agruparFacturacion([
      fila({ uds: 1, ars: 1000 }),
      fila({ doc_kind: 'CREDIT_NOTE', doc_entry: 8, uds: -1, ars: -1000 }),
    ]);
    expect(clientes[0].skus[0]).toMatchObject({ uds: 0, ars: 0, precio: null });
  });

  it('dos clientes: ordenados por importe; SKU distintos contados una vez en KPIs', () => {
    const { clientes, kpis } = agruparFacturacion([
      fila({ card_code: 'C1', ars: 100 }),
      fila({ card_code: 'C2', card_name: 'DOS', ars: 500, doc_entry: 200 }),
    ]);
    expect(clientes.map((c) => c.cardCode)).toEqual(['C2', 'C1']);
    expect(kpis).toMatchObject({ clientes: 2, skus: 1, ars: 600, facturas: 2 });
  });

  it('mes sin facturación: lista vacía y totales en cero', () => {
    expect(agruparFacturacion([])).toEqual({
      clientes: [],
      kpis: { clientes: 0, skus: 0, uds: 0, ars: 0, facturas: 0 },
    });
  });

  it('valores BigQuery (Big / {value}) y redondeo', () => {
    const big = { valueOf: () => '0.1' };
    const { clientes } = agruparFacturacion([
      fila({ ars: big, uds: 1 }),
      fila({ ars: { valueOf: () => '0.2' }, uds: 1, doc_entry: 2, fecha: { value: '2026-10-09' } }),
    ]);
    expect(clientes[0].totalArs).toBe(0.3);
    expect(clientes[0].skus[0].facturas[1].fecha).toBe('2026-10-09');
  });
});

describe('pedidosDelMesCore', () => {
  it('sin login → unauthenticated', async () => {
    await expect(
      pedidosDelMesCore(mkDeps([], { role: 'admin' }), { auth: null, data: {} })
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('vendedor: el servidor fuerza su vendor aunque el navegador pida otro', async () => {
    const deps = mkDeps([fila({})], { role: 'vendedor', vendor: 'PACHI' });
    const r = await pedidosDelMesCore(deps, {
      auth: { uid: 'u1' },
      data: { anio: 2026, mes: 10, vendedor: 'MAURICIO GIL', vendedores: ['MAURICIO GIL'] },
    });
    const q = deps.runQuery.mock.calls[0][0];
    expect(q.params.vendedores).toEqual(['PACHI']);
    expect(r.alcance).toEqual({ nacional: false, vendedor: 'PACHI' });
  });

  it('admin: nacional (sin filtro de vendedor)', async () => {
    const deps = mkDeps([fila({})], { role: 'admin' });
    const r = await pedidosDelMesCore(deps, { auth: { uid: 'a' }, data: { anio: 2026, mes: 10 } });
    expect(deps.runQuery.mock.calls[0][0].params.vendedores).toEqual([]);
    expect(r.alcance.nacional).toBe(true);
    expect(r.periodo).toEqual({ anio: 2026, mes: 10 });
    expect(r.kpis.clientes).toBe(1);
  });

  it('interno: rechazado sin consultar BigQuery', async () => {
    const deps = mkDeps([], { role: 'interno', vendor: 'X' });
    await expect(pedidosDelMesCore(deps, { auth: { uid: 'i' }, data: {} })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(deps.runQuery).not.toHaveBeenCalled();
  });

  it('caché 10 min por alcance + período; vendedores distintos no se mezclan', async () => {
    const cache = new Map();
    let t = NOW;
    const mk = (role) => ({
      runQuery: vi.fn(async () => [fila({ vendedor: role.vendor || 'X' })]),
      getUserRole: vi.fn(async () => role),
      cache,
      now: () => t,
    });
    const a = mk({ role: 'vendedor', vendor: 'PACHI' });
    await pedidosDelMesCore(a, { auth: { uid: 'p' }, data: { anio: 2026, mes: 10 } });
    await pedidosDelMesCore(a, { auth: { uid: 'p' }, data: { anio: 2026, mes: 10 } });
    expect(a.runQuery).toHaveBeenCalledTimes(1);
    const b = mk({ role: 'vendedor', vendor: 'MAURICIO GIL' });
    await pedidosDelMesCore(b, { auth: { uid: 'm' }, data: { anio: 2026, mes: 10 } });
    expect(b.runQuery).toHaveBeenCalledTimes(1);
    t = NOW + CACHE_TTL_MS + 1;
    await pedidosDelMesCore(a, { auth: { uid: 'p' }, data: { anio: 2026, mes: 10 } });
    expect(a.runQuery).toHaveBeenCalledTimes(2);
  });

  it('la respuesta cacheada es una copia (no se puede corromper)', async () => {
    const deps = mkDeps([fila({})], { role: 'admin' });
    const r1 = await pedidosDelMesCore(deps, { auth: { uid: 'a' }, data: { anio: 2026, mes: 10 } });
    r1.clientes[0].nombre = 'ROTO';
    const r2 = await pedidosDelMesCore(deps, { auth: { uid: 'a' }, data: { anio: 2026, mes: 10 } });
    expect(r2.clientes[0].nombre).toBe('CLIENTE UNO');
  });
});

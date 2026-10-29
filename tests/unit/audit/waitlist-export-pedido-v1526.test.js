// v1526: "Exportar pedido" con 3 variantes (Stock Asignado / Original / Completo).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWaitlistExportRows,
  isStockAsignadoItem,
} from '../../../src/pure/waitlist-export-rows.js';

const PRICES = { A: 100, B: 250, C: 1000, D: 50 };
const getPrice = (c) => PRICES[c] || 0;
const ITEMS = [
  {
    code: 'A',
    desc: 'Prod A',
    qty: 2,
    origen: 'stock-asignado',
    asigRefs: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
  },
  { code: 'B', desc: 'Prod B', qty: 3 },
  { code: 'C', desc: 'Prod C', qty: 1 }, // sin stock: igual va (antes se omitia)
  { code: 'D', desc: 'Prod D', qty: 4, origen: 'stock-asignado' },
  { code: 'E', desc: 'qty 0', qty: 0 },
  null,
];

describe('buildWaitlistExportRows', () => {
  it('completo = todas las lineas con cantidad pedida x precio (= Total pedido del modal)', () => {
    const r = buildWaitlistExportRows(ITEMS, 'completo', getPrice);
    expect(r.rows.map((x) => x.code)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.total).toBe(2 * 100 + 3 * 250 + 1000 + 4 * 50);
    expect(r.unidades).toBe(10);
  });
  it('asignado = solo lineas STOCK ASIGNADO', () => {
    const r = buildWaitlistExportRows(ITEMS, 'asignado', getPrice);
    expect(r.rows.map((x) => x.code)).toEqual(['A', 'D']);
    expect(r.total).toBe(400);
  });
  it('original = todo lo que NO es STOCK ASIGNADO', () => {
    const r = buildWaitlistExportRows(ITEMS, 'original', getPrice);
    expect(r.rows.map((x) => x.code)).toEqual(['B', 'C']);
    expect(r.total).toBe(1750);
  });
  it('asignado + original = completo (particion exacta)', () => {
    const a = buildWaitlistExportRows(ITEMS, 'asignado', getPrice);
    const o = buildWaitlistExportRows(ITEMS, 'original', getPrice);
    const c = buildWaitlistExportRows(ITEMS, 'completo', getPrice);
    expect(a.total + o.total).toBe(c.total);
    expect(a.unidades + o.unidades).toBe(c.unidades);
    expect(a.rows.length + o.rows.length).toBe(c.rows.length);
  });
  it('no depende del stock: una linea sin stock sigue en el Excel (bug REBORN 632)', () => {
    const r = buildWaitlistExportRows([{ code: 'C', qty: 5 }], 'completo', getPrice);
    expect(r.rows[0].qty).toBe(5);
  });
  it('items vacio / no array', () => {
    expect(buildWaitlistExportRows(null, 'completo', getPrice).rows).toEqual([]);
    expect(isStockAsignadoItem({ origen: 'stock-asignado' })).toBe(true);
    expect(isStockAsignadoItem({})).toBe(false);
  });
});

describe('contrato index.html v1526', () => {
  const html = readFileSync('index.html', 'utf8');
  it('boton unico "Exportar pedido" abre el selector', () => {
    expect(html).toContain('id="wcard-export-pedido-btn" onclick="waitlistExportPedido()"');
    expect(html).toContain('window.waitlistExportPedido = function');
    expect(html).toContain("'Pedido Stock Asignado'");
    expect(html).toContain("'Pedido Original'");
    expect(html).toContain("'Pedido Completo'");
  });
  it('export viejo capeado por stock libre general eliminado', () => {
    expect(html).not.toContain('waitlistExportArchivoCliente');
    expect(html).not.toContain('wcard-archivo-cliente-btn');
  });
  it('main.js expone el pure', () => {
    const main = readFileSync('src/main.js', 'utf8');
    expect(main).toContain("from './pure/waitlist-export-rows.js'");
    expect(main).toMatch(/buildWaitlistExportRows,\n\s+isStockAsignadoItem,/);
  });
});

describe('v1526: "Recargar limpio" preserva la lista de precios local', () => {
  it('shimano_price_cache_v1 esta en CLEAN_RELOAD_PRESERVE_KEYS', () => {
    const html = readFileSync('index.html', 'utf8');
    const m = html.match(/const CLEAN_RELOAD_PRESERVE_KEYS = Object\.freeze\(\[([\s\S]*?)\]\)/);
    expect(m).not.toBeNull();
    expect(m[1]).toContain("'shimano_price_cache_v1'");
    expect(m[1]).toContain("'shimano_zonas_pending_v1'");
  });
});

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

describe('v1527: "Recargar limpio" preserva la lista de precios local', () => {
  it('shimano_price_cache_v1 esta en CLEAN_RELOAD_PRESERVE_KEYS', () => {
    const html = readFileSync('index.html', 'utf8');
    const m = html.match(/const CLEAN_RELOAD_PRESERVE_KEYS = Object\.freeze\(\[([\s\S]*?)\]\)/);
    expect(m).not.toBeNull();
    expect(m[1]).toContain("'shimano_price_cache_v1'");
    expect(m[1]).toContain("'shimano_zonas_pending_v1'");
  });
});

describe('v1530: lo que no tiene stock va en rojo y no suma', () => {
  // Con stock por indice de item (mismo calculo que "Subtotal (Con Stock)" del modal).
  const CON = { 0: 2, 1: 1, 2: 0, 3: 4 };
  const getCon = (i) => CON[i];

  it('parcial = fila normal + fila sinStock; sin stock = solo fila roja', () => {
    const r = buildWaitlistExportRows(ITEMS, 'completo', getPrice, getCon);
    expect(r.rows.map((x) => `${x.code}:${x.qty}:${x.sinStock}`)).toEqual([
      'A:2:false',
      'B:1:false',
      'B:2:true',
      'C:1:true',
      'D:4:false',
    ]);
    expect(r.productos).toBe(4);
  });

  it('el total suma solo lo que tiene stock; el back order va aparte', () => {
    const r = buildWaitlistExportRows(ITEMS, 'completo', getPrice, getCon);
    expect(r.total).toBe(2 * 100 + 1 * 250 + 4 * 50);
    expect(r.unidades).toBe(7);
    expect(r.totalSinStock).toBe(2 * 250 + 1000);
    expect(r.unidadesSinStock).toBe(3);
    // Total con + sin = lo que pidio el cliente.
    expect(r.total + r.totalSinStock).toBe(2 * 100 + 3 * 250 + 1000 + 4 * 50);
  });

  it('ejemplo Mariano: pedido $1.000.000 con $200.000 sin stock -> total $800.000', () => {
    const items = [
      { code: 'X', qty: 8 },
      { code: 'Y', qty: 2 },
    ];
    const r = buildWaitlistExportRows(
      items,
      'completo',
      () => 100000,
      (i) => [8, 0][i]
    );
    expect(r.total).toBe(800000);
    expect(r.totalSinStock).toBe(200000);
  });

  it('sin dato de stock (null) o con mas stock que lo pedido: todo suma', () => {
    const items = [
      { code: 'A', qty: 2 },
      { code: 'B', qty: 3 },
    ];
    const r = buildWaitlistExportRows(items, 'completo', getPrice, (i) => [null, 99][i]);
    expect(r.rows.every((x) => !x.sinStock)).toBe(true);
    expect(r.total).toBe(2 * 100 + 3 * 250);
    expect(r.unidadesSinStock).toBe(0);
  });

  it('asignado + original = completo tambien con back order', () => {
    const a = buildWaitlistExportRows(ITEMS, 'asignado', getPrice, getCon);
    const o = buildWaitlistExportRows(ITEMS, 'original', getPrice, getCon);
    const c = buildWaitlistExportRows(ITEMS, 'completo', getPrice, getCon);
    expect(a.total + o.total).toBe(c.total);
    expect(a.totalSinStock + o.totalSinStock).toBe(c.totalSinStock);
  });

  it('contrato index.html: el modal guarda el con-stock por item y el Excel pinta rojo', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('qtyConStock: qtyConSap,');
    expect(html).toContain('window._wcardQtyConStock = { id: w._id, byIdx: {} };');
    expect(html).toContain('pure(w.items || [], mode, getPrice, getQtyConStock)');
    expect(html).toContain("'SIN STOCK, QUEDA EN BACK ORDER ('");
    expect(html).toContain("'TOTAL DEL PEDIDO (CON STOCK)'");
    expect(html).toContain("const ROJO = 'FFDC2626';");
  });
});

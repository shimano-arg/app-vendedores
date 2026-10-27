// @ts-check
/**
 * v1488 §86 (2026-10-27) — fuente única backorder export.
 *
 * Reporte Mariano: los 2 exports de backorder (panel izquierdo "EXPORTAR" vs
 * modal BACKORDER) divergían en unidades. Delta medido contra prod:
 * modal 7696 vs panel 7474 → +222 unidades por BOs > 90d (`includeExpired`).
 *
 * Fix: pure fn `computeBackorderExportRows` que:
 *   - Default `includeExpired=true` (alineado con §40.1 y
 *     getStockBreakdown.backorderApp.total).
 *   - Consolida por cliente+SKU (§56).
 *   - Devuelve filas uniformes con columna Edad_BO_dias.
 *
 * Ambos exports (panel y modal) la llaman — mismos defaults, mismos totales.
 *
 * Fixture requirements (regla v1137+ `backorder-sku-map.js:284`):
 * - `stage: 'confirmed'` obligatorio para que entre el pedido.
 * - `closedAt: null`.
 * - `lines[].qtyOpen > 0`.
 * - `createdAt` populated.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeBackorderExportRows,
  formatBackorderFiltrosHeader,
} from '../../../src/pure/backorder-export-rows.js';

/** Helper deps mock reutilizable. */
function makeDeps(stockMap, products) {
  return {
    getStockDisponibleVenta: (sku) => Number((stockMap || {})[String(sku).toUpperCase()]) || 0,
    canonVendor: (v) =>
      String(v || '')
        .trim()
        .toUpperCase(),
    products: products || [],
    resolveVendorFallback: () => '',
  };
}

/** Helper fixture pedido con shape mínimo que el compute acepta. */
function mkPedido(opts) {
  return {
    _fsId: opts.id,
    stage: 'confirmed',
    closedAt: null,
    clientCardCode: opts.cardCode || 'C001',
    clientName: opts.cliente || 'CLIENTE',
    province: opts.province || 'BA',
    locName: opts.locName || 'LANUS',
    ownerVendor: opts.vendor || 'MAURICIO GIL',
    createdAt: opts.createdAt || new Date().toISOString(),
    lines: opts.lines || [],
  };
}

describe('v1488 §86 — computeBackorderExportRows (pure fn)', () => {
  it('T1 default includeExpired=true: BO > 90d SE INCLUYE (§40.1)', () => {
    const oldMs = Date.now() - 100 * 24 * 60 * 60 * 1000;
    const pedidos = [
      mkPedido({
        id: 'p_old',
        cliente: 'VIEJO SRL',
        createdAt: new Date(oldMs).toISOString(),
        lines: [{ code: 'SKU_X', state: 'BO', qty: 5, qtyOpen: 5, precio: 1000 }],
      }),
    ];
    const r = computeBackorderExportRows(pedidos, {}, makeDeps({}));
    expect(r.totalUnidades).toBe(5);
    expect(r.rows[0].Edad_BO_dias).toBeGreaterThanOrEqual(99);
    expect(r.filtrosAplicados.includeExpired).toBe(true);
  });

  it('T2 includeExpired=false: BO > 90d SE EXCLUYE', () => {
    const oldMs = Date.now() - 100 * 24 * 60 * 60 * 1000;
    const pedidos = [
      mkPedido({
        id: 'p_old',
        cliente: 'VIEJO',
        createdAt: new Date(oldMs).toISOString(),
        lines: [{ code: 'SKU_X', state: 'BO', qty: 5, qtyOpen: 5, precio: 1000 }],
      }),
    ];
    const r = computeBackorderExportRows(pedidos, { includeExpired: false }, makeDeps({}));
    expect(r.totalUnidades).toBe(0);
    expect(r.rows.length).toBe(0);
  });

  it('T3 fixture §J: cliente con BO parcial', () => {
    const nowMs = Date.now();
    const pedidos = [
      mkPedido({
        id: 'p1',
        cardCode: 'CJ',
        cliente: 'CLIENTE J',
        createdAt: new Date(nowMs - 10 * 86400000).toISOString(),
        lines: [{ code: 'SKU_J', state: 'BO', qty: 3, qtyOpen: 3, precio: 500 }],
      }),
    ];
    const r = computeBackorderExportRows(pedidos, {}, makeDeps({}));
    expect(r.totalUnidades).toBe(3);
    expect(r.rows[0].Cliente).toBe('CLIENTE J');
    expect(r.rows[0].Cantidad_Pendiente_BO).toBe(3);
  });

  it('T4 fixture 2 clientes mismo SKU: 2 filas distintas', () => {
    const nowMs = Date.now();
    const pedidos = [
      mkPedido({
        id: 'p_a',
        cardCode: 'CA',
        cliente: 'CLIENTE A',
        vendor: 'VDE1',
        createdAt: new Date(nowMs - 5 * 86400000).toISOString(),
        lines: [{ code: 'SKU_Y', state: 'BO', qty: 4, qtyOpen: 4, precio: 100 }],
      }),
      mkPedido({
        id: 'p_b',
        cardCode: 'CB',
        cliente: 'CLIENTE B',
        vendor: 'VDE2',
        createdAt: new Date(nowMs - 10 * 86400000).toISOString(),
        lines: [{ code: 'SKU_Y', state: 'BO', qty: 7, qtyOpen: 7, precio: 100 }],
      }),
    ];
    const r = computeBackorderExportRows(pedidos, {}, makeDeps({}));
    expect(r.rows.length).toBe(2);
    expect(r.totalUnidades).toBe(11);
    expect(r.rows[0].Cliente).toBe('CLIENTE A');
    expect(r.rows[1].Cliente).toBe('CLIENTE B');
    expect(r.rows[0].Cantidad_Pendiente_BO).toBe(4);
    expect(r.rows[1].Cantidad_Pendiente_BO).toBe(7);
  });

  it('T5 pedido con línea cancelled NO cuenta', () => {
    const nowMs = Date.now();
    const pedidos = [
      mkPedido({
        id: 'p_cancel',
        cardCode: 'CC',
        cliente: 'CANCELADO',
        createdAt: new Date(nowMs - 1 * 86400000).toISOString(),
        lines: [{ code: 'SKU_Z', state: 'cancelled', qty: 10, qtyOpen: 0, precio: 100 }],
      }),
    ];
    const r = computeBackorderExportRows(pedidos, {}, makeDeps({}));
    expect(r.totalUnidades).toBe(0);
    expect(r.rows.length).toBe(0);
  });

  it('T6 cliente consolidado: mismo cardCode + SKU en 2 pedidos = 1 fila', () => {
    const nowMs = Date.now();
    const pedidos = [
      mkPedido({
        id: 'p_x1',
        cardCode: 'CDUP',
        cliente: 'DUPL',
        createdAt: new Date(nowMs - 3 * 86400000).toISOString(),
        lines: [{ code: 'SKU_D', state: 'BO', qty: 2, qtyOpen: 2, precio: 50 }],
      }),
      mkPedido({
        id: 'p_x2',
        cardCode: 'CDUP',
        cliente: 'DUPL',
        createdAt: new Date(nowMs - 1 * 86400000).toISOString(),
        lines: [{ code: 'SKU_D', state: 'BO', qty: 3, qtyOpen: 3, precio: 50 }],
      }),
    ];
    const r = computeBackorderExportRows(pedidos, {}, makeDeps({}));
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].Cantidad_Pendiente_BO).toBe(5);
    expect(r.rows[0].Edad_BO_dias).toBeGreaterThanOrEqual(2);
    expect(r.rows[0].Edad_BO_dias).toBeLessThanOrEqual(4);
  });

  it('T7 fixture completo: 2 clientes BO mismo SKU + 1 cancelled', () => {
    const nowMs = Date.now();
    const pedidos = [
      mkPedido({
        id: 'p_j',
        cardCode: 'CJ',
        cliente: 'J',
        createdAt: new Date(nowMs - 5 * 86400000).toISOString(),
        lines: [{ code: 'SKU_SHARED', state: 'BO', qty: 3, qtyOpen: 3, precio: 100 }],
      }),
      mkPedido({
        id: 'p_k',
        cardCode: 'CK',
        cliente: 'K',
        createdAt: new Date(nowMs - 2 * 86400000).toISOString(),
        lines: [{ code: 'SKU_SHARED', state: 'BO', qty: 5, qtyOpen: 5, precio: 100 }],
      }),
      mkPedido({
        id: 'p_cancel',
        cardCode: 'CZ',
        cliente: 'Z',
        createdAt: new Date(nowMs - 1 * 86400000).toISOString(),
        lines: [{ code: 'SKU_SHARED', state: 'cancelled', qty: 100, qtyOpen: 0, precio: 100 }],
      }),
    ];
    const r = computeBackorderExportRows(pedidos, {}, makeDeps({}));
    expect(r.totalUnidades).toBe(8);
    expect(r.rows.length).toBe(2);
    const panelR = computeBackorderExportRows(pedidos, {}, makeDeps({}));
    const modalR = computeBackorderExportRows(pedidos, { includeExpired: true }, makeDeps({}));
    expect(panelR.totalUnidades).toBe(modalR.totalUnidades);
    expect(panelR.rows.length).toBe(modalR.rows.length);
  });
});

describe('v1488 §86 — formatBackorderFiltrosHeader', () => {
  it('T20 sin filtros → "ninguno (toda la cola §40.1)"', () => {
    const s = formatBackorderFiltrosHeader({ includeExpired: true });
    expect(s).toContain('ninguno');
    expect(s).toContain('§40.1');
  });

  it('T21 vendor + mes → formato breve', () => {
    const s = formatBackorderFiltrosHeader({
      vendorKey: 'MAURICIO GIL',
      mesYYYYMM: '2026-10',
      includeExpired: true,
    });
    expect(s).toContain('vendedor="MAURICIO GIL"');
    expect(s).toContain('mes=2026-10');
  });

  it('T22 includeExpired=false → "solo_vigentes_90d"', () => {
    const s = formatBackorderFiltrosHeader({ includeExpired: false });
    expect(s).toContain('solo_vigentes_90d');
  });
});

describe('v1488 §86 — contrato: exports-core.js y index.html usan la pure fn', () => {
  const EXPORTS = readFileSync('src/domains/exports-core.js', 'utf8');
  const INDEX_HTML = readFileSync('index.html', 'utf8');
  const MAIN = readFileSync('src/main.js', 'utf8');

  it('T30 exports-core (panel) usa computeBackorderExportRows', () => {
    const idx = EXPORTS.indexOf('window.exportBackorderAll');
    const slice = EXPORTS.slice(idx, idx + 3000);
    expect(slice).toMatch(/backorderExport\.computeBackorderExportRows/);
  });

  it('T31 index.html (modal) delega al pure fn', () => {
    const idx = INDEX_HTML.indexOf('window.exportBackordersToExcel');
    const slice = INDEX_HTML.slice(idx, idx + 5000);
    expect(slice).toMatch(/_bkExportFn/);
    expect(slice).toMatch(/backorderExport\.computeBackorderExportRows/);
  });

  it('T32 main.js expone backorderExport en __phase0.pure', () => {
    expect(MAIN).toMatch(/backorderExport: \{/);
    expect(MAIN).toMatch(/computeBackorderExportRows/);
    expect(MAIN).toMatch(/formatBackorderFiltrosHeader/);
  });
});

describe('v1488 — bump versión', () => {
  it('T40 APP_VERSION ≥ v1488 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1488);
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});

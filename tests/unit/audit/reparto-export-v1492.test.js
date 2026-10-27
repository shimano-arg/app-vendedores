// @ts-check
/**
 * v1492 §91 (2026-10-27) — export Excel del módulo "Reparto de ingresos".
 *
 * Pedido Mariano: agregar botón en el modal "Reparto de ingresos" para
 * exportar todo a Excel.
 *
 * Fuente: `window._repartoIngresos` (array inline). Dos hojas: Resumen (una
 * fila por ingreso) + Detalle (una fila por cliente). Fila TOTAL al final.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const EXPORTS = readFileSync('src/domains/exports-core.js', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1492 §91 — exportRepartoToExcel handler', () => {
  it('T1 window.exportRepartoToExcel está definido en exports-core.js', () => {
    expect(EXPORTS).toMatch(/window\.exportRepartoToExcel\s*=\s*async function/);
  });

  it('T2 lee _repartoIngresos (fuente de datos del modal)', () => {
    const idx = EXPORTS.indexOf('window.exportRepartoToExcel');
    const slice = EXPORTS.slice(idx, idx + 6000);
    expect(slice).toMatch(/w\._repartoIngresos/);
  });

  it('T3 genera 2 hojas: Resumen + Detalle', () => {
    const idx = EXPORTS.indexOf('window.exportRepartoToExcel');
    const slice = EXPORTS.slice(idx, idx + 6000);
    expect(slice).toMatch(/{\s*name:\s*['"]Resumen['"]/);
    expect(slice).toMatch(/{\s*name:\s*['"]Detalle['"]/);
  });

  it('T4 fila TOTAL agregada por pure fn (v1497 §96 refactor)', async () => {
    // v1497 §96: la fila TOTAL ahora vive en la pure fn `computeRepartoExportRows`,
    // no en el handler inline. Verifica el shape de output de la pure fn.
    const { computeRepartoExportRows } = await import('../../../src/pure/reparto-export-rows.js');
    const r = computeRepartoExportRows(
      [{ sku: 'X', qtyIngresada: 1, clientesBO: [{ clientName: 'A', qtyBO: 1 }] }],
      { hideNoStock: false },
      { getStockFisico: () => 10 }
    );
    expect(r.resumenRows[r.resumenRows.length - 1].SKU).toBe('TOTAL');
    expect(r.detalleRows[r.detalleRows.length - 1].SKU).toBe('TOTAL');
  });

  it('T5 columnas Resumen: SKU, Producto, Stock_fisico_dep11, Qty_ingresada, N_clientes_BO, Suma_BO_solicitada, Qty_asignada, Vuelve_a_BO, Status, Ingreso_detectado', async () => {
    const { computeRepartoExportRows } = await import('../../../src/pure/reparto-export-rows.js');
    const r = computeRepartoExportRows(
      [{ sku: 'X', qtyIngresada: 1, clientesBO: [{ clientName: 'A', qtyBO: 1 }] }],
      { hideNoStock: false },
      { getStockFisico: () => 10 }
    );
    const cols = Object.keys(r.resumenRows[0]);
    expect(cols).toContain('N_clientes_BO');
    expect(cols).toContain('Suma_BO_solicitada');
    expect(cols).toContain('Stock_fisico_dep11');
    expect(cols).toContain('Qty_ingresada');
    // v1497 §96: columnas nuevas pedidas por Mariano.
    expect(cols).toContain('Qty_asignada');
    expect(cols).toContain('Vuelve_a_BO');
  });

  it('T6 columnas Detalle: SKU, Producto, Cliente, CardCode, Localidad, Provincia, Vendedor, Qty_BO_solicitada, Status', async () => {
    const { computeRepartoExportRows } = await import('../../../src/pure/reparto-export-rows.js');
    const r = computeRepartoExportRows(
      [{ sku: 'X', qtyIngresada: 1, clientesBO: [{ clientName: 'A', qtyBO: 1 }] }],
      { hideNoStock: false },
      { getStockFisico: () => 10 }
    );
    const cols = Object.keys(r.detalleRows[0]);
    expect(cols).toContain('Cliente');
    expect(cols).toContain('CardCode');
    expect(cols).toContain('Vendedor');
    expect(cols).toContain('Qty_BO_solicitada');
    // v1497 §96: Localidad y Provincia agregadas (robust a "cliente sin localidad").
    expect(cols).toContain('Localidad');
    expect(cols).toContain('Provincia');
  });

  it('T7 usa downloadXlsx (patrón existente con estilos consistentes)', () => {
    const idx = EXPORTS.indexOf('window.exportRepartoToExcel');
    const slice = EXPORTS.slice(idx, idx + 6000);
    expect(slice).toMatch(/await downloadXlsx\(/);
  });

  it('T8 filename "Reparto_YYYY-MM-DD_HHmm.xlsx"', () => {
    const idx = EXPORTS.indexOf('window.exportRepartoToExcel');
    const slice = EXPORTS.slice(idx, idx + 6000);
    expect(slice).toMatch(/'Reparto_'/);
    expect(slice).toMatch(/\.xlsx/);
  });

  it('T9 alerta si no hay ingresos (empty state)', () => {
    const idx = EXPORTS.indexOf('window.exportRepartoToExcel');
    const slice = EXPORTS.slice(idx, idx + 6000);
    expect(slice).toMatch(/No hay ingresos de reparto/);
  });

  it('T10 lookup Producto desde PRODUCTS global por SKU', () => {
    const idx = EXPORTS.indexOf('window.exportRepartoToExcel');
    const slice = EXPORTS.slice(idx, idx + 6000);
    expect(slice).toMatch(/w\.PRODUCTS/);
  });
});

describe('v1492 §91 — botón en el modal #reparto-modal', () => {
  it('T20 header del modal tiene botón "Exportar Excel"', () => {
    const idx = INDEX_HTML.indexOf('id="reparto-modal"');
    const slice = INDEX_HTML.slice(idx, idx + 3000);
    expect(slice).toContain('exportRepartoToExcel');
    expect(slice).toContain('Exportar Excel');
  });

  it('T21 botón usa estilo pill inline (§21 SW cache)', () => {
    const idx = INDEX_HTML.indexOf('id="reparto-modal"');
    const slice = INDEX_HTML.slice(idx, idx + 3000);
    expect(slice).toMatch(/exportRepartoToExcel.*border-radius:999px/s);
  });

  it('T22 botón export está colocado antes del botón cerrar (visualmente a la izquierda)', () => {
    const idx = INDEX_HTML.indexOf('id="reparto-modal"');
    const slice = INDEX_HTML.slice(idx, idx + 3000);
    const exportIdx = slice.indexOf('exportRepartoToExcel');
    const closeBtnIdx = slice.indexOf('reparto-apple-close');
    expect(exportIdx).toBeGreaterThan(0);
    expect(closeBtnIdx).toBeGreaterThan(exportIdx);
  });

  it('T23 botón defensivo: chequea existencia de la fn antes de llamarla', () => {
    const idx = INDEX_HTML.indexOf('id="reparto-modal"');
    const slice = INDEX_HTML.slice(idx, idx + 3000);
    expect(slice).toMatch(/window\.exportRepartoToExcel && window\.exportRepartoToExcel\(\)/);
  });
});

describe('v1492 — bump versión', () => {
  it('T40 APP_VERSION ≥ v1492 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    // @ts-expect-error — matched above
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1492);
    // @ts-expect-error — matched above
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});

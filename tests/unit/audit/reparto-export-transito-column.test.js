/**
 * v1565 §E4.3 (Opción 1 safe) — tests de la columna 10 "En tránsito"
 * en el export Excel del reparto (template editable de Pablo).
 *
 * Regla: la columna va al FINAL del Excel. NO toca las fórmulas por posición
 * existentes (`=C{row}-E{row}-G{row}`), NO modifica Backorder/Asignado/Eliminar.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeRepartoExcelExportRows } from '../../../src/pure/reparto-excel-export-rows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const makeIngreso = (sku, clientes) => ({
  _id: 'ing_' + sku.toLowerCase(),
  sku,
  qtyIngresada: 10,
  clientesBO: clientes,
});

describe('v1565 §E4.3 — reparto export columna "En tránsito" (Opción 1 safe)', () => {
  it('T1: el shape RepartoExcelRow incluye el campo EnTransito', () => {
    const ingresos = [
      makeIngreso('SKU1', [{ clientCardCode: 'C001', clientName: 'Cliente A', qtyBackorder: 5 }]),
    ];
    const r = computeRepartoExcelExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 10,
      }
    );
    expect(r.rows.length).toBe(1);
    expect(Object.keys(r.rows[0])).toContain('EnTransito');
    expect(r.rows[0].EnTransito).toBe(0); // sin getQtyTransitoParaCliente → 0
  });

  it('T2: fixture con getQtyTransitoParaCliente → EnTransito correcto por fila', () => {
    const ingresos = [
      makeIngreso('SKU1', [
        { clientCardCode: 'C001', clientName: 'Cliente A', qtyBackorder: 5 },
        { clientCardCode: 'C002', clientName: 'Cliente B', qtyBackorder: 3 },
      ]),
      makeIngreso('SKU2', [{ clientCardCode: 'C001', clientName: 'Cliente A', qtyBackorder: 2 }]),
    ];
    const transitoMap = {
      'C001|SKU1': 3,
      'C002|SKU1': 0,
      'C001|SKU2': 7,
    };
    const r = computeRepartoExcelExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 10,
        getQtyTransitoParaCliente: (cc, sku) => transitoMap[cc + '|' + sku] || 0,
      }
    );
    const idx = (cc, sku) => r.rows.findIndex((x) => x.CardCode === cc && x.Codigo === sku);
    expect(r.rows[idx('C001', 'SKU1')].EnTransito).toBe(3);
    expect(r.rows[idx('C002', 'SKU1')].EnTransito).toBe(0);
    expect(r.rows[idx('C001', 'SKU2')].EnTransito).toBe(7);
  });

  it('T3: sin dep getQtyTransitoParaCliente (flag OFF / compat) → EnTransito = 0 en todas', () => {
    const ingresos = [
      makeIngreso('SKU1', [
        { clientCardCode: 'C001', clientName: 'Cliente A', qtyBackorder: 5 },
        { clientCardCode: 'C002', clientName: 'Cliente B', qtyBackorder: 3 },
      ]),
    ];
    const r = computeRepartoExcelExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 10,
        // NO getQtyTransitoParaCliente
      }
    );
    expect(r.rows.every((x) => x.EnTransito === 0)).toBe(true);
  });

  it('T4: ws.columns[] en exports-reparto.js tiene "En tránsito" como ÚLTIMO (índice 9 → column 10)', () => {
    const src = readFileSync(join(ROOT, 'src', 'domains', 'exports-reparto.js'), 'utf8');
    // Match del bloque ws.columns = [ ... ].
    const match = src.match(/ws\.columns\s*=\s*\[([\s\S]*?)\];/);
    expect(match).toBeTruthy();
    const colsBlock = match[1];
    // La columna En tránsito debe aparecer DESPUÉS de CardCode (= último del shape viejo).
    const cardCodeIdx = colsBlock.indexOf("key: 'CardCode'");
    const enTransitoIdx = colsBlock.indexOf("key: 'EnTransito'");
    expect(cardCodeIdx).toBeGreaterThan(-1);
    expect(enTransitoIdx).toBeGreaterThan(-1);
    expect(enTransitoIdx).toBeGreaterThan(cardCodeIdx);
    // Header literal.
    expect(colsBlock).toMatch(/header:\s*['"]En tránsito['"]/);
  });

  it('T5: NO modifica la fórmula VueleABackorder — sigue =C{row}-E{row}-G{row}', () => {
    const ingresos = [
      makeIngreso('SKU1', [{ clientCardCode: 'C001', clientName: 'Cliente A', qtyBackorder: 5 }]),
    ];
    const r = computeRepartoExcelExportRows(
      ingresos,
      { hideNoStock: false },
      {
        getStockFisico: () => 10,
        getQtyTransitoParaCliente: () => 99, // no afecta la fórmula.
      }
    );
    // Formato =C{N}-E{N}-G{N} (columnas 3, 5, 7 = Backorder, Asignado, Eliminar).
    expect(r.rows[0].VueleABackorder).toMatch(/^=C\d+-E\d+-G\d+$/);
    // La fórmula NO menciona la columna J (10) ni ningún otro cambio.
    expect(r.rows[0].VueleABackorder).not.toMatch(/J/);
  });
});

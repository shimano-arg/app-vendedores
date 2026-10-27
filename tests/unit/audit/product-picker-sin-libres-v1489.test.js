// @ts-check
/**
 * v1489 §87 (2026-10-27) — product-picker: quitar etiqueta amarilla "N libres".
 *
 * Reporte Mariano: en el modal de carga de pedido (buscador de productos,
 * ej. cliente ARMERIA MAYOR S.R.L., búsqueda "cud"), aparecían etiquetas
 * amarillas inline "51 libres", "19 libres", "1 libres" al lado del SKU en
 * cada fila con stock disponible. Ensuciaban la lista.
 *
 * Fix v1489: la cantidad libre se mueve al tooltip del span SKU + sigue
 * accesible en el tooltip del stockDot verde. El punto de color se mantiene
 * (indicador binario de disponibilidad). Etiquetas "CAMP"/"ASIG"/"BO" NO se
 * tocan. Lógica de stock NO se toca — es solo presentación.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PICKER = readFileSync('src/domains/product-picker.js', 'utf8');

describe('v1489 §87 — product-picker: sin etiqueta amarilla "N libres"', () => {
  it('T1 NO existe la cadena " libres</span>" en el renderer', () => {
    expect(PICKER).not.toContain(' libres</span>');
  });

  it('T2 el bloque legacy `dispBadge` ya no existe', () => {
    // La variable antigua desaparece completamente — reemplazada por skuTitle.
    expect(PICKER).not.toMatch(/let dispBadge\b/);
    expect(PICKER).not.toMatch(/\+\s*dispBadge\s*\+/);
  });

  it('T3 cantidad disponible se preserva como tooltip del SKU (skuTitle)', () => {
    expect(PICKER).toMatch(/let skuTitle = ''/);
    expect(PICKER).toMatch(/skuTitle =\s*\n?\s*dispFisico/);
    expect(PICKER).toMatch(/Disponible: ' \+ disp \+ ' u'/);
  });

  it('T4 el SKU se envuelve en <span title="..."> cuando hay disp > 0', () => {
    expect(PICKER).toMatch(/const skuHtml = skuTitle/);
    expect(PICKER).toMatch(/'<span title="' \+ escapeAttr\(skuTitle\) \+ '">'/);
  });

  it('T5 stockDot (punto verde/rojo/ámbar) se preserva intacto', () => {
    // Verde para disp > 0.
    expect(PICKER).toMatch(/stock-dot ok/);
    // Rojo para sin stock.
    expect(PICKER).toMatch(/stock-dot no/);
    // Gris para sin datos.
    expect(PICKER).toMatch(/stock-dot na/);
    // Ámbar inline con color-warning.
    expect(PICKER).toMatch(/background:var\(--color-warning\)/);
  });

  it('T6 badges CAMP / ASIG / BO siguen presentes en el render', () => {
    expect(PICKER).toMatch(
      /stockDot \+\s*\n?\s*skuHtml \+\s*\n?\s*campBadge \+\s*\n?\s*asigBadge \+\s*\n?\s*boBadge/
    );
  });

  it('T7 lógica de stock intacta — fuentes de datos NO cambiaron', () => {
    expect(PICKER).toMatch(/window\.getStockRealmenteDisponible/);
    expect(PICKER).toMatch(/window\.getStockDisponibleVenta/);
    expect(PICKER).toMatch(/window\.getStockTransito/);
    expect(PICKER).toMatch(/const dispReal =/);
    expect(PICKER).toMatch(/const disp = dispReal != null \? dispReal : dispFisico/);
  });

  it('T8 el estilo amarillo pastel #fef9c3 del chip legacy desaparece', () => {
    // El único lugar donde se usaba era el chip "N libres".
    expect(PICKER).not.toContain('#fef9c3');
    expect(PICKER).not.toContain('#fde68a');
  });
});

describe('v1489 — bump versión', () => {
  it('T40 APP_VERSION ≥ v1489 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    // @ts-expect-error
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1489);
    // @ts-expect-error
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});

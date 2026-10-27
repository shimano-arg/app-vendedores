// @ts-check
/**
 * v1483 (2026-10-27) — Modal Alta SAP: los 4 botones en una sola fila.
 *
 * Antes (v1262): "Ficha Cliente" estaba en un `<div>` separado arriba con
 * border-top dashed. Los otros 3 (Guardar, Editar direccion, Cerrar)
 * compartían el div `.sap-alta-footer-row` (v1423 §57).
 *
 * Ahora (v1483 Mariano): los 4 en la misma fila, orden Guardar →
 * Editar direccion → Ficha Cliente → Cerrar, mismo alto y espaciado.
 * Mobile: wrap natural (2×2 cuando el ancho no alcanza, gracias a
 * flex-wrap:wrap + gap:8px).
 *
 * Sin cambios en la lógica del onclick (openFichaClienteFromSapModal).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1483 — Modal Alta SAP: fila única de 4 botones', () => {
  it('T1 el <div> separado con "Ficha Cliente" aislado arriba fue eliminado', () => {
    // Antes: `<div style="border-top:1px dashed..." ...><button Ficha Cliente></button></div>`
    // Ahora: Ficha Cliente dentro de `.sap-alta-footer-row`.
    expect(INDEX_HTML).not.toMatch(
      /border-top:1px dashed[^']+padding-top:10px;display:flex;justify-content:center'[\s\S]{0,50}openFichaClienteFromSapModal/
    );
  });

  it('T2 Ficha Cliente dentro del mismo .sap-alta-footer-row que los otros 3', () => {
    const idx = INDEX_HTML.indexOf('\'<div class="sap-alta-footer-row"');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 2500);
    // Los 4 botones en el mismo bloque.
    expect(slice).toMatch(/saveSapAltaFantasiaFromModal/); // Guardar
    expect(slice).toMatch(/openSapAltaAddressModal/); // Editar dirección
    expect(slice).toMatch(/openFichaClienteFromSapModal/); // Ficha Cliente
    expect(slice).toMatch(/sap-alta-info-modal.*classList\.remove.*open/); // Cerrar
  });

  it('T3 orden: Guardar → Editar dirección → Ficha Cliente → Cerrar', () => {
    const idx = INDEX_HTML.indexOf('\'<div class="sap-alta-footer-row"');
    const slice = INDEX_HTML.slice(idx, idx + 2500);
    const iGuardar = slice.indexOf('saveSapAltaFantasiaFromModal');
    const iEditar = slice.indexOf('openSapAltaAddressModal');
    const iFicha = slice.indexOf('openFichaClienteFromSapModal');
    const iCerrar = slice.indexOf('class="btn-cancel"');
    expect(iGuardar).toBeGreaterThan(0);
    expect(iEditar).toBeGreaterThan(iGuardar);
    expect(iFicha).toBeGreaterThan(iEditar);
    expect(iCerrar).toBeGreaterThan(iFicha);
  });

  it('T4 flex-wrap preservado (mobile 2×2 natural)', () => {
    const idx = INDEX_HTML.indexOf('\'<div class="sap-alta-footer-row"');
    const slice = INDEX_HTML.slice(idx, idx + 500);
    expect(slice).toMatch(/display:flex/);
    expect(slice).toMatch(/flex-wrap:wrap/);
    expect(slice).toMatch(/gap:8px/);
    expect(slice).toMatch(/justify-content:center/);
  });

  it('T5 botón Ficha Cliente: mismo alto que Editar dirección (padding:9px 14px)', () => {
    const idx = INDEX_HTML.indexOf('\'<div class="sap-alta-footer-row"');
    const slice = INDEX_HTML.slice(idx, idx + 2500);
    // Botón Ficha Cliente: estilo armonizado con Editar dirección.
    const ficha = slice.match(/openFichaClienteFromSapModal\([^)]+\)[^>]+style="([^"]+)"/);
    expect(ficha, 'botón Ficha Cliente debe tener style inline').not.toBeNull();
    expect(ficha[1]).toContain('padding:9px 14px');
    expect(ficha[1]).toContain('font-size:12px');
    expect(ficha[1]).toContain('border-radius:6px');
  });

  it('T6 lógica del onclick de Ficha Cliente preservada (sin cambio)', () => {
    // El modal se arma en una template string JS; el onclick concat con
    // safeFsId queda como: onclick="openFichaClienteFromSapModal(\'' + safeFsId + '\')".
    expect(INDEX_HTML).toContain("openFichaClienteFromSapModal(\\'' + safeFsId + '\\')");
  });
});

describe('v1483 — bump versión', () => {
  it('T10 APP_VERSION ≥ v1483 + sync SW', () => {
    const html = INDEX_HTML.match(/const APP_VERSION = 'v(\d+)'/);
    const sw = readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(html, 'APP_VERSION').not.toBeNull();
    expect(sw, 'CACHE_VERSION').not.toBeNull();
    expect(Number(html[1])).toBeGreaterThanOrEqual(1483);
    expect(html[1]).toBe(sw[1]);
  });
});

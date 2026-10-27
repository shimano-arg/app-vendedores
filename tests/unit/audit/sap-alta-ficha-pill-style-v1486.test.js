// @ts-check
/**
 * v1486 (2026-10-27) — Modal Alta SAP: botón "Ficha Cliente" con estilo pill
 * (fondo blanco + borde azul + texto azul), mismo que "Editar direccion".
 *
 * Antes (v1483): fondo azul sólido `#007aff` + texto blanco → rompía el patrón
 * pill del modal donde los otros 3 botones son:
 *   - Guardar: .btn-confirm verde sólido.
 *   - Editar direccion: inline con fondo blanco + borde `#1d4ed8` + texto `#1d4ed8`.
 *   - Cerrar: .btn-cancel rojo sólido.
 *
 * Ahora (v1486): Ficha Cliente copia el MISMO inline style que Editar
 * direccion verbatim. Cero estilos nuevos. Logica del onclick preservada.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1486 — Modal Alta SAP: Ficha Cliente estilo pill-azul', () => {
  it('T1 button Ficha Cliente usa fondo var(--bg-elevated) (blanco), NO azul sólido', () => {
    const idx = INDEX_HTML.indexOf('openFichaClienteFromSapModal');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 500);
    expect(slice).toContain('background:var(--bg-elevated)');
    expect(slice).not.toContain('background:#007aff');
  });

  it('T2 border + color del botón = #1d4ed8 (mismo que Editar direccion)', () => {
    const idx = INDEX_HTML.indexOf('openFichaClienteFromSapModal');
    const slice = INDEX_HTML.slice(idx, idx + 500);
    expect(slice).toContain('border:1.5px solid #1d4ed8');
    expect(slice).toContain('color:#1d4ed8');
  });

  it('T3 padding + border-radius + font-size iguales a Editar direccion', () => {
    const idx = INDEX_HTML.indexOf('openFichaClienteFromSapModal');
    const slice = INDEX_HTML.slice(idx, idx + 500);
    expect(slice).toContain('padding:9px 14px');
    expect(slice).toContain('border-radius:6px');
    expect(slice).toContain('font-size:12px');
    expect(slice).toContain('font-weight:700');
  });

  it('T4 inline style de Ficha Cliente == inline style de Editar direccion (verbatim)', () => {
    // Extraer ambos inline styles DENTRO de la fila sap-alta-footer-row.
    const rowStart = INDEX_HTML.indexOf('\'<div class="sap-alta-footer-row"');
    expect(rowStart).toBeGreaterThan(0);
    const row = INDEX_HTML.slice(rowStart, rowStart + 3000);
    const extractStyleInRow = (search) => {
      const idx = row.indexOf(search);
      if (idx < 0) return null;
      const slice = row.slice(idx, idx + 600);
      const m = slice.match(/style="([^"]+)"/);
      return m ? m[1] : null;
    };
    const editarStyle = extractStyleInRow('openSapAltaAddressModal');
    const fichaStyle = extractStyleInRow('openFichaClienteFromSapModal');
    expect(editarStyle, 'style de Editar direccion en la fila').not.toBeNull();
    expect(fichaStyle, 'style de Ficha Cliente en la fila').not.toBeNull();
    expect(fichaStyle).toBe(editarStyle);
  });

  it('T5 logica del onclick preservada (sin cambio)', () => {
    expect(INDEX_HTML).toContain("openFichaClienteFromSapModal(\\'' + safeFsId + '\\')");
  });

  it('T6 button sigue en la misma fila .sap-alta-footer-row (v1483 preservado)', () => {
    const idxRow = INDEX_HTML.indexOf('\'<div class="sap-alta-footer-row"');
    const idxFicha = INDEX_HTML.indexOf('openFichaClienteFromSapModal');
    expect(idxRow).toBeGreaterThan(0);
    expect(idxFicha).toBeGreaterThan(idxRow);
  });
});

describe('v1486 — bump versión', () => {
  it('T10 APP_VERSION ≥ v1486 + sync SW', () => {
    const html = INDEX_HTML.match(/const APP_VERSION = 'v(\d+)'/);
    const sw = readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(html, 'APP_VERSION').not.toBeNull();
    expect(sw, 'CACHE_VERSION').not.toBeNull();
    expect(Number(html[1])).toBeGreaterThanOrEqual(1486);
    expect(html[1]).toBe(sw[1]);
  });
});

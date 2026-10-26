// @ts-check
/**
 * v1464 (2026-10-26) — cambio 1: botón "Ficha cliente" del popup del pin del mapa
 * llama DIRECTO a openFichaClienteDirect (abre ficha real sin modal de revisión).
 *
 * Verifica el contrato por grep en index.html:
 *   - openFichaClienteDirect(name, prov, loc, vendor) existe + está en window.
 *   - handler del botón del popup del pin invoca openFichaClienteDirect (no openClientModal).
 *   - h2 del .modal-head tiene color: #ffffff explícito.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1464 §cambio 1 — pin popup Ficha cliente directo', () => {
  it('openFichaClienteDirect existe y está en window', () => {
    expect(INDEX_HTML).toMatch(
      /function\s+openFichaClienteDirect\s*\(\s*clientName\s*,\s*provincia\s*,\s*localidad\s*,\s*assignedVendor\s*\)/
    );
    expect(INDEX_HTML).toMatch(/window\.openFichaClienteDirect\s*=\s*openFichaClienteDirect/);
  });

  it('openFichaClienteDirect delega en openFichaClienteFromClientModal (no abre #client-modal visualmente)', () => {
    const start = INDEX_HTML.indexOf('function openFichaClienteDirect');
    const end = INDEX_HTML.indexOf('window.openFichaClienteDirect', start);
    const fn = INDEX_HTML.slice(start, end);
    expect(fn).toMatch(/openFichaClienteFromClientModal\s*\(\s*\)/);
    expect(fn).not.toMatch(/openClientModal\s*\(/);
    // Debe setear dataset del #client-modal (para que populate funcione).
    expect(fn).toMatch(/cmEl\.dataset\.clientName/);
    expect(fn).toMatch(/cmEl\.dataset\.provincia/);
    expect(fn).toMatch(/cmEl\.dataset\.localidad/);
    expect(fn).toMatch(/cmEl\.dataset\.docId/);
    expect(fn).toMatch(/cmEl\.dataset\.vendor/);
    // NO debe hacer classList.add('open') sobre el client-modal.
    expect(fn).not.toMatch(/cmEl.classList.add\(['"]open/);
  });

  it('handler del botón del popup del pin invoca openFichaClienteDirect (no openClientModal)', () => {
    // El bloque que arma el botón "Ficha cliente" del popup del pin está en
    // la función que construye markers (líneas ~10200). Verifica que el
    // _onclick usa openFichaClienteDirect y NO openClientModal.
    const i = INDEX_HTML.indexOf('v1464 (2026-10-26): un click abre la ficha real');
    expect(i).toBeGreaterThan(0);
    const window = INDEX_HTML.slice(i, i + 900);
    expect(window).toMatch(/openFichaClienteDirect\s*\(/);
    expect(window).not.toMatch(/openClientModal\s*\(/);
    // El botón mantiene el texto "Ficha cliente" + el style outline azul.
    expect(window).toMatch(/Ficha cliente<\/button>/);
    expect(window).toMatch(/#1d4ed8/);
  });

  it('cambio 2 — .modal-head h2 tiene color: #ffffff explícito (sin !important, en la clase)', () => {
    // Regla CSS actual: .modal-head h2 { font-size: 18px; font-weight: 800; margin-bottom: 4px; color: #ffffff }
    expect(INDEX_HTML).toMatch(/\.modal-head h2\{[^}]*color:#ffffff/);
    // El color debe estar SIN !important (pedido Mariano: "corregir en la clase del header, no con !important").
    const match = INDEX_HTML.match(/\.modal-head h2\{[^}]*\}/);
    expect(match).toBeTruthy();
    expect(match[0]).not.toMatch(/color:#ffffff\s*!important/);
  });
});

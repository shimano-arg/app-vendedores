// @ts-check
/**
 * v1423 §57 (2026-10-22) — modal "Alta SAP" (#sap-alta-info-modal):
 * 1. Botón "Ficha Cliente (perfil para segmentar)" simplificado a "Ficha Cliente".
 * 2. Fila de 3 botones (Guardar / Editar direccion / Cerrar) centrada
 *    horizontalmente (antes alineada a la derecha con flex-end).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1423 §57 — texto botón "Ficha Cliente" simplificado', () => {
  it('NO hay instancias del texto viejo "Ficha Cliente (perfil para segmentar)"', () => {
    expect(INDEX_HTML).not.toMatch(/Ficha Cliente \(perfil para segmentar\)/);
  });

  it('modal SAP (openSapAltaInfoModal) usa el texto nuevo "Ficha Cliente"', () => {
    const idx = INDEX_HTML.indexOf('openFichaClienteFromSapModal');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1000);
    expect(slice).toMatch(/'Ficha Cliente'/);
    expect(slice).not.toMatch(/'Ficha Cliente \(perfil para segmentar\)'/);
  });

  it('modal cliente POINT (#client-modal) también usa "Ficha Cliente"', () => {
    const idx = INDEX_HTML.indexOf('openFichaClienteFromClientModal()');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 2000);
    expect(slice).toMatch(/Ficha Cliente\s*<\s*\/\s*button/);
    expect(slice).not.toMatch(/Ficha Cliente \(perfil para segmentar\)/);
  });
});

describe('v1423 §57 — fila de 3 botones centrada en modal SAP', () => {
  it('fila usa justify-content:center + clase sap-alta-footer-row', () => {
    const idx = INDEX_HTML.indexOf('sap-alta-footer-row');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 400);
    expect(slice).toMatch(/justify-content\s*:\s*center/);
  });

  it('NO existe la fila con justify-content:flex-end + los 3 botones del modal SAP', () => {
    // Grep específico: la fila flex-end viejecita con Guardar+Editar+Cerrar en modal SAP.
    expect(INDEX_HTML).not.toMatch(
      /justify-content\s*:\s*flex-end['"][\s\S]{0,500}saveSapAltaFantasiaFromModal/
    );
  });

  it('mantiene mismo gap:8px entre botones', () => {
    const idx = INDEX_HTML.indexOf('sap-alta-footer-row');
    const slice = INDEX_HTML.slice(idx, idx + 400);
    expect(slice).toMatch(/gap\s*:\s*8px/);
  });

  it('botón Ficha Cliente sigue centrado arriba de la fila', () => {
    // El botón Ficha Cliente está en un div propio con justify-content:center.
    const idx = INDEX_HTML.indexOf('openFichaClienteFromSapModal');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx - 400, idx);
    expect(slice).toMatch(/justify-content\s*:\s*center/);
  });

  it('los 3 botones esperados están presentes en el modal SAP: Guardar, Editar direccion, Cerrar', () => {
    const idx = INDEX_HTML.indexOf('sap-alta-footer-row');
    const sliceEnd = INDEX_HTML.indexOf('</div>', idx);
    const slice = INDEX_HTML.slice(idx, sliceEnd + 10);
    expect(slice).toMatch(/saveSapAltaFantasiaFromModal/);
    expect(slice).toMatch(/>Guardar</);
    expect(slice).toMatch(/openSapAltaAddressModal/);
    expect(slice).toMatch(/>Editar direccion</);
    expect(slice).toMatch(/btn-cancel/);
    expect(slice).toMatch(/>Cerrar</);
  });
});

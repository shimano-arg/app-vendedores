// @ts-check
/**
 * v1504 PR2 — contrato de call-sites: readers UI (modal pedido/planner/espera)
 * NO leen `l.desc` directo; usan `resolveLineDescLive` o un helper equivalente.
 *
 * Alcance: solo renders UI críticos reportados por Mariano. Write-side
 * (payload a CF, exports forenses, build de waitlist items, csv-serializer) sí
 * puede leer `l.desc` directo porque es el snapshot al momento de la operación.
 *
 * El test no es exhaustivo (grep sobre miles de call-sites sería ruido). Audita
 * los 3 readers claves:
 *   1. index.html — modal detalle del pedido (Pedidos > Confirmados).
 *   2. index.html — modal "Líneas" del Planner (reportado 2026-10-28).
 *   3. src/domains/pedidos-modal.js — modal review (crear/editar).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('v1504 PR2 — readers UI usan resolveLineDescLive', () => {
  const html = readFileSync('index.html', 'utf8');

  it('T1 modal detalle pedido (línea <div class="pname">) usa resolveLineDescLive', () => {
    const idx = html.indexOf('<div class="ped-line"');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 1500);
    expect(slice).toMatch(/<div class="pname">/);
    expect(slice).toMatch(/resolveLineDescLive/);
    expect(slice).toMatch(/_getCatalogDescMap/);
  });

  it('T2 modal "Líneas" del Planner (planner-modal-lineas-table) usa resolveLineDescLive', () => {
    // La tabla se arma en una función que contiene `planner-modal-lineas-table`.
    const idx = html.indexOf('\'<table class="planner-modal-lineas-table">\'');
    expect(idx).toBeGreaterThan(0);
    // Buscar hacia atrás el `map(l =>` que arma las filas.
    const funcStart = html.lastIndexOf('const rows = lineas.map(l =>', idx);
    expect(funcStart).toBeGreaterThan(0);
    const slice = html.slice(funcStart, idx);
    expect(slice).toMatch(/resolveLineDescLive/);
    expect(slice).toMatch(/_getCatalogDescMap/);
    // Comentario del fix.
    expect(slice).toMatch(/v1504 PR2/);
  });

  it('T3 modal detalle Pedidos del mes (<div class="pline">) usa resolveLineDescLive', () => {
    const idx = html.indexOf('<div class="pline">');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(Math.max(0, idx - 500), idx + 400);
    expect(slice).toMatch(/_descPline/);
    expect(slice).toMatch(/resolveLineDescLive/);
  });

  it('T4 wrapper _getCatalogDescMap existe + invalida cache en listener', () => {
    expect(html).toMatch(/window\._getCatalogDescMap\s*=\s*function/);
    expect(html).toMatch(/_catalogDescMapCache = null/);
    expect(html).toMatch(/buildCatalogDescMapFromProducts/);
  });

  it('T5 wrapper _getCatalogDescByCode existe', () => {
    expect(html).toMatch(/window\._getCatalogDescByCode\s*=\s*function/);
  });
});

describe('v1504 PR2 — src/domains/pedidos-modal.js usa helper _resolveDescLiveLocal', () => {
  const src = readFileSync('src/domains/pedidos-modal.js', 'utf8');

  it('T10 helper _resolveDescLiveLocal declarado', () => {
    expect(src).toMatch(/function _resolveDescLiveLocal\(line\)/);
    expect(src).toMatch(/resolveLineDescLive/);
    expect(src).toMatch(/_getCatalogDescMap/);
  });

  it('T11 modal review (<div class="rl-name">) usa _resolveDescLiveLocal', () => {
    const idx = src.indexOf('<div class="rl-name">');
    expect(idx).toBeGreaterThan(0);
    const slice = src.slice(idx, idx + 500);
    expect(slice).toMatch(/_resolveDescLiveLocal\(l\)/);
  });

  it('T12 modal faltantes (span escapeHtml de desc) usa _resolveDescLiveLocal', () => {
    // v1504 reemplazó `escapeHtml(l.desc || '')` por `escapeHtml(_resolveDescLiveLocal(l))`
    // en el modal de faltantes/no-stock.
    expect(src).toMatch(/escapeHtml\(_resolveDescLiveLocal\(l\)\)/);
  });
});

describe('v1504 PR2 — payload SAP sigue viajando `l.desc` original', () => {
  it('T20 commit-pedido-core sigue usando resolveLineDesc (write-side)', () => {
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    expect(core).toMatch(/desc: resolveLineDesc\(payloadLine, catalogDescMap\)/);
    expect(core).not.toMatch(/resolveLineDescLive/);
  });

  it('T21 auto-send-sap-core NO toca ninguna función de resolve-line-desc', () => {
    const sap = readFileSync('functions/core/auto-send-sap-core.js', 'utf8');
    expect(sap).not.toMatch(/resolveLineDesc/);
  });

  it('T22 index.html _tryCommitPedidoCF payload sigue mandando l.desc original', () => {
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('lines: (docData.lines || []).map');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 800);
    // El payload sigue mandando `l.desc` crudo. NO debe llamar resolveLineDescLive.
    expect(slice).toMatch(/desc: l\.desc \|\| ''/);
    expect(slice).not.toMatch(/resolveLineDescLive/);
  });
});

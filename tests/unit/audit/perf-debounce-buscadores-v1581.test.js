// @ts-check
/**
 * PERF v1581 (2026-11-25) — debounce 200ms sobre buscadores pesados.
 *
 * Reporte Mariano: "la app está extremadamente lenta en los buscadores y
 * scroll". Informe `Desktop\RESPUESTAS\PERF_LENTITUD_2026-11-25\INFORME.md`
 * identifica 3 culpables:
 *   1. Buscadores sin debounce (30 de 32 inputs).
 *   2. `_renderWaitlistSidebar` re-render completo por keystroke.
 *   3. `backdrop-filter: blur` en modales con listas largas.
 *
 * Este PR cierra los 3 + H1 (vars CSS `--color-success-bg` + `--color-danger-bg`
 * faltantes en `:root` light, hallazgo del adversarial del PR #1431).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1581 §PERF — helper _perfDebounce global', () => {
  it('window._perfDebounce declarado como función con firma (fn, ms)', () => {
    expect(INDEX_HTML).toMatch(/window\._perfDebounce\s*=\s*function\(fn,\s*ms\)/);
  });
  it('implementación usa setTimeout + clearTimeout (pattern canónico)', () => {
    const idx = INDEX_HTML.indexOf('window._perfDebounce');
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/clearTimeout\(/);
    expect(slice).toMatch(/setTimeout\(/);
  });
  it('guard: si fn no es función devuelve fn tal cual (no explota)', () => {
    const idx = INDEX_HTML.indexOf('window._perfDebounce');
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/typeof fn !== 'function'/);
  });
});

describe('v1581 §PERF — _renderWaitlistSidebar listener debounced', () => {
  it('el listener input del #slft-wl-search usa _perfDebounce 200ms', () => {
    const idx = INDEX_HTML.indexOf('function _renderWaitlistSidebar()');
    expect(idx).toBeGreaterThan(-1);
    const slice = INDEX_HTML.slice(idx, idx + 3000);
    expect(slice).toMatch(/_debouncedReRender/);
    expect(slice).toMatch(/_perfDebounce/);
    expect(slice).toMatch(/\b200\b/);
  });
});

describe('v1581 §PERF — batch de wrappers debounced al final del script', () => {
  const idx = INDEX_HTML.indexOf('_installPerfDebounce');
  it('bloque IIFE _installPerfDebounce presente', () => {
    expect(idx).toBeGreaterThan(-1);
  });
  // Lista de fnNames que deben estar wrapeadas. Grep contra el array `_targets`.
  const CRITICAL_FNS = [
    'onReviewSearch',
    'renderZonasList',
    'renderProductMaster',
    'renderProductPicker',
    'onLocSearchChange',
    'onCliSearchChange',
    'renderPedidosTab',
    'onBackordersTiendaChange',
    '_cpstFilterClientes',
    'waitlistOnAddSearch',
    '_repartoRender',
    '_renderDeposito',
  ];
  it.each(CRITICAL_FNS)('fn %s registrada en _targets del installer', (fnName) => {
    const slice = INDEX_HTML.slice(idx, idx + 4000);
    expect(slice).toContain("'" + fnName + "'");
  });
});

describe('v1581 §PERF — CSS backdrop-filter apagado en modales con listas largas', () => {
  const MODALES = [
    '#waitlist-card-modal',
    '#backorders-modal',
    '#reparto-modal',
    '#crear-pedido-st-modal',
    '#generar-backorder-modal',
  ];
  it.each(MODALES)('modal %s tiene backdrop-filter:none override', (modalId) => {
    const idx = INDEX_HTML.indexOf('v1581 (2026-11-25) PERF — apagar backdrop-filter');
    expect(idx).toBeGreaterThan(-1);
    const slice = INDEX_HTML.slice(idx, idx + 1500);
    expect(slice).toContain(modalId);
    expect(slice).toMatch(/backdrop-filter:\s*none/);
  });
});

describe('v1581 §H1 (adversarial PR #1431) — CSS vars faltantes en :root light', () => {
  it(':root define --color-success-bg = #dcfce7 (verde pastel)', () => {
    const rootIdx = INDEX_HTML.indexOf(':root {');
    expect(rootIdx).toBeGreaterThan(-1);
    const slice = INDEX_HTML.slice(rootIdx, rootIdx + 2000);
    expect(slice).toMatch(/--color-success-bg:\s*#dcfce7/);
  });
  it(':root define --color-danger-bg = #fee2e2 (rojo pastel)', () => {
    const rootIdx = INDEX_HTML.indexOf(':root {');
    const slice = INDEX_HTML.slice(rootIdx, rootIdx + 2000);
    expect(slice).toMatch(/--color-danger-bg:\s*#fee2e2/);
  });
});

describe('v1581 — bump APP_VERSION + CACHE_VERSION', () => {
  it('APP_VERSION v1581 en index.html', () => {
    expect(INDEX_HTML).toContain("const APP_VERSION = 'v1581'");
  });
  it('CACHE_VERSION v1581 en sw.js', () => {
    const sw = readFileSync('sw.js', 'utf8');
    expect(sw).toContain("const CACHE_VERSION = 'v1581'");
  });
});

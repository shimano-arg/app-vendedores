/**
 * E2.b smoke test — Node-based. Verifica que app.bundle.js del root:
 *   1. Existe y está en rango de tamaño esperado.
 *   2. Carga en un vm.Context fake sin throw.
 *   3. Expone window.__phase0 con la estructura completa.
 *   4. Las 10 funciones puras siguen dando resultados correctos post-bundling.
 *
 * También verifica el wiring de source index.html + sw.js:
 *   - index.html tiene el <script src="./app.bundle.js"> antes de </head>.
 *   - index.html tiene el bloque de assignments window.__phase0 → window.foo.
 *   - APP_VERSION (index.html) == CACHE_VERSION (sw.js).
 *   - sw.js STATIC_ASSETS incluye ./app.bundle.js.
 *   - index.html YA NO tiene las 10 definiciones inline de las funciones puras.
 *
 * Por qué no Playwright: chromium download bloquea con la red actual (README 43.5).
 * La verificación DOM/Firebase real queda como gate humano manual pre-merge.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';

const ROOT = process.cwd();
const BUNDLE = join(ROOT, 'app.bundle.js');
const INDEX = join(ROOT, 'index.html');
const SW = join(ROOT, 'sw.js');

describe('artifacts en repo root', () => {
  it('app.bundle.js existe', () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it('app.bundle.js en rango [20 KB, 200 KB] (bundle chico esperado en Fase 0)', () => {
    const size = statSync(BUNDLE).size;
    expect(size).toBeGreaterThan(20_000);
    expect(size).toBeLessThan(200_000);
  });

  it('index.html en rango [1.5 MB, 3.5 MB] (post-borrado de 10 fns inline)', () => {
    const size = statSync(INDEX).size;
    expect(size).toBeGreaterThan(1_500_000);
    expect(size).toBeLessThan(3_500_000);
  });
});

describe('index.html wiring', () => {
  it('tiene <script src="./app.bundle.js"> antes de </head>', () => {
    const html = readFileSync(INDEX, 'utf8');
    const scriptIdx = html.indexOf('<script src="./app.bundle.js">');
    const headCloseIdx = html.indexOf('</head>');
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(headCloseIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(headCloseIdx);
  });

  it('tiene el bloque "Fase 0 E2.b" con assignments window.__phase0', () => {
    const html = readFileSync(INDEX, 'utf8');
    expect(html).toContain('Fase 0 E2.b');
    expect(html).toContain('window.__phase0');
    expect(html).toContain('window.titleCase');
    expect(html).toContain('window.escapeHtml');
    expect(html).toContain('window.calcClientDiscount');
    expect(html).toContain('window.applySentryUserContext');
  });

  it('throw explícito si el bundle no cargó (fail-fast)', () => {
    const html = readFileSync(INDEX, 'utf8');
    expect(html).toMatch(/throw new Error\('Bundle window\.__phase0 no cargó/);
  });

  it('NO tiene las 10 definiciones inline de funciones puras (E2.b step 1)', () => {
    const html = readFileSync(INDEX, 'utf8');
    // Cada regex matchea la forma exacta de la definición original.
    const forbidden = [
      /^function normClientName\(s\)\{/m,
      /^function titleCase\(s\)\{/m,
      /^function escapeHtml\(s\)\{/m,
      /^function normTitle\(s\)\{/m,
      /^function _normalizeSearch\(s\)\{/m,
      /^function calcClientDiscount\(clientData, subtotal, formaPago\)\{/m,
      /^function matchesAllTokens\(haystack, query\)\{/m,
      /^function findSapDuplicateForProvisorio\(prov\)\{/m,
      /^function matchSkuFromTitle\(meliTitle\)\{/m,
      /^function passesTypeFilter\(name\)\{/m,
    ];
    for (const re of forbidden) {
      expect(html, `inline definition matching ${re} debe estar borrada`).not.toMatch(re);
    }
  });

  it('NO tiene inline window.applySentryUserContext = function... (E2.b step 2)', () => {
    const html = readFileSync(INDEX, 'utf8');
    expect(html).not.toMatch(/window\.applySentryUserContext = function \(sentry/);
  });
});

describe('sw.js wiring', () => {
  it('APP_VERSION (index.html) == CACHE_VERSION (sw.js)', () => {
    const html = readFileSync(INDEX, 'utf8');
    const sw = readFileSync(SW, 'utf8');
    const htmlV = html.match(/const APP_VERSION = '(v\d+)';/);
    const swV = sw.match(/const CACHE_VERSION = '(v\d+)';/);
    expect(htmlV).not.toBeNull();
    expect(swV).not.toBeNull();
    expect(htmlV[1]).toBe(swV[1]);
  });

  it('STATIC_ASSETS incluye ./app.bundle.js (offline PWA)', () => {
    const sw = readFileSync(SW, 'utf8');
    expect(sw).toContain("'./app.bundle.js'");
  });
});

describe('bundle runtime', () => {
  it('carga sin throw en un contexto con window={}', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    expect(() => runInNewContext(src, ctx)).not.toThrow();
  });

  it('expone window.__phase0 con {version, pure, sentry, sap}', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    const p = ctx.window.__phase0;
    expect(p).toBeDefined();
    expect(typeof p.version).toBe('string');
    expect(p.pure).toBeDefined();
    expect(p.sentry).toBeDefined();
    expect(p.sap).toBeDefined();
  });

  it('__phase0.pure expone las 10 funciones extraídas', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    const pure = ctx.window.__phase0.pure;
    const expected = [
      'normClientName', 'titleCase', 'escapeHtml', 'normTitle', 'normalizeSearch',
      'calcClientDiscount', 'matchesAllTokens', 'findSapDuplicateForProvisorio',
      'matchSkuFromTitle', 'passesTypeFilter',
    ];
    for (const name of expected) {
      expect(typeof pure[name], `pure.${name} debe ser function`).toBe('function');
    }
  });

  it('titleCase("hola mundo") === "Hola Mundo" post-bundle', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(ctx.window.__phase0.pure.titleCase('hola mundo')).toBe('Hola Mundo');
  });

  it('normClientName("Café López") === "CAFE LOPEZ" post-bundle (unicode ok)', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(ctx.window.__phase0.pure.normClientName('Café López')).toBe('CAFE LOPEZ');
  });

  it('escapeHtml("<a>") === "&lt;a&gt;" post-bundle', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(ctx.window.__phase0.pure.escapeHtml('<a>')).toBe('&lt;a&gt;');
  });

  it('calcClientDiscount tipo P + $5M CONTADO → 3% vol + 6% fijo + 5% antic = 14%', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    const r = ctx.window.__phase0.pure.calcClientDiscount({ cliTipo: 'P' }, 5_000_000, 'CONTADO');
    expect(r.pctFijo).toBe(6);
    expect(r.pctVol).toBe(3);
    expect(r.pctAntic).toBe(5);
    expect(r.pctTotal).toBe(14);
  });

  it('__phase0.sap.createSapClient es una factory function', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(typeof ctx.window.__phase0.sap.createSapClient).toBe('function');
  });

  it('applySentryUserContext callable con sentry=null (no throw)', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(() => ctx.window.__phase0.sentry.applySentryUserContext(null, null, null, null)).not.toThrow();
  });
});

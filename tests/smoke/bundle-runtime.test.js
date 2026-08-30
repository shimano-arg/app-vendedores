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

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BUNDLE = join(ROOT, 'app.bundle.js');
const INDEX = join(ROOT, 'index.html');
const SW = join(ROOT, 'sw.js');

describe('artifacts en repo root', () => {
  it('app.bundle.js existe', () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it('app.bundle.js (shell) en rango [20 KB, 2500 KB] post-E3 code splitting', () => {
    // Pre-E2: ~44 KB. Post-E2 completo: 2.23 MB (bundle único).
    // Post-E3 (3 chunks lazy): shell 1.89 MB + 3 chunks 358 KB total.
    // Reducción del shell: ~15% en E3 fase 1. Chunks futuros reducirán más.
    // v732 (2026-08-29): techo subido 2.5 MB -> 3 MB. 3 nuevos schemas ML.
    // v744 (2026-08-30): techo subido 3 MB -> 3.5 MB. Dark mode E3 (Leaflet
    // dark tiles swap + scrollbars + overlays + logo overrides + assets)
    // sumo ~80 KB al bundle. Bundle actual 3.08 MB.
    const size = statSync(BUNDLE).size;
    expect(size).toBeGreaterThan(20_000);
    expect(size).toBeLessThan(3_500_000);
  });

  it('E3: chunks/*.js existen y cada uno < 400 KB (assert del plan)', () => {
    const chunks = ['exports-core', 'exports-advanced', 'admin-users'];
    for (const name of chunks) {
      const chunkPath = join(ROOT, 'chunks', name + '.js');
      expect(existsSync(chunkPath), `chunks/${name}.js debe existir`).toBe(true);
      const size = statSync(chunkPath).size;
      expect(size, `chunks/${name}.js debe estar en rango`).toBeGreaterThan(1_000);
      expect(size, `chunks/${name}.js debe estar < 400 KB`).toBeLessThan(400_000);
    }
  });

  it('index.html en rango [800 KB, 3.5 MB] (baja durante E2 al ir extrayendo dominios)', () => {
    // Pre-E2: 2.14 MB. Progresión E2: baja ~50-200 KB por dominio extraído.
    // Post-E2.m.2: 1.44 MB (12,700+ LOC extraídos al bundle).
    // Mínimo 800 KB deja margen para que sigamos extrayendo admin-users (~6,463 LOC).
    const size = statSync(INDEX).size;
    expect(size).toBeGreaterThan(800_000);
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

  it('E3: STATIC_ASSETS incluye chunks lazy (./chunks/*.js) para offline', () => {
    const sw = readFileSync(SW, 'utf8');
    const chunks = ['exports-core', 'exports-advanced', 'admin-users'];
    for (const name of chunks) {
      expect(sw, `sw.js debe cachear ./chunks/${name}.js`).toContain(`'./chunks/${name}.js'`);
    }
  });

  it('E5: activate limpia cachés viejos con nombre distinto al vigente', () => {
    // El pattern del activate handler filtra keys.filter(k => k !== STATIC_CACHE && k !== HTML_CACHE)
    // y borra los que quedan. Esto garantiza que al bump de CACHE_VERSION el
    // cache viejo se elimine al primer activate del SW nuevo.
    const sw = readFileSync(SW, 'utf8');
    expect(sw).toContain("addEventListener('activate'");
    expect(sw).toMatch(/keys\.filter\(k => k !== STATIC_CACHE/);
    expect(sw).toContain('caches.delete');
  });

  it('E5: stale-while-revalidate para assets locales (bundle + chunks + iconos)', () => {
    // Pattern del handler: caches.open(STATIC_CACHE).then(cache => cache.match(req)
    // .then(cached => { const netFetch = fetch(req).then(resp => cache.put(req, ...)));
    // return cached || netFetch }))
    // Detecta que hay tanto match como put en el mismo handler.
    const sw = readFileSync(SW, 'utf8');
    expect(sw).toContain('STALE-WHILE-REVALIDATE');
    expect(sw).toMatch(/cache\.match\(req\)[\s\S]+cache\.put\(req/);
    // Sanity: return cached || netFetch (fast path)
    expect(sw).toMatch(/return cached \|\| netFetch/);
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

  it('E3: expone window.loadChunk (loader function)', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = {
      window: {},
      console,
      globalThis: {},
      document: { createElement: () => ({}), head: { appendChild: () => {} } },
    };
    runInNewContext(src, ctx);
    expect(typeof ctx.window.loadChunk).toBe('function');
    // __chunksLoaded es el registry interno del loader
    expect(ctx.window.__chunksLoaded).toBeDefined();
  });

  it('E3: instala stubs proxy para exports de chunks lazy (window.openAdminPanel, window.exportToExcel, etc.)', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = {
      window: {},
      console,
      globalThis: {},
      document: { createElement: () => ({}), head: { appendChild: () => {} } },
    };
    runInNewContext(src, ctx);
    // Stubs de admin-users
    expect(typeof ctx.window.openAdminPanel).toBe('function');
    expect(typeof ctx.window.saveUserRole).toBe('function');
    // Stubs de exports-core
    expect(typeof ctx.window.exportToExcel).toBe('function');
    expect(typeof ctx.window.exportMasterClientes).toBe('function');
    // Stubs de exports-advanced
    expect(typeof ctx.window.exportPowerBI).toBe('function');
  });

  it('__phase0.pure expone las 10 funciones extraídas', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    const pure = ctx.window.__phase0.pure;
    const expected = [
      'normClientName',
      'titleCase',
      'escapeHtml',
      'normTitle',
      'normalizeSearch',
      'calcClientDiscount',
      'matchesAllTokens',
      'findSapDuplicateForProvisorio',
      'matchSkuFromTitle',
      'passesTypeFilter',
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
    expect(() =>
      ctx.window.__phase0.sentry.applySentryUserContext(null, null, null, null)
    ).not.toThrow();
  });
});

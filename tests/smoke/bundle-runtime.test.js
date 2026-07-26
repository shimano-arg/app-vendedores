/**
 * E2 smoke test — Node-based. Corre `dist/app.bundle.js` en un vm.Context
 * fake con window={} y verifica que window.__phase0 quede poblado con todo
 * lo que src/main.js declara exportar.
 *
 * Por qué no Playwright: el chromium download (~150-600 MB según OS) está
 * bloqueado por la red actual (README 43.5 documenta 90+ min de timeout).
 * Este smoke cubre la aserción crítica de E2 no-breaking: "el bundle carga
 * sin throw y expone la API prometida". La verificación DOM/Firebase real
 * queda como gate humano manual pre-merge (mismo patrón que E1).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const BUNDLE = join(DIST, 'app.bundle.js');
const INDEX = join(DIST, 'index.html');
const SW = join(DIST, 'sw.js');

describe('dist/ artifacts', () => {
  it('existen los 3 archivos generados por build', () => {
    expect(existsSync(BUNDLE)).toBe(true);
    expect(existsSync(INDEX)).toBe(true);
    expect(existsSync(SW)).toBe(true);
  });

  it('dist/index.html está en rango [1.5 MB, 3.5 MB] (gate E2)', () => {
    const size = statSync(INDEX).size;
    expect(size).toBeGreaterThan(1_500_000);
    expect(size).toBeLessThan(3_500_000);
  });

  it('dist/index.html tiene el <script src="./app.bundle.js" defer> inyectado', () => {
    const html = readFileSync(INDEX, 'utf8');
    expect(html).toMatch(/<script src="\.\/app\.bundle\.js" defer><\/script>/);
  });

  it('dist/index.html y dist/sw.js tienen la misma versión bumpeada', () => {
    const html = readFileSync(INDEX, 'utf8');
    const sw = readFileSync(SW, 'utf8');
    const htmlV = html.match(/const APP_VERSION = '(v\d+)';/);
    const swV = sw.match(/const CACHE_VERSION = '(v\d+)';/);
    expect(htmlV).not.toBeNull();
    expect(swV).not.toBeNull();
    expect(htmlV[1]).toBe(swV[1]);
  });
});

describe('bundle runtime', () => {
  it('carga sin throw en un contexto con window={}', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    expect(() => runInNewContext(src, ctx)).not.toThrow();
  });

  it('expone window.__phase0 con estructura {version, pure, sentry, sap}', () => {
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

  it('__phase0.pure.titleCase("hola mundo") === "Hola Mundo" (sanity post-bundle)', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(ctx.window.__phase0.pure.titleCase('hola mundo')).toBe('Hola Mundo');
  });

  it('__phase0.pure.normClientName("Café López") === "CAFE LOPEZ" (unicode ok post-bundle)', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(ctx.window.__phase0.pure.normClientName('Café López')).toBe('CAFE LOPEZ');
  });

  it('__phase0.sap.createSapClient es una factory function', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(typeof ctx.window.__phase0.sap.createSapClient).toBe('function');
  });

  it('__phase0.sentry.applySentryUserContext es callable con sentry=null (no throw)', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const ctx = { window: {}, console, globalThis: {} };
    runInNewContext(src, ctx);
    expect(() => ctx.window.__phase0.sentry.applySentryUserContext(null, null, null, null)).not.toThrow();
  });
});

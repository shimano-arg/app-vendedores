// @ts-check
/**
 * E3 §auditgrises G5.14 — SW cache coherency:
 * `sw.js:CACHE_VERSION` DEBE ser igual a `index.html:APP_VERSION`.
 * Diferencia implica que al deployar un cambio de reglas (JS, CSS, chunks),
 * users con SW stale pueden quedar operando sobre reglas viejas sin que el
 * SW invalide su cache. Al mismo tiempo, bumpear sólo APP_VERSION sin
 * CACHE_VERSION no invalida nada del cache de assets.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const SW_JS = readFileSync('sw.js', 'utf8');

describe('G5.14 — SW CACHE_VERSION == APP_VERSION', () => {
  it('index.html define APP_VERSION', () => {
    expect(INDEX_HTML).toMatch(/const APP_VERSION\s*=\s*['"]v\d+['"]/);
  });

  it('sw.js define CACHE_VERSION', () => {
    expect(SW_JS).toMatch(/const CACHE_VERSION\s*=\s*['"]v\d+['"]/);
  });

  it('APP_VERSION === CACHE_VERSION (coherencia bump)', () => {
    const appMatch = INDEX_HTML.match(/const APP_VERSION\s*=\s*['"](v\d+)['"]/);
    const swMatch = SW_JS.match(/const CACHE_VERSION\s*=\s*['"](v\d+)['"]/);
    expect(appMatch).toBeTruthy();
    expect(swMatch).toBeTruthy();
    const appVersion = appMatch[1];
    const swVersion = swMatch[1];
    expect(swVersion).toBe(appVersion);
  });
});

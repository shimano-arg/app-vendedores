// v1546 (CLAUDE.md §106): el botón «Pedidos del mes» del header usa el pill Apple.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync('styles/apple-design.css', 'utf8');
const HTML = readFileSync('index.html', 'utf8');

function bloque(selector) {
  const i = CSS.indexOf(selector + ' {');
  expect(i, selector + ' sin bloque en apple-design.css').toBeGreaterThan(0);
  return CSS.slice(i, CSS.indexOf('}', i));
}

describe('v1546 — #pedidos-mes-btn con estilo Apple', () => {
  it('tiene el bloque pill completo', () => {
    const b = bloque('#pedidos-mes-btn.btn-zonas');
    expect(b).toMatch(/border-radius: 999px !important/);
    expect(b).toMatch(/text-transform: none !important/);
    expect(b).toMatch(/font-weight: 600 !important/);
    expect(b).toMatch(/letter-spacing: -0\.01em !important/);
    expect(b).toMatch(/box-shadow: none !important/);
  });

  it('tiene hover y feedback al presionar', () => {
    expect(CSS).toMatch(/#pedidos-mes-btn\.btn-zonas:hover \{[^}]*background/);
    expect(CSS).toMatch(/#pedidos-mes-btn\.btn-zonas:active \{ transform: scale\(0\.97\)/);
  });

  it('los vecinos del header siguen con el mismo pill', () => {
    for (const sel of ['#planner-header-btn.btn-zonas', '#panel-control-btn.btn-zonas']) {
      expect(bloque(sel)).toMatch(/border-radius: 999px !important/);
    }
  });

  it('apple-design.css sigue en CRLF', () => {
    expect(CSS.includes('\r\n')).toBe(true);
  });

  it('versión >= v1546 en sync con el SW', () => {
    const m = HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(1546);
    const sw = readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(sw[1]).toBe(m[1]);
  });
});

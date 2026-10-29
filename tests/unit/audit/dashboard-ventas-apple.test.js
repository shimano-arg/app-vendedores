// @ts-check
/** Dashboard de Ventas fase 2 Task 4: estilo Apple scoped a #dashboard-ventas-modal. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync('styles/apple-design.css', 'utf8');
const JS = readFileSync('src/domains/dashboard-ventas.js', 'utf8');

function block() {
  const a = CSS.indexOf('/* dashboard-ventas-apple:start');
  const b = CSS.indexOf('/* dashboard-ventas-apple:end */');
  return a >= 0 && b > a ? CSS.slice(a, b) : '';
}

/** Selectores de todas las reglas (incluye las anidadas en @media), sin comentarios. */
function selectors(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{/g;
  let m = re.exec(clean);
  while (m) {
    const s = m[1].trim();
    if (s && !s.startsWith('@')) out.push(...s.split(',').map((x) => x.trim()));
    m = re.exec(clean);
  }
  return out;
}

describe('Dashboard de Ventas estilo Apple', () => {
  const css = block();
  it('existe el bloque', () => expect(css.length).toBeGreaterThan(100));
  it('todas las reglas empiezan con #dashboard-ventas-modal', () => {
    const bad = selectors(css).filter((s) => !s.startsWith('#dashboard-ventas-modal'));
    expect(bad).toEqual([]);
  });
  it('contiene los valores del spec', () => {
    expect(css).toContain('backdrop-filter');
    expect(css).toContain('#f5f5f7');
    expect(css).toContain('#49A2DA');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('border-radius: 16px');
    expect(css).toContain('0 1px 3px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.06)');
    expect(css).toContain('scale(0.97)');
  });
  it('no pisa height/overflow del modal-box (§49)', () => {
    expect(css).not.toMatch(/\bmax-height\s*:/);
    expect(css).not.toMatch(/\boverflow(-y)?\s*:/);
  });
  it('Chart.js: grilla suave, sin borde de ejes, fuente system', () => {
    expect(JS).toContain('rgba(0,0,0,.06)');
    expect(JS).toContain('rgba(255,255,255,.08)');
    expect(JS).toMatch(/data-theme'\) === 'dark'/);
    expect(JS).toContain('border: { display: false }');
    expect(JS).toContain('-apple-system');
  });

  it('cascada: cada .dv-X que el CSS inline estiliza se gana con #dashboard-ventas-body', () => {
    const html = readFileSync('index.html', 'utf8');
    const inline = [...html.matchAll(/#dashboard-ventas-body\s+(\.dv-[a-z-]+)/g)].map((m) => m[1]);
    const classes = [...new Set(inline)];
    expect(classes.length).toBeGreaterThan(10);
    const sels = selectors(css);
    for (const c of classes) {
      const competing = sels.filter((s) => new RegExp(`${c}(?![a-z-])`).test(s));
      for (const s of competing) expect(s, c).toContain('#dashboard-ventas-body');
    }
    expect(sels.some((s) => s.includes('.dv-card'))).toBe(true);
  });
});

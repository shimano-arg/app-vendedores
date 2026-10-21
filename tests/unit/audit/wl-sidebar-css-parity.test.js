// @ts-check
/**
 * v1396 §40.4 — Test CSS parity: parsea apple-design.css + bloque style del
 * index.html, encuentra TODAS las reglas que matchean `.slft-wl-item.source-cpst`
 * (con o sin has-exceed/hover) y verifica que setean el MISMO background.
 *
 * Si alguien agrega una regla nueva con background distinto para una variante
 * de .source-cpst, este test FALLA.
 *
 * El invariante: una card STOCK ASIG tiene UN SOLO color de fondo en todos los
 * estados. has-exceed solo cambia el border-left. CLAUDE.md §40.4.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APPLE_CSS = readFileSync('styles/apple-design.css', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');

function extractInlineCss(html) {
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  const chunks = [];
  let m;
  while ((m = re.exec(html)) !== null) chunks.push(m[1]);
  return chunks.join('\n');
}
const INDEX_CSS = extractInlineCss(INDEX_HTML);
const ALL_CSS = APPLE_CSS + '\n' + INDEX_CSS;

function findRulesWithSelectorContaining(css, needle) {
  const out = [];
  const re = /([^{};]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selectorRaw = m[1].trim();
    const body = m[2].trim();
    const selectors = selectorRaw.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      if (sel.includes(needle)) {
        out.push({ selector: sel, body });
        break;
      }
    }
  }
  return out;
}

function extractBackground(body) {
  const m = body.match(/background\s*:\s*([^;]+)/i);
  return m
    ? m[1]
        .trim()
        .toLowerCase()
        .replace(/\s*!important$/, '')
        .trim()
    : null;
}

describe('v1396 §40.4 CSS parity .slft-wl-item.source-cpst', () => {
  const rules = findRulesWithSelectorContaining(ALL_CSS, '.slft-wl-item.source-cpst');

  it('existen reglas que matchean .slft-wl-item.source-cpst', () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it('todas las reglas con background setean el MISMO valor', () => {
    const backgrounds = rules.map((r) => extractBackground(r.body)).filter((bg) => bg !== null);
    if (backgrounds.length === 0) return;
    const unique = Array.from(new Set(backgrounds));
    const details = rules
      .filter((r) => extractBackground(r.body))
      .map((r) => '  ' + r.selector + ' -> ' + extractBackground(r.body))
      .join('\n');
    expect(unique.length, 'Multiple backgrounds detectados:\n' + details).toBe(1);
  });

  it('el background es #fdba74 (naranja — fix v1396 Mariano)', () => {
    const backgrounds = rules.map((r) => extractBackground(r.body)).filter((bg) => bg !== null);
    for (const bg of backgrounds) {
      expect(bg).toBe('#fdba74');
    }
  });

  it('.source-cpst.has-exceed NO setea un background distinto al base .source-cpst', () => {
    const exceedRules = rules.filter((r) => r.selector.includes('.has-exceed'));
    for (const r of exceedRules) {
      const bg = extractBackground(r.body);
      if (bg !== null) {
        expect(bg).toBe('#fdba74');
      }
    }
  });
});

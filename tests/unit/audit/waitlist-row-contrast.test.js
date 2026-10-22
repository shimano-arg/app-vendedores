// @ts-check
/**
 * v1405 §43 — Test contraste WCAG en la tabla modal #wcard-rows.
 *
 * Parsea el bloque <style> del index.html + styles/apple-design.css. Para cada
 * combinacion relevante (fila x celda), simula la cascade CSS con specificity
 * + !important + source order y verifica:
 *   1. Ninguna combinacion de fila azul reservada queda con texto blanco sobre
 *      fondo claro (contraste WCAG >= 4.5:1).
 *   2. Los 3 tooltips de la tabla usan `\n` real, no `\\n` literal.
 *
 * El bug reportado (orden 486 ARIEL GUSTAVO ESTEBAN, SGS80MH2A/SGS90MH2A):
 * - fila `merge-reservado-imported` + col `disp-sap-col` -> bg transparente (var
 *   no definida en light) + color blanco !important = ilegible.
 * - fila `merge-reservado-imported.repeat-sku` + col `pedido-final-col` -> bg
 *   #fff7ed naranja palido !important ganaba por specificity + color blanco.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const APPLE_CSS = readFileSync('styles/apple-design.css', 'utf8');

function extractInlineCss(html) {
  const matches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g));
  return matches.map((m) => m[1]).join('\n');
}

const INDEX_CSS = extractInlineCss(INDEX_HTML);

/** Strippa comentarios CSS /* ... *\/ para que el parser no incluya el texto
 * del comentario (con comas, llaves) como parte de un selector. */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const ALL_CSS = stripCssComments(APPLE_CSS + '\n' + INDEX_CSS);

/** Resolver var() de light mode (:root). */
const CSS_VARS = {
  '--color-success': '#166534',
  '--color-success-bg': null, // NO definida en :root; cae a transparent
  '--color-danger': '#dc2626',
  '--color-danger-strong': '#991b1b',
  '--color-danger-bg': null,
  '--color-warning': '#d97706',
  '--color-warning-bg': '#fef3c7',
};

function resolveVar(value) {
  if (!value) return value;
  const m = value.match(/var\(\s*(--[a-z0-9-]+)\s*\)/i);
  if (!m) return value;
  const resolved = CSS_VARS[m[1]];
  return resolved === null ? null : resolved || value;
}

/** Specificity (a,b,c). */
function specificity(selector) {
  let a = 0;
  let b = 0;
  let c = 0;
  const s = selector.replace(/\s+/g, ' ').trim();
  const idRe = /#[a-zA-Z_][\w-]*/g;
  const classRe = /\.[a-zA-Z_][\w-]*/g;
  const pseudoClassRe = /:(?!:)[a-zA-Z-]+(?:\([^)]*\))?/g;
  const attrRe = /\[[^\]]+\]/g;
  const pseudoElemRe = /::[a-zA-Z-]+/g;
  const elementRe = /(?:^|[\s>+~])([a-zA-Z][\w-]*)/g;
  a += (s.match(idRe) || []).length;
  b += (s.match(classRe) || []).length;
  b += (s.match(attrRe) || []).length;
  b += (s.match(pseudoClassRe) || []).length;
  c += (s.match(pseudoElemRe) || []).length;
  const stripped = s
    .replace(idRe, '')
    .replace(classRe, '')
    .replace(attrRe, '')
    .replace(pseudoClassRe, '')
    .replace(pseudoElemRe, '');
  c += (stripped.match(elementRe) || []).length;
  return [a, b, c];
}

function cmpSpec(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/** Parsea CSS y devuelve lista de rules {selector, body, index}. */
function parseRules(css) {
  const out = [];
  const matches = Array.from(css.matchAll(/([^{};@]+)\{([^}]*)\}/g));
  let idx = 0;
  for (const m of matches) {
    const selectorsRaw = (m[1] || '').trim();
    if (!selectorsRaw || selectorsRaw.startsWith('@')) continue;
    const body = (m[2] || '').trim();
    const selectors = selectorsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sel of selectors) {
      out.push({ selector: sel, body, index: idx++ });
    }
  }
  return out;
}

const ALL_RULES = parseRules(ALL_CSS);

function parseSimpleSelector(sel) {
  const classes = new Set();
  const classMatches = sel.match(/\.[a-zA-Z_][\w-]*/g) || [];
  for (const c of classMatches) classes.add(c.slice(1));
  const pseudoMatches = sel.match(/:(?!:)[a-zA-Z-]+/g) || [];
  const pseudos = new Set(pseudoMatches.map((p) => p.slice(1)));
  const stripped = sel
    .replace(/#[a-zA-Z_][\w-]*/g, '')
    .replace(/\.[a-zA-Z_][\w-]*/g, '')
    .replace(/:(?!:)[a-zA-Z-]+(?:\([^)]*\))?/g, '')
    .trim();
  const tagM = stripped.match(/^[a-zA-Z][\w-]*/);
  return { classes, pseudos, tag: tagM ? tagM[0].toLowerCase() : null };
}

function matchesTr(sel, rowClasses, pseudo) {
  const p = parseSimpleSelector(sel);
  if (p.tag && p.tag !== 'tr') return false;
  for (const cls of p.classes) {
    if (!rowClasses.has(cls)) return false;
  }
  for (const ps of p.pseudos) {
    if (ps !== pseudo) return false;
  }
  return true;
}

function matchesTd(sel, cellClasses) {
  if (!sel) return true;
  const p = parseSimpleSelector(sel);
  if (p.tag && p.tag !== 'td') return false;
  for (const cls of p.classes) {
    if (!cellClasses.has(cls)) return false;
  }
  return true;
}

/** Lee propiedad `prop` del body y devuelve {value, important} o null. */
function readProp(body, prop) {
  const re = new RegExp('(^|[;\\s])' + prop + '\\s*:\\s*([^;]+)', 'i');
  const m = body.match(re);
  if (!m) return null;
  let val = m[2].trim();
  const important = /!important$/i.test(val);
  val = val.replace(/\s*!important$/i, '').trim();
  return { value: val, important };
}

function computeEffective(prop, rowClasses, cellClasses, pseudo = null) {
  const rowSet = new Set(rowClasses);
  const cellSet = new Set(cellClasses);
  const candidates = [];
  for (const r of ALL_RULES) {
    const sel = r.selector;
    if (!sel.startsWith('#wcard-rows')) continue;
    const parts = sel.split(/\s+/).filter(Boolean);
    if (parts[0] !== '#wcard-rows') continue;
    if (parts.length < 2) continue;
    const trSel = parts[1];
    if (!matchesTr(trSel, rowSet, pseudo)) continue;
    let tdSel = null;
    if (parts.length === 2) {
      tdSel = null;
    } else if (parts.length === 3) {
      tdSel = parts[2];
    } else {
      continue;
    }
    if (tdSel) {
      if (parseSimpleSelector(tdSel).tag !== 'td') continue;
      if (!matchesTd(tdSel, cellSet)) continue;
    }
    const found = readProp(r.body, prop);
    if (!found) continue;
    const resolved = resolveVar(found.value);
    candidates.push({
      selector: sel,
      value: resolved,
      important: found.important,
      spec: specificity(sel),
      index: r.index,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    const s = cmpSpec(b.spec, a.spec);
    if (s !== 0) return s;
    return b.index - a.index;
  });
  return candidates[0].value;
}

function luminance(hex) {
  if (!hex || hex === 'transparent' || hex === 'inherit') return null;
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const [R, G, B] = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function ratio(bgHex, fgHex) {
  const l1 = luminance(bgHex);
  const l2 = luminance(fgHex);
  if (l1 === null || l2 === null) return null;
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

const BLUE = '#1e40af';

describe('v1405 §43 — specificity del parser', () => {
  it('`#wcard-rows tr.A td.B` = [1,2,2]', () => {
    expect(specificity('#wcard-rows tr.A td.B')).toEqual([1, 2, 2]);
  });
  it('`#wcard-rows tr.A.B td.C` = [1,3,2]', () => {
    expect(specificity('#wcard-rows tr.A.B td.C')).toEqual([1, 3, 2]);
  });
  it('`#wcard-rows tr.A.B:hover td.C` = [1,4,2]', () => {
    expect(specificity('#wcard-rows tr.A.B:hover td.C')).toEqual([1, 4, 2]);
  });
});

const ROW_RESERVADAS = ['merge-reservado-imported', 'merge-duplicate-reservado'];
const CELLS = [
  { name: 'disp-sap-col', classes: ['num', 'disp-sap-col'] },
  { name: 'pedido-final-col', classes: ['num', 'pedido-final-col'] },
];
const COMBOS = [
  { name: 'base', extra: [] },
  { name: 'repeat-sku', extra: ['repeat-sku'] },
  { name: 'warn-quiebra', extra: ['warn-quiebra'] },
  { name: 'warn-duplicado', extra: ['warn-duplicado'] },
  { name: 'exceed', extra: ['exceed'] },
];
const PSEUDOS = [null, 'hover'];

describe('v1405 §43 — contraste WCAG filas reservadas × celdas destacadas', () => {
  for (const rowBase of ROW_RESERVADAS) {
    for (const combo of COMBOS) {
      for (const cell of CELLS) {
        for (const pseudo of PSEUDOS) {
          const rowClasses = [rowBase, ...combo.extra];
          const label =
            'tr.' + rowClasses.join('.') + (pseudo ? ':' + pseudo : '') + ' × ' + cell.name;
          it('contraste >=4.5 en ' + label, () => {
            const bg = computeEffective('background', rowClasses, cell.classes, pseudo);
            const fg = computeEffective('color', rowClasses, cell.classes, pseudo);
            expect(bg, 'bg nulo para ' + label).toBeTruthy();
            expect(fg, 'fg nulo para ' + label).toBeTruthy();
            const r = ratio(bg, fg);
            expect(r, 'ratio nulo bg=' + bg + ' fg=' + fg).not.toBeNull();
            expect(
              r,
              label + ' bg=' + bg + ' fg=' + fg + ' ratio=' + (r || 0).toFixed(2)
            ).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    }
  }

  it('fg efectivo es blanco en toda combinación reservada × destacada', () => {
    for (const rowBase of ROW_RESERVADAS) {
      for (const combo of COMBOS) {
        for (const cell of CELLS) {
          const fg = computeEffective('color', [rowBase, ...combo.extra], cell.classes, null);
          const normalized = (fg || '').toLowerCase().replace(/^#/, '').trim();
          expect(
            ['fff', 'ffffff'],
            'fg no blanco en ' + rowBase + '/' + combo.name + '/' + cell.name + ' = ' + fg
          ).toContain(normalized);
        }
      }
    }
  });

  it('bg efectivo es azul #1e40af en reservada × destacada', () => {
    for (const rowBase of ROW_RESERVADAS) {
      for (const combo of COMBOS) {
        for (const cell of CELLS) {
          const bg = computeEffective('background', [rowBase, ...combo.extra], cell.classes, null);
          expect(
            bg,
            'bg no azul en ' + rowBase + '/' + combo.name + '/' + cell.name + ' = ' + bg
          ).toBe(BLUE);
        }
      }
    }
  });
});

describe('v1405 §43 — nunca blanco sobre fondo claro (regla por regla)', () => {
  it('toda regla con color:#fff !important + bg declarado tiene bg con luma oscura', () => {
    const WHITE_RE = /color\s*:\s*#(?:fff|ffffff)\s*!important/i;
    const violations = [];
    for (const r of ALL_RULES) {
      if (!r.selector.startsWith('#wcard-rows')) continue;
      if (!WHITE_RE.test(r.body)) continue;
      const bgFound = readProp(r.body, 'background');
      if (!bgFound) continue;
      const bg = resolveVar(bgFound.value) || bgFound.value;
      const lum = luminance(bg);
      if (lum === null) continue;
      if (lum > 0.5) {
        violations.push(
          r.selector + ' -> bg=' + bg + ' (luma=' + lum.toFixed(2) + ') + color:#fff'
        );
      }
    }
    expect(violations, 'WCAG blanco-sobre-claro:\n  ' + violations.join('\n  ')).toEqual([]);
  });
});

describe('v1405 §43 — tooltips usan newline real', () => {
  it('tdReserv.title del modal #wcard-rows no tiene \\n literal (dos chars)', () => {
    const idx = INDEX_HTML.indexOf('tdReserv.title = ');
    expect(idx).toBeGreaterThan(0);
    const chunk = INDEX_HTML.slice(idx, idx + 800);
    expect(chunk).not.toMatch(/\\\\n/);
  });

  it('tdLibre.title del modal #wcard-rows no tiene \\n literal', () => {
    const idx = INDEX_HTML.indexOf('tdLibre.title = ');
    expect(idx).toBeGreaterThan(0);
    const chunk = INDEX_HTML.slice(idx, idx + 800);
    expect(chunk).not.toMatch(/\\\\n/);
  });

  it('tdFinal.title del modal #wcard-rows no tiene \\n literal', () => {
    const idx = INDEX_HTML.indexOf('tdFinal.title = r.hasData');
    expect(idx).toBeGreaterThan(0);
    const chunk = INDEX_HTML.slice(idx, idx + 500);
    expect(chunk).not.toMatch(/\\\\n/);
  });
});

// sec 2026-11-24 — el escapeAttr inline de index.html y el de
// src/pure/html-safe.js tienen que comportarse igual (§57).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeAttr as pureEscapeAttr } from '../../../src/pure/html-safe.js';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

function extractInlineEscapeAttr() {
  const m = html.match(/function escapeAttr\(s\)\{[\s\S]*?\n\}/);
  if (!m) throw new Error('escapeAttr inline no encontrado en index.html');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return escapeAttr;`)();
}

describe('escapeAttr inline ≡ pure', () => {
  const inline = extractInlineEscapeAttr();
  const inputs = [
    '',
    'simple',
    "o'neil",
    'a"b',
    'a&b',
    '&#39;',
    '&quot;',
    'x&#39;);alert(1);//',
    '<b>&</b>',
    'c:\\ruta',
    null,
    undefined,
    0,
    'ÑANDÚ & CÍA',
  ];
  for (const v of inputs) {
    it(`mismo resultado para ${JSON.stringify(v)}`, () => {
      expect(inline(v)).toBe(pureEscapeAttr(v));
    });
  }
  it('el inline escapa &', () => {
    expect(inline('a&b')).toBe('a&amp;b');
  });
});

/** Decodifica entidades HTML como lo hace el parser al leer un atributo. */
function decodeAttr(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

describe('escapeAttr (pure): payloads', () => {
  it('escapa & antes que el resto', () => {
    expect(pureEscapeAttr('a&b')).toBe('a&amp;b');
    expect(pureEscapeAttr('&#39;')).toBe('&amp;#39;');
  });
  it('dentro de onclick="f(\'…\')", el valor decodificado no cierra el string JS', () => {
    for (const payload of [
      'x&#39;);alert(1);//',
      "x');alert(1);//",
      'x&quot;);alert(1);//',
      'a"b',
      'c\\',
      "o'neil & co",
    ]) {
      const decoded = decodeAttr(pureEscapeAttr(payload));
      // Simula el handler inline: el string JS evaluado tiene que devolver el valor original.
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return '${decoded}';`);
      expect(fn()).toBe(payload);
    }
  });
  it('escapa < y > y tolera null/undefined', () => {
    expect(pureEscapeAttr('<b>')).toBe('&lt;b&gt;');
    expect(pureEscapeAttr(null)).toBe('');
    expect(pureEscapeAttr(undefined)).toBe('');
  });
});

describe('contrato C-03', () => {
  const admin = readFileSync(resolve(__dirname, '../../../src/domains/admin-users.js'), 'utf8');
  it('admin-users.js no arma onclick con JSON.stringify(email)', () => {
    expect(admin).not.toMatch(/JSON\.stringify\(d\.email/);
    expect((admin.match(/escapeAttr\(d\.email \|\| ''\)/g) || []).length).toBe(2);
  });
  it('index.html: openClientModal del popup no usa &quot; como delimitador JS', () => {
    expect(html).not.toMatch(/openClientModal\(&quot;/);
  });
});

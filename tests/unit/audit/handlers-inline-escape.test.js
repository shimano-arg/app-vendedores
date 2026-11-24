// sec 2026-11-24 (revisión adversarial PR #1415) — escape de atributos y
// argumentos de handlers inline. Tests de la lógica pura (jsArgAttr) +
// contratos por grep para que el patrón viejo no vuelva.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeAttr, jsArgAttr } from '../../../src/pure/html-safe.js';

const ROOT = resolve(__dirname, '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listJs(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// El navegador decodifica las entidades del atributo antes de ejecutar el
// handler. Modelo mínimo de esa decodificación para los tests.
function decodeAttr(s) {
  return s.replace(/&(amp|quot|lt|gt|#39);/g, (_m, e) =>
    e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'lt' ? '<' : e === 'gt' ? '>' : "'"
  );
}

// Evalúa el literal JS tal como lo vería el handler (después de decodificar).
function evalLiteral(lit) {
  return new Function('return [' + lit + '];')();
}

const PAYLOADS = [
  'Mc\u0027Donalds',
  'a"b',
  '&quot;+x()+&quot;',
  '&#39;+x()+&#39;',
  "\\'+x()+\\'",
  '\\',
  '"><img src=x onerror=x()>',
  '</script><script>x()</script>',
  'linea1\nlinea2\r\nlinea3',
  'sep\u2028\u2029',
  'Ñandú & Cía',
];

describe('jsArgAttr', () => {
  it('devuelve un literal entre comillas simples sin comillas dobles ni < >', () => {
    for (const p of PAYLOADS) {
      const out = jsArgAttr(p);
      expect(out.startsWith("'")).toBe(true);
      expect(out.endsWith("'")).toBe(true);
      expect(out).not.toMatch(/["<>\n\r\u2028\u2029]/);
    }
  });
  it('después de decodificar el atributo, el literal vale exactamente el original', () => {
    for (const p of PAYLOADS) {
      const decoded = decodeAttr(jsArgAttr(p));
      const res = evalLiteral(decoded);
      expect(res).toEqual([p]);
    }
  });
  it('null/undefined → string vacío', () => {
    expect(jsArgAttr(null)).toBe("''");
    expect(jsArgAttr(undefined)).toBe("''");
  });
  it('el patrón viejo (JSON.stringify + &quot;) sí dejaba salir del string', () => {
    // Documenta por qué se reemplazó: `&quot;` dentro del valor se decodifica.
    const old = JSON.stringify('&quot;+x()+&quot;').replace(/"/g, '&quot;');
    const decoded = decodeAttr(old);
    expect(decoded).toBe('""+x()+""');
  });
});

describe('escapeAttr en string JS entre comillas simples', () => {
  it('ningún payload sale del literal', () => {
    for (const p of PAYLOADS.filter((x) => !/[\n\r\u2028\u2029]/.test(x))) {
      const res = evalLiteral("'" + decodeAttr(escapeAttr(p)) + "'");
      expect(res).toEqual([p]);
    }
  });
});

describe('contrato: no reaparece JSON.stringify(…).replace(/"/g, …) en handlers', () => {
  const files = [...listJs(resolve(ROOT, 'src')), resolve(ROOT, 'index.html')];
  it('ningún archivo de src/ ni index.html usa el patrón', () => {
    const re = /JSON\.stringify\([^;\n]*?\)\s*\.replace\(\s*\/"\/g/;
    const hits = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (re.test(l)) hits.push(relative(ROOT, f) + ':' + (i + 1));
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('contrato: puntos corregidos', () => {
  const notif = read('src/domains/notificaciones.js');
  const html = read('index.html');

  it('notificaciones: la clase type-* sale de una lista de tipos conocidos', () => {
    expect(notif).toMatch(/const KNOWN_NOTIF_TYPES = new Set\(\[/);
    expect(notif).toMatch(/'notif-item type-' \+ notifTypeClass\(type\)/);
    expect(notif).not.toMatch(/'notif-item type-' \+ type \+/);
  });
  it('notificaciones: el id de la miniatura se escapa', () => {
    expect(notif).toMatch(/escapeHtml\('task-' \+ n\._fsId \+ '-' \+ i\)/);
    expect(notif).toMatch(/escapeHtml\('sent-' \+ n\._fsId \+ '-' \+ i\)/);
    expect(notif).not.toMatch(/id="(task|sent)-' \+\s*n\._fsId/);
  });
  it('notificaciones: deleteMyAltaCli recibe el nombre con jsArgAttr', () => {
    expect(notif).toMatch(/const safeName = jsArgAttr\(a\.comercio \|\| ''\)/);
  });
  it('index.html: handlers del Planner usan escapeAttr (no escapeHtml) en el string JS', () => {
    expect(html).toMatch(/openPlannerCardModal\(\\'' \+ escapeAttr\(pedido\.id\)/);
    expect(html).toMatch(/resendPlannerNotif\(\\'' \+ escapeAttr\(currentCol\)/);
    expect(html).not.toMatch(/\\'' \+ escapeHtml\([^)]*\) \+ '\\'\)/);
  });
  it('IDs de documento en handlers van escapados (sap-admin-panel, campanias, admin-users)', () => {
    const cases = [
      ['src/domains/sap-admin-panel.js', 'p\\._fsId'],
      ['src/domains/campanias.js', 'c\\._id'],
      ['src/domains/admin-users.js', 'docId'],
    ];
    for (const [file, v] of cases) {
      const src = read(file);
      expect(src).not.toMatch(new RegExp("\\(\\\\'' \\+\\n\\s+" + v + ' \\+\\n'));
    }
  });
  it('forecast: los handlers no usan escapeHtml dentro del string JS', () => {
    const src = read('src/domains/forecast.js');
    expect(src).not.toMatch(/\\'' \+\n\s+escapeHtmlSafe\(/);
    expect(src).not.toMatch(/"', '" \+\n\s+escapeHtmlSafe\(/);
  });
});

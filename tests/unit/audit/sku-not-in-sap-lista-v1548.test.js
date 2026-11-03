// v1548 (2026-11-03): el cartel SKU_NOT_IN_SAP_CATALOG lista los productos que
// SAP rechaza (antes no decía cuáles) + fix de la variable `details` inexistente
// en la rama CONTENTION_RETRY_EXHAUSTED (ReferenceError → falla muda).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatProductosNoCargadosEnSap,
  PALABRAS_PROHIBIDAS,
} from '../../../src/pure/mensajes-vendedor.js';

const HTML = readFileSync('index.html', 'utf8');
const MAIN = readFileSync('src/main.js', 'utf8');

const LINES = [
  { code: 'CLC66H2PY', desc: 'Caña Clarus 6\'6" H' },
  { code: 'trx301b', desc: 'Reel TRX 301 B' },
  { code: 'ABC1', desc: '' },
];

describe('v1548 formatProductosNoCargadosEnSap', () => {
  it('lista código y descripción de cada producto rechazado', () => {
    const t = formatProductosNoCargadosEnSap(['CLC66H2PY', 'TRX301B'], LINES);
    expect(t).toMatch(/todavía no están cargados en SAP/);
    expect(t).toMatch(/Productos a revisar \(2\):/);
    expect(t).toContain('• CLC66H2PY — Caña Clarus');
    expect(t).toContain('• TRX301B — Reel TRX 301 B');
    expect(t.trim().endsWith('Código técnico: SKU_NOT_IN_SAP_CATALOG')).toBe(true);
  });

  it('un solo producto sin descripción', () => {
    const t = formatProductosNoCargadosEnSap(['abc1'], LINES);
    expect(t).toMatch(/Producto a revisar:\n• ABC1\n/);
  });

  it('resume a partir del tope y deduplica', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'X' + i).concat(['X0']);
    const t = formatProductosNoCargadosEnSap(many, [], 15);
    expect(t).toMatch(/Productos a revisar \(20\):/);
    expect(t).toContain('… y 5 más');
    expect(t).not.toContain('• X15');
  });

  it('sin lista cae al mensaje de siempre', () => {
    const t = formatProductosNoCargadosEnSap([], LINES);
    expect(t).not.toMatch(/a revisar/);
    expect(t).toMatch(/Código técnico: SKU_NOT_IN_SAP_CATALOG/);
  });

  it('el texto base no tiene jerga (§68)', () => {
    const base = formatProductosNoCargadosEnSap([], []).split('\n\n')[0];
    for (const p of PALABRAS_PROHIBIDAS) {
      expect(base.toLowerCase().includes(String(p).toLowerCase()), p).toBe(false);
    }
  });
});

describe('v1548 — cableado en index.html y bundle', () => {
  it('rama SKU_NOT_IN_SAP_CATALOG usa data.missingSkus y las líneas del pedido', () => {
    expect(HTML).toMatch(
      /code === 'SKU_NOT_IN_SAP_CATALOG'[\s\S]{0,400}missingSkus[\s\S]{0,400}formatProductosNoCargadosEnSap[\s\S]{0,120}docData\.lines/
    );
  });

  it('la rama CONTENTION ya no usa la variable inexistente `details`', () => {
    expect(HTML).not.toMatch(/details && details\.lastError/);
    expect(HTML).toMatch(/const _det = \(_commitCfResult && _commitCfResult\.data\) \|\| \{\};/);
  });

  it('main.js expone el helper en __phase0.pure.mensajesVendedor', () => {
    expect(MAIN).toMatch(/formatProductosNoCargadosEnSap,\n\s*\},/);
  });

  it('versión >= v1548 en sync con el SW', () => {
    const m = HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(1548);
    expect(readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/)[1]).toBe(m[1]);
  });
});

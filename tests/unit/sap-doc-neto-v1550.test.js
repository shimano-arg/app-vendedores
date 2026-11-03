// v1550 (2026-11-03): "VA A SAP" tiene que ser el número que entra a SAP.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sapDocNetoSinIva } from '../../functions/core/sap-doc-neto.js';
import { computeVaASap } from '../../src/pure/pedido-va-a-sap.js';

const HTML = readFileSync('index.html', 'utf8');
const SYNC = readFileSync('functions/core/sync-sap-doc-totals-core.js', 'utf8');

describe('v1550 sapDocNetoSinIva', () => {
  it('ARIZAGA SQ 2000476: DocTotal 3.164.150 − IVA 549.150 = 2.615.000', () => {
    expect(sapDocNetoSinIva({ DocTotal: 3164150, VatSum: 549150 })).toBe(2615000);
  });
  it('sin VatSum usa DocTotal', () => {
    expect(sapDocNetoSinIva({ DocTotal: 822800 })).toBe(822800);
  });
  it('valores inválidos → null', () => {
    expect(sapDocNetoSinIva(null)).toBe(null);
    expect(sapDocNetoSinIva({})).toBe(null);
    expect(sapDocNetoSinIva({ DocTotal: 0 })).toBe(null);
    expect(sapDocNetoSinIva({ DocTotal: 'x' })).toBe(null);
  });
  it('IVA absurdo (>= total) se ignora', () => {
    expect(sapDocNetoSinIva({ DocTotal: 100, VatSum: 100 })).toBe(100);
  });
});

describe('v1550 — VA A SAP usa el total real de SAP', () => {
  it('computeVaASap prioriza sapDocTotal sobre la suma de líneas confirmadas', () => {
    const pedido = {
      sapDocTotal: 2615000,
      lines: [{ state: 'confirmed', qty: 1, precio: 5176000 }],
    };
    expect(computeVaASap(pedido)).toBe(2615000);
  });

  it('los listeners de pedidos copian sapDocTotal al objeto que usa el modal', () => {
    const hits =
      HTML.match(
        /sapDocTotal: \(typeof d\.sapDocTotal === 'number'\) \? d\.sapDocTotal : null,/g
      ) || [];
    expect(hits.length).toBe(2);
  });

  it('el sync de 30 min pide VatSum y guarda el neto', () => {
    expect(SYNC).toMatch(/const select = 'DocEntry,DocNum,DocTotal,VatSum';/);
    expect(SYNC).toMatch(/map\.set\(de, sapDocNetoSinIva\(r\) \|\| 0\);/);
  });

  it('versión >= v1550 en sync con el SW', () => {
    const m = HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(1550);
    expect(readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/)[1]).toBe(m[1]);
  });
});

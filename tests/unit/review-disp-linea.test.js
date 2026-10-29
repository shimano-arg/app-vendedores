// v1528: disponible por línea en "Revisá tu pedido" (caso BENGOCHEA ORDEN 653).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dispParaLineaReview } from '../../src/pure/review-disp-linea.js';

// Fixture BENGOCHEA 29/10: 597144 físico 5, reservadas 5 (todas del cliente).
const LIBRE = { 597144: 0, LUGC17: 40, CUDC150XG: 1 };
const UTIL = { 597144: 1 };
const deps = {
  getLibre: (s) => (s in LIBRE ? LIBRE[s] : null),
  getUtilizable: (s) => (s in UTIL ? UTIL[s] : 0),
};
const asig = {
  code: '597144',
  qty: 1,
  origen: 'stock-asignado',
  asigRefs: [{ pedidoId: 'p', lineIndex: 0, qtyAsignada: 1 }],
};

describe('dispParaLineaReview', () => {
  it('línea STOCK ASIGNADO usa el utilizable del cliente, no el libre general', () => {
    expect(dispParaLineaReview(asig, 'C20293164852', deps)).toBe(1);
  });
  it('línea normal usa el libre general', () => {
    expect(dispParaLineaReview({ code: 'LUGC17', qty: 2 }, 'C20293164852', deps)).toBe(40);
  });
  it('origen sin asigRefs se trata como línea normal (igual que la CF)', () => {
    expect(dispParaLineaReview({ code: '597144', origen: 'stock-asignado' }, 'C1', deps)).toBe(0);
  });
  it('sin cardCode cae al libre general', () => {
    expect(dispParaLineaReview(asig, '', deps)).toBe(0);
  });
  it('sin datos de stock devuelve null', () => {
    expect(dispParaLineaReview({ code: 'NOEXISTE' }, 'C1', deps)).toBeNull();
  });
  it('nunca negativo', () => {
    expect(dispParaLineaReview({ code: 'X' }, 'C1', { getLibre: () => -3 })).toBe(0);
  });
});

describe('contrato v1528', () => {
  const modal = readFileSync('src/domains/pedidos-modal.js', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  it('renderReviewLines decide el disponible por línea con el pure', () => {
    expect(modal).toContain('dispParaLineaReview');
  });
  it('el cliente del review lleva cardCode al venir de lista de espera', () => {
    expect(html).toMatch(
      /currentOrderClient = \{name: w\.clientName, tipo: 'C', province: provNorm, locName, cardCode:/
    );
  });
  it('main.js expone el pure', () => {
    expect(readFileSync('src/main.js', 'utf8')).toContain("from './pure/review-disp-linea.js'");
  });
});

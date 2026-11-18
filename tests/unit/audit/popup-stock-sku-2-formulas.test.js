// @ts-nocheck
/**
 * v1562 reparto-dep12 §E4.1 — Popup "Stock del SKU" con 2 fórmulas.
 *
 * Flag ON + transitoDep12 > 0 → 2 bloques (físico + tránsito), ambas
 * fórmulas cierran. Flag OFF o sin tránsito → compat §103 (1 bloque).
 */

import { describe, expect, it } from 'vitest';
import {
  renderPopupStockSkuPlainText,
  renderPopupStockSkuPlainTextMultiBlock,
} from '../../../src/pure/popup-stock-sku-lineas.js';

function breakdown(transitoDep12 = 3) {
  return {
    sku: 'SKU1',
    fisicoDep11: 10,
    transitoDep12,
    backorderApp: { total: 0, porCliente: [] },
    asignadas: { total: 2, totalFisico: 2, totalTransito: 0, porCliente: [], detalle: [] },
    confirmadasSinFacturar: {
      total: 3,
      totalFisico: 3,
      totalTransito: 0,
      porCliente: [],
    },
    waitlistCpst: { total: 0, porCliente: [] },
    repartoAbierto: { qty: 0, repartoId: null, status: null },
    reservadasTotal: 5,
    libre: 5,
    libreTransito: 3,
    utilizablePara: () => 5,
    pendienteReparto: { qty: 0, repartoId: null },
    _version: 8,
  };
}

describe('v1562 §E4.1 — popup multi-block', () => {
  it('T1: flag ON + transitoDep12=3 → 2 bloques', () => {
    const out = renderPopupStockSkuPlainTextMultiBlock(breakdown(3), {
      dep12FlagOn: true,
    });
    expect(out).toContain('━━━ Físico (en depósito) ━━━');
    expect(out).toContain('━━━ Tránsito (cruzando Uruguay, llega ~7 días) ━━━');
  });

  it('T2: flag ON + transitoDep12=0 → 1 bloque (compat §103)', () => {
    const b = breakdown(0);
    const out = renderPopupStockSkuPlainTextMultiBlock(b, { dep12FlagOn: true });
    const compat = renderPopupStockSkuPlainText(b);
    expect(out).toBe(compat);
    expect(out).not.toContain('━━━ Tránsito');
  });

  it('T3: flag OFF + transitoDep12=5 → 1 bloque', () => {
    const b = breakdown(5);
    const out = renderPopupStockSkuPlainTextMultiBlock(b, { dep12FlagOn: false });
    const compat = renderPopupStockSkuPlainText(b);
    expect(out).toBe(compat);
    expect(out).not.toContain('━━━ Tránsito');
  });

  it('T4: fórmula físico cierra (fisicoDep11 − asigFisico − confFisico = libre)', () => {
    const out = renderPopupStockSkuPlainTextMultiBlock(breakdown(3), {
      dep12FlagOn: true,
    });
    // fisico=10, asigFisico=2, confFisico=3, libre=5 → 10-2-3=5
    expect(out).toContain('Cuenta: 10 − 2 − 3 = 5');
  });

  it('T5: fórmula tránsito cierra (transitoDep12 − asigTransito − confTransito = libreTransito)', () => {
    const b = breakdown(3);
    // transito=3, asigTrans=0, confTrans=0, libreTrans=3 → 3-0-0=3
    const out = renderPopupStockSkuPlainTextMultiBlock(b, { dep12FlagOn: true });
    expect(out).toContain('Cuenta: 3 − 0 − 0 = 3');
  });

  it('T6: con asig+conf en tránsito, fórmula tránsito cierra a 1', () => {
    const b = breakdown(4);
    b.asignadas.totalTransito = 2;
    b.confirmadasSinFacturar.totalTransito = 1;
    b.libreTransito = 1;
    const out = renderPopupStockSkuPlainTextMultiBlock(b, { dep12FlagOn: true });
    expect(out).toContain('Cuenta: 4 − 2 − 1 = 1');
  });
});

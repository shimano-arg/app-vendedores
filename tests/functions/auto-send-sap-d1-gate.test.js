// @ts-check
/**
 * STACK S-4 T5 (D1 gate 2026-11-25) — buildQuotationPayload respeta flag
 * `deps.maxDiscountSalesRaised`.
 *
 * Contexto D1: SAP user APP_VENDEDORES tiene MaxDiscountSales=0 (documentado
 * desde v389). SAP rechaza cualquier DiscountPercent>0 con error 10000724.
 * Hasta que Santi destrabe D1, mandamos DiscountPercent:0 + "DESCUENTO
 * SOLICITADO: N%" en Comments.
 *
 * Tests:
 *   T1 maxDiscountSalesRaised=false (default): DiscountPercent=0 +
 *      Comments con "DESCUENTO SOLICITADO: N%".
 *   T2 maxDiscountSalesRaised=true: DiscountPercent=N + Comments SIN sufijo.
 *   T3 discountPct=0 (sin descuento): Comments sin sufijo, DiscountPercent=0
 *      (ambos modos iguales).
 */
import { describe, expect, it } from 'vitest';
import { buildQuotationPayload } from '../../functions/core/auto-send-sap-core.js';

function makeDeps(maxDiscountSalesRaised) {
  return {
    sapClients: new Map([['CLIENTE TEST', 'C001']]),
    sapProducts: new Map([['SKU-A', 'SKU-A']]),
    sapVendors: new Map([['VEND1', 42]]),
    appSeriesId: 103,
    dueDateDays: 30,
    now: () => new Date('2026-11-25T12:00:00Z').getTime(),
    maxDiscountSalesRaised,
  };
}

function pedidoWith(discountPct) {
  return {
    clientName: 'CLIENTE TEST',
    clientCardCode: 'C001',
    ownerVendor: 'VEND1',
    ownerEmail: 'v1@shimano.com.ar',
    condicionPago: 'CONTADO',
    discountPct,
    lines: [{ code: 'SKU-A', state: 'confirmed', qty: 10, precio: 10000 }],
    stage: 'confirmed',
    month: 'Noviembre 2026',
  };
}

describe('STACK S-4 T5 (D1 gate) — buildQuotationPayload maxDiscountSalesRaised', () => {
  it('T1 — maxDiscountSalesRaised=false: DiscountPercent=0 + "DESCUENTO SOLICITADO: N%" en Comments', () => {
    const r = buildQuotationPayload(pedidoWith(14), 'PEDIDO1', makeDeps(false), 'VEND1');
    expect(r.ok).toBe(true);
    expect(r.payload.DiscountPercent).toBe(0);
    expect(r.payload.Comments).toContain('DESCUENTO SOLICITADO: 14%');
  });

  it('T2 — maxDiscountSalesRaised=true: DiscountPercent=14 + Comments SIN sufijo', () => {
    const r = buildQuotationPayload(pedidoWith(14), 'PEDIDO2', makeDeps(true), 'VEND1');
    expect(r.ok).toBe(true);
    expect(r.payload.DiscountPercent).toBe(14);
    expect(r.payload.Comments).not.toContain('DESCUENTO SOLICITADO');
  });

  it('T3 — discountPct=0 (sin descuento): ambos modos devuelven Comments sin sufijo', () => {
    const rOff = buildQuotationPayload(pedidoWith(0), 'PEDIDO3', makeDeps(false), 'VEND1');
    const rOn = buildQuotationPayload(pedidoWith(0), 'PEDIDO4', makeDeps(true), 'VEND1');
    expect(rOff.payload.DiscountPercent).toBe(0);
    expect(rOn.payload.DiscountPercent).toBe(0);
    expect(rOff.payload.Comments).not.toContain('DESCUENTO SOLICITADO');
    expect(rOn.payload.Comments).not.toContain('DESCUENTO SOLICITADO');
  });

  it('T4 — maxDiscountSalesRaised=false + discountSnapshot.pctTotal como fallback: Comments muestra el pct del snapshot', () => {
    const pedido = {
      clientName: 'CLIENTE TEST',
      clientCardCode: 'C001',
      ownerVendor: 'VEND1',
      ownerEmail: 'v1@shimano.com.ar',
      condicionPago: 'CONTADO',
      // Sin discountPct flat, pero con snapshot.pctTotal
      discountSnapshot: { pctTotal: 6 },
      lines: [{ code: 'SKU-A', state: 'confirmed', qty: 10, precio: 10000 }],
      stage: 'confirmed',
      month: 'Noviembre 2026',
    };
    const r = buildQuotationPayload(pedido, 'PEDIDO5', makeDeps(false), 'VEND1');
    expect(r.ok).toBe(true);
    expect(r.payload.DiscountPercent).toBe(0);
    expect(r.payload.Comments).toContain('DESCUENTO SOLICITADO: 6%');
  });

  it('T5 — Comments respeta el límite de 254 chars de SAP', () => {
    const r = buildQuotationPayload(
      {
        clientName: 'X'.repeat(100),
        clientCardCode: 'C001',
        ownerVendor: 'VEND1',
        ownerEmail: 'extremely-long-email-address-to-fill-the-comments-buffer@shimano.com.ar',
        condicionPago: 'CONTADO',
        discountPct: 12,
        lines: [{ code: 'SKU-A', state: 'confirmed', qty: 10, precio: 10000 }],
        stage: 'confirmed',
        month: 'Noviembre 2026',
      },
      'PEDIDO6',
      makeDeps(false),
      'VEND1'
    );
    expect(r.ok).toBe(true);
    expect(r.payload.Comments.length).toBeLessThanOrEqual(254);
  });
});

// E3 reparto-dep12 §1: buildQuotationPayload skippea líneas enTransito
// cuando `deps.dep12Enabled === true`. Con flag OFF comportamiento histórico
// 100% (defensivo).
import { describe, expect, it } from 'vitest';
import { buildQuotationPayload } from '../../functions/core/auto-send-sap-core.js';

function makeDeps(dep12Enabled) {
  return {
    sapClients: new Map([['CLIENTE TEST', 'C001']]),
    sapProducts: new Map([
      ['SKU-FIS', 'SKU-FIS'],
      ['SKU-TRANS', 'SKU-TRANS'],
    ]),
    sapVendors: new Map([['VEND1', 42]]),
    appSeriesId: 103,
    dueDateDays: 30,
    now: () => new Date('2026-11-18T12:00:00Z').getTime(),
    dep12Enabled,
  };
}

function pedidoWith(lines, ownerVendor = 'VEND1') {
  return {
    clientName: 'CLIENTE TEST',
    clientCardCode: 'C001',
    ownerVendor,
    condicionPago: 'CONDICION',
    lines,
    stage: 'confirmed',
    month: '2026-11',
  };
}

describe('E3 §1 buildQuotationPayload skip enTransito', () => {
  it('flag ON + línea enTransito + línea física → envía solo la física', () => {
    const r = buildQuotationPayload(
      pedidoWith([
        { code: 'SKU-FIS', state: 'confirmed', qty: 3 },
        { code: 'SKU-TRANS', state: 'confirmed', qty: 2, enTransito: true },
      ]),
      'PEDIDO1',
      makeDeps(true),
      'VEND1'
    );
    expect(r.ok).toBe(true);
    expect(r.linesCount).toBe(1);
    expect(r.transitoSkipped).toBe(1); // contador de LÍNEAS enTransito skippeadas (no unidades)
    expect(r.payload.DocumentLines).toHaveLength(1);
    expect(r.payload.DocumentLines[0].ItemCode).toBe('SKU-FIS');
  });

  it('flag ON + TODAS enTransito → ok:false reason=all_transito', () => {
    const r = buildQuotationPayload(
      pedidoWith([{ code: 'SKU-TRANS', state: 'confirmed', qty: 5, enTransito: true }]),
      'PEDIDO2',
      makeDeps(true),
      'VEND1'
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('all_transito');
    expect(r.transitoSkipped).toBe(1);
  });

  it('flag OFF + línea enTransito → se envía igual (comportamiento histórico)', () => {
    const r = buildQuotationPayload(
      pedidoWith([{ code: 'SKU-TRANS', state: 'confirmed', qty: 2, enTransito: true }]),
      'PEDIDO3',
      makeDeps(false),
      'VEND1'
    );
    expect(r.ok).toBe(true);
    expect(r.linesCount).toBe(1);
    expect(r.transitoSkipped).toBe(0);
  });

  it('flag ON + línea BO enTransito → ya filtrada por state!=confirmed (sin cambio)', () => {
    const r = buildQuotationPayload(
      pedidoWith([
        { code: 'SKU-FIS', state: 'confirmed', qty: 3 },
        { code: 'SKU-TRANS', state: 'BO', qty: 2, enTransito: true },
      ]),
      'PEDIDO4',
      makeDeps(true),
      'VEND1'
    );
    expect(r.ok).toBe(true);
    expect(r.linesCount).toBe(1);
    expect(r.transitoSkipped).toBe(0);
  });

  it('flag ON + todas físicas → payload normal', () => {
    const r = buildQuotationPayload(
      pedidoWith([
        { code: 'SKU-FIS', state: 'confirmed', qty: 3 },
        { code: 'SKU-TRANS', state: 'confirmed', qty: 2, enTransito: false },
      ]),
      'PEDIDO5',
      makeDeps(true),
      'VEND1'
    );
    expect(r.ok).toBe(true);
    expect(r.linesCount).toBe(2);
    expect(r.transitoSkipped).toBe(0);
  });

  it('deps sin dep12Enabled (undefined) → comportamiento histórico', () => {
    const r = buildQuotationPayload(
      pedidoWith([{ code: 'SKU-TRANS', state: 'confirmed', qty: 2, enTransito: true }]),
      'PEDIDO6',
      {
        sapClients: new Map([['CLIENTE TEST', 'C001']]),
        sapProducts: new Map([['SKU-TRANS', 'SKU-TRANS']]),
        sapVendors: new Map([['VEND1', 42]]),
        appSeriesId: 103,
        dueDateDays: 30,
        now: () => 1763472000000,
      },
      'VEND1'
    );
    expect(r.ok).toBe(true);
    expect(r.linesCount).toBe(1);
    expect(r.transitoSkipped).toBe(0);
  });
});

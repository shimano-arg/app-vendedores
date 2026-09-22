import { describe, expect, it } from 'vitest';
import { buildEmailContent, computeTotalArs, shouldNotify } from '../../functions/core/notify-quotation-sent-core.js';

// v1034 (2026-09-22): unit tests para el trigger onQuotationSentNotify (santiago.beron@shimano.uy).
// El bug reportado: el email siempre llegaba con total vacio porque el CF leia
// `pedido.totalAmountArs`, campo que en Firestore prod NO existe en los pedidos que
// se envian a SAP — el schema real es `netAmountArs` (mayoria) o `subtotalArs`.

describe('computeTotalArs — precedencia de fields del schema real', () => {
  it('usa totalAmountArs si esta presente (legacy path)', () => {
    expect(computeTotalArs({ totalAmountArs: 100000, netAmountArs: 999 })).toBe(100000);
  });

  it('cae a netAmountArs (schema mas comun en pedidos con docNum)', () => {
    expect(computeTotalArs({ netAmountArs: 23403800 })).toBe(23403800);
  });

  it('cae a subtotalArs si no hay net', () => {
    expect(computeTotalArs({ subtotalArs: 12345 })).toBe(12345);
  });

  it('respeta legacy total/totalARS', () => {
    expect(computeTotalArs({ total: 555 })).toBe(555);
    expect(computeTotalArs({ totalARS: 777 })).toBe(777);
  });

  it('computa desde lines[] cuando no hay ningun total', () => {
    const pedido = {
      lines: [
        { qty: 2, precio: 100 },
        { qty: 3, priceAtCreation: 50 },
        { qty: 1, price: 25 },
      ],
    };
    expect(computeTotalArs(pedido)).toBe(2 * 100 + 3 * 50 + 1 * 25);
  });

  it('ignora lineas sin qty o sin precio', () => {
    const pedido = {
      lines: [
        { qty: 2, precio: 100 },
        { qty: 0, precio: 100 }, // qty 0 → ignora
        { qty: 5 }, // sin precio → ignora
        null,
      ],
    };
    expect(computeTotalArs(pedido)).toBe(200);
  });

  it('devuelve null si no hay total ni lines utilizables', () => {
    expect(computeTotalArs({})).toBeNull();
    expect(computeTotalArs({ lines: [] })).toBeNull();
    expect(computeTotalArs({ lines: [{ qty: 0 }] })).toBeNull();
    expect(computeTotalArs(null)).toBeNull();
  });
});

describe('buildEmailContent — total renderizado con schema real', () => {
  const baseTs = { docNum: 12345, docEntry: 999, transferredAt: '2026-09-22T12:00:00Z' };

  it('renderiza netAmountArs formateado en $ ARS (case pedido #208 real)', () => {
    const pedido = {
      clientName: 'CLIENTE X',
      transferidoSAP: baseTs,
      netAmountArs: 23403800,
      lines: [{ code: 'X' }],
    };
    const { text, html } = buildEmailContent('ped-abc', pedido);
    expect(text).toContain('Total ARS: $23.403.800');
    expect(html).toContain('$23.403.800');
  });

  it('renderiza subtotalArs cuando no hay net', () => {
    const pedido = { transferidoSAP: baseTs, subtotalArs: 828000, lines: [] };
    const { text } = buildEmailContent('id', pedido);
    expect(text).toContain('Total ARS: $828.000');
  });

  it('computa desde lines cuando el pedido no tiene total', () => {
    const pedido = {
      transferidoSAP: baseTs,
      lines: [
        { qty: 6, priceAtCreation: 21000 }, // 126000
        { qty: 2, precio: 5000 }, // 10000
      ],
    };
    const { text } = buildEmailContent('id', pedido);
    expect(text).toContain('Total ARS: $136.000');
  });

  it('muestra "-" cuando no hay ningun dato de total (caso extremo)', () => {
    const pedido = { transferidoSAP: baseTs };
    const { text } = buildEmailContent('id', pedido);
    expect(text).toContain('Total ARS: -');
  });

  // Regression guard v1034: si el CF vuelve a leer solo totalAmountArs,
  // este test falla en los pedidos reales (que usan netAmountArs).
  it('NO regresa a leer solo totalAmountArs (bug v1033-and-prior)', () => {
    const pedido = { transferidoSAP: baseTs, netAmountArs: 500000 };
    const { text } = buildEmailContent('id', pedido);
    expect(text).not.toContain('Total ARS: -');
    expect(text).toContain('$500.000');
  });
});

describe('shouldNotify — sanity (sin cambios en v1034)', () => {
  it('dispara cuando docNum aparece por primera vez via service_layer_auto', () => {
    const before = { transferidoSAP: {} };
    const after = { transferidoSAP: { docNum: 1, via: 'service_layer_auto' } };
    expect(shouldNotify(before, after)).toBe(true);
  });
  it('no dispara para via=cf_auto', () => {
    const after = { transferidoSAP: { docNum: 1, via: 'cf_auto' } };
    expect(shouldNotify({}, after)).toBe(false);
  });
  it('no dispara si el pedido fue borrado (after=null)', () => {
    expect(shouldNotify({ transferidoSAP: {} }, null)).toBe(false);
  });
});

// @ts-check
/**
 * v1416 §42.2 (2026-10-22) — tests del pure helper review-guard-unify.
 */
import { describe, expect, it } from 'vitest';
import {
  buildUnifiedAtReviewUpdate,
  formatUnifyConfirmMessage,
  mergeWaitlistIntoOrderLines,
} from '../../src/pure/review-guard-unify.js';

const CARD_PONTORIERO = 'C20175569635';

function makeWaitlist524() {
  return {
    _id: 'wl-524',
    orderNumber: 524,
    clientCardCode: CARD_PONTORIERO,
    createdAt: '2026-10-22T15:53:00Z',
    items: Array.from({ length: 29 }, (_, i) => ({
      code: 'SKU-524-' + i,
      qty: 6,
      precio: 10000 + i * 100,
      desc: 'desc 524-' + i,
      origen: 'stock-asignado',
      asigRefs: [{ pedidoId: 'ped-origen-A', lineIndex: i, qtyAsignada: 6 }],
    })),
  };
}

function makeWaitlist526() {
  return {
    _id: 'wl-526',
    orderNumber: 526,
    clientCardCode: CARD_PONTORIERO,
    createdAt: '2026-10-22T16:38:00Z',
    items: [
      {
        code: 'SKU-526-A',
        qty: 3,
        precio: 20000,
        desc: 'desc 526-A',
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-origen-B', lineIndex: 0, qtyAsignada: 3 }],
      },
      {
        code: 'SKU-526-B',
        qty: 3,
        precio: 25000,
        desc: 'desc 526-B',
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-origen-B', lineIndex: 1, qtyAsignada: 3 }],
      },
    ],
  };
}

describe('mergeWaitlistIntoOrderLines', () => {
  it('mergea 29 líneas de la 524 al pedido actual + preserva origen+asigRefs+importedFromOrder', () => {
    const ord = [{ code: 'SKU-ACTUAL', qty: 1, precio: 5000, desc: 'actual' }];
    const target = makeWaitlist524();
    const res = mergeWaitlistIntoOrderLines(ord, target);
    expect(res.added).toBe(29);
    expect(res.totalUnidades).toBe(29 * 6);
    expect(ord).toHaveLength(1 + 29);
    expect(ord[0].code).toBe('SKU-ACTUAL'); // la línea original queda
    const first = ord[1];
    expect(first.code).toBe('SKU-524-0');
    expect(first.qty).toBe(6);
    expect(first.origen).toBe('stock-asignado');
    expect(first.asigRefs).toEqual([{ pedidoId: 'ped-origen-A', lineIndex: 0, qtyAsignada: 6 }]);
    expect(first.importedFromOrder).toBe(524);
    expect(first._unifiedFromWaitlistId).toBe('wl-524');
  });

  it('salta items sin code o con qty <= 0', () => {
    const ord = [];
    const w = {
      _id: 'wl-x',
      orderNumber: 1,
      items: [{ code: '', qty: 1 }, { code: 'ONLY', qty: 0 }, { code: 'OK', qty: 2 }, null],
    };
    const res = mergeWaitlistIntoOrderLines(ord, w);
    expect(res.added).toBe(1);
    expect(res.totalUnidades).toBe(2);
    expect(ord).toHaveLength(1);
    expect(ord[0].code).toBe('OK');
  });

  it('waitlist vacío → no agrega nada', () => {
    const ord = [{ code: 'A', qty: 1 }];
    const w = { _id: 'wl-empty', orderNumber: 99, items: [] };
    const res = mergeWaitlistIntoOrderLines(ord, w);
    expect(res.added).toBe(0);
    expect(ord).toHaveLength(1);
  });

  it('waitlist sin items[] → no rompe', () => {
    const ord = [];
    const res1 = mergeWaitlistIntoOrderLines(ord, { _id: 'wl', orderNumber: 1 });
    expect(res1.added).toBe(0);
    const res2 = mergeWaitlistIntoOrderLines(ord, {});
    expect(res2.added).toBe(0);
    const res3 = mergeWaitlistIntoOrderLines(ord, null);
    expect(res3.added).toBe(0);
  });

  it('ord no-array → throw', () => {
    expect(() => mergeWaitlistIntoOrderLines(null, makeWaitlist526())).toThrow(/debe ser array/);
    expect(() => mergeWaitlistIntoOrderLines({}, makeWaitlist526())).toThrow(/debe ser array/);
  });

  it('línea sin asigRefs → preserva null (no quiebra el bloque v1280/§33)', () => {
    const ord = [];
    const w = {
      _id: 'wl-sin-refs',
      orderNumber: 100,
      items: [{ code: 'X', qty: 1, origen: null, asigRefs: null }],
    };
    mergeWaitlistIntoOrderLines(ord, w);
    expect(ord[0].origen).toBe(null);
    expect(ord[0].asigRefs).toBe(null);
    expect(ord[0].importedFromOrder).toBe(100);
  });
});

describe('buildUnifiedAtReviewUpdate', () => {
  it('devuelve payload con stage=consumed + closedReason unified_at_review', () => {
    const p = buildUnifiedAtReviewUpdate('mariano@shimano', '2026-10-22T20:00:00Z');
    expect(p).toEqual({
      stage: 'consumed',
      closedAt: '2026-10-22T20:00:00Z',
      closedReason: 'unified_at_review',
      unifiedIntoCurrentOrder: true,
      unifiedAt: '2026-10-22T20:00:00Z',
      unifiedBy: 'mariano@shimano',
    });
  });

  it('unifiedBy vacío cuando no hay user', () => {
    const p = buildUnifiedAtReviewUpdate(null, '2026-10-22T20:00:00Z');
    expect(p.unifiedBy).toBe('');
    const p2 = buildUnifiedAtReviewUpdate(undefined, '2026-10-22T20:00:00Z');
    expect(p2.unifiedBy).toBe('');
  });
});

describe('formatUnifyConfirmMessage', () => {
  it('menciona el orderNumber + cantidad SKU + unidades', () => {
    const msg = formatUnifyConfirmMessage(makeWaitlist524());
    expect(msg).toContain('ORDEN 524');
    expect(msg).toContain('29 linea');
    expect(msg).toContain('174 u'); // 29 × 6
    expect(msg).toMatch(/OK.*=.*Unificar/i);
    expect(msg).toMatch(/Cancelar.*=.*Volver a editar/i);
  });

  it('waitlist sin orderNumber → fallback texto genérico', () => {
    const w = { _id: 'wl', items: [{ code: 'X', qty: 1 }] };
    const msg = formatUnifyConfirmMessage(w);
    expect(msg).toContain('la orden abierta');
    expect(msg).toContain('1 u');
  });

  it('waitlist vacío → 0 líneas, 0 u', () => {
    const msg = formatUnifyConfirmMessage({ _id: 'wl', orderNumber: 1, items: [] });
    expect(msg).toContain('ORDEN 1');
    expect(msg).toContain('0 linea');
    expect(msg).toContain('0 u');
  });
});

describe('v1416 §42.2 caso real PONTORIERO 526 absorbe 524 al review', () => {
  it('merge 29 líneas (524) + 2 líneas iniciales del VDE (como pedido B pre-526) = 31 líneas al pedido actual', () => {
    // Escenario Mariano 22/10:
    // - VDE arma pedido B (que después quedó como waitlist 526 — 2 SKU, 6 u).
    // - "Pasar a Pendientes" → el guard §42.2 encuentra la 524 abierta y ofrece unificar.
    // - OK → absorbe las 29 líneas de la 524 al ord[] actual.
    const ordActual = [
      {
        code: 'SKU-526-A',
        qty: 3,
        precio: 20000,
        desc: 'desc 526-A',
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-origen-B', lineIndex: 0, qtyAsignada: 3 }],
      },
      {
        code: 'SKU-526-B',
        qty: 3,
        precio: 25000,
        desc: 'desc 526-B',
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-origen-B', lineIndex: 1, qtyAsignada: 3 }],
      },
    ];
    const target = makeWaitlist524();
    const res = mergeWaitlistIntoOrderLines(ordActual, target);
    expect(res.added).toBe(29);
    expect(res.totalUnidades).toBe(174);
    expect(ordActual).toHaveLength(31);
    // Pedido B queda con 31 líneas; al confirmar + transferir a SAP, el bloque
    // v1280/§33 ejecuta `_origenesACancelar` con `line.asigRefs` de las 29 (que
    // apuntan a ped-origen-A) + las 2 (que apuntan a ped-origen-B) = las 31 ASIG
    // originales se cancelan atómicamente.
    const totalAsigRefs = ordActual.reduce(
      (sum, l) => sum + (Array.isArray(l.asigRefs) ? l.asigRefs.length : 0),
      0
    );
    expect(totalAsigRefs).toBe(31);
    // Fuentes:
    expect(ordActual[0].importedFromOrder).toBeUndefined(); // 526-A es del ord[] actual
    expect(ordActual[2].importedFromOrder).toBe(524); // primera línea importada
  });
});

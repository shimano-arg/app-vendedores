// @ts-check
/**
 * Tests para computeStaleLineClosure (functions/core/close-stale-lines-on-cobrado-core.js).
 * Precedente bug CUDC201XG 2026-10-19 (ver header del core).
 */
import { describe, expect, it } from 'vitest';
import { computeStaleLineClosure } from '../../functions/core/close-stale-lines-on-cobrado-core.js';

const FIXED_ISO = '2026-10-19T18:00:00.000Z';

describe('computeStaleLineClosure — guards (no-op defensivos)', () => {
  it('pedido null → no-op', () => {
    expect(computeStaleLineClosure(null)).toEqual({ closedLines: [], newLines: null });
  });
  it('pedido undefined → no-op', () => {
    expect(computeStaleLineClosure(undefined)).toEqual({ closedLines: [], newLines: null });
  });
  it('pedido vacio → no-op', () => {
    expect(computeStaleLineClosure({})).toEqual({ closedLines: [], newLines: null });
  });
  it('paidStatus undefined → no-op (no corremos si no hay señal de cobro)', () => {
    const p = { lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }] };
    expect(computeStaleLineClosure(p)).toEqual({ closedLines: [], newLines: null });
  });
  it('paidStatus=partial → no-op (todavia hay invoices pendientes, no es seguro)', () => {
    const p = { paidStatus: 'partial', lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }] };
    expect(computeStaleLineClosure(p)).toEqual({ closedLines: [], newLines: null });
  });
  it('paidStatus=paid pero sin lines → no-op', () => {
    expect(computeStaleLineClosure({ paidStatus: 'paid' })).toEqual({
      closedLines: [],
      newLines: null,
    });
  });
  it('paidStatus=paid con lines vacio → no-op', () => {
    expect(computeStaleLineClosure({ paidStatus: 'paid', lines: [] })).toEqual({
      closedLines: [],
      newLines: null,
    });
  });
  it('paidStatus=paid con lines no-array → no-op', () => {
    // @ts-expect-error forzamos input invalido
    expect(computeStaleLineClosure({ paidStatus: 'paid', lines: 'nope' })).toEqual({
      closedLines: [],
      newLines: null,
    });
  });
});

describe('computeStaleLineClosure — states NO cerrables', () => {
  const cases = [
    { state: 'BO', why: 'BO = backorder legitimo, SAP SQ sigue abierta' },
    { state: 'invoiced', why: 'ya cerrada' },
    { state: 'cancelled', why: 'ya cerrada manualmente' },
    { state: 'recycled', why: 'reciclada a otro pedido' },
    { state: 'legacy', why: 'pre-migracion, intocable' },
    { state: 'closed_stale', why: 'ya cerrada por este mismo helper (idempotencia)' },
  ];
  cases.forEach(({ state, why }) => {
    it(`paidStatus=paid + state=${state} qtyOpen>0 → NO cierra (${why})`, () => {
      const p = {
        paidStatus: 'paid',
        lines: [{ code: 'X', state, qtyOpen: 5, qty: 5, qtyCancelled: 0 }],
      };
      expect(computeStaleLineClosure(p)).toEqual({ closedLines: [], newLines: null });
    });
  });
});

describe('computeStaleLineClosure — cerraduras validas', () => {
  it('paidStatus=paid + state=confirmed qtyOpen=3 → cierra, qtyCancelled suma', () => {
    const p = {
      paidStatus: 'paid',
      lines: [{ code: 'CUDC201XG', state: 'confirmed', qty: 3, qtyOpen: 3, qtyCancelled: 0 }],
    };
    const r = computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(r.closedLines).toHaveLength(1);
    expect(r.closedLines[0]).toEqual({
      idx: 0,
      code: 'CUDC201XG',
      state: 'confirmed',
      qtyClosed: 3,
    });
    expect(r.newLines).not.toBeNull();
    expect(r.newLines[0]).toEqual({
      code: 'CUDC201XG',
      state: 'closed_stale',
      qty: 3,
      qtyOpen: 0,
      qtyCancelled: 3,
      closedStaleAt: FIXED_ISO,
      closedStaleReason: 'pedido_paid_full_line_stale',
    });
  });

  it('paidStatus=paid + state=ASIG qtyOpen=2 → cierra con suma de qtyCancelled previo', () => {
    const p = {
      paidStatus: 'paid',
      lines: [{ code: 'X', state: 'ASIG', qty: 5, qtyOpen: 2, qtyCancelled: 3 }],
    };
    const r = computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(r.newLines[0].qtyCancelled).toBe(5);
    expect(r.newLines[0].qtyOpen).toBe(0);
    expect(r.newLines[0].state).toBe('closed_stale');
  });

  it('FATECHI case: qty=6 qtyInvoiced=3 qtyOpen=3 state=confirmed → cierra las 3', () => {
    const p = {
      paidStatus: 'paid',
      lines: [
        {
          code: 'CUDC201XG',
          state: 'confirmed',
          qty: 6,
          qtyInvoiced: 3,
          qtyOpen: 3,
          qtyCancelled: 0,
          qtyRecycled: 0,
        },
      ],
    };
    const r = computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(r.closedLines[0].qtyClosed).toBe(3);
    expect(r.newLines[0].qty).toBe(6); // qty original preservada
    expect(r.newLines[0].qtyInvoiced).toBe(3); // facturadas preservadas
    expect(r.newLines[0].qtyOpen).toBe(0);
    expect(r.newLines[0].qtyCancelled).toBe(3); // 0 + 3
    // Invariante: qty = qtyInvoiced + qtyOpen + qtyCancelled + qtyRecycled
    const inv =
      r.newLines[0].qtyInvoiced +
      r.newLines[0].qtyOpen +
      r.newLines[0].qtyCancelled +
      r.newLines[0].qtyRecycled;
    expect(inv).toBe(r.newLines[0].qty);
  });

  it('mix de lineas: solo las confirmed/ASIG abiertas se cierran, resto intacto', () => {
    const p = {
      paidStatus: 'paid',
      lines: [
        { code: 'A', state: 'BO', qtyOpen: 10, qtyCancelled: 0 },
        { code: 'B', state: 'confirmed', qty: 2, qtyOpen: 2, qtyCancelled: 0 },
        { code: 'C', state: 'invoiced', qty: 5, qtyOpen: 0, qtyInvoiced: 5, qtyCancelled: 0 },
        { code: 'D', state: 'ASIG', qty: 1, qtyOpen: 1, qtyCancelled: 0 },
        { code: 'E', state: 'confirmed', qty: 4, qtyOpen: 0, qtyCancelled: 4 }, // ya cerrada
      ],
    };
    const r = computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(r.closedLines).toHaveLength(2);
    expect(r.closedLines.map((c) => c.code).sort()).toEqual(['B', 'D']);
    // Linea A (BO) no se toca
    expect(r.newLines[0].state).toBe('BO');
    expect(r.newLines[0].qtyOpen).toBe(10);
    // Linea C (invoiced) no se toca
    expect(r.newLines[2].state).toBe('invoiced');
    // Linea E (ya cerrada) no se toca
    expect(r.newLines[4].state).toBe('confirmed');
    expect(r.newLines[4].qtyOpen).toBe(0);
  });
});

describe('computeStaleLineClosure — idempotencia + edge cases', () => {
  it('todo ya cerrado → no-op segunda corrida (newLines=null)', () => {
    const p1 = {
      paidStatus: 'paid',
      lines: [{ code: 'X', state: 'confirmed', qty: 3, qtyOpen: 3, qtyCancelled: 0 }],
    };
    const r1 = computeStaleLineClosure(p1, { nowIso: FIXED_ISO });
    expect(r1.newLines).not.toBeNull();
    // Simulamos re-aplicacion
    const p2 = { paidStatus: 'paid', lines: r1.newLines };
    const r2 = computeStaleLineClosure(p2, { nowIso: FIXED_ISO });
    expect(r2).toEqual({ closedLines: [], newLines: null });
  });

  it('qtyOpen=0 en state=confirmed → no-op (nada que cerrar)', () => {
    const p = {
      paidStatus: 'paid',
      lines: [
        { code: 'X', state: 'confirmed', qty: 5, qtyOpen: 0, qtyInvoiced: 5, qtyCancelled: 0 },
      ],
    };
    expect(computeStaleLineClosure(p)).toEqual({ closedLines: [], newLines: null });
  });

  it('qtyOpen negativo (dato sucio) → no-op (no cerramos negativos)', () => {
    const p = {
      paidStatus: 'paid',
      lines: [{ code: 'X', state: 'confirmed', qtyOpen: -2, qtyCancelled: 0 }],
    };
    expect(computeStaleLineClosure(p)).toEqual({ closedLines: [], newLines: null });
  });

  it('qtyOpen como string (dato sucio) → convierte con Number, cierra si >0', () => {
    const p = {
      paidStatus: 'paid',
      // @ts-expect-error forzamos dato sucio
      lines: [{ code: 'X', state: 'confirmed', qty: 2, qtyOpen: '2', qtyCancelled: 0 }],
    };
    const r = computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(r.closedLines[0].qtyClosed).toBe(2);
    expect(r.newLines[0].qtyCancelled).toBe(2);
  });

  it('line null en array → preserva null, no choca', () => {
    const p = {
      paidStatus: 'paid',
      lines: [
        null,
        { code: 'X', state: 'confirmed', qty: 1, qtyOpen: 1, qtyCancelled: 0 },
        undefined,
      ],
    };
    const r = computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(r.closedLines).toHaveLength(1);
    expect(r.closedLines[0].idx).toBe(1);
    expect(r.newLines[0]).toBeNull();
    expect(r.newLines[2]).toBeUndefined();
  });

  it('sin opts → genera nowIso real (ISO parseable)', () => {
    const p = {
      paidStatus: 'paid',
      lines: [{ code: 'X', state: 'confirmed', qty: 1, qtyOpen: 1, qtyCancelled: 0 }],
    };
    const r = computeStaleLineClosure(p);
    expect(r.newLines[0].closedStaleAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(r.newLines[0].closedStaleAt).toString()).not.toBe('Invalid Date');
  });

  it('line sin code (dato sucio) → closedLines.code = null', () => {
    const p = {
      paidStatus: 'paid',
      lines: [{ state: 'confirmed', qty: 1, qtyOpen: 1, qtyCancelled: 0 }],
    };
    const r = computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(r.closedLines[0].code).toBeNull();
  });
});

describe('computeStaleLineClosure — no muta input (pureza)', () => {
  it('no modifica el array lines original', () => {
    const originalLine = { code: 'X', state: 'confirmed', qty: 3, qtyOpen: 3, qtyCancelled: 0 };
    const lines = [originalLine];
    const p = { paidStatus: 'paid', lines };
    computeStaleLineClosure(p, { nowIso: FIXED_ISO });
    expect(originalLine.qtyOpen).toBe(3);
    expect(originalLine.state).toBe('confirmed');
    expect(originalLine.qtyCancelled).toBe(0);
  });
});

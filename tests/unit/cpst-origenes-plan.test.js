// v1520 (2026-10-29) — Pre-flight CPST tolerante a ASIG huérfanas.
// Caso real: REBORN SRL (C30710852762) CLC66H2PY, pedido 8lGQkjUJfZwqsfnNw4iw.
// El pedido tenía una línea ASIG zombie (qty=0, qtyOpen=0, dejada por
// revertSobreAsignadas con entregable 0) ANTES de la línea ASIG viva con 2u.
// El pre-flight viejo hacía findIndex por code+state, caía en la zombie y
// bloqueaba todo el pedido ("faltaron 2u").
import { describe, expect, it } from 'vitest';
import { formatAsigHuerfanaAviso, planCpstOrigenes } from '../../src/pure/cpst-origenes-plan.js';

const PID = '8lGQkjUJfZwqsfnNw4iw';

function pedidoReborn() {
  return {
    _fsId: PID,
    lines: [
      { code: 'TRX301B', state: 'ASIG', qty: 1, qtyOpen: 1 },
      // zombie: dejada por revertSobreAsignadas (entregable 0)
      { code: 'CLC66H2PY', state: 'ASIG', qty: 0, qtyOpen: 0 },
      { code: 'CLC66H2PY', state: 'BO', qty: 3, qtyOpen: 1 },
      // viva: asignada por reparto posterior
      { code: 'CLC66H2PY', state: 'ASIG', qty: 2, qtyOpen: 2, asigFromReparto: 'ing1' },
    ],
  };
}

describe('planCpstOrigenes', () => {
  it('T1 REBORN: usa entry.lineIndex y salta la zombie anterior → sin huérfanas', () => {
    const skus = [
      {
        sku: 'CLC66H2PY',
        qtyAjustada: 2,
        entries: [{ pedidoId: PID, lineIndex: 3, qty: 2, state: 'ASIG' }],
      },
      {
        sku: 'TRX301B',
        qtyAjustada: 1,
        entries: [{ pedidoId: PID, lineIndex: 0, qty: 1, state: 'ASIG' }],
      },
    ];
    const r = planCpstOrigenes(skus, new Map([[PID, pedidoReborn()]]));
    expect(r.huerfanas).toEqual([]);
    expect(r.pedidosOrigenes).toEqual([
      { pedidoId: PID, lineIndex: 3, sku: 'CLC66H2PY', qtyAsignada: 2 },
      { pedidoId: PID, lineIndex: 0, sku: 'TRX301B', qtyAsignada: 1 },
    ]);
    expect(r.cubiertoPorSku).toEqual({ CLC66H2PY: 2, TRX301B: 1 });
  });

  it('T2 entry sin lineIndex (cache legacy): busca la primera ASIG con qtyOpen>0, no la zombie', () => {
    const skus = [
      { sku: 'CLC66H2PY', qtyAjustada: 2, entries: [{ pedidoId: PID, qty: 2, state: 'ASIG' }] },
    ];
    const r = planCpstOrigenes(skus, new Map([[PID, pedidoReborn()]]));
    expect(r.huerfanas).toEqual([]);
    expect(r.pedidosOrigenes[0].lineIndex).toBe(3);
  });

  it('T3 huérfana real: la única ASIG del SKU tiene qtyOpen=0 → se omite, el resto sigue', () => {
    const ped = pedidoReborn();
    ped.lines[3] = { code: 'CLC66H2PY', state: 'BO', qty: 2, qtyOpen: 2 }; // ya no hay ASIG viva
    const skus = [
      {
        sku: 'CLC66H2PY',
        qtyAjustada: 2,
        entries: [{ pedidoId: PID, lineIndex: 1, qty: 2, state: 'ASIG' }],
      },
      {
        sku: 'TRX301B',
        qtyAjustada: 1,
        entries: [{ pedidoId: PID, lineIndex: 0, qty: 1, state: 'ASIG' }],
      },
    ];
    const r = planCpstOrigenes(skus, new Map([[PID, ped]]));
    expect(r.cubiertoPorSku).toEqual({ CLC66H2PY: 0, TRX301B: 1 });
    expect(r.pedidosOrigenes).toHaveLength(1);
    expect(r.faltantePorSku).toEqual({ CLC66H2PY: 2 });
    expect(r.huerfanas).toHaveLength(1);
    expect(r.huerfanas[0]).toMatchObject({
      sku: 'CLC66H2PY',
      pedidoId: PID,
      lineIndex: 1,
      motivo: 'qtyOpen_cero',
      lineState: 'ASIG',
      lineQtyOpen: 0,
      qtyEsperada: 2,
    });
  });

  it('T4 cobertura parcial: ASIG viva con menos qtyOpen que la entry → cubre lo que hay', () => {
    const ped = pedidoReborn();
    ped.lines[3].qtyOpen = 1;
    const skus = [
      {
        sku: 'CLC66H2PY',
        qtyAjustada: 2,
        entries: [{ pedidoId: PID, lineIndex: 3, qty: 2, state: 'ASIG' }],
      },
    ];
    const r = planCpstOrigenes(skus, new Map([[PID, ped]]));
    expect(r.cubiertoPorSku.CLC66H2PY).toBe(1);
    expect(r.faltantePorSku).toEqual({ CLC66H2PY: 1 });
  });

  it('T5 pedido no encontrado → huérfana con motivo pedido_no_encontrado', () => {
    const skus = [
      {
        sku: 'X1',
        qtyAjustada: 1,
        entries: [{ pedidoId: 'nope', lineIndex: 0, qty: 1, state: 'ASIG' }],
      },
    ];
    const r = planCpstOrigenes(skus, new Map());
    expect(r.huerfanas[0].motivo).toBe('pedido_no_encontrado');
    expect(r.faltantePorSku).toEqual({ X1: 1 });
  });

  it('T6 no usa dos veces la misma línea para dos entries del mismo pedido', () => {
    const ped = { _fsId: 'p', lines: [{ code: 'A', state: 'ASIG', qty: 1, qtyOpen: 1 }] };
    const skus = [
      {
        sku: 'A',
        qtyAjustada: 2,
        entries: [
          { pedidoId: 'p', qty: 1, state: 'ASIG' },
          { pedidoId: 'p', qty: 1, state: 'ASIG' },
        ],
      },
    ];
    const r = planCpstOrigenes(skus, new Map([['p', ped]]));
    expect(r.pedidosOrigenes).toHaveLength(1);
    expect(r.faltantePorSku).toEqual({ A: 1 });
  });

  it('T7 lineIndex apunta a otro SKU → fallback por búsqueda', () => {
    const skus = [
      {
        sku: 'CLC66H2PY',
        qtyAjustada: 2,
        entries: [{ pedidoId: PID, lineIndex: 0, qty: 2, state: 'ASIG' }],
      },
    ];
    const r = planCpstOrigenes(skus, new Map([[PID, pedidoReborn()]]));
    expect(r.pedidosOrigenes[0].lineIndex).toBe(3);
  });

  it('T8 qtyAjustada=0 no genera nada', () => {
    const r = planCpstOrigenes([{ sku: 'A', qtyAjustada: 0, entries: [] }], new Map());
    expect(r).toMatchObject({ pedidosOrigenes: [], huerfanas: [], faltantePorSku: {} });
  });
});

describe('formatAsigHuerfanaAviso', () => {
  it('texto simple por producto, sin jerga', () => {
    const t = formatAsigHuerfanaAviso({ CLC66H2PY: 2, TRX301B: 1 });
    expect(t).toContain('2 unidades de CLC66H2PY ya no están disponibles, avisale a Mariano.');
    expect(t).toContain('1 unidad de TRX301B ya no está disponible, avisale a Mariano.');
    for (const w of ['SKU', 'qtyOpen', 'ASIG', 'huerfan', 'Firestore', 'undefined']) {
      expect(t).not.toContain(w);
    }
  });
  it('vacío si no hay faltantes', () => {
    expect(formatAsigHuerfanaAviso({})).toBe('');
  });
});

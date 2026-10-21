// @ts-check
/**
 * v1397 §40.5 — computeCpstRevertPlan: plan de reversión ASIG → BO.
 *
 * Casos del pedido Mariano 2026-10-21:
 *   T1: ASIG 3 y físico 0 → revert_full 3 a BO, no crea pedido.
 *   T2: ASIG 6 y físico 2 → split qtyKeep=2 qtyRevert=4.
 *   T3: 2 ASIGs (3+3), entregable 4 → entry1 keep 3, entry2 split qtyKeep=1 qtyRevert=2.
 *   T4: idempotencia.
 */
import { describe, expect, it } from 'vitest';
import { computeCpstRevertPlan, sumRevertUnits } from '../../src/pure/cpst-revert-plan.js';

describe('v1397 §40.5 computeCpstRevertPlan', () => {
  it('T1 ASIG 3 + entregable 0 → revert_full 3 a BO', () => {
    const plan = computeCpstRevertPlan([{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 3 }], 0);
    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe('revert_full');
    expect(plan[0].qtyKeep).toBe(0);
    expect(plan[0].qtyRevert).toBe(3);
    expect(sumRevertUnits(plan)).toBe(3);
  });

  it('T2 ASIG 6 + entregable 2 → split qtyKeep=2 qtyRevert=4', () => {
    const plan = computeCpstRevertPlan([{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 6 }], 2);
    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe('split');
    expect(plan[0].qtyKeep).toBe(2);
    expect(plan[0].qtyRevert).toBe(4);
    expect(sumRevertUnits(plan)).toBe(4);
  });

  it('T3 2 entries ASIG 3+3 + entregable 4 → keep 3 + split 1/2', () => {
    const plan = computeCpstRevertPlan(
      [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 3 },
        { pedidoId: 'p2', lineIndex: 0, qtyAsignada: 3 },
      ],
      4
    );
    expect(plan).toHaveLength(2);
    expect(plan[0].action).toBe('keep');
    expect(plan[0].qtyKeep).toBe(3);
    expect(plan[0].qtyRevert).toBe(0);
    expect(plan[1].action).toBe('split');
    expect(plan[1].qtyKeep).toBe(1);
    expect(plan[1].qtyRevert).toBe(2);
    expect(sumRevertUnits(plan)).toBe(2);
  });

  it('entregable == nominal total → todo keep', () => {
    const plan = computeCpstRevertPlan(
      [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 },
        { pedidoId: 'p2', lineIndex: 0, qtyAsignada: 3 },
      ],
      5
    );
    expect(plan.every((a) => a.action === 'keep')).toBe(true);
    expect(sumRevertUnits(plan)).toBe(0);
  });

  it('entregable 0 con N entries → todas revert_full', () => {
    const plan = computeCpstRevertPlan(
      [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 1 },
        { pedidoId: 'p2', lineIndex: 2, qtyAsignada: 2 },
      ],
      0
    );
    expect(plan.every((a) => a.action === 'revert_full')).toBe(true);
    expect(sumRevertUnits(plan)).toBe(3);
  });

  it('entries vacio → plan vacio', () => {
    expect(computeCpstRevertPlan([], 5)).toEqual([]);
    expect(computeCpstRevertPlan(null, 5)).toEqual([]);
  });

  it('idempotencia: mismo input → mismo output', () => {
    const entries = [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 6 }];
    const a = computeCpstRevertPlan(entries, 2);
    const b = computeCpstRevertPlan(entries, 2);
    expect(a).toEqual(b);
  });

  it('qtyAsignada <= 0 se saltea (edge)', () => {
    const plan = computeCpstRevertPlan(
      [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 0 },
        { pedidoId: 'p2', lineIndex: 0, qtyAsignada: 3 },
      ],
      1
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].entry.pedidoId).toBe('p2');
    expect(plan[0].action).toBe('split');
    expect(plan[0].qtyKeep).toBe(1);
    expect(plan[0].qtyRevert).toBe(2);
  });

  it('caso LA LOMITA EXGC66MHBAR 1u fisico 0 → revert_full 1', () => {
    const plan = computeCpstRevertPlan([{ pedidoId: 'JW657sps', lineIndex: 0, qtyAsignada: 1 }], 0);
    expect(plan[0].action).toBe('revert_full');
    expect(plan[0].qtyRevert).toBe(1);
  });

  it('caso LA LOMITA EXGC66HBAR 2u fisico 0 → revert_full 2', () => {
    const plan = computeCpstRevertPlan([{ pedidoId: 'lYavw5kw', lineIndex: 0, qtyAsignada: 2 }], 0);
    expect(plan[0].action).toBe('revert_full');
    expect(plan[0].qtyRevert).toBe(2);
  });
});

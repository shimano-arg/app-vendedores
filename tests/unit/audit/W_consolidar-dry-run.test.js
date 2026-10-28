// @ts-check
/**
 * v1516 §TBD — Dry-run test del script W_consolidar_ingresos_duplicados.cjs.
 *
 * Como el script usa Firestore admin SDK + firebase-admin que no está disponible
 * en el ambiente de tests, aqui testeamos la LOGICA PURA de group by + target
 * selection + sum qty via mock Firestore.
 *
 * El contrato que verificamos:
 *   - Group by sku funciona.
 *   - Target = doc más viejo (menor detectedAt).
 *   - Sum qtyIngresada = qty del target + suma de qty de "otros".
 *   - othersCount = N docs - 1.
 */
import { describe, expect, it } from 'vitest';

/**
 * Replica la lógica pura del script W sin tocar admin SDK.
 * @param {Array<{id: string, data: any}>} activeDocs
 * @returns {Array<{sku: string, targetId: string, targetPrevQty: number, othersIds: string[], othersCount: number, sumOthersQty: number, targetNewQty: number}>}
 */
function planConsolidation(activeDocs) {
  const bySku = new Map();
  for (const d of activeDocs) {
    const sku = String(d.data.sku || '')
      .toUpperCase()
      .trim();
    if (!sku) continue;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(d);
  }
  const plan = [];
  for (const [sku, docs] of bySku) {
    if (docs.length < 2) continue;
    const sorted = docs.slice().sort((a, b) => {
      const ta = String(a.data.detectedAt || '');
      const tb = String(b.data.detectedAt || '');
      return ta.localeCompare(tb);
    });
    const target = sorted[0];
    const others = sorted.slice(1);
    const sumOthersQty = others.reduce((s, o) => s + (Number(o.data.qtyIngresada) || 0), 0);
    plan.push({
      sku,
      targetId: target.id,
      targetPrevQty: Number(target.data.qtyIngresada) || 0,
      othersIds: others.map((o) => o.id),
      othersCount: others.length,
      sumOthersQty,
      targetNewQty: (Number(target.data.qtyIngresada) || 0) + sumOthersQty,
    });
  }
  return plan;
}

describe('W_consolidar — dry-run plan logic', () => {
  it('mock Firestore con 3 SKUs duplicados → verifica group by + target selection + sum qty', () => {
    const activeDocs = [
      // FXS70MHC2: 2 docs
      {
        id: 'f_a',
        data: {
          sku: 'FXS70MHC2',
          qtyIngresada: 3,
          detectedAt: '2026-10-28T10:00:00Z',
          status: 'pending',
        },
      },
      {
        id: 'f_b',
        data: {
          sku: 'FXS70MHC2',
          qtyIngresada: 7,
          detectedAt: '2026-10-28T12:00:00Z',
          status: 'pending',
        },
      },
      // SLX151XGA: 2 docs
      {
        id: 's_a',
        data: {
          sku: 'SLX151XGA',
          qtyIngresada: 5,
          detectedAt: '2026-10-27T09:00:00Z',
          status: 'in_progress',
          lockedAt: '2026-10-27T09:00:00Z',
        },
      },
      {
        id: 's_b',
        data: {
          sku: 'SLX151XGA',
          qtyIngresada: 10,
          detectedAt: '2026-10-28T08:00:00Z',
          status: 'pending',
        },
      },
      // SUC60MH2APY: 3 docs
      {
        id: 'u_a',
        data: {
          sku: 'SUC60MH2APY',
          qtyIngresada: 2,
          detectedAt: '2026-10-28T06:00:00Z',
          status: 'pending',
        },
      },
      {
        id: 'u_b',
        data: {
          sku: 'SUC60MH2APY',
          qtyIngresada: 4,
          detectedAt: '2026-10-28T07:00:00Z',
          status: 'pending',
        },
      },
      {
        id: 'u_c',
        data: {
          sku: 'SUC60MH2APY',
          qtyIngresada: 1,
          detectedAt: '2026-10-28T08:00:00Z',
          status: 'pending',
        },
      },
      // UNIQUE: 1 doc, no debe aparecer en el plan
      {
        id: 'uniq_1',
        data: {
          sku: 'UNIQUE',
          qtyIngresada: 50,
          detectedAt: '2026-10-28T05:00:00Z',
          status: 'pending',
        },
      },
    ];
    const plan = planConsolidation(activeDocs);
    // 3 grupos con duplicados.
    expect(plan).toHaveLength(3);
    const byS = new Map(plan.map((p) => [p.sku, p]));
    // FXS70MHC2: target = f_a (más viejo), newQty = 3 + 7 = 10
    expect(byS.get('FXS70MHC2')).toMatchObject({
      targetId: 'f_a',
      targetPrevQty: 3,
      othersIds: ['f_b'],
      othersCount: 1,
      sumOthersQty: 7,
      targetNewQty: 10,
    });
    // SLX151XGA: target = s_a (más viejo), newQty = 5 + 10 = 15
    expect(byS.get('SLX151XGA')).toMatchObject({
      targetId: 's_a',
      targetPrevQty: 5,
      othersIds: ['s_b'],
      othersCount: 1,
      sumOthersQty: 10,
      targetNewQty: 15,
    });
    // SUC60MH2APY: 3 docs — target = u_a (más viejo), others=[u_b, u_c], newQty = 2+4+1 = 7
    expect(byS.get('SUC60MH2APY')).toMatchObject({
      targetId: 'u_a',
      targetPrevQty: 2,
      othersCount: 2,
      sumOthersQty: 5,
      targetNewQty: 7,
    });
    expect(byS.get('SUC60MH2APY').othersIds.sort()).toEqual(['u_b', 'u_c']);
    // UNIQUE: no está en el plan (1 doc solo).
    expect(byS.has('UNIQUE')).toBe(false);
  });

  it('sin duplicados → plan vacio', () => {
    const activeDocs = [
      { id: 'a', data: { sku: 'FOO', qtyIngresada: 10, detectedAt: '2026-10-28T10:00:00Z' } },
      { id: 'b', data: { sku: 'BAR', qtyIngresada: 5, detectedAt: '2026-10-28T10:00:00Z' } },
    ];
    expect(planConsolidation(activeDocs)).toEqual([]);
  });

  it('ignora docs sin sku', () => {
    const activeDocs = [
      { id: 'a', data: { sku: '', qtyIngresada: 10, detectedAt: '2026-10-28T10:00:00Z' } },
      { id: 'b', data: { sku: '', qtyIngresada: 5, detectedAt: '2026-10-28T11:00:00Z' } },
    ];
    expect(planConsolidation(activeDocs)).toEqual([]);
  });

  it('case-insensitive sku matching (uppercase canonicalizado)', () => {
    const activeDocs = [
      { id: 'a', data: { sku: 'fxc', qtyIngresada: 3, detectedAt: '2026-10-28T10:00:00Z' } },
      { id: 'b', data: { sku: 'FXC', qtyIngresada: 5, detectedAt: '2026-10-28T11:00:00Z' } },
    ];
    const plan = planConsolidation(activeDocs);
    expect(plan).toHaveLength(1);
    expect(plan[0].sku).toBe('FXC');
    expect(plan[0].targetNewQty).toBe(8);
  });

  it('target sin detectedAt (string vacío) sigue siendo determinístico', () => {
    const activeDocs = [
      { id: 'a', data: { sku: 'X', qtyIngresada: 3, detectedAt: '' } },
      { id: 'b', data: { sku: 'X', qtyIngresada: 5, detectedAt: '2026-10-28T10:00:00Z' } },
    ];
    const plan = planConsolidation(activeDocs);
    // '' < '2026-...' lexicográficamente, entonces 'a' es target.
    expect(plan[0].targetId).toBe('a');
  });
});

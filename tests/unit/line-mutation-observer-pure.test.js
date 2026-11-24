// @ts-check
import { describe, expect, it } from 'vitest';
import {
  buildObservationLogEntry,
  detectLineMutations,
  isLegitimateActor,
} from '../../functions/core/line-mutation-observer-core.js';

describe('line-mutation-observer-core (pure)', () => {
  describe('detectLineMutations — out of scope', () => {
    it('after null (delete) → not in scope', () => {
      const r = detectLineMutations({ lines: [] }, null);
      expect(r.hasMutation).toBe(false);
      expect(r.inScope).toBe(false);
    });

    it('before null (create) → not in scope (el detector ignora creates)', () => {
      const r = detectLineMutations(null, { lines: [{ code: 'X', qty: 1, state: 'pending' }] });
      expect(r.hasMutation).toBe(false);
      expect(r.inScope).toBe(false);
    });

    it('stage invoiced → not in scope', () => {
      const before = { stage: 'invoiced', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
      const after = { stage: 'invoiced', lines: [{ code: 'X', qty: 999, state: 'confirmed' }] };
      const r = detectLineMutations(before, after);
      expect(r.inScope).toBe(false);
    });

    it('stage closed → not in scope', () => {
      const before = { stage: 'closed', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
      const after = { stage: 'closed', lines: [{ code: 'X', qty: 999, state: 'confirmed' }] };
      expect(detectLineMutations(before, after).inScope).toBe(false);
    });

    it('stage cancelled → not in scope', () => {
      const before = { stage: 'cancelled', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
      const after = { stage: 'cancelled', lines: [{ code: 'X', qty: 999, state: 'confirmed' }] };
      expect(detectLineMutations(before, after).inScope).toBe(false);
    });

    it('includeTerminalStages=true override', () => {
      const before = { stage: 'invoiced', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
      const after = { stage: 'invoiced', lines: [{ code: 'X', qty: 5, state: 'confirmed' }] };
      const r = detectLineMutations(before, after, { includeTerminalStages: true });
      expect(r.inScope).toBe(true);
      expect(r.hasMutation).toBe(true);
    });
  });

  describe('detectLineMutations — no-op / noise', () => {
    it('identical before/after → no mutation', () => {
      const line = { code: 'TRX301', qty: 3, state: 'confirmed' };
      const r = detectLineMutations(
        { stage: 'pending', lines: [line] },
        { stage: 'pending', lines: [{ ...line }] }
      );
      expect(r.hasMutation).toBe(false);
      expect(r.inScope).toBe(true);
    });

    it('cambio de stage sin tocar lines ni agregados → sin mutation', () => {
      const before = { stage: 'pending', lines: [{ code: 'X', qty: 2, state: 'confirmed' }] };
      const after = { stage: 'confirmed', lines: [{ code: 'X', qty: 2, state: 'confirmed' }] };
      expect(detectLineMutations(before, after).hasMutation).toBe(false);
    });

    it('ambas líneas cancelled → ignora deltas de qty/code', () => {
      const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'cancelled' }] };
      const after = { stage: 'pending', lines: [{ code: 'Y', qty: 999, state: 'cancelled' }] };
      expect(detectLineMutations(before, after).hasMutation).toBe(false);
    });
  });

  describe('detectLineMutations — mutaciones por tipo', () => {
    it('LINE_QTY_CHANGED detecta el delta', () => {
      const before = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
      const after = { stage: 'pending', lines: [{ code: 'X', qty: 100, state: 'confirmed' }] };
      const r = detectLineMutations(before, after);
      expect(r.hasMutation).toBe(true);
      expect(r.mutations).toEqual([
        { kind: 'LINE_QTY_CHANGED', lineIdx: 0, sku: 'X', from: 1, to: 100, delta: 99 },
      ]);
    });

    it('LINE_SKU_CHANGED preserva qty', () => {
      const before = { stage: 'pending', lines: [{ code: 'CHEAP', qty: 2, state: 'confirmed' }] };
      const after = {
        stage: 'pending',
        lines: [{ code: 'EXPENSIVE', qty: 2, state: 'confirmed' }],
      };
      const r = detectLineMutations(before, after);
      expect(r.mutations).toEqual([
        { kind: 'LINE_SKU_CHANGED', lineIdx: 0, from: 'CHEAP', to: 'EXPENSIVE', qty: 2 },
      ]);
    });

    it('LINE_ADDED cuando el índice new aparece con una línea activa', () => {
      const before = { stage: 'pending', lines: [{ code: 'A', qty: 1, state: 'confirmed' }] };
      const after = {
        stage: 'pending',
        lines: [
          { code: 'A', qty: 1, state: 'confirmed' },
          { code: 'B', qty: 5, state: 'confirmed' },
        ],
      };
      const r = detectLineMutations(before, after);
      expect(r.mutations).toEqual([{ kind: 'LINE_ADDED', lineIdx: 1, sku: 'B', qty: 5 }]);
    });

    it('LINE_REMOVED cuando el índice queda sin línea activa', () => {
      const before = {
        stage: 'pending',
        lines: [
          { code: 'A', qty: 1, state: 'confirmed' },
          { code: 'B', qty: 5, state: 'confirmed' },
        ],
      };
      const after = { stage: 'pending', lines: [{ code: 'A', qty: 1, state: 'confirmed' }] };
      const r = detectLineMutations(before, after);
      expect(r.mutations).toEqual([{ kind: 'LINE_REMOVED', lineIdx: 1, sku: 'B', qty: 5 }]);
    });

    it('cambio de state="confirmed" → "cancelled" se trata como LINE_REMOVED', () => {
      const before = { stage: 'pending', lines: [{ code: 'X', qty: 3, state: 'confirmed' }] };
      const after = { stage: 'pending', lines: [{ code: 'X', qty: 3, state: 'cancelled' }] };
      const r = detectLineMutations(before, after);
      expect(r.mutations).toEqual([{ kind: 'LINE_REMOVED', lineIdx: 0, sku: 'X', qty: 3 }]);
    });

    it('NET_AMOUNT_CHANGED + SUBTOTAL_CHANGED', () => {
      const before = {
        stage: 'pending',
        lines: [{ code: 'X', qty: 1, state: 'confirmed' }],
        netAmountArs: 1000,
        subtotalArs: 1000,
      };
      const after = {
        stage: 'pending',
        lines: [{ code: 'X', qty: 1, state: 'confirmed' }],
        netAmountArs: 2500,
        subtotalArs: 3000,
      };
      const r = detectLineMutations(before, after);
      const kinds = r.mutations.map((m) => m.kind);
      expect(kinds).toContain('NET_AMOUNT_CHANGED');
      expect(kinds).toContain('SUBTOTAL_CHANGED');
      const net = r.mutations.find((m) => m.kind === 'NET_AMOUNT_CHANGED');
      expect(net).toMatchObject({ from: 1000, to: 2500, delta: 1500 });
    });

    it('varias mutaciones combinadas en un solo write', () => {
      const before = {
        stage: 'pending',
        lines: [
          { code: 'A', qty: 1, state: 'confirmed' },
          { code: 'B', qty: 5, state: 'confirmed' },
        ],
        netAmountArs: 500,
      };
      const after = {
        stage: 'pending',
        lines: [
          { code: 'A', qty: 50, state: 'confirmed' }, // qty changed
          { code: 'B', qty: 5, state: 'cancelled' }, // removed
          { code: 'C', qty: 2, state: 'confirmed' }, // added
        ],
        netAmountArs: 25000, // changed
      };
      const r = detectLineMutations(before, after);
      expect(r.hasMutation).toBe(true);
      const kinds = r.mutations.map((m) => m.kind).sort();
      expect(kinds).toEqual(
        ['LINE_ADDED', 'LINE_QTY_CHANGED', 'LINE_REMOVED', 'NET_AMOUNT_CHANGED'].sort()
      );
    });
  });

  describe('detectLineMutations — null-safe inputs', () => {
    it('lines undefined en before → no rompe', () => {
      const before = { stage: 'pending' };
      const after = { stage: 'pending', lines: [{ code: 'X', qty: 1, state: 'confirmed' }] };
      const r = detectLineMutations(before, after);
      expect(r.mutations).toEqual([{ kind: 'LINE_ADDED', lineIdx: 0, sku: 'X', qty: 1 }]);
    });

    it('lines not array → tratada como []', () => {
      const before = { stage: 'pending', lines: 'oops' };
      const after = { stage: 'pending', lines: [{ code: 'X', qty: 2, state: 'confirmed' }] };
      const r = detectLineMutations(before, after);
      expect(r.hasMutation).toBe(true);
    });

    it('line sin code / qty → defaults seguros', () => {
      const before = { stage: 'pending', lines: [{ state: 'confirmed' }] };
      const after = { stage: 'pending', lines: [{ state: 'confirmed' }] };
      expect(detectLineMutations(before, after).hasMutation).toBe(false);
    });
  });
});

describe('isLegitimateActor', () => {
  it('admin → true', () => expect(isLegitimateActor('admin')).toBe(true));
  it('interno → true', () => expect(isLegitimateActor('interno')).toBe(true));
  it('gerente → true', () => expect(isLegitimateActor('gerente')).toBe(true));
  it('vendedor → false', () => expect(isLegitimateActor('vendedor')).toBe(false));
  it('viewer → false', () => expect(isLegitimateActor('viewer')).toBe(false));
  it('null → false', () => expect(isLegitimateActor(null)).toBe(false));
  it('undefined → false', () => expect(isLegitimateActor(undefined)).toBe(false));
  it('case-insensitive', () => expect(isLegitimateActor('Admin')).toBe(true));
});

describe('buildObservationLogEntry', () => {
  it('shape correcto con afterData completo', () => {
    const entry = buildObservationLogEntry({
      pedidoId: 'ped-abc',
      mutations: [{ kind: 'LINE_QTY_CHANGED', lineIdx: 0, sku: 'X', from: 1, to: 100, delta: 99 }],
      actorUid: 'uid-vde',
      actorEmail: 'vde@shimano.com.ar',
      actorRole: 'vendedor',
      afterData: {
        stage: 'pending',
        ownerUid: 'uid-vde',
        ownerEmail: 'vde@shimano.com.ar',
        vendorAssigned: 'MAURICIO GIL',
        clientCardCode: 'C001',
        clientName: 'BROBRO SA',
        orderNumber: 516,
      },
      nowIso: '2026-11-24T12:00:00.000Z',
      shadowStartedAt: '2026-11-24',
    });

    expect(entry.type).toBe('LINE_MUTATION_OBSERVED');
    expect(entry.severity).toBe('HIGH');
    expect(entry.pedidoId).toBe('ped-abc');
    expect(entry.actorUid).toBe('uid-vde');
    expect(entry.actorRole).toBe('vendedor');
    expect(entry.pedidoStage).toBe('pending');
    expect(entry.pedidoClientCardCode).toBe('C001');
    expect(entry.pedidoOrderNumber).toBe(516);
    expect(entry.mutationsCount).toBe(1);
    expect(entry._shadowOnly).toBe(true);
    expect(entry._shadowStartedAt).toBe('2026-11-24');
    expect(entry._observerVersion).toBe('v1');
  });

  it('tolera actorRole null + afterData parcial', () => {
    const entry = buildObservationLogEntry({
      pedidoId: 'ped-xyz',
      mutations: [],
      actorUid: null,
      actorEmail: null,
      actorRole: null,
      afterData: null,
      nowIso: '2026-11-24T12:00:00.000Z',
      shadowStartedAt: '2026-11-24',
    });
    expect(entry.actorUid).toBe(null);
    expect(entry.actorRole).toBe(null);
    expect(entry.pedidoStage).toBe(null);
    expect(entry.pedidoClientCardCode).toBe(null);
  });
});

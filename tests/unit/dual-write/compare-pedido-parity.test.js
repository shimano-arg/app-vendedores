/**
 * Tests unit del pure helper src/pure/dual-write/compare-pedido-parity.js.
 *
 * Cubre:
 *   - Docs iguales → {ok: true}.
 *   - Diff en qty/state/cardCode → diff detallado con severity critical.
 *   - PG vacio → critical diff pedido.
 *   - FS vacio → critical diff pedido.
 *   - Lineas extra en FS / PG.
 *   - Reservations extra en FS / PG.
 *   - Timestamps con tolerancia.
 *   - transferidoSAP JSONB.
 *
 * @module tests/unit/dual-write/compare-pedido-parity.test.js
 */

import { describe, expect, it } from 'vitest';
import {
  compareLines,
  comparePedidoHeader,
  comparePedidoParity,
  compareReservations,
  jsonbEquals,
  scalarEquals,
  timestampEquals,
} from '../../../src/pure/dual-write/compare-pedido-parity.js';

function makeFsDoc(overrides = {}, lines = []) {
  return Object.assign(
    {
      _fsId: 'ped_test_001',
      orderNumber: 1234,
      clientCardCode: 'C001',
      clientName: 'CLIENTE TEST',
      assignedVendorUid: 'uid-vde-01',
      vendorAssigned: 'MAURICIO GIL',
      ownerUid: 'uid-vde-01',
      cargadoPorUid: 'uid-vde-01',
      origen: 'manual',
      draftId: null,
      transferidoSAP: null,
      createdAt: '2026-11-26T12:00:00.000Z',
      updatedAt: '2026-11-26T12:05:00.000Z',
      firstInvoicedAt: null,
      cobradoAt: null,
      closedAt: null,
      closedReason: null,
      closedBy: null,
      lines: lines,
    },
    overrides
  );
}

function makeFsLine(overrides = {}) {
  return Object.assign(
    {
      code: 'SKU-A',
      state: 'ASIG',
      qty: 5,
      qtyOpen: 5,
      qtyCancelled: 0,
      price: 10000,
      discountPct: 0,
      enTransito: false,
      asigAt: '2026-11-26T11:00:00.000Z',
    },
    overrides
  );
}

function makePgShape(overrides = {}) {
  return Object.assign(
    {
      pedido: {
        id: 'ped_test_001',
        order_number: 1234,
        client_card_code: 'C001',
        client_name: 'CLIENTE TEST',
        assigned_vendor_uid: 'uid-vde-01',
        assigned_vendor_key: 'MAURICIO GIL',
        owner_uid: 'uid-vde-01',
        cargado_por_uid: 'uid-vde-01',
        origen: 'manual',
        draft_id: null,
        transferido_sap: null,
        created_at: '2026-11-26T12:00:00.000Z',
        updated_at: '2026-11-26T12:05:00.000Z',
        first_invoiced_at: null,
        cobrado_at: null,
        closed_at: null,
        closed_reason: null,
        closed_by: null,
      },
      lines: [
        {
          pedido_id: 'ped_test_001',
          line_index: 0,
          sku: 'SKU-A',
          state: 'ASIG',
          qty: 5,
          qty_open: 5,
          qty_cancelled: 0,
          price_ars: 10000,
          discount_percent: 0,
          en_transito: false,
          asig_at: '2026-11-26T11:00:00.000Z',
        },
      ],
      reservations: [
        {
          pedido_id: 'ped_test_001',
          line_index: 0,
          sku: 'SKU-A',
          warehouse: 'dep_11',
          qty: 5,
          state: 'ASIG',
          asig_at: '2026-11-26T11:00:00.000Z',
        },
      ],
    },
    overrides
  );
}

describe('scalarEquals', () => {
  it('T1: valores iguales strict', () => {
    expect(scalarEquals(5, 5)).toBe(true);
    expect(scalarEquals('a', 'a')).toBe(true);
  });

  it('T2: null y undefined son equivalentes', () => {
    expect(scalarEquals(null, undefined)).toBe(true);
  });

  it('T3: strings con whitespace trim', () => {
    expect(scalarEquals('  abc ', 'abc')).toBe(true);
  });

  it('T4: numeric string vs number', () => {
    expect(scalarEquals('5', 5)).toBe(true);
    expect(scalarEquals(5, '5')).toBe(true);
  });

  it('T5: valores distintos devuelven false', () => {
    expect(scalarEquals(5, 6)).toBe(false);
    expect(scalarEquals('a', 'b')).toBe(false);
  });
});

describe('timestampEquals', () => {
  it('T6: timestamps iguales', () => {
    expect(timestampEquals('2026-11-26T12:00:00.000Z', '2026-11-26T12:00:00.000Z')).toBe(true);
  });

  it('T7: tolerancia 1s', () => {
    expect(timestampEquals('2026-11-26T12:00:00.000Z', '2026-11-26T12:00:00.500Z')).toBe(true);
  });

  it('T8: diferencia > 1s', () => {
    expect(timestampEquals('2026-11-26T12:00:00.000Z', '2026-11-26T12:00:02.000Z')).toBe(false);
  });

  it('T9: null + null → true', () => {
    expect(timestampEquals(null, null)).toBe(true);
  });

  it('T10: null vs timestamp real → false', () => {
    expect(timestampEquals(null, '2026-11-26T12:00:00.000Z')).toBe(false);
  });
});

describe('jsonbEquals (transferido_sap)', () => {
  it('T11: shapes iguales', () => {
    expect(jsonbEquals({ docEntry: 100, docNum: 2000 }, { docEntry: 100, docNum: 2000 })).toBe(
      true
    );
  });

  it('T12: ambos null', () => {
    expect(jsonbEquals(null, null)).toBe(true);
  });

  it('T13: keys distintas', () => {
    expect(jsonbEquals({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('T14: values distintos', () => {
    expect(jsonbEquals({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('comparePedidoParity', () => {
  it('T15: docs iguales → {ok: true, diff: []}', () => {
    const fs = makeFsDoc({}, [makeFsLine()]);
    const pg = makePgShape();
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(true);
    expect(result.diff).toEqual([]);
  });

  it('T16: FS vacío + PG existe → critical diff', () => {
    const result = comparePedidoParity(null, makePgShape());
    expect(result.ok).toBe(false);
    expect(result.diff).toHaveLength(1);
    expect(result.diff[0].path).toBe('pedido');
    expect(result.diff[0].severity).toBe('critical');
  });

  it('T17: PG vacío + FS existe → critical diff', () => {
    const fs = makeFsDoc({}, [makeFsLine()]);
    const result = comparePedidoParity(fs, null);
    expect(result.ok).toBe(false);
    expect(result.diff[0].path).toBe('pedido');
  });

  it('T18: diff en qty → critical', () => {
    const fs = makeFsDoc({}, [makeFsLine({ qty: 5, qtyOpen: 5 })]);
    const pg = makePgShape();
    pg.lines[0].qty = 7;
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(false);
    const qtyDiff = result.diff.find((d) => d.path === 'lines[0].qty');
    expect(qtyDiff).toBeDefined();
    expect(qtyDiff.severity).toBe('critical');
    expect(qtyDiff.fsValue).toBe(5);
    expect(qtyDiff.pgValue).toBe(7);
  });

  it('T19: diff en state → critical', () => {
    const fs = makeFsDoc({}, [makeFsLine({ state: 'ASIG' })]);
    const pg = makePgShape();
    pg.lines[0].state = 'BO';
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(false);
    const stateDiff = result.diff.find((d) => d.path === 'lines[0].state');
    expect(stateDiff).toBeDefined();
    expect(stateDiff.severity).toBe('critical');
  });

  it('T20: diff en cardCode → critical', () => {
    const fs = makeFsDoc({ clientCardCode: 'C001' }, []);
    const pg = makePgShape({ lines: [], reservations: [] });
    pg.pedido.client_card_code = 'C999';
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(false);
    const cardDiff = result.diff.find((d) => d.path === 'pedido.client_card_code');
    expect(cardDiff).toBeDefined();
    expect(cardDiff.severity).toBe('critical');
  });

  it('T21: diff en closed_reason → warning (no bloquea ok)', () => {
    // El header incluye closed_reason en PEDIDO_WARNING_FIELDS. Un diff en
    // warning no es critical, entonces ok=true.
    const fs = makeFsDoc({ closedReason: 'R1' }, []);
    const pg = makePgShape({ lines: [], reservations: [] });
    pg.pedido.closed_reason = 'R2';
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(true);
    const diff = result.diff.find((d) => d.path === 'pedido.closed_reason');
    expect(diff).toBeDefined();
    expect(diff.severity).toBe('warning');
  });

  it('T22: linea extra en PG → critical', () => {
    const fs = makeFsDoc({}, [makeFsLine()]);
    const pg = makePgShape();
    pg.lines.push({
      pedido_id: 'ped_test_001',
      line_index: 1,
      sku: 'SKU-EXTRA',
      state: 'BO',
      qty: 1,
      qty_open: 1,
      qty_cancelled: 0,
      price_ars: 0,
      discount_percent: 0,
      en_transito: false,
    });
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(false);
    const extra = result.diff.find((d) => d.path === 'lines[1]');
    expect(extra).toBeDefined();
    expect(extra.severity).toBe('critical');
  });

  it('T23: linea extra en FS → critical', () => {
    const fs = makeFsDoc({}, [
      makeFsLine(),
      makeFsLine({ code: 'SKU-B', asigAt: '2026-11-26T11:30:00.000Z' }),
    ]);
    const pg = makePgShape();
    // pg only has 0, not 1.
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(false);
    const extra = result.diff.find((d) => d.path === 'lines[1]');
    expect(extra).toBeDefined();
    expect(extra.severity).toBe('critical');
  });

  it('T24: diff en reservation.warehouse → critical', () => {
    const fs = makeFsDoc({}, [makeFsLine({ enTransito: false })]);
    const pg = makePgShape();
    pg.reservations[0].warehouse = 'dep_12'; // FS dice dep_11.
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(false);
    const diff = result.diff.find((d) => d.path.includes('.warehouse'));
    expect(diff).toBeDefined();
    expect(diff.severity).toBe('critical');
  });

  it('T25: FS transform falla → critical diff', () => {
    const badFs = { lines: [] }; // missing orderNumber, cardCode, etc.
    const pg = makePgShape();
    const result = comparePedidoParity(badFs, pg);
    expect(result.ok).toBe(false);
    expect(result.diff.length).toBeGreaterThan(0);
    expect(result.diff[0].fsValue).toContain('transform_failed');
  });

  it('T26: ambos null → ok (soft-delete en sync)', () => {
    const result = comparePedidoParity(null, null);
    expect(result.ok).toBe(true);
    expect(result.diff).toEqual([]);
  });

  it('T27: transferido_sap divergente → critical', () => {
    const fs = makeFsDoc({ transferidoSAP: { docEntry: 100, docNum: 2000 } }, []);
    const pg = makePgShape({ lines: [], reservations: [] });
    pg.pedido.transferido_sap = { docEntry: 200, docNum: 2000 };
    const result = comparePedidoParity(fs, pg);
    expect(result.ok).toBe(false);
    const diff = result.diff.find((d) => d.path === 'pedido.transferido_sap');
    expect(diff).toBeDefined();
    expect(diff.severity).toBe('critical');
  });
});

/**
 * Tests unit del pure helper src/pure/dual-write/transform-pedido-to-pg.js.
 *
 * Fixture cubriendo los 6 shapes canonicos de linea §40:
 *   BO + ASIG + confirmed + invoiced + cancelled + enTransito.
 *
 * Plus: timestamps (3 shapes Firestore), transferidoSAP, validation errors,
 * reservation derivation (§40.8 orderDocEntry), warehouse routing (§107).
 *
 * @module tests/unit/dual-write/transform-pedido-to-pg.test.js
 */

import { describe, expect, it } from 'vitest';
import {
  lineReservesStockForPg,
  mapLineState,
  mapPedidoOrigen,
  toIsoOrNull,
  transformPedidoToPg,
  validatePedidoHeader,
  warehouseForLine,
} from '../../../src/pure/dual-write/transform-pedido-to-pg.js';

/**
 * Factory de un pedido Firestore valido con N lineas inyectables.
 */
function makePedido(overrides = {}, lines = []) {
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

function makeLine(overrides = {}) {
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

describe('toIsoOrNull — accepts 3 Firestore timestamp shapes + null', () => {
  it('T1: null/undefined → null', () => {
    expect(toIsoOrNull(null)).toBe(null);
    expect(toIsoOrNull(undefined)).toBe(null);
  });

  it('T2: string ISO válido → preservado', () => {
    expect(toIsoOrNull('2026-11-26T12:00:00.000Z')).toBe('2026-11-26T12:00:00.000Z');
  });

  it('T3: Firestore Timestamp con toDate() → ISO', () => {
    const fakeTs = { toDate: () => new Date('2026-11-26T12:00:00.000Z') };
    expect(toIsoOrNull(fakeTs)).toBe('2026-11-26T12:00:00.000Z');
  });

  it('T4: REST shape {seconds, nanoseconds} → ISO', () => {
    const ts = { seconds: 1764158400, nanoseconds: 0 };
    const out = toIsoOrNull(ts);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('T5: number epoch ms → ISO', () => {
    const out = toIsoOrNull(1764158400000);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('T6: string vacío → null', () => {
    expect(toIsoOrNull('')).toBe(null);
  });
});

describe('mapLineState — 5 estados válidos + fallback', () => {
  it('BO/ASIG/confirmed/invoiced/cancelled → preservados', () => {
    expect(mapLineState('BO')).toBe('BO');
    expect(mapLineState('ASIG')).toBe('ASIG');
    expect(mapLineState('confirmed')).toBe('confirmed');
    expect(mapLineState('invoiced')).toBe('invoiced');
    expect(mapLineState('cancelled')).toBe('cancelled');
  });

  it('shape desconocido → null (caller decide skip)', () => {
    expect(mapLineState('unknown')).toBe(null);
    expect(mapLineState(undefined)).toBe(null);
    expect(mapLineState(123)).toBe(null);
  });
});

describe('mapPedidoOrigen', () => {
  it('normalizations canonical', () => {
    expect(mapPedidoOrigen('manual')).toBe('manual');
    expect(mapPedidoOrigen('cpst')).toBe('cpst');
    expect(mapPedidoOrigen('stock-asignado-batch')).toBe('cpst');
    expect(mapPedidoOrigen('excel')).toBe('excel');
    expect(mapPedidoOrigen('reparto')).toBe('reparto');
    expect(mapPedidoOrigen('backorder')).toBe('backorder');
    expect(mapPedidoOrigen('generar_backorder')).toBe('backorder');
    expect(mapPedidoOrigen('sap_sync')).toBe('sap_sync');
  });

  it('shape desconocido → "manual" (fallback)', () => {
    expect(mapPedidoOrigen('whatever')).toBe('manual');
    expect(mapPedidoOrigen(undefined)).toBe('manual');
  });
});

describe('warehouseForLine (§107)', () => {
  it('enTransito=true → dep_12', () => {
    expect(warehouseForLine(true)).toBe('dep_12');
  });

  it('enTransito=false/undefined → dep_11', () => {
    expect(warehouseForLine(false)).toBe('dep_11');
    expect(warehouseForLine(undefined)).toBe('dep_11');
  });
});

describe('lineReservesStockForPg (mirror schema line_reserves_stock §40)', () => {
  it('BO nunca reserva (§40)', () => {
    expect(lineReservesStockForPg({ state: 'BO', qtyOpen: 5 }, null)).toBe(false);
  });

  it('ASIG con qtyOpen>0 reserva (§40.10)', () => {
    expect(lineReservesStockForPg({ state: 'ASIG', qtyOpen: 5 }, null)).toBe(true);
  });

  it('confirmed sin orderDocEntry reserva', () => {
    expect(lineReservesStockForPg({ state: 'confirmed', qtyOpen: 5 }, null)).toBe(true);
    expect(lineReservesStockForPg({ state: 'confirmed', qtyOpen: 5 }, {})).toBe(true);
  });

  it('confirmed con orderDocEntry NO reserva (§40.8)', () => {
    const transferidoSap = { orderDocEntry: 12345 };
    expect(lineReservesStockForPg({ state: 'confirmed', qtyOpen: 5 }, transferidoSap)).toBe(false);
  });

  it('invoiced/cancelled nunca reservan', () => {
    expect(lineReservesStockForPg({ state: 'invoiced', qtyOpen: 5 }, null)).toBe(false);
    expect(lineReservesStockForPg({ state: 'cancelled', qtyOpen: 0 }, null)).toBe(false);
  });

  it('qtyOpen <= 0 nunca reserva', () => {
    expect(lineReservesStockForPg({ state: 'ASIG', qtyOpen: 0 }, null)).toBe(false);
    expect(lineReservesStockForPg({ state: 'confirmed', qtyOpen: -1 }, null)).toBe(false);
  });
});

describe('validatePedidoHeader', () => {
  it('doc valido → [] (sin errores)', () => {
    const doc = makePedido();
    expect(validatePedidoHeader(doc)).toEqual([]);
  });

  it('doc sin id → missing_id', () => {
    const doc = makePedido({ _fsId: undefined, id: undefined });
    const errors = validatePedidoHeader(doc);
    expect(errors).toContain('missing_id');
  });

  it('doc sin lines array → missing_lines_array', () => {
    const doc = makePedido({ lines: null });
    expect(validatePedidoHeader(doc)).toContain('missing_lines_array');
  });

  it('null / non-object → doc_not_object', () => {
    expect(validatePedidoHeader(null)).toContain('doc_not_object');
    expect(validatePedidoHeader('string')).toContain('doc_not_object');
  });
});

describe('transformPedidoToPg — happy path', () => {
  it('T10: pedido con 1 linea ASIG → shape PG completo', () => {
    const line = makeLine({ state: 'ASIG', qty: 5, qtyOpen: 5 });
    const doc = makePedido({}, [line]);
    const result = transformPedidoToPg(doc);
    expect(result.pedido.id).toBe('ped_test_001');
    expect(result.pedido.order_number).toBe(1234);
    expect(result.pedido.client_card_code).toBe('C001');
    expect(result.pedido.assigned_vendor_uid).toBe('uid-vde-01');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].sku).toBe('SKU-A');
    expect(result.lines[0].state).toBe('ASIG');
    expect(result.lines[0].qty).toBe(5);
    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0].warehouse).toBe('dep_11');
    expect(result.reservations[0].qty).toBe(5);
  });

  it('T11: pedido con 6 shapes canónicos — reservations correctas', () => {
    const lines = [
      makeLine({ code: 'SKU-BO', state: 'BO', qty: 3, qtyOpen: 3 }),
      makeLine({ code: 'SKU-ASIG', state: 'ASIG', qty: 2, qtyOpen: 2 }),
      makeLine({
        code: 'SKU-CONF',
        state: 'confirmed',
        qty: 4,
        qtyOpen: 4,
        confirmedAt: '2026-11-26T10:00:00.000Z',
      }),
      makeLine({ code: 'SKU-INV', state: 'invoiced', qty: 1, qtyOpen: 0 }),
      makeLine({
        code: 'SKU-CANC',
        state: 'cancelled',
        qty: 2,
        qtyOpen: 0,
        qtyCancelled: 2,
        cancelledAt: '2026-11-26T11:00:00.000Z',
      }),
      makeLine({
        code: 'SKU-TRAN',
        state: 'ASIG',
        qty: 1,
        qtyOpen: 1,
        enTransito: true,
        asigAtTransito: '2026-11-26T09:00:00.000Z',
      }),
    ];
    const doc = makePedido({}, lines);
    const result = transformPedidoToPg(doc);
    expect(result.lines).toHaveLength(6);
    // Solo ASIG (dep_11) + confirmed (dep_11) + ASIG enTransito (dep_12) = 3 reservations.
    expect(result.reservations).toHaveLength(3);
    const dep11 = result.reservations.filter((r) => r.warehouse === 'dep_11');
    const dep12 = result.reservations.filter((r) => r.warehouse === 'dep_12');
    expect(dep11).toHaveLength(2);
    expect(dep12).toHaveLength(1);
    expect(dep12[0].sku).toBe('SKU-TRAN');
  });

  it('T12: confirmed con orderDocEntry SAP → NO reserva (§40.8)', () => {
    const line = makeLine({ state: 'confirmed', qty: 4, qtyOpen: 4 });
    const doc = makePedido(
      { transferidoSAP: { docEntry: 100, docNum: 2000100, orderDocEntry: 500 } },
      [line]
    );
    const result = transformPedidoToPg(doc);
    expect(result.lines).toHaveLength(1);
    expect(result.reservations).toHaveLength(0);
  });

  it('T13: origen stock-asignado-batch → PG enum "cpst"', () => {
    const doc = makePedido({ origen: 'stock-asignado-batch' }, []);
    const result = transformPedidoToPg(doc);
    expect(result.pedido.origen).toBe('cpst');
  });

  it('T14: líneas con shapes inválidos emiten warnings (no throw)', () => {
    const lines = [
      makeLine({ state: 'ASIG' }),
      { code: '', state: 'ASIG', qty: 1, qtyOpen: 1 }, // sin sku
      { code: 'SKU-X', state: 'BOGUS', qty: 1, qtyOpen: 1 }, // state unknown
      { code: 'SKU-Y', state: 'ASIG', qty: 0, qtyOpen: 0 }, // qty inválido
      null, // null
    ];
    const doc = makePedido({}, lines);
    const result = transformPedidoToPg(doc);
    expect(result.lines).toHaveLength(1); // solo la válida
    expect(result.warnings.length).toBeGreaterThanOrEqual(4);
    expect(result.warnings.some((w) => w.includes('missing_sku'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('unknown_state'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('invalid_qty'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('not_object'))).toBe(true);
  });

  it('T15: doc inválido → throw con razones', () => {
    const doc = { lines: [] }; // sin orderNumber, etc.
    expect(() => transformPedidoToPg(doc)).toThrow(/invalid_pedido_doc/);
  });

  it('T16: timestamps preservados correctamente', () => {
    const doc = makePedido(
      {
        closedAt: '2026-11-26T15:00:00.000Z',
        closedReason: 'test_close',
        closedBy: 'admin@test.com',
      },
      []
    );
    const result = transformPedidoToPg(doc);
    expect(result.pedido.closed_at).toBe('2026-11-26T15:00:00.000Z');
    expect(result.pedido.closed_reason).toBe('test_close');
  });

  it('T17: id puede venir como _fsId o id', () => {
    const doc1 = makePedido({ _fsId: 'via_fsid', id: undefined }, []);
    const doc2 = makePedido({ _fsId: undefined, id: 'via_id' }, []);
    expect(transformPedidoToPg(doc1).pedido.id).toBe('via_fsid');
    expect(transformPedidoToPg(doc2).pedido.id).toBe('via_id');
  });

  it('T18: cardCode trim + preservar', () => {
    const doc = makePedido({ clientCardCode: '  C002  ' }, []);
    const result = transformPedidoToPg(doc);
    expect(result.pedido.client_card_code).toBe('C002');
  });
});

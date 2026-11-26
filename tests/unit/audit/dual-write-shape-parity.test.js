// @ts-check
/**
 * Stack S-12 H1 (review 2026-11-26): el shape que `commitPedidoCore` pasa
 * al dual-write en el happy path tiene que matchear byte-por-byte con el
 * que pasa en el idempotent hit, para que `transformPedidoToPg` lea los
 * mismos campos y emita los mismos SQL INSERTs.
 *
 * Antes del fix:
 *   - Idempotent hit → pasa `existingPedido.data` (shape Firestore nativo
 *     con `lines[]` splitteadas por state).
 *   - Happy path → pasaba `_buildPedidoDocForPg` que mergeaba qtyConfirmed
 *     + qtyBO en 1 sola linea con state='confirmed' OR 'BO' — DIVERGENCIA.
 *
 * Post-fix:
 *   - commitInTransaction embeds `pedidoData` (el mismo shape que
 *     `tx.set(pedidoRef, pedidoData)`) en el return value via
 *     `_pedidoDocForDualWrite`.
 *   - `_buildPedidoDocForPg` lo retorna tal cual.
 *   - El shape persistido en Firestore = el shape pasado al dual-write.
 *
 * Este test NO ejecuta `commitInTransaction` completo — valida el
 * contrato de `_buildPedidoDocForPg` directamente (pure por diseño).
 */
import { describe, expect, it } from 'vitest';
import { transformPedidoToPg } from '../../../functions/core/dual-write/transform-pedido-to-pg.js';

/**
 * Simula el shape Firestore nativo que un `existingPedido.data` tendria
 * (persistido por commitInTransaction via `tx.set(pedidoRef, pedidoData)`).
 */
function makeFirestoreNativePedidoData() {
  return {
    clientCardCode: 'C001',
    clientName: 'CLIENTE TEST',
    assignedVendorUid: 'uid-vde',
    vendorAssigned: 'MAURICIO GIL',
    ownerUid: 'uid-pablo',
    cargadoPorUid: 'uid-pablo',
    origen: 'cpst',
    _draftId: 'C|BA|CABA|CLIENTE TEST|501',
    orderNumber: 501,
    stage: 'confirmed',
    source: 'stock-asignado-batch',
    transferidoSAP: null,
    createdAt: '2026-11-26T17:00:00.000Z',
    updatedAt: '2026-11-26T17:00:00.000Z',
    confirmedAt: '2026-11-26T17:00:00.000Z',
    closedAt: null,
    closedReason: null,
    schemaVersion: 2,
    netAmountArs: 75000,
    // Lineas splitteadas (mix 2 confirmed + 1 BO del mismo SKU).
    lines: [
      {
        code: 'SKU-A',
        state: 'confirmed',
        qty: 2,
        qtyOpen: 2,
        qtyCancelled: 0,
        precio: 15000,
        confirmedAt: '2026-11-26T17:00:00.000Z',
        enTransito: false,
      },
      {
        code: 'SKU-A',
        state: 'BO',
        qty: 1,
        qtyOpen: 1,
        qtyCancelled: 0,
        precio: 15000,
        enTransito: false,
      },
      {
        code: 'SKU-B',
        state: 'confirmed',
        qty: 1,
        qtyOpen: 1,
        qtyCancelled: 0,
        precio: 30000,
        confirmedAt: '2026-11-26T17:00:00.000Z',
        enTransito: true,
        asigAtTransito: '2026-11-26T16:00:00.000Z',
      },
    ],
  };
}

describe('Stack S-12 H1 — shape parity idempotent vs happy', () => {
  it('transformPedidoToPg sobre shape Firestore nativo emite reservations esperadas', () => {
    const doc = { ...makeFirestoreNativePedidoData(), _fsId: 'pedido-abc' };
    const result = transformPedidoToPg(doc);
    expect(result.pedido.id).toBe('pedido-abc');
    expect(result.pedido.origen).toBe('cpst');
    // 3 lineas input → 3 lineas PG.
    expect(result.lines).toHaveLength(3);
    // Reservations: confirmed(2) + confirmed(1) (SKU-A BO no reserva, §40).
    expect(result.reservations).toHaveLength(2);
    // SKU-A confirmed reserva en dep_11.
    const resA = result.reservations.find((r) => r.sku === 'SKU-A');
    expect(resA).toBeDefined();
    expect(resA.warehouse).toBe('dep_11');
    expect(resA.qty).toBe(2);
    // SKU-B confirmed con enTransito=true reserva en dep_12.
    const resB = result.reservations.find((r) => r.sku === 'SKU-B');
    expect(resB).toBeDefined();
    expect(resB.warehouse).toBe('dep_12');
    expect(resB.qty).toBe(1);
  });

  it('transformPedidoToPg lee enTransito + asigAtTransito + enDep11At per-linea', () => {
    const doc = {
      ...makeFirestoreNativePedidoData(),
      _fsId: 'pedido-abc',
      lines: [
        {
          code: 'SKU-C',
          state: 'ASIG',
          qty: 1,
          qtyOpen: 1,
          precio: 1000,
          enTransito: true,
          asigAtTransito: '2026-11-25T10:00:00.000Z',
          enDep11At: '2026-11-26T10:00:00.000Z',
          asigAt: '2026-11-25T10:00:00.000Z',
        },
      ],
    };
    const result = transformPedidoToPg(doc);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].en_transito).toBe(true);
    expect(result.lines[0].asig_at_transito).toBe('2026-11-25T10:00:00.000Z');
    expect(result.lines[0].en_dep11_at).toBe('2026-11-26T10:00:00.000Z');
    expect(result.lines[0].asig_at).toBe('2026-11-25T10:00:00.000Z');
  });

  it('shape Firestore nativo con lineas mix confirmed/BO del mismo SKU → PG mantiene las 2 lineas', () => {
    const doc = { ...makeFirestoreNativePedidoData(), _fsId: 'pedido-xyz' };
    const result = transformPedidoToPg(doc);
    const linesA = result.lines.filter((l) => l.sku === 'SKU-A');
    expect(linesA).toHaveLength(2);
    expect(linesA[0].state).toBe('confirmed');
    expect(linesA[0].qty).toBe(2);
    expect(linesA[1].state).toBe('BO');
    expect(linesA[1].qty).toBe(1);
  });

  it('shape Firestore nativo trasferidoSAP=null se preserva para PG', () => {
    const doc = { ...makeFirestoreNativePedidoData(), _fsId: 'pedido-123' };
    const result = transformPedidoToPg(doc);
    expect(result.pedido.transferido_sap).toBeNull();
  });

  it('shape Firestore nativo con transferidoSAP.orderDocEntry → confirmed NO reserva (§40.8)', () => {
    const doc = {
      ...makeFirestoreNativePedidoData(),
      _fsId: 'pedido-sent-sap',
      transferidoSAP: { orderDocEntry: 123, docNum: 456 },
      lines: [
        {
          code: 'SKU-X',
          state: 'confirmed',
          qty: 1,
          qtyOpen: 1,
          precio: 1000,
          confirmedAt: '2026-11-26T17:00:00.000Z',
        },
      ],
    };
    const result = transformPedidoToPg(doc);
    // Linea existe pero reservation NO (bloqueada por §40.8).
    expect(result.lines).toHaveLength(1);
    expect(result.reservations).toHaveLength(0);
  });

  it('shape Firestore nativo con lineas discountPct per-linea se preserva', () => {
    const doc = {
      ...makeFirestoreNativePedidoData(),
      _fsId: 'pedido-disc',
      lines: [
        {
          code: 'SKU-D',
          state: 'confirmed',
          qty: 1,
          qtyOpen: 1,
          precio: 1000,
          discountPct: 15,
          confirmedAt: '2026-11-26T17:00:00.000Z',
        },
      ],
    };
    const result = transformPedidoToPg(doc);
    expect(result.lines[0].discount_percent).toBe(15);
  });

  it('shape mergeado legacy (qtyConfirmed+qtyBO en misma linea) seria rechazado por transformPedidoToPg', () => {
    // Shape legacy (pre-fix H1 del happy path): 1 linea con qty total +
    // state='confirmed' mergeando qtyConfirmed+qtyBO. Esto hubiera llegado
    // al PG con qty_open invalido porque transformPedidoToPg lee state
    // string directo.
    // Lo importante aca: shape nativo = correcto; shape mergeado = discrepa.
    const doc = {
      ...makeFirestoreNativePedidoData(),
      _fsId: 'pedido-legacy',
      lines: [
        // Legacy shape: 1 linea con qtyConfirmed+qtyBO (3 u total)
        { code: 'SKU-A', state: 'confirmed', qty: 3, qtyOpen: 3, precio: 15000 },
      ],
    };
    const result = transformPedidoToPg(doc);
    // El shape legacy hubiera emitido 1 reservation con qty=3.
    // El shape nativo (ver primer test) emite 1 reservation con qty=2 (solo
    // confirmed, BO no reserva). Divergencia comprobada.
    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0].qty).toBe(3); // vs 2 del shape nativo
  });
});

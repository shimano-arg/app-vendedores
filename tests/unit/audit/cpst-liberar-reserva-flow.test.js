// @ts-check
/**
 * v1399 §40.7 — Flow completo "liberar reserva" en 2 casos:
 *
 * Case 1: botón X sobre línea con reserva.
 *   - Línea en pedido origen muta: state=ASIG→cancelled,
 *     closedReason='quitado_por_vendedor_cpst'.
 *   - Breakdown deja de contar.
 *   - Idempotencia.
 *
 * Case 2: qty editada < reserva + enviado a SAP.
 *   - Línea origen split en 2 cancelled: consumed (waitlist-confirm) +
 *     recortado (recorte_vendedor_cpst).
 *   - Breakdown deja de contar las recortadas.
 */
import { describe, expect, it } from 'vitest';
import {
  collectAsigRefsForItemCancel,
  computeRecorteVendedorPlan,
  sumQtyBySku,
} from '../../../src/pure/cpst-item-cancel-helpers.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

const nowIso = '2026-10-21T18:00:00Z';
const userEmail = 'test@shimano.com.ar';

function applyXCancelToLine(line) {
  // Simula handler waitlistRemoveItem (case 1).
  if (
    line.state === 'cancelled' &&
    (line.closedReason === 'quitado_por_vendedor_cpst' ||
      line.closedReason === 'cliente_rechazo_cpst')
  ) {
    return { line, changed: false };
  }
  if (line.state !== 'ASIG') return { line, changed: false };
  const newLine = Object.assign({}, line);
  const prevQo = Number(newLine.qtyOpen) || 0;
  newLine.state = 'cancelled';
  newLine.qtyOpen = 0;
  newLine.qtyCancelled = (Number(newLine.qtyCancelled) || 0) + prevQo;
  newLine.closedReason = 'quitado_por_vendedor_cpst';
  newLine.cancelledAt = nowIso;
  newLine.cancelledBy = userEmail;
  newLine.asigReserva = false;
  return { line: newLine, changed: true };
}

function applyRecorteToPedidoLines(lines, lineIndex, qtyConsumed, qtyRecortado, pedidoBRef) {
  // Simula el loop de recorte-split del bloque v1280 (post-v1399).
  const newLines = lines.map((l) => Object.assign({}, l));
  const linea = newLines[lineIndex];
  if (!linea || linea.state !== 'ASIG') return { newLines, changed: false };
  if (qtyRecortado === 0) {
    // consumed completo → cancel full waitlist-confirm.
    newLines[lineIndex] = Object.assign({}, linea, {
      qtyOpen: 0,
      qtyCancelled: (Number(linea.qtyCancelled) || 0) + qtyConsumed,
      state: 'cancelled',
      closedReason: 'waitlist-confirm',
      cancelledAt: nowIso,
      cancelledIntoPedidoId: pedidoBRef,
    });
    return { newLines, changed: true };
  }
  // Case recorte: split.
  if (qtyConsumed > 0) {
    newLines[lineIndex] = Object.assign({}, linea, {
      qty: qtyConsumed,
      qtyOpen: 0,
      qtyCancelled: qtyConsumed,
      state: 'cancelled',
      closedReason: 'waitlist-confirm',
      cancelledAt: nowIso,
      cancelledIntoPedidoId: pedidoBRef,
    });
  } else {
    newLines[lineIndex] = Object.assign({}, linea, {
      qtyOpen: 0,
      qtyCancelled: (Number(linea.qtyCancelled) || 0) + (Number(linea.qty) || 0),
      state: 'cancelled',
      closedReason: 'recorte_vendedor_cpst',
      cancelledAt: nowIso,
      cancelledBy: userEmail,
      cancelledIntoPedidoId: pedidoBRef,
      asigReserva: false,
    });
  }
  if (qtyConsumed > 0 && qtyRecortado > 0) {
    const recLine = Object.assign({}, linea, {
      qty: qtyRecortado,
      qtyOpen: 0,
      qtyInvoiced: 0,
      qtyCancelled: qtyRecortado,
      qtyRecycled: 0,
      state: 'cancelled',
      closedReason: 'recorte_vendedor_cpst',
      cancelledAt: nowIso,
      cancelledBy: userEmail,
      cancelledIntoPedidoId: pedidoBRef,
      splitFromLineIndex: lineIndex,
      asigReserva: false,
    });
    delete recLine.asigRefs;
    newLines.push(recLine);
  }
  return { newLines, changed: true };
}

describe('v1399 §40.7 Case 1: botón X con reserva', () => {
  it('X sobre línea con reserva 1u (ALAN caso simétrico): cancela y libera', () => {
    const line = { code: 'CLC70MHAAR', state: 'ASIG', qty: 1, qtyOpen: 1, asigReserva: true };
    const w = {
      items: [{ code: 'CLC70MHAAR', asigRefs: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 1 }] }],
    };
    const refs = collectAsigRefsForItemCancel(w, 0);
    expect(refs).toHaveLength(1);
    const { line: nl, changed } = applyXCancelToLine(line);
    expect(changed).toBe(true);
    expect(nl.state).toBe('cancelled');
    expect(nl.closedReason).toBe('quitado_por_vendedor_cpst');
    expect(nl.qtyOpen).toBe(0);
    expect(nl.qtyCancelled).toBe(1);
  });

  it('X sobre línea SIN reserva: no toca pedidos (collectAsigRefsForItemCancel devuelve [])', () => {
    const w = { items: [{ code: 'X', qty: 5 }] }; // sin asigRefs ni pedidosOrigenes
    const refs = collectAsigRefsForItemCancel(w, 0);
    expect(refs).toEqual([]);
  });

  it('Idempotencia X: línea ya cancelled con quitado_por_vendedor_cpst no cambia', () => {
    const line = {
      code: 'X',
      state: 'cancelled',
      qty: 1,
      qtyOpen: 0,
      qtyCancelled: 1,
      closedReason: 'quitado_por_vendedor_cpst',
      cancelledAt: '2026-10-20T10:00:00Z',
    };
    const { changed } = applyXCancelToLine(line);
    expect(changed).toBe(false);
  });

  it('Línea ya cancelled con otro reason (cliente_rechazo_cpst): también skip', () => {
    const line = { code: 'X', state: 'cancelled', closedReason: 'cliente_rechazo_cpst' };
    const { changed } = applyXCancelToLine(line);
    expect(changed).toBe(false);
  });

  it('Línea en estado BO (ex-ASIG revertida v1397): skip (no se fuerza cancel)', () => {
    const line = { code: 'X', state: 'BO', asigRevertidaReason: 'asig_sin_stock_revertida_a_bo' };
    const { changed } = applyXCancelToLine(line);
    expect(changed).toBe(false);
  });

  it('Breakdown post-X: deja de contar la ASIG', () => {
    const pedidoPost = {
      _fsId: 'p1',
      closedAt: null,
      clientCardCode: 'C',
      createdAt: nowIso,
      lines: [
        {
          code: 'X',
          state: 'cancelled',
          qty: 1,
          qtyOpen: 0,
          qtyCancelled: 1,
          closedReason: 'quitado_por_vendedor_cpst',
        },
      ],
    };
    const now = Date.parse('2026-10-21T19:00:00Z');
    const b = getStockBreakdown('X', { getStockFisico: () => 3, pedidos: [pedidoPost] }, { now });
    expect(b.asignadas.total).toBe(0);
    expect(b.libre).toBe(3);
  });
});

describe('v1399 §40.7 Case 2: recorte al enviar SAP', () => {
  it('Reserva 5 editada a 3 → split: 3 waitlist-confirm + 2 recorte_vendedor_cpst', () => {
    const lines = [{ code: 'ALV6000FA', state: 'ASIG', qty: 5, qtyOpen: 5, asigReserva: true }];
    const docDataLines = [{ code: 'ALV6000FA', state: 'confirmed', qty: 3, qtyOpen: 3 }];
    const sum = sumQtyBySku(docDataLines);
    const plan = computeRecorteVendedorPlan(
      [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 5, sku: 'ALV6000FA' }],
      sum
    );
    expect(plan[0].qtyConsumed).toBe(3);
    expect(plan[0].qtyRecortado).toBe(2);
    const { newLines, changed } = applyRecorteToPedidoLines(lines, 0, 3, 2, 'pedidoB-ref');
    expect(changed).toBe(true);
    expect(newLines).toHaveLength(2);
    expect(newLines[0].state).toBe('cancelled');
    expect(newLines[0].closedReason).toBe('waitlist-confirm');
    expect(newLines[0].qty).toBe(3);
    expect(newLines[0].qtyCancelled).toBe(3);
    expect(newLines[1].state).toBe('cancelled');
    expect(newLines[1].closedReason).toBe('recorte_vendedor_cpst');
    expect(newLines[1].qty).toBe(2);
    expect(newLines[1].qtyCancelled).toBe(2);
    expect(newLines[1].splitFromLineIndex).toBe(0);
  });

  it('Reserva 5 editada a 7 → 5 waitlist-confirm + 0 recortado (excedente a BO en pedido B, fuera de este plan)', () => {
    const docDataLines = [
      { code: 'X', state: 'confirmed', qty: 5, qtyOpen: 5 },
      { code: 'X', state: 'BO', qty: 2, qtyOpen: 2 },
    ];
    const sum = sumQtyBySku(docDataLines);
    expect(sum.X).toBe(7);
    const plan = computeRecorteVendedorPlan(
      [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 5, sku: 'X' }],
      sum
    );
    expect(plan[0].qtyConsumed).toBe(5);
    expect(plan[0].qtyRecortado).toBe(0);
  });

  it('Breakdown post-recorte: no cuenta las 2 recortadas', () => {
    const pedidoPost = {
      _fsId: 'p1',
      closedAt: null,
      clientCardCode: 'C',
      createdAt: nowIso,
      lines: [
        {
          code: 'ALV6000FA',
          state: 'cancelled',
          qty: 3,
          qtyOpen: 0,
          qtyCancelled: 3,
          closedReason: 'waitlist-confirm',
        },
        {
          code: 'ALV6000FA',
          state: 'cancelled',
          qty: 2,
          qtyOpen: 0,
          qtyCancelled: 2,
          closedReason: 'recorte_vendedor_cpst',
        },
      ],
    };
    const now = Date.parse('2026-10-21T19:00:00Z');
    const b = getStockBreakdown(
      'ALV6000FA',
      { getStockFisico: () => 5, pedidos: [pedidoPost] },
      { now }
    );
    expect(b.asignadas.total).toBe(0);
    expect(b.libre).toBe(5);
  });

  it('Orden unificada v1382: 2 asigRefs por SKU, VDE edita a 4 → consumed en orden', () => {
    const w = {
      items: [
        {
          code: 'X',
          qty: 4,
          asigRefs: [
            { pedidoId: 'pA', lineIndex: 0, qtyAsignada: 3 },
            { pedidoId: 'pB', lineIndex: 1, qtyAsignada: 3 },
          ],
        },
      ],
    };
    const refs = collectAsigRefsForItemCancel(w, 0);
    expect(refs).toHaveLength(2);
    const plan = computeRecorteVendedorPlan(refs, { X: 4 });
    // pA consume 3 (todo), pB consume 1, recorta 2.
    expect(plan[0].qtyConsumed).toBe(3);
    expect(plan[0].qtyRecortado).toBe(0);
    expect(plan[1].qtyConsumed).toBe(1);
    expect(plan[1].qtyRecortado).toBe(2);
  });

  it('Idempotencia recorte: línea ya cancelled no se re-cancela', () => {
    const lines = [
      {
        code: 'X',
        state: 'cancelled',
        qty: 5,
        qtyOpen: 0,
        qtyCancelled: 5,
        closedReason: 'waitlist-confirm',
      },
    ];
    const { changed } = applyRecorteToPedidoLines(lines, 0, 3, 2, 'pedidoB-ref');
    expect(changed).toBe(false);
  });

  it('caso real SNAKE S.R.L. orden 488 ALV6000FA 1u reservada, VDE deja 1 y envía → cancel full waitlist-confirm (sin recorte)', () => {
    const origenes = [{ pedidoId: 'snakePedId', lineIndex: 0, qtyAsignada: 1, sku: 'ALV6000FA' }];
    const sum = sumQtyBySku([{ code: 'ALV6000FA', qty: 1 }]);
    const plan = computeRecorteVendedorPlan(origenes, sum);
    expect(plan[0].qtyConsumed).toBe(1);
    expect(plan[0].qtyRecortado).toBe(0);
  });
});

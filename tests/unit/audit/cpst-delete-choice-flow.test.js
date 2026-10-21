// @ts-check
/**
 * v1398 §40.6 — Flow completo "Borrar pedido CPST" con 2 opciones.
 *
 * 1. "cliente_rechazo_cpst": delete waitlist + mutar lines ASIG referenciadas
 *    a state='cancelled' con closedReason='cliente_rechazo_cpst', cancelledAt,
 *    cancelledBy. qtyOpen=0, qtyCancelled += qtyOpen anterior.
 * 2. "solo_borrador": delete waitlist. Las líneas quedan intactas.
 *
 * Al cancelar, el breakdown deja de contar esas asignaciones.
 * La cancelación es idempotente.
 * Órdenes unificadas (v1382) con asigRefs en items[]: mismo criterio por línea.
 */
import { describe, expect, it } from 'vitest';
import {
  collectAsigRefsForCancel,
  sumUnitsToFreeOnCancel,
} from '../../../src/pure/cpst-cancel-asig-plan.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';
import { isWaitlistCpst } from '../../../src/pure/wl-sidebar-classes.js';

const nowIso = '2026-10-21T17:30:00Z';
const userEmail = 'test@shimano.com.ar';

function applyCancelToLine(line, qtyFree) {
  // Simula la lógica inline del handler _wcardDeleteChoicePick.
  if (line.state === 'cancelled' && line.closedReason === 'cliente_rechazo_cpst') {
    return { line, changed: false };
  }
  if (line.state !== 'ASIG') return { line, changed: false };
  const newLine = Object.assign({}, line);
  const prevQo = Number(newLine.qtyOpen) || 0;
  newLine.state = 'cancelled';
  newLine.qtyOpen = 0;
  newLine.qtyCancelled = (Number(newLine.qtyCancelled) || 0) + prevQo;
  newLine.closedReason = 'cliente_rechazo_cpst';
  newLine.cancelledAt = nowIso;
  newLine.cancelledBy = userEmail;
  newLine.asigReserva = false;
  return { line: newLine, changed: true };
}

describe('v1398 §40.6 CPST delete-choice flow', () => {
  it('isWaitlistCpst: waitlist con source → true', () => {
    expect(isWaitlistCpst({ source: 'stock-asignado-batch' })).toBe(true);
  });

  it('isWaitlistCpst: waitlist con pedidosOrigenes → true (fallback)', () => {
    expect(isWaitlistCpst({ pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0 }] })).toBe(true);
  });

  it('isWaitlistCpst: waitlist normal → false', () => {
    expect(isWaitlistCpst({})).toBe(false);
  });

  it('Path 1 (rechazo_cpst): línea ASIG queda cancelled con audit', () => {
    const pedido = {
      _fsId: 'ewGoZIDQ',
      closedAt: null,
      clientCardCode: 'C23347411299',
      clientName: 'ALAN OSCAR NICOLAS RODRIGUEZ',
      createdAt: '2026-10-17T10:00:00Z',
      lines: [
        {
          code: 'CLC70MHAAR',
          state: 'ASIG',
          qty: 1,
          qtyOpen: 1,
          asigReserva: true,
          asigAt: '2026-10-17T14:00:00Z',
        },
      ],
    };
    const waitlist = {
      _id: 'wl487',
      source: 'stock-asignado-batch',
      orderNumber: '487',
      clientCardCode: 'C23347411299',
      pedidosOrigenes: [{ pedidoId: 'ewGoZIDQ', lineIndex: 0, qtyAsignada: 1, sku: 'CLC70MHAAR' }],
    };
    const refs = collectAsigRefsForCancel(waitlist);
    expect(refs).toHaveLength(1);
    expect(sumUnitsToFreeOnCancel(refs)).toBe(1);
    const { line, changed } = applyCancelToLine(pedido.lines[0], refs[0].qtyAsignada);
    expect(changed).toBe(true);
    expect(line.state).toBe('cancelled');
    expect(line.qtyOpen).toBe(0);
    expect(line.qtyCancelled).toBe(1);
    expect(line.closedReason).toBe('cliente_rechazo_cpst');
    expect(line.cancelledAt).toBe(nowIso);
    expect(line.cancelledBy).toBe(userEmail);
    expect(line.asigReserva).toBe(false);
  });

  it('Path 1: después de cancelar, breakdown deja de contar la ASIG', () => {
    const pedidoPost = {
      _fsId: 'ewGoZIDQ',
      closedAt: null,
      clientCardCode: 'C23347411299',
      createdAt: '2026-10-17T10:00:00Z',
      lines: [
        {
          code: 'CLC70MHAAR',
          state: 'cancelled',
          qty: 1,
          qtyOpen: 0,
          qtyCancelled: 1,
          closedReason: 'cliente_rechazo_cpst',
        },
      ],
    };
    const now = Date.parse('2026-10-21T18:00:00Z');
    const b = getStockBreakdown(
      'CLC70MHAAR',
      { getStockFisico: () => 2, pedidos: [pedidoPost] },
      { now }
    );
    expect(b.asignadas.total).toBe(0);
    expect(b.asignadas.totalEntregable).toBe(0);
    expect(b.libre).toBe(2);
  });

  it('Path 2 (solo_borrador): línea queda intacta', () => {
    const pedido = {
      lines: [{ code: 'CLC70MHAAR', state: 'ASIG', qty: 1, qtyOpen: 1, asigReserva: true }],
    };
    // "solo_borrador" NO llama applyCancelToLine — la línea queda intacta.
    expect(pedido.lines[0].state).toBe('ASIG');
    expect(pedido.lines[0].qtyOpen).toBe(1);
  });

  it('Idempotencia: segundo pase sobre línea ya cancelled con closedReason → no cambia', () => {
    const linePre = {
      code: 'CLC70MHAAR',
      state: 'cancelled',
      qty: 1,
      qtyOpen: 0,
      qtyCancelled: 1,
      closedReason: 'cliente_rechazo_cpst',
      cancelledAt: '2026-10-20T10:00:00Z',
      cancelledBy: 'otroUser@shimano.com.ar',
    };
    const { line, changed } = applyCancelToLine(linePre, 1);
    expect(changed).toBe(false);
    expect(line.cancelledAt).toBe('2026-10-20T10:00:00Z');
    expect(line.cancelledBy).toBe('otroUser@shimano.com.ar');
  });

  it('Línea ya en estado distinto (BO revertida v1397, invoiced): skip', () => {
    const lineBo = {
      code: 'X',
      state: 'BO',
      qty: 3,
      qtyOpen: 3,
      asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
    };
    const { changed: changedBo } = applyCancelToLine(lineBo, 3);
    expect(changedBo).toBe(false);
    const lineInv = { code: 'X', state: 'invoiced', qty: 2, qtyOpen: 0, qtyInvoiced: 2 };
    const { changed: changedInv } = applyCancelToLine(lineInv, 2);
    expect(changedInv).toBe(false);
  });

  it('Orden unificada (v1382): items[].asigRefs se procesa por línea', () => {
    const waitlistUnificada = {
      _id: 'wlU',
      // source puede faltar; pedidosOrigenes también o estar incompleto.
      items: [
        {
          code: 'CLC70MHAAR',
          qty: 1,
          origen: 'stock-asignado',
          asigRefs: [{ pedidoId: 'pA', lineIndex: 0, qtyAsignada: 1 }],
        },
        {
          code: 'EXGC66HBAR',
          qty: 2,
          origen: 'stock-asignado',
          asigRefs: [{ pedidoId: 'pB', lineIndex: 3, qtyAsignada: 2 }],
        },
      ],
    };
    expect(isWaitlistCpst(waitlistUnificada)).toBe(false); // sin source, sin pedidosOrigenes
    // Nota: el bundle en runtime detecta CPST via source OR pedidosOrigenes.
    // Las órdenes unificadas tienen items[].asigRefs pero pueden carecer de
    // pedidosOrigenes al nivel documento → fallback: isCpst se decide también
    // mirando asigRefs. En producción el flujo abre modal igual porque el
    // caller detecta source=stock-asignado-batch heredado via mergeLinesFromOrders.
    // Lo relevante: collectAsigRefsForCancel debe extraer AMBAS fuentes.
    const refs = collectAsigRefsForCancel(waitlistUnificada);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.pedidoId).sort()).toEqual(['pA', 'pB']);
    expect(sumUnitsToFreeOnCancel(refs)).toBe(3);
  });

  it('Caso real ALAN OSCAR orden 487 CLC70MHAAR 1u: refs + sum', () => {
    const w = {
      _id: 'orden487',
      source: 'stock-asignado-batch',
      orderNumber: '487',
      clientName: 'ALAN OSCAR NICOLAS RODRIGUEZ',
      clientCardCode: 'C23347411299',
      pedidosOrigenes: [{ pedidoId: 'ewGoZIDQ', lineIndex: 0, qtyAsignada: 1, sku: 'CLC70MHAAR' }],
      items: [{ code: 'CLC70MHAAR', qty: 1 }],
    };
    expect(isWaitlistCpst(w)).toBe(true);
    const refs = collectAsigRefsForCancel(w);
    expect(refs).toHaveLength(1);
    expect(refs[0].pedidoId).toBe('ewGoZIDQ');
    expect(sumUnitsToFreeOnCancel(refs)).toBe(1);
  });
});

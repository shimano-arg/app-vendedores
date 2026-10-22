// @ts-check
/**
 * v1404 §42 — Flow completo _createOrUnifyWaitlistPayload (simulado).
 *
 * Tests requerido por Mariano:
 *   1. Creación manual con orden abierta existente unifica y no crea doc nuevo.
 *   2. Creación CPST con orden abierta unifica conservando origen y asigRefs.
 *   3. Cliente sin orden abierta crea normal.
 *   4. Dos órdenes abiertas previas se absorben en la más nueva.
 *   5. Cancelar no escribe nada.
 *   6. Sidebar pinta naranja una orden manual con una línea CPST absorbida.
 */
import { describe, expect, it } from 'vitest';
import { mergeLinesFromOrders } from '../../../src/pure/unificar-ordenes.js';
import { findOpenWaitlistsForClient } from '../../../src/pure/waitlist-unique-per-client.js';
import { isWaitlistCpst } from '../../../src/pure/wl-sidebar-classes.js';

// Simulación del helper _createOrUnifyWaitlistPayload (misma lógica inline).
function simulateUnify(payload, allWaitlists, { confirmResult }) {
  const cardCode = String(payload.clientCardCode || '').trim();
  const open = findOpenWaitlistsForClient(allWaitlists, cardCode);
  if (open.length === 0 || !cardCode) {
    return { action: 'create', payloadToWrite: payload };
  }
  if (!confirmResult) {
    return { action: 'cancel' };
  }
  const target = open[0];
  const others = open.slice(1);
  const existingLines = Array.isArray(target.items) ? target.items.slice() : [];
  const incoming = Array.isArray(payload.items) ? payload.items.slice() : [];
  const importedBatches = [{ orderNumber: 0, lines: incoming }];
  for (const o of others) {
    if (Array.isArray(o.items))
      importedBatches.push({ orderNumber: Number(o.orderNumber) || 0, lines: o.items });
  }
  const _mr = mergeLinesFromOrders(existingLines, importedBatches);
  const mergedLines = _mr.mergedLines;
  return {
    action: 'unify',
    target,
    others,
    mergedLines,
    pedidosOrigenes: [...(target.pedidosOrigenes || []), ...(payload.pedidosOrigenes || [])],
    inheritedSource:
      !target.source &&
      (payload.source === 'stock-asignado-batch' ||
        (Array.isArray(payload.pedidosOrigenes) && payload.pedidosOrigenes.length > 0)),
  };
}

describe('v1404 §42 flow unificación', () => {
  it('T3 cliente sin orden abierta → create normal', () => {
    const r = simulateUnify({ clientCardCode: 'CNEW', items: [{ code: 'A', qty: 1 }] }, [], {
      confirmResult: true,
    });
    expect(r.action).toBe('create');
  });

  it('T1 creación manual con orden abierta → unify, no crea doc nuevo', () => {
    const existing = {
      _id: 'exist1',
      clientCardCode: 'C1',
      closedAt: null,
      orderNumber: 445,
      items: [{ code: 'A', qty: 1 }],
    };
    const incoming = {
      clientCardCode: 'C1',
      orderNumber: 999,
      items: [{ code: 'B', qty: 2 }],
    };
    const r = simulateUnify(incoming, [existing], { confirmResult: true });
    expect(r.action).toBe('unify');
    expect(r.target._id).toBe('exist1');
    expect(r.mergedLines.length).toBe(2);
    expect(r.mergedLines[0].code).toBe('A');
    expect(r.mergedLines[1].code).toBe('B');
  });

  it('T2 CPST con orden abierta → unify preservando origen+asigRefs', () => {
    const existing = {
      _id: 'exist1',
      clientCardCode: 'C1',
      closedAt: null,
      orderNumber: 500,
      source: 'crear-manual',
      items: [{ code: 'A', qty: 1 }],
    };
    const incoming = {
      clientCardCode: 'C1',
      orderNumber: 501,
      source: 'stock-asignado-batch',
      items: [
        {
          code: 'B',
          qty: 2,
          origen: 'stock-asignado',
          asigRefs: [{ pedidoId: 'pX', lineIndex: 0, qtyAsignada: 2 }],
        },
      ],
      pedidosOrigenes: [{ pedidoId: 'pX', lineIndex: 0, qtyAsignada: 2, sku: 'B' }],
    };
    const r = simulateUnify(incoming, [existing], { confirmResult: true });
    expect(r.action).toBe('unify');
    expect(r.mergedLines.length).toBe(2);
    const linB = r.mergedLines.find((l) => l.code === 'B');
    expect(linB.origen).toBe('stock-asignado');
    expect(linB.asigRefs).toHaveLength(1);
    expect(r.pedidosOrigenes).toHaveLength(1);
    expect(r.pedidosOrigenes[0].pedidoId).toBe('pX');
    // target ya tenía source='crear-manual'; no se pisa. isWaitlistCpst
    // detectará CPST via items[].origen=stock-asignado (T6 valida).
    expect(r.inheritedSource).toBe(false);
    // Pero la orden mergeada DEBE ser CPST por items[].origen.
    expect(isWaitlistCpst({ source: 'crear-manual', items: r.mergedLines })).toBe(true);
  });

  it('T4 dos órdenes abiertas previas → absorbidas en la más nueva', () => {
    const wVieja = {
      _id: 'w_vieja',
      clientCardCode: 'C1',
      closedAt: null,
      orderNumber: 100,
      createdAt: '2026-10-18T10:00:00Z',
      items: [{ code: 'OLD', qty: 1 }],
    };
    const wNueva = {
      _id: 'w_nueva',
      clientCardCode: 'C1',
      closedAt: null,
      orderNumber: 200,
      createdAt: '2026-10-21T10:00:00Z',
      items: [{ code: 'NEW', qty: 2 }],
    };
    const incoming = { clientCardCode: 'C1', items: [{ code: 'INC', qty: 3 }] };
    const r = simulateUnify(incoming, [wVieja, wNueva], { confirmResult: true });
    expect(r.action).toBe('unify');
    expect(r.target._id).toBe('w_nueva'); // la más nueva
    expect(r.others.map((o) => o._id)).toEqual(['w_vieja']);
    const codes = r.mergedLines.map((l) => l.code).sort();
    expect(codes).toEqual(['INC', 'NEW', 'OLD']); // existing (NEW) + incoming (INC) + absorbed (OLD)
  });

  it('T5 Cancelar no escribe nada', () => {
    const existing = { _id: 'exist1', clientCardCode: 'C1', closedAt: null, items: [] };
    const incoming = { clientCardCode: 'C1', items: [{ code: 'B', qty: 1 }] };
    const r = simulateUnify(incoming, [existing], { confirmResult: false });
    expect(r.action).toBe('cancel');
    expect(r).not.toHaveProperty('target');
    expect(r).not.toHaveProperty('mergedLines');
  });

  it('T6 sidebar pinta naranja una orden manual con línea CPST absorbida', () => {
    // Orden base = manual (sin source=stock-asignado-batch).
    // Después de unificar, items[] tiene al menos una con origen=stock-asignado.
    const unifiedWaitlist = {
      _id: 'unified1',
      source: 'crear-manual', // nació manual
      clientCardCode: 'C1',
      items: [
        { code: 'A', qty: 1 }, // manual original
        { code: 'B', qty: 2, origen: 'stock-asignado' }, // absorbida de CPST
      ],
    };
    expect(isWaitlistCpst(unifiedWaitlist)).toBe(true);
  });
});

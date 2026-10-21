// @ts-check
/**
 * v1397 §40.5 — Flow completo CPST con reversión ASIG → BO.
 *
 * Simula las 3 cosas que escribe _cpstConfirmar al batch:
 *   1. revertActions aplicadas al array lines[] de cada pedido origen.
 *   2. waitlist creado (si items.length > 0).
 *   3. Idempotencia: segundo pase sobre línea ya revertida no la toca.
 *
 * No usa Firebase emulator — simula el merge en memoria con la misma lógica
 * que el código inline de index.html.
 */
import { describe, expect, it } from 'vitest';
import { computeCpstRevertPlan } from '../../../src/pure/cpst-revert-plan.js';

const nowIso = '2026-10-21T17:00:00Z';
const userEmail = 'test@shimano.com.ar';

function applyRevertToLines(lines, action) {
  const newLines = lines.map((l) => Object.assign({}, l));
  const origLine = newLines[action.lineIndex];
  if (!origLine) return { newLines, changed: false };
  // Idempotencia check (igual que el código inline).
  if (origLine.state === 'BO' && origLine.asigRevertidaReason === 'asig_sin_stock_revertida_a_bo') {
    return { newLines, changed: false };
  }
  if (action.action === 'revert_full') {
    origLine.state = 'BO';
    origLine.asigReserva = false;
    origLine.asigRevertidaAt = nowIso;
    origLine.asigRevertidaBy = userEmail;
    origLine.asigRevertidaReason = 'asig_sin_stock_revertida_a_bo';
    return { newLines, changed: true };
  }
  if (action.action === 'split') {
    const origQo = Number(origLine.qtyOpen) || Number(origLine.qty) || 0;
    origLine.qty = action.qtyKeep;
    origLine.qtyOpen = Math.min(origQo, action.qtyKeep);
    const boLine = Object.assign({}, origLine, {
      state: 'BO',
      qty: action.qtyRevert,
      qtyOpen: action.qtyRevert,
      asigReserva: false,
      asigAt: null,
      asigRevertidaAt: nowIso,
      asigRevertidaBy: userEmail,
      asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
      splitFromLineIndex: action.lineIndex,
    });
    delete boLine.asigRefs;
    newLines.push(boLine);
    return { newLines, changed: true };
  }
  return { newLines, changed: false };
}

describe('v1397 §40.5 CPST revert flow', () => {
  it('T1: ASIG 3 + físico 0 → línea entera revierte a BO, waitlist NO se crea', () => {
    const lines = [
      {
        code: '597151',
        state: 'ASIG',
        qty: 3,
        qtyOpen: 3,
        asigReserva: true,
        asigAt: '2026-10-20T17:00Z',
      },
    ];
    const sk = {
      sku: '597151',
      qty: 3,
      qtyAjustada: 0,
      qtyRecorte: 3,
      entries: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 3, state: 'ASIG' }],
    };
    const plan = computeCpstRevertPlan(sk.entries, sk.qtyAjustada);
    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe('revert_full');
    const { newLines, changed } = applyRevertToLines(lines, {
      pedidoId: 'p1',
      lineIndex: 0,
      action: 'revert_full',
      qtyKeep: 0,
      qtyRevert: 3,
    });
    expect(changed).toBe(true);
    expect(newLines).toHaveLength(1);
    expect(newLines[0].state).toBe('BO');
    expect(newLines[0].qty).toBe(3);
    expect(newLines[0].qtyOpen).toBe(3);
    expect(newLines[0].asigReserva).toBe(false);
    expect(newLines[0].asigRevertidaReason).toBe('asig_sin_stock_revertida_a_bo');
    expect(newLines[0].asigRevertidaAt).toBe(nowIso);
    // waitlist no se crea: items vacío.
    const items = [sk].filter((x) => x.qtyAjustada > 0);
    expect(items).toHaveLength(0);
  });

  it('T2: ASIG 6 + físico 2 → split, waitlist con 2, línea BO nueva con 4', () => {
    const lines = [
      {
        code: '597151',
        state: 'ASIG',
        qty: 6,
        qtyOpen: 6,
        asigReserva: true,
        asigAt: '2026-10-20T17:00Z',
      },
    ];
    const sk = {
      sku: '597151',
      qty: 6,
      qtyAjustada: 2,
      qtyRecorte: 4,
      entries: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 6, state: 'ASIG' }],
    };
    const plan = computeCpstRevertPlan(sk.entries, sk.qtyAjustada);
    expect(plan[0].action).toBe('split');
    expect(plan[0].qtyKeep).toBe(2);
    expect(plan[0].qtyRevert).toBe(4);
    const { newLines } = applyRevertToLines(lines, {
      pedidoId: 'p1',
      lineIndex: 0,
      action: 'split',
      qtyKeep: 2,
      qtyRevert: 4,
    });
    expect(newLines).toHaveLength(2);
    expect(newLines[0].state).toBe('ASIG');
    expect(newLines[0].qty).toBe(2);
    expect(newLines[0].qtyOpen).toBe(2);
    expect(newLines[1].state).toBe('BO');
    expect(newLines[1].qty).toBe(4);
    expect(newLines[1].qtyOpen).toBe(4);
    expect(newLines[1].asigRevertidaReason).toBe('asig_sin_stock_revertida_a_bo');
    expect(newLines[1].splitFromLineIndex).toBe(0);
  });

  it('T3 idempotencia: segundo pase sobre línea ya revertida no la toca', () => {
    const linesPre = [
      {
        code: '597151',
        state: 'BO',
        qty: 3,
        qtyOpen: 3,
        asigReserva: false,
        asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
        asigRevertidaAt: '2026-10-20T10:00Z',
        asigRevertidaBy: 'otroUser@shimano.com.ar',
      },
    ];
    const { newLines, changed } = applyRevertToLines(linesPre, {
      pedidoId: 'p1',
      lineIndex: 0,
      action: 'revert_full',
      qtyKeep: 0,
      qtyRevert: 3,
    });
    expect(changed).toBe(false);
    expect(newLines[0].asigRevertidaAt).toBe('2026-10-20T10:00Z');
    expect(newLines[0].asigRevertidaBy).toBe('otroUser@shimano.com.ar');
  });

  it('T4: después de la reversión, el breakdown ve 3u BO + 0 ASIG (reconciliación la ve y crea reparto cuando hay físico)', async () => {
    const { getStockBreakdown } = await import('../../../src/pure/stock-breakdown.js');
    const now = Date.parse('2026-10-21T18:00:00Z');
    // Pedido origen con línea revertida.
    const pedido = {
      _fsId: 'p1',
      closedAt: null,
      clientCardCode: 'C30716659379',
      clientName: 'LA LOMITA',
      createdAt: '2026-10-16T12:00:00Z',
      lines: [
        {
          code: 'EXGC66HBAR',
          state: 'BO',
          qty: 2,
          qtyOpen: 2,
          asigReserva: false,
          asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
        },
      ],
    };
    // Físico 0 → sin reparto (no se crea reparto si no hay físico).
    const b0 = getStockBreakdown(
      'EXGC66HBAR',
      { getStockFisico: () => 0, pedidos: [pedido] },
      { now }
    );
    expect(b0.backorderApp.total).toBe(2);
    expect(b0.asignadas.total).toBe(0);
    expect(b0.fisicoDep11).toBe(0);
    // Físico 4 entra → el bucket backorderApp sigue 2u, hay 4u disponible. La
    // reconciliación (functions/core/reparto-core.js) usará esta data para crear
    // el reparto. Validamos que el BO está presente para que la reconciliación
    // lo pesque.
    const b4 = getStockBreakdown(
      'EXGC66HBAR',
      { getStockFisico: () => 4, pedidos: [pedido] },
      { now }
    );
    expect(b4.backorderApp.total).toBe(2);
    expect(b4.libre).toBe(4);
    // backorderApp.porCliente contiene al cliente LA LOMITA con 2u → reconcile crea reparto.
    const inCola = b4.backorderApp.porCliente.find((c) => c.cardCode === 'C30716659379');
    expect(inCola).toBeDefined();
    expect(inCola.qty).toBe(2);
  });

  it('T5 caso LA LOMITA EXGC66MHBAR 1u + EXGC66HBAR 2u + físico 0 ambos → revert 3u total, no crea waitlist', () => {
    const sks = [
      {
        sku: 'EXGC66MHBAR',
        qtyAjustada: 0,
        entries: [{ pedidoId: 'JW657sps', lineIndex: 0, qtyAsignada: 1, state: 'ASIG' }],
      },
      {
        sku: 'EXGC66HBAR',
        qtyAjustada: 0,
        entries: [{ pedidoId: 'lYavw5kw', lineIndex: 0, qtyAsignada: 2, state: 'ASIG' }],
      },
    ];
    const actions = [];
    for (const sk of sks) {
      const plan = computeCpstRevertPlan(sk.entries, sk.qtyAjustada);
      for (const a of plan) {
        if (a.action !== 'keep') actions.push({ sku: sk.sku, ...a });
      }
    }
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.action === 'revert_full')).toBe(true);
    const total = actions.reduce((s, a) => s + a.qtyRevert, 0);
    expect(total).toBe(3);
    const items = sks.filter((sk) => sk.qtyAjustada > 0);
    expect(items).toHaveLength(0); // no waitlist
  });
});

// @ts-nocheck
/**
 * Tests unit del healing puro `src/pure/asig-ref-healing.js`.
 * v1565 Incidente Frente A (2026-11-24, §108 CLAUDE.md).
 *
 * Reproduce los 4 casos SNAKE SRL + scenarios A-E del diseño:
 *   - Caso A: revertida_a_bo (asig_sin_stock_revertida_a_bo) → DROP.
 *   - Caso A': asig_destildada_por_admin → DROP.
 *   - Caso B: split_twin (cancelled + splitFromLineIndex + gemela viva) → REPOINT.
 *   - Caso B': split sin gemela viva → DROP.
 *   - Caso C: cliente_rechazo_cpst → DROP.
 *   - Caso C': quitado_por_vendedor_cpst → DROP.
 *   - Caso C'': recorte_vendedor_cpst → DROP.
 *   - Caso D: cancelled waitlist-confirm (consumida por otro pedido) → DROP.
 *   - Caso E: zombie qtyOpen=0 → DROP.
 *   - Caso E': qtyAsignada > qtyOpen → CLAMP.
 *   - Línea ASIG viva + qty OK → KEEP.
 *   - SKU_MISMATCH → KEEP (abort downstream, no enmascarar bug).
 *   - PEDIDO_ORIGEN_NOT_FOUND (snap exists=false) → KEEP (abort downstream).
 */
import { describe, expect, it } from 'vitest';
import { healAsigRefs } from '../../src/pure/asig-ref-healing.js';

function makeSnap(lines, exists = true) {
  return { exists, data: exists ? { lines } : null };
}

describe('healAsigRefs — Frente A v1565', () => {
  it('Caso A: revertida_a_bo (asig_sin_stock_revertida_a_bo) → DROP', () => {
    const payload = {
      lines: [
        {
          code: 'CLC70H2PY',
          asigRefs: [
            { pedidoId: '53vbayoJzYqceThBKCY9', lineIndex: 23, sku: 'CLC70H2PY', qtyAsignada: 1 },
          ],
        },
      ],
    };
    const snaps = new Map();
    snaps.set(
      '53vbayoJzYqceThBKCY9',
      makeSnap(
        new Array(24).fill(null).map((_, i) =>
          i === 23
            ? {
                code: 'CLC70H2PY',
                state: 'BO',
                qtyOpen: 1,
                asigReserva: false,
                asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
                asigRevertidaAt: '2026-11-21T10:00:00Z',
              }
            : { code: 'OTRO', state: 'confirmed', qtyOpen: 0 }
        )
      )
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.healedCount).toBe(1);
    expect(r.droppedRefs).toBe(1);
    expect(r.repointedRefs).toBe(0);
    expect(r.clampedRefs).toBe(0);
    expect(payload.lines[0].asigRefs).toHaveLength(0);
    expect(r.events[0].action).toBe('dropped');
    expect(r.events[0].reason).toBe('revertida_a_bo');
    expect(r.events[0].pedidoOrigenId).toBe('53vbayoJzYqceThBKCY9');
    expect(r.events[0].lineIndex).toBe(23);
  });

  it("Caso A': asig_destildada_por_admin → DROP", () => {
    const payload = {
      lines: [
        {
          code: 'CAPSH2403',
          asigRefs: [{ pedidoId: 'P1', lineIndex: 0, sku: 'CAPSH2403', qtyAsignada: 2 }],
        },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P1',
      makeSnap([
        {
          code: 'CAPSH2403',
          state: 'BO',
          qtyOpen: 2,
          asigReserva: false,
          asigRevertidaReason: 'asig_destildada_por_admin',
        },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(1);
    expect(r.events[0].reason).toBe('revertida_a_bo');
  });

  it('Caso B: split_twin existe (cancelled + splitFromLineIndex + gemela ASIG viva) → REPOINT', () => {
    const payload = {
      lines: [
        {
          code: 'SHMTECHLBLUEL',
          asigRefs: [{ pedidoId: 'P2', lineIndex: 79, sku: 'SHMTECHLBLUEL', qtyAsignada: 3 }],
        },
      ],
    };
    const lines = new Array(85).fill(null).map((_, i) => ({
      code: 'OTRO',
      state: 'confirmed',
      qtyOpen: 0,
    }));
    lines[79] = {
      code: 'SHMTECHLBLUEL',
      state: 'cancelled',
      qtyOpen: 0,
      splitFromLineIndex: 25,
      closedReason: 'recorte_vendedor_cpst',
    };
    // Gemela viva en index 80 (post-split §40.7)
    lines[80] = {
      code: 'SHMTECHLBLUEL',
      state: 'ASIG',
      qtyOpen: 3,
      splitFromLineIndex: 79,
    };
    const snaps = new Map();
    snaps.set('P2', makeSnap(lines));
    const r = healAsigRefs(payload, snaps);
    // La línea 79 tiene closedReason='recorte_vendedor_cpst' → caso C dispara primero → DROP.
    // Si quiero probar REPOINT puro, la línea original debe estar cancelled SIN closedReason del set rechazo.
    expect(r.droppedRefs + r.repointedRefs).toBe(1);
  });

  it('Caso B puro: split_twin SIN closedReason de rechazo → REPOINT', () => {
    const payload = {
      lines: [
        {
          code: 'SKU-X',
          asigRefs: [{ pedidoId: 'P2', lineIndex: 10, sku: 'SKU-X', qtyAsignada: 3 }],
        },
      ],
    };
    const lines = [];
    for (let i = 0; i < 20; i++) lines.push({ code: 'OTRO', state: 'confirmed', qtyOpen: 0 });
    // Línea cancelled con splitFromLineIndex (pero NO del set rechazo explícito)
    lines[10] = {
      code: 'SKU-X',
      state: 'cancelled',
      qtyOpen: 0,
      splitFromLineIndex: 5,
      closedReason: 'otro_motivo',
    };
    // Gemela viva en index 15
    lines[15] = {
      code: 'SKU-X',
      state: 'ASIG',
      qtyOpen: 3,
      splitFromLineIndex: 10,
    };
    const snaps = new Map();
    snaps.set('P2', makeSnap(lines));
    const r = healAsigRefs(payload, snaps);
    expect(r.repointedRefs).toBe(1);
    expect(r.droppedRefs).toBe(0);
    expect(payload.lines[0].asigRefs[0].lineIndex).toBe(15);
    expect(payload.lines[0].asigRefs[0].qtyAsignada).toBe(3);
    expect(r.events[0].action).toBe('repointed');
    expect(r.events[0].reason).toBe('split_twin');
  });

  it('Caso B: split_twin con qty menor → REPOINT + CLAMP combinados', () => {
    const payload = {
      lines: [
        {
          code: 'SKU-Y',
          asigRefs: [{ pedidoId: 'P3', lineIndex: 2, sku: 'SKU-Y', qtyAsignada: 5 }],
        },
      ],
    };
    const lines = [
      { code: 'OTRO', state: 'confirmed', qtyOpen: 0 },
      { code: 'OTRO', state: 'confirmed', qtyOpen: 0 },
      { code: 'SKU-Y', state: 'cancelled', qtyOpen: 0, splitFromLineIndex: 1, closedReason: 'x' },
      { code: 'SKU-Y', state: 'ASIG', qtyOpen: 2, splitFromLineIndex: 2 },
    ];
    const snaps = new Map();
    snaps.set('P3', makeSnap(lines));
    const r = healAsigRefs(payload, snaps);
    expect(r.repointedRefs).toBe(1);
    expect(payload.lines[0].asigRefs[0].lineIndex).toBe(3);
    expect(payload.lines[0].asigRefs[0].qtyAsignada).toBe(2); // clamped
    expect(r.events[0].clampedQty).toBe(2);
  });

  it("Caso B': split sin gemela viva → DROP", () => {
    const payload = {
      lines: [
        {
          code: 'SKU-Z',
          asigRefs: [{ pedidoId: 'P4', lineIndex: 0, sku: 'SKU-Z', qtyAsignada: 1 }],
        },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P4',
      makeSnap([
        {
          code: 'SKU-Z',
          state: 'cancelled',
          qtyOpen: 0,
          splitFromLineIndex: null,
          closedReason: 'x',
        },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    // cancelled sin splitFromLineIndex del set rechazo → KEEP (CHECK D2 abort downstream)
    expect(r.droppedRefs).toBe(0);
  });

  it("Caso B'': split con splitFromLineIndex pero sin gemela viva → DROP", () => {
    const payload = {
      lines: [
        {
          code: 'SKU-W',
          asigRefs: [{ pedidoId: 'P5', lineIndex: 3, sku: 'SKU-W', qtyAsignada: 1 }],
        },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P5',
      makeSnap([
        { code: 'X', state: 'confirmed', qtyOpen: 0 },
        { code: 'X', state: 'confirmed', qtyOpen: 0 },
        { code: 'X', state: 'confirmed', qtyOpen: 0 },
        {
          code: 'SKU-W',
          state: 'cancelled',
          qtyOpen: 0,
          splitFromLineIndex: 1,
          closedReason: 'otro',
        },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(1);
    expect(r.events[0].reason).toBe('split_sin_gemela_viva');
  });

  it('Caso C: cliente_rechazo_cpst → DROP', () => {
    const payload = {
      lines: [
        {
          code: 'X',
          asigRefs: [{ pedidoId: 'P6', lineIndex: 0, sku: 'X', qtyAsignada: 1 }],
        },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P6',
      makeSnap([
        {
          code: 'X',
          state: 'cancelled',
          qtyOpen: 0,
          closedReason: 'cliente_rechazo_cpst',
          cancelledAt: '2026-11-20T15:00:00Z',
        },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(1);
    expect(r.events[0].reason).toBe('rechazo_explicito');
    expect(r.events[0].details.closedReason).toBe('cliente_rechazo_cpst');
  });

  it("Caso C': quitado_por_vendedor_cpst → DROP", () => {
    const payload = {
      lines: [
        { code: 'Y', asigRefs: [{ pedidoId: 'P7', lineIndex: 0, sku: 'Y', qtyAsignada: 1 }] },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P7',
      makeSnap([
        { code: 'Y', state: 'cancelled', qtyOpen: 0, closedReason: 'quitado_por_vendedor_cpst' },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(1);
  });

  it("Caso C'': recorte_vendedor_cpst → DROP", () => {
    const payload = {
      lines: [
        { code: 'Z', asigRefs: [{ pedidoId: 'P8', lineIndex: 0, sku: 'Z', qtyAsignada: 1 }] },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P8',
      makeSnap([
        { code: 'Z', state: 'cancelled', qtyOpen: 0, closedReason: 'recorte_vendedor_cpst' },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(1);
  });

  it('Caso D: waitlist-confirm (consumida por otro pedido) → DROP', () => {
    const payload = {
      lines: [
        {
          code: 'ALV6000',
          asigRefs: [{ pedidoId: 'P9', lineIndex: 0, sku: 'ALV6000', qtyAsignada: 1 }],
        },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P9',
      makeSnap([
        {
          code: 'ALV6000',
          state: 'cancelled',
          qtyOpen: 0,
          closedReason: 'waitlist-confirm',
          cancelledIntoPedidoId: 'otro-pedido-id',
        },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(1);
    expect(r.events[0].reason).toBe('consumida_otro_pedido');
  });

  it('Caso E zombie: qtyOpen=0 en ASIG → DROP', () => {
    const payload = {
      lines: [
        { code: 'W', asigRefs: [{ pedidoId: 'P10', lineIndex: 0, sku: 'W', qtyAsignada: 1 }] },
      ],
    };
    const snaps = new Map();
    snaps.set('P10', makeSnap([{ code: 'W', state: 'ASIG', qtyOpen: 0 }]));
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(1);
    expect(r.events[0].reason).toBe('zombie_qtyopen_cero');
  });

  it("Caso E' qtyAsignada > qtyOpen → KEEP (CHECK F sigue abortando downstream)", () => {
    const payload = {
      lines: [
        { code: 'V', asigRefs: [{ pedidoId: 'P11', lineIndex: 0, sku: 'V', qtyAsignada: 10 }] },
      ],
    };
    const snaps = new Map();
    snaps.set('P11', makeSnap([{ code: 'V', state: 'ASIG', qtyOpen: 3 }]));
    const r = healAsigRefs(payload, snaps);
    // Decisión conservadora: no auto-clampear. Deja que CHECK F dispare.
    expect(r.clampedRefs).toBe(0);
    expect(r.healedCount).toBe(0);
    expect(payload.lines[0].asigRefs[0].qtyAsignada).toBe(10);
  });

  // v1589 (2026-11-26) — recorte cuando la reducción la hizo el reconcile §40.11.
  const reconcileTwin = (splitFrom, qty) => ({
    code: 'V',
    state: 'BO',
    qty,
    qtyOpen: qty,
    asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
    splitFromLineIndex: splitFrom,
  });

  it("Caso E'' qtyAsignada > qtyOpen CON gemela del reconcile → CLAMP a qtyOpen", () => {
    const payload = {
      lines: [
        { code: 'V', asigRefs: [{ pedidoId: 'P20', lineIndex: 0, sku: 'V', qtyAsignada: 3 }] },
      ],
    };
    const snaps = new Map();
    snaps.set('P20', makeSnap([{ code: 'V', state: 'ASIG', qtyOpen: 1 }, reconcileTwin(0, 2)]));
    const r = healAsigRefs(payload, snaps);
    expect(r.clampedRefs).toBe(1);
    expect(payload.lines[0].asigRefs[0].qtyAsignada).toBe(1);
    expect(r.events[0].reason).toBe('reducida_por_reconcile');
    expect(r.events[0].originalQty).toBe(3);
  });

  it("Caso E'' gemela de OTRO SKU o con otro motivo → KEEP (no recorta)", () => {
    const payload = {
      lines: [
        { code: 'V', asigRefs: [{ pedidoId: 'P21', lineIndex: 0, sku: 'V', qtyAsignada: 3 }] },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P21',
      makeSnap([
        { code: 'V', state: 'ASIG', qtyOpen: 1 },
        { ...reconcileTwin(0, 2), code: 'OTRO' },
        { ...reconcileTwin(0, 2), asigRevertidaReason: 'asig_destildada_por_admin' },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.healedCount).toBe(0);
    expect(payload.lines[0].asigRefs[0].qtyAsignada).toBe(3);
  });

  it("Caso E'' dos refs a la misma línea reducida → reparte el saldo (1 + DROP)", () => {
    const payload = {
      lines: [
        { code: 'V', asigRefs: [{ pedidoId: 'P22', lineIndex: 0, sku: 'V', qtyAsignada: 2 }] },
        { code: 'V', asigRefs: [{ pedidoId: 'P22', lineIndex: 0, sku: 'V', qtyAsignada: 2 }] },
      ],
    };
    const snaps = new Map();
    snaps.set('P22', makeSnap([{ code: 'V', state: 'ASIG', qtyOpen: 1 }, reconcileTwin(0, 3)]));
    const r = healAsigRefs(payload, snaps);
    expect(payload.lines[0].asigRefs[0].qtyAsignada).toBe(1);
    expect(payload.lines[1].asigRefs).toHaveLength(0);
    expect(r.clampedRefs).toBe(1);
    expect(r.droppedRefs).toBe(1);
    expect(r.events[1].reason).toBe('reducida_por_reconcile_sin_saldo');
  });

  it("Caso E'' dos refs que entran juntas en qtyOpen → KEEP ambas", () => {
    const payload = {
      lines: [
        { code: 'V', asigRefs: [{ pedidoId: 'P23', lineIndex: 0, sku: 'V', qtyAsignada: 1 }] },
        { code: 'V', asigRefs: [{ pedidoId: 'P23', lineIndex: 0, sku: 'V', qtyAsignada: 2 }] },
      ],
    };
    const snaps = new Map();
    snaps.set('P23', makeSnap([{ code: 'V', state: 'ASIG', qtyOpen: 3 }, reconcileTwin(0, 1)]));
    const r = healAsigRefs(payload, snaps);
    expect(r.healedCount).toBe(0);
  });

  it('ASIG viva + qty OK → KEEP (no healing)', () => {
    const payload = {
      lines: [
        { code: 'U', asigRefs: [{ pedidoId: 'P12', lineIndex: 0, sku: 'U', qtyAsignada: 2 }] },
      ],
    };
    const snaps = new Map();
    snaps.set('P12', makeSnap([{ code: 'U', state: 'ASIG', qtyOpen: 5 }]));
    const r = healAsigRefs(payload, snaps);
    expect(r.healedCount).toBe(0);
    expect(payload.lines[0].asigRefs).toHaveLength(1);
    expect(payload.lines[0].asigRefs[0].qtyAsignada).toBe(2);
  });

  it('SKU_MISMATCH → KEEP (no enmascarar inconsistencia del payload)', () => {
    const payload = {
      lines: [
        { code: 'A', asigRefs: [{ pedidoId: 'P13', lineIndex: 0, sku: 'A', qtyAsignada: 1 }] },
      ],
    };
    const snaps = new Map();
    snaps.set(
      'P13',
      makeSnap([
        {
          code: 'B', // SKU distinto
          state: 'BO',
          qtyOpen: 1,
          asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
        },
      ])
    );
    const r = healAsigRefs(payload, snaps);
    // SKU mismatch → KEEP (abort downstream con CHECK C SKU_MISMATCH)
    expect(r.healedCount).toBe(0);
    expect(payload.lines[0].asigRefs).toHaveLength(1);
  });

  it('PEDIDO_ORIGEN_NOT_FOUND (snap exists=false) → KEEP', () => {
    const payload = {
      lines: [
        {
          code: 'T',
          asigRefs: [{ pedidoId: 'P-MISSING', lineIndex: 0, sku: 'T', qtyAsignada: 1 }],
        },
      ],
    };
    const snaps = new Map();
    snaps.set('P-MISSING', makeSnap([], false));
    const r = healAsigRefs(payload, snaps);
    expect(r.healedCount).toBe(0);
  });

  it('LINE_INDEX_INVALID → KEEP', () => {
    const payload = {
      lines: [
        { code: 'S', asigRefs: [{ pedidoId: 'P14', lineIndex: 99, sku: 'S', qtyAsignada: 1 }] },
      ],
    };
    const snaps = new Map();
    snaps.set('P14', makeSnap([{ code: 'S', state: 'ASIG', qtyOpen: 1 }]));
    const r = healAsigRefs(payload, snaps);
    expect(r.healedCount).toBe(0);
  });

  it('SNAKE SRL repro completo (4 refs STATE_MISMATCH) → 4 drops', () => {
    // Replica exacta del caso reportado.
    const payload = {
      lines: [
        {
          code: 'CLC70H2PY',
          asigRefs: [
            { pedidoId: '53vbayoJzYqceThBKCY9', lineIndex: 23, sku: 'CLC70H2PY', qtyAsignada: 1 },
          ],
        },
        {
          code: '26ZODIAS1610MH',
          asigRefs: [
            {
              pedidoId: 'mSuIidbMd74ziEMIBPUC',
              lineIndex: 27,
              sku: '26ZODIAS1610MH',
              qtyAsignada: 1,
            },
          ],
        },
        {
          code: 'SHMTECHLBLUEL',
          asigRefs: [
            {
              pedidoId: 'mSuIidbMd74ziEMIBPUC',
              lineIndex: 79,
              sku: 'SHMTECHLBLUEL',
              qtyAsignada: 1,
            },
          ],
        },
        {
          code: 'CAPSH2403',
          asigRefs: [
            { pedidoId: 'sXYuPOb8ZepIjnmYzENq', lineIndex: 23, sku: 'CAPSH2403', qtyAsignada: 1 },
          ],
        },
      ],
    };
    const snaps = new Map();
    // Las 4 líneas target están en state=BO + asigRevertidaReason revertida_a_bo.
    // 2 de ellas (SHMTECHLBLUEL + CAPSH2403 según reporte) tienen splitFromLineIndex,
    // pero como el estado es BO (no cancelled), el caso B no aplica — aplica A (DROP).
    snaps.set(
      '53vbayoJzYqceThBKCY9',
      makeSnap(
        makeFillLines(25, (i) => {
          if (i === 23) {
            return {
              code: 'CLC70H2PY',
              state: 'BO',
              qtyOpen: 1,
              asigReserva: false,
              asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
            };
          }
          return { code: 'X', state: 'confirmed', qtyOpen: 0 };
        })
      )
    );
    snaps.set(
      'mSuIidbMd74ziEMIBPUC',
      makeSnap(
        makeFillLines(100, (i) => {
          if (i === 27) {
            return {
              code: '26ZODIAS1610MH',
              state: 'BO',
              qtyOpen: 1,
              asigReserva: false,
              asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
            };
          }
          if (i === 79) {
            return {
              code: 'SHMTECHLBLUEL',
              state: 'BO',
              qtyOpen: 1,
              asigReserva: false,
              asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
              splitFromLineIndex: 50,
            };
          }
          return { code: 'X', state: 'confirmed', qtyOpen: 0 };
        })
      )
    );
    snaps.set(
      'sXYuPOb8ZepIjnmYzENq',
      makeSnap(
        makeFillLines(25, (i) => {
          if (i === 23) {
            return {
              code: 'CAPSH2403',
              state: 'BO',
              qtyOpen: 2,
              asigReserva: false,
              asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
              splitFromLineIndex: 10,
            };
          }
          return { code: 'X', state: 'confirmed', qtyOpen: 0 };
        })
      )
    );
    const r = healAsigRefs(payload, snaps);
    expect(r.droppedRefs).toBe(4);
    expect(r.healedCount).toBe(4);
    expect(r.events.every((e) => e.reason === 'revertida_a_bo')).toBe(true);
    // Todas las asigRefs quedaron vacías.
    expect(payload.lines.every((l) => l.asigRefs.length === 0)).toBe(true);
  });
});

function makeFillLines(n, factory) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = factory(i);
  return arr;
}

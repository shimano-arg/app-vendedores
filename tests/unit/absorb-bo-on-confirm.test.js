// @ts-check
/**
 * §J (v1455 2026-10-25) — Unit tests `computeBoAbsorption` + helpers.
 *
 * 10 casos canónicos del plan + edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAbsorptionsToLines,
  buildBackfillKey,
  buildBackfillUpdate,
  computeBoAbsorption,
} from '../../src/pure/absorb-bo-on-confirm.js';

/** @param {string} iso */
function ms(iso) {
  return new Date(iso).getTime();
}

/**
 * Helper para armar un pedido mock mínimo.
 * @param {{id: string, cardCode: string, createdAt: string, closedAt?: string | null, lines: Array<any>}} p
 */
function pedido(p) {
  return {
    _fsId: p.id,
    clientCardCode: p.cardCode,
    createdAt: p.createdAt,
    closedAt: p.closedAt || null,
    lines: p.lines,
  };
}

/**
 * @param {Partial<{code: string, state: string, qty: number, qtyOpen: number, qtyCancelled: number}>} l
 */
function line(l) {
  return {
    code: l.code || 'SKU-X',
    state: l.state || 'BO',
    qty: Number(l.qty || l.qtyOpen || 0),
    qtyOpen: Number(l.qtyOpen || 0),
    qtyCancelled: Number(l.qtyCancelled || 0),
    qtyInvoiced: 0,
    qtyRecycled: 0,
    precio: 100,
  };
}

describe('§J computeBoAbsorption — 10 casos canónicos', () => {
  it('T1 — sin BO del cliente → absorptions=[], totalCubierto=0', () => {
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 5 }],
      allPedidos: [],
    });
    expect(r.absorptions).toEqual([]);
    expect(r.totalCubierto).toBe(0);
  });

  it('T2 — 1 BO exacto qtyOpen=X → absorbe X, línea queda qtyOpen=0', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 5 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toHaveLength(1);
    expect(r.absorptions[0]).toMatchObject({
      sku: 'SKU-X',
      cantidad: 5,
      pedidoIdOrigen: 'ped-A',
      lineIndexOrigen: 0,
      qtyAntes: 5,
      qtyDespues: 0,
    });
    expect(r.totalCubierto).toBe(5);
  });

  it('T3 — 1 BO parcial qtyOpen>X → absorbe X, qtyOpen queda qtyOpen-X', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 10, qtyOpen: 10 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 3 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toHaveLength(1);
    expect(r.absorptions[0].qtyAntes).toBe(10);
    expect(r.absorptions[0].qtyDespues).toBe(7);
    expect(r.absorptions[0].cantidad).toBe(3);
    expect(r.totalCubierto).toBe(3);
  });

  it('T4 — múltiples BO FIFO (2 pedidos distintos) → absorbe empezando por más viejo', () => {
    const pOld = pedido({
      id: 'ped-OLD',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 3, qtyOpen: 3 })],
    });
    const pNew = pedido({
      id: 'ped-NEW',
      cardCode: 'C001',
      createdAt: '2026-10-15T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 10, qtyOpen: 10 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 5 }],
      allPedidos: [pNew, pOld], // orden input random
    });
    expect(r.absorptions).toHaveLength(2);
    // Primero el viejo (3u completos), después el nuevo (2u).
    expect(r.absorptions[0].pedidoIdOrigen).toBe('ped-OLD');
    expect(r.absorptions[0].cantidad).toBe(3);
    expect(r.absorptions[0].qtyDespues).toBe(0);
    expect(r.absorptions[1].pedidoIdOrigen).toBe('ped-NEW');
    expect(r.absorptions[1].cantidad).toBe(2);
    expect(r.absorptions[1].qtyDespues).toBe(8);
    expect(r.totalCubierto).toBe(5);
  });

  it('T5 — cardCode distinto NO absorbe', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C999', // DIFERENTE
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 5 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toEqual([]);
    expect(r.totalCubierto).toBe(0);
  });

  it('T6 — SKU distinto NO absorbe', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-Y', state: 'BO', qty: 5, qtyOpen: 5 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 5 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toEqual([]);
    expect(r.totalCubierto).toBe(0);
  });

  it('T7 — qty 0 en payload → skip (sin absorption)', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 0 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toEqual([]);
    expect(r.totalCubierto).toBe(0);
  });

  it('T8 — BO con qtyOpen=0 → skip (ya cancelado)', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 0 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 3 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toEqual([]);
    expect(r.totalCubierto).toBe(0);
  });

  it('T9 — idempotencia: segunda invocación tras aplicar mutaciones → []', () => {
    // Simular que ya se aplicó una vez: la línea quedó cancelled.
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'cancelled', qty: 5, qtyOpen: 0 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 5 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toEqual([]);
    expect(r.totalCubierto).toBe(0);
  });

  it('T10 — pedido con closedAt!=null → skip', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      closedAt: '2026-10-10T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 5 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toEqual([]);
    expect(r.totalCubierto).toBe(0);
  });
});

describe('§J computeBoAbsorption — edge cases', () => {
  it('absorbe cuando qty pedida > suma de BO disponible (cap)', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 3, qtyOpen: 3 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 10 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toHaveLength(1);
    expect(r.absorptions[0].cantidad).toBe(3);
    expect(r.totalCubierto).toBe(3);
  });

  it('múltiples líneas BO del mismo SKU en un pedido → FIFO por lineIndex', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [
        line({ code: 'SKU-X', state: 'BO', qty: 2, qtyOpen: 2 }),
        line({ code: 'SKU-X', state: 'BO', qty: 3, qtyOpen: 3 }),
      ],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 4 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toHaveLength(2);
    expect(r.absorptions[0].lineIndexOrigen).toBe(0);
    expect(r.absorptions[0].cantidad).toBe(2);
    expect(r.absorptions[1].lineIndexOrigen).toBe(1);
    expect(r.absorptions[1].cantidad).toBe(2);
    expect(r.absorptions[1].qtyDespues).toBe(1);
  });

  it('pure: mismo input llamado 2 veces → mismo output (determinística)', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 })],
    });
    const payload = {
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 3 }],
      allPedidos: [p],
    };
    const r1 = computeBoAbsorption(payload);
    const r2 = computeBoAbsorption(payload);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('múltiples SKUs en el payload → cada uno absorbe por su cuenta', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [
        line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 }),
        line({ code: 'SKU-Y', state: 'BO', qty: 2, qtyOpen: 2 }),
      ],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [
        { sku: 'SKU-X', cantidad: 2 },
        { sku: 'SKU-Y', cantidad: 1 },
      ],
      allPedidos: [p],
    });
    expect(r.absorptions).toHaveLength(2);
    expect(r.totalCubierto).toBe(3);
  });

  it('SKU en lower-case → normaliza', () => {
    const p = pedido({
      id: 'ped-A',
      cardCode: 'C001',
      createdAt: '2026-10-01T00:00:00Z',
      lines: [line({ code: 'sku-x', state: 'BO', qty: 5, qtyOpen: 5 })],
    });
    const r = computeBoAbsorption({
      cardCode: 'C001',
      lines: [{ sku: 'SKU-X', cantidad: 3 }],
      allPedidos: [p],
    });
    expect(r.absorptions).toHaveLength(1);
    expect(r.absorptions[0].cantidad).toBe(3);
  });
});

describe('§J applyAbsorptionsToLines — mutaciones', () => {
  it('qtyOpen=0 post absorb → state=cancelled + closedReason', () => {
    const lines = [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 })];
    const abs = [
      {
        sku: 'SKU-X',
        cantidad: 5,
        pedidoIdOrigen: 'ped-A',
        lineIndexOrigen: 0,
        qtyAntes: 5,
        qtyDespues: 0,
      },
    ];
    const newLines = applyAbsorptionsToLines(lines, abs, 'new-ped-id', '2026-10-25T12:00:00Z');
    expect(newLines[0].qtyOpen).toBe(0);
    expect(newLines[0].state).toBe('cancelled');
    expect(newLines[0].closedReason).toBe('absorbed_by_newer_confirmed');
    expect(newLines[0].cancelledIntoPedidoId).toBe('new-ped-id');
    expect(newLines[0].absorbedByNewerPedidoId).toBe('new-ped-id');
    expect(newLines[0].qtyCancelled).toBe(5);
    expect(newLines[0].asigReserva).toBe(false);
  });

  it('qtyOpen>0 post absorb → sigue BO + partialCancel', () => {
    const lines = [line({ code: 'SKU-X', state: 'BO', qty: 10, qtyOpen: 10 })];
    const abs = [
      {
        sku: 'SKU-X',
        cantidad: 3,
        pedidoIdOrigen: 'ped-A',
        lineIndexOrigen: 0,
        qtyAntes: 10,
        qtyDespues: 7,
      },
    ];
    const newLines = applyAbsorptionsToLines(lines, abs, 'new-ped-id', '2026-10-25T12:00:00Z');
    expect(newLines[0].qtyOpen).toBe(7);
    expect(newLines[0].state).toBe('BO');
    expect(newLines[0].partialCancelFrom).toBe('absorbed_by_newer_confirmed');
    expect(newLines[0].partialCancelQty).toBe(3);
    expect(newLines[0].qtyCancelled).toBe(3);
  });

  it('no muta el array original', () => {
    const originalLines = [line({ code: 'SKU-X', state: 'BO', qty: 5, qtyOpen: 5 })];
    const abs = [
      {
        sku: 'SKU-X',
        cantidad: 5,
        pedidoIdOrigen: 'ped-A',
        lineIndexOrigen: 0,
        qtyAntes: 5,
        qtyDespues: 0,
      },
    ];
    const newLines = applyAbsorptionsToLines(originalLines, abs, 'new', '2026-10-25T12:00:00Z');
    expect(originalLines[0].state).toBe('BO');
    expect(originalLines[0].qtyOpen).toBe(5);
    expect(newLines[0]).not.toBe(originalLines[0]);
  });
});

describe('§J buildBackfillUpdate', () => {
  it('agrega entrada con key versionada por fecha', () => {
    const existing = {};
    const abs = [
      {
        sku: 'SKU-X',
        cantidad: 3,
        pedidoIdOrigen: 'ped-A',
        lineIndexOrigen: 0,
        qtyAntes: 5,
        qtyDespues: 2,
      },
    ];
    const bf = buildBackfillUpdate(existing, abs, 'new-ped-id', '2026-10-25T12:00:00Z');
    const key = buildBackfillKey('2026-10-25T12:00:00Z');
    expect(bf[key]).toBeDefined();
    expect(bf[key].consumedBy).toBe('new-ped-id');
    expect(bf[key].absorptions).toHaveLength(1);
    expect(bf[key].absorptions[0]).toMatchObject({
      sku: 'SKU-X',
      cantidad: 3,
      qtyAntes: 5,
      qtyDespues: 2,
      lineIndex: 0,
    });
    expect(bf[key].source).toBe('commitPedidoCF');
  });

  it('preserva _backfill previos (append-only)', () => {
    const existing = {
      J_bo_absorbed_prev: { foo: 'bar' },
    };
    const abs = [
      {
        sku: 'SKU-X',
        cantidad: 1,
        pedidoIdOrigen: 'ped-A',
        lineIndexOrigen: 0,
        qtyAntes: 1,
        qtyDespues: 0,
      },
    ];
    const bf = buildBackfillUpdate(existing, abs, 'new', '2026-10-25T12:00:00Z');
    expect(bf.J_bo_absorbed_prev).toEqual({ foo: 'bar' });
    const key = buildBackfillKey('2026-10-25T12:00:00Z');
    expect(bf[key]).toBeDefined();
  });
});

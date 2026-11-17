// @ts-check
/**
 * v8 §E1 (2026-11-17 Reparto dep 12) — Tests del breakdown con buckets
 * `libreTransito` + `asignadas.totalTransito` + `confirmadas.totalTransito`
 * + comportamiento de `lineReservesStock` con `line.enTransito === true`.
 *
 * Tests T1-T15 por el plan + CPST T14/T15.
 */
import { describe, expect, it } from 'vitest';
import { buildClosedReasonWithTransito } from '../../src/pure/cpst-cancel-asig-plan.js';
import { computeCpstRevertPlan } from '../../src/pure/cpst-revert-plan.js';
import { getStockBreakdown } from '../../src/pure/stock-breakdown.js';
import { lineReservesStock } from '../../src/pure/stock-realmente-disponible.js';

/** Helper fábrica del snapshot deps. */
function deps({ fisico = 0, transito = 0, pedidos = [] } = {}) {
  return {
    getStockFisico: (_sku) => fisico,
    getStockTransito: (_sku) => transito,
    pedidos,
  };
}

/** Helper línea ASIG con/sin enTransito. */
function asigLine({ qty = 1, asigAt = null, enTransito = false, asigAtTransito = null } = {}) {
  const l = { code: 'SKU1', state: 'ASIG', qty, qtyOpen: qty };
  if (asigAt) l.asigAt = asigAt;
  if (enTransito) l.enTransito = true;
  if (asigAtTransito) l.asigAtTransito = asigAtTransito;
  return l;
}

function confLine({ qty = 1, enTransito = false, confirmedAtTransito = null } = {}) {
  const l = { code: 'SKU1', state: 'confirmed', qty, qtyOpen: qty };
  if (enTransito) l.enTransito = true;
  if (confirmedAtTransito) l.confirmedAtTransito = confirmedAtTransito;
  return l;
}

function pedido({ confirmedAt = null, createdAt = null, lines = [] } = {}) {
  return {
    _fsId: 'P1',
    clientCardCode: 'C001',
    clientName: 'cli',
    closedAt: null,
    confirmedAt,
    createdAt,
    lines,
  };
}

const nowIso = new Date().toISOString();
const NOW_MS = Date.now();

describe('v8 §E1 — buckets tránsito dep 12', () => {
  it('T1: físico=5 + tránsito=3 + 0 ASIG → libre=5, libreTransito=3, asignadas.totalTransito=0', () => {
    const b = getStockBreakdown('SKU1', deps({ fisico: 5, transito: 3 }));
    expect(b.fisicoDep11).toBe(5);
    expect(b.transitoDep12).toBe(3);
    expect(b.libre).toBe(5);
    expect(b.libreTransito).toBe(3);
    expect(b.asignadas.totalTransito).toBe(0);
    expect(b._version).toBe(8);
  });

  it('T2: físico=5 + tránsito=3 + ASIG qty=2 enTransito=true → libre=5, libreTransito=1, asignadas.totalTransito=2', () => {
    const p = pedido({
      confirmedAt: nowIso,
      createdAt: nowIso,
      lines: [asigLine({ qty: 2, enTransito: true, asigAtTransito: nowIso })],
    });
    const b = getStockBreakdown('SKU1', deps({ fisico: 5, transito: 3, pedidos: [p] }));
    expect(b.libre).toBe(5);
    expect(b.libreTransito).toBe(1);
    expect(b.asignadas.totalTransito).toBe(2);
    expect(b.asignadas.totalFisico).toBe(0);
    expect(b.asignadas.total).toBe(2);
  });

  it('T3: físico=5 + tránsito=3 + ASIG qty=2 enTransito=false → libre=3, libreTransito=3', () => {
    const p = pedido({
      createdAt: nowIso,
      lines: [asigLine({ qty: 2, asigAt: nowIso, enTransito: false })],
    });
    const b = getStockBreakdown('SKU1', deps({ fisico: 5, transito: 3, pedidos: [p] }));
    expect(b.libre).toBe(3);
    expect(b.libreTransito).toBe(3);
    expect(b.asignadas.totalFisico).toBe(2);
    expect(b.asignadas.totalTransito).toBe(0);
  });

  it('T4: asignadas.total suma ambos buckets (físico + tránsito)', () => {
    const p = pedido({
      createdAt: nowIso,
      lines: [
        asigLine({ qty: 2, asigAt: nowIso }),
        { ...asigLine({ qty: 3, enTransito: true, asigAtTransito: nowIso }), code: 'SKU1' },
      ],
    });
    const b = getStockBreakdown('SKU1', deps({ fisico: 10, transito: 10, pedidos: [p] }));
    expect(b.asignadas.total).toBe(5);
    expect(b.asignadas.totalFisico).toBe(2);
    expect(b.asignadas.totalTransito).toBe(3);
  });

  it('T5: confirmed enTransito → confirmadasSinFacturar.totalTransito poblado', () => {
    const p = pedido({
      confirmedAt: nowIso,
      createdAt: nowIso,
      lines: [confLine({ qty: 4, enTransito: true, confirmedAtTransito: nowIso })],
    });
    const b = getStockBreakdown('SKU1', deps({ fisico: 2, transito: 10, pedidos: [p] }));
    expect(b.confirmadasSinFacturar.totalTransito).toBe(4);
    expect(b.confirmadasSinFacturar.totalFisico).toBe(0);
    expect(b.confirmadasSinFacturar.total).toBe(4);
    expect(b.libre).toBe(2);
    expect(b.libreTransito).toBe(6);
  });

  it('T6: confirmed físico + tránsito mixto', () => {
    const p1 = pedido({
      _fsId: 'P1',
      confirmedAt: nowIso,
      lines: [confLine({ qty: 1 })],
    });
    const p2 = pedido({
      _fsId: 'P2',
      confirmedAt: nowIso,
      createdAt: nowIso,
      lines: [confLine({ qty: 3, enTransito: true, confirmedAtTransito: nowIso })],
    });
    p2._fsId = 'P2';
    const b = getStockBreakdown('SKU1', deps({ fisico: 2, transito: 5, pedidos: [p1, p2] }));
    expect(b.confirmadasSinFacturar.totalFisico).toBe(1);
    expect(b.confirmadasSinFacturar.totalTransito).toBe(3);
  });

  it('T7: libreTransito nunca negativo (clamp)', () => {
    const p = pedido({
      createdAt: nowIso,
      lines: [asigLine({ qty: 10, enTransito: true, asigAtTransito: nowIso })],
    });
    const b = getStockBreakdown('SKU1', deps({ fisico: 0, transito: 3, pedidos: [p] }));
    expect(b.libreTransito).toBe(0);
    expect(b.libreTransito).toBeGreaterThanOrEqual(0);
  });

  it('T8: snapshot sin getStockTransito → libreTransito=0 sin romper', () => {
    const b = getStockBreakdown('SKU1', {
      getStockFisico: () => 5,
      // getStockTransito omitido deliberadamente
      pedidos: [],
    });
    expect(b.transitoDep12).toBe(0);
    expect(b.libreTransito).toBe(0);
    expect(b.libre).toBe(5);
  });

  it('T9: ASIG enTransito con asigAt vieja (10d) → sigue reservando (TTL soft ignorado)', () => {
    const tenDaysAgo = new Date(NOW_MS - 10 * 24 * 60 * 60 * 1000).toISOString();
    const line = asigLine({ qty: 2, asigAt: tenDaysAgo, enTransito: true, asigAtTransito: nowIso });
    const p = pedido({ createdAt: nowIso, lines: [line] });
    expect(lineReservesStock(line, NOW_MS, p)).toBe(true);
  });

  it('T10: ASIG enTransito con asigAtTransito 31d → NO reserva (hard cap 30d)', () => {
    const thirtyOneDaysAgo = new Date(NOW_MS - 31 * 24 * 60 * 60 * 1000).toISOString();
    const line = asigLine({ qty: 1, enTransito: true, asigAtTransito: thirtyOneDaysAgo });
    const p = pedido({ createdAt: nowIso, lines: [line] });
    expect(lineReservesStock(line, NOW_MS, p)).toBe(false);
  });

  it('T11: ASIG enTransito sin asigAtTransito, fallback a asigAt para hard cap', () => {
    const fifteenDaysAgo = new Date(NOW_MS - 15 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyOneDaysAgo = new Date(NOW_MS - 31 * 24 * 60 * 60 * 1000).toISOString();
    // asigAt 15d → OK (< 30d hard cap tránsito), soft 7d ignorado.
    const lineOk = asigLine({ qty: 1, asigAt: fifteenDaysAgo, enTransito: true });
    expect(lineReservesStock(lineOk, NOW_MS, pedido({ createdAt: nowIso }))).toBe(true);
    // asigAt 31d → excede hard cap.
    const lineBad = asigLine({ qty: 1, asigAt: thirtyOneDaysAgo, enTransito: true });
    expect(lineReservesStock(lineBad, NOW_MS, pedido({ createdAt: nowIso }))).toBe(false);
  });

  it('T12: Sin asigAt ni asigAtTransito → fallback a pedido.createdAt para hard cap', () => {
    const thirtyOneDaysAgo = new Date(NOW_MS - 31 * 24 * 60 * 60 * 1000).toISOString();
    const line = asigLine({ qty: 1, enTransito: true });
    const p = pedido({ createdAt: thirtyOneDaysAgo });
    expect(lineReservesStock(line, NOW_MS, p)).toBe(false);
    // Fail-open si no hay ninguna fecha
    const p2 = pedido({ createdAt: null });
    expect(lineReservesStock(line, NOW_MS, p2)).toBe(true);
  });

  it('T13: confirmed enTransito con confirmedAt 61d → NO reserva (hard cap 60d)', () => {
    const sixtyOneDaysAgo = new Date(NOW_MS - 61 * 24 * 60 * 60 * 1000).toISOString();
    const line = confLine({ qty: 1, enTransito: true });
    const p = pedido({ confirmedAt: sixtyOneDaysAgo, createdAt: sixtyOneDaysAgo });
    expect(lineReservesStock(line, NOW_MS, p)).toBe(false);
    // 59d → OK (confirmed+enTransito ignora soft 7d).
    const fiftyNineDaysAgo = new Date(NOW_MS - 59 * 24 * 60 * 60 * 1000).toISOString();
    const pOk = pedido({ confirmedAt: fiftyNineDaysAgo, createdAt: fiftyNineDaysAgo });
    expect(lineReservesStock(line, NOW_MS, pOk)).toBe(true);
  });
});

describe('v8 §E1 — CPST extensions', () => {
  it('T14: computeCpstRevertPlan incluye wasEnTransito en plan output', () => {
    const entries = [
      { pedidoId: 'P1', lineIndex: 0, qtyAsignada: 2, enTransito: true },
      { pedidoId: 'P2', lineIndex: 1, qtyAsignada: 3, enTransito: false },
    ];
    const plan = computeCpstRevertPlan(entries, 0); // revert_full para todas
    expect(plan).toHaveLength(2);
    expect(plan[0].wasEnTransito).toBe(true);
    expect(plan[0].action).toBe('revert_full');
    expect(plan[1].wasEnTransito).toBe(false);
    expect(plan[1].action).toBe('revert_full');
  });

  it('T15: buildClosedReasonWithTransito agrega _transito suffix si ref era tránsito', () => {
    expect(buildClosedReasonWithTransito('cliente_rechazo_cpst', { enTransito: true })).toBe(
      'cliente_rechazo_cpst_transito'
    );
    expect(buildClosedReasonWithTransito('quitado_por_vendedor_cpst', { enTransito: true })).toBe(
      'quitado_por_vendedor_cpst_transito'
    );
    // enTransito=false/undefined → base reason sin suffix.
    expect(buildClosedReasonWithTransito('cliente_rechazo_cpst', { enTransito: false })).toBe(
      'cliente_rechazo_cpst'
    );
    expect(buildClosedReasonWithTransito('cliente_rechazo_cpst', {})).toBe('cliente_rechazo_cpst');
    expect(buildClosedReasonWithTransito('cliente_rechazo_cpst', null)).toBe(
      'cliente_rechazo_cpst'
    );
  });
});

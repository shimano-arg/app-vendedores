// @ts-check
/**
 * §39 FIX v9 (2026-11-24) — tests para el override agregados en
 * getStockBreakdown.
 *
 * Reproduce los 14 casos clasificados por V_output_post_deploy_2026-11-24.txt
 * + Mauricio C27184733760 EXGC58MHB (dos entries duplicate retry del mismo
 * draftId; 1 caso único por draftId).
 *
 * Invariantes:
 * - Con `snapshotAgregados=true` + getters válidos: reservadasTotal usa los
 *   agregados del snapshot (igual al server) → MISMO que server.
 * - Con `snapshotAgregados=false` o getters ausentes: cae al iterate legacy
 *   (deps.pedidos).
 * - Server (sin snapshotAgregados): sigue iterating → ground truth.
 * - _version=9 si se usó agregados; 8 si legacy.
 * - fisicoDep11 + libre + utilizablePara derivados correctamente.
 * - Zero sobreventa posible: libre nunca < 0, reservadasTotal cap por físico.
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown } from '../../src/pure/stock-breakdown.js';

const NOW = Date.parse('2026-11-24T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

// Fixture emulando los 14 casos §39: cliente VDE itera `pedidos` filtrado por
// assignedVendorUid → ve solo SUS pedidos (ningún otro vendor). Server itera
// TODOS → ve todas las reservas cross-vendor.
//
// Setup: fisicoDep11=5 para SKU-X. Hay 1 pedido ASIG del VDE (cliente C1, 2u)
// + 1 pedido ASIG de OTRO vendor (cliente C2, 3u). Total reservado real = 5u.
//
// Cliente VDE sin agregados ve solo el suyo → reservadasTotal=2 → libre=3.
// Server ve todos → reservadasTotal=5 → libre=0. STOCK_CHANGED cuando VDE
// confirma qty=3 pensando que hay libre, server rechaza.
//
// Post-fix §39 v9: cliente con agregados ve reservadasTotal=5 → libre=0 →
// NO intenta confirmar algo que el server ya reserva.

const _vdePedidoPropio = {
  _fsId: 'ped-vde',
  closedAt: null,
  clientCardCode: 'C1',
  clientName: 'CLIENTE VDE',
  createdAt: daysAgo(1),
  assignedVendorUid: 'uid-vde',
  lines: [{ code: 'SKU-X', state: 'ASIG', qtyOpen: 2, asigAt: daysAgo(1) }],
};

const _otroVendorPedido = {
  _fsId: 'ped-otro',
  closedAt: null,
  clientCardCode: 'C2',
  clientName: 'CLIENTE OTRO',
  createdAt: daysAgo(1),
  assignedVendorUid: 'uid-otro-vendor',
  lines: [{ code: 'SKU-X', state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(1) }],
};

describe('§39 FIX v9 — override agregados cierra divergencia cliente↔server', () => {
  it('cliente VDE sin agregados ve reservadasTotal menor (iterate filtrado)', () => {
    // Simula listener cliente filtrado por assignedVendorUid='uid-vde'.
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [_vdePedidoPropio], // SOLO el del VDE (filtrado).
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(2);
    expect(b.libre).toBe(3);
    expect(b._version).toBe(8);
  });

  it('server con iterate completo ve reservadasTotal real (ground truth)', () => {
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [_vdePedidoPropio, _otroVendorPedido], // Admin SDK ve TODO.
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(5);
    expect(b.libre).toBe(0);
    expect(b._version).toBe(8);
  });

  it('cliente VDE con agregados v9 ve lo MISMO que server (fix §39)', () => {
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [_vdePedidoPropio], // filtrado cliente.
        snapshotAgregados: true,
        getAsignadaBySku: (s) => (s === 'SKU-X' ? 5 : 0), // agregado real del server.
        getConfirmadaBySku: () => 0,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(5); // alineado con server
    expect(b.libre).toBe(0); // NO intenta confirmar algo ya reservado
    expect(b._version).toBe(9);
  });

  it('cliente VDE con agregados mezcla ASIG + confirmed server-side', () => {
    // Server ve: ASIG=5 + confirmed=2 → total reservado=7, cap por fisico=5 → libre=0.
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [_vdePedidoPropio],
        snapshotAgregados: true,
        getAsignadaBySku: () => 5,
        getConfirmadaBySku: () => 2,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(5); // cap por fisicoDep11
    expect(b.libre).toBe(0);
    expect(b._version).toBe(9);
  });

  it('cliente VDE con agregados y fisico > reservas: libre correcto', () => {
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 10,
        pedidos: [_vdePedidoPropio],
        snapshotAgregados: true,
        getAsignadaBySku: () => 5,
        getConfirmadaBySku: () => 2,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(7);
    expect(b.libre).toBe(3);
    expect(b._version).toBe(9);
  });

  it('snapshotAgregados=false → fallback iterate aunque getters estén', () => {
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [_vdePedidoPropio],
        snapshotAgregados: false,
        getAsignadaBySku: () => 99,
        getConfirmadaBySku: () => 99,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(2); // iterate legacy, ignora getters
    expect(b._version).toBe(8);
  });

  it('snapshotAgregados=true pero getters ausentes → fallback iterate', () => {
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [_vdePedidoPropio],
        snapshotAgregados: true,
        // getters undefined
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(2); // iterate legacy
    expect(b._version).toBe(8);
  });

  it('utilizablePara(cardCode) respeta reservas propias con agregados', () => {
    // Setup: fisico=5, ASIG agregado=5, cliente C1 tiene 2u propias ASIG.
    // Para C1: libre + reservasPropias = 0 + 2 = 2.
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [_vdePedidoPropio],
        snapshotAgregados: true,
        getAsignadaBySku: () => 5,
        getConfirmadaBySku: () => 0,
      },
      { now: NOW }
    );
    expect(b.utilizablePara('C1')).toBe(2);
    expect(b.utilizablePara('C999')).toBe(0); // cliente sin reservas propias
  });

  it('caso Mauricio C27184733760 EXGC58MHB — dos retries mismo draftId', () => {
    // Shape real post-deploy: fisicoDep11=1, reservadasTotal server=1,
    // libre server=0, cliente pensó libre>0 y pidió qty=1 → STOCK_CHANGED.
    // Post-fix: cliente ve 0 libre → NO intenta.
    const b = getStockBreakdown(
      'EXGC58MHB',
      {
        getStockFisico: () => 1,
        pedidos: [], // filtrado cliente VDE Mauricio: no ve la ASIG de otro vendor
        snapshotAgregados: true,
        getAsignadaBySku: (s) => (s === 'EXGC58MHB' ? 1 : 0),
        getConfirmadaBySku: () => 0,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(1);
    expect(b.libre).toBe(0);
    expect(b.utilizablePara('C27184733760')).toBe(0); // Mauricio no tiene ASIG propia
    expect(b._version).toBe(9);
  });

  it('agregados override NO permite sobreventa (cap fisicoDep11)', () => {
    // Agregados dicen 100 reservadas, pero fisico=5 → reservadasTotal=5, libre=0.
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [],
        snapshotAgregados: true,
        getAsignadaBySku: () => 100,
        getConfirmadaBySku: () => 0,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(5);
    expect(b.libre).toBe(0); // nunca negativo
  });

  it('agregados con fisico=0 → libre=0 siempre', () => {
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 0,
        pedidos: [],
        snapshotAgregados: true,
        getAsignadaBySku: () => 10,
        getConfirmadaBySku: () => 0,
      },
      { now: NOW }
    );
    expect(b.fisicoDep11).toBe(0);
    expect(b.reservadasTotal).toBe(0);
    expect(b.libre).toBe(0);
  });

  it('agregados con getters que devuelven null/undefined → coerción a 0', () => {
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        pedidos: [],
        snapshotAgregados: true,
        getAsignadaBySku: () => null,
        getConfirmadaBySku: () => undefined,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(0);
    expect(b.libre).toBe(5);
    expect(b._version).toBe(9);
  });

  it('v8 §E1 tránsito intacto: el fix NO toca libreTransito', () => {
    const transitoPed = {
      _fsId: 'ped-trans',
      closedAt: null,
      clientCardCode: 'C1',
      createdAt: daysAgo(1),
      lines: [{ code: 'SKU-X', state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(1), enTransito: true }],
    };
    const b = getStockBreakdown(
      'SKU-X',
      {
        getStockFisico: () => 5,
        getStockTransito: () => 5,
        pedidos: [transitoPed],
        snapshotAgregados: true,
        getAsignadaBySku: () => 5, // agregado físico (excluye tránsito)
        getConfirmadaBySku: () => 0,
      },
      { now: NOW }
    );
    expect(b.reservadasTotal).toBe(5); // físico cap
    expect(b.libre).toBe(0);
    expect(b.libreTransito).toBe(2); // 5 - 3 enTransito
  });
});

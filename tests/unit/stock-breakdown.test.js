// @ts-check
/**
 * v1392 (§40) — getStockBreakdown v2:
 *   - BO NO reserva (lineReservesStock('BO')→false).
 *   - repartoAbierto es INFORMATIVO (NO suma a reservadasTotal).
 *   - reservadasTotal = asignadas + confirmed + waitlistCpst.
 *   - libre = max(0, fisicoDep11 - reservadasTotal).
 *   - utilizablePara(cardCode) = min(fisico, libre + reservasPropias)
 *     donde reservasPropias NO incluye BO.
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown, STOCK_LABELS } from '../../src/pure/stock-breakdown.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const _ped = (opts) =>
  Object.assign(
    {
      _fsId: 'p1',
      closedAt: null,
      clientCardCode: 'C1',
      clientName: 'CLIENTE_1',
      createdAt: daysAgo(1),
      confirmedAt: daysAgo(1),
      lines: [],
    },
    opts
  );

const _makeDeps = ({ fisico = 0, transito = 0, pedidos = [], waitlist = [], ingresos = [] }) => ({
  getStockFisico: () => fisico,
  getStockTransito: () => transito,
  pedidos,
  waitlistEntries: waitlist,
  ingresosRepartoActivos: ingresos,
});

describe('v1392 §40 schema shape', () => {
  it('expone bucket repartoAbierto + mantiene pendienteReparto alias', () => {
    const b = getStockBreakdown('X', _makeDeps({}), { now: NOW });
    expect(Object.keys(b).sort()).toEqual(
      [
        '_version',
        'asignadas',
        'backorderApp',
        'confirmadasSinFacturar',
        'demandaSapSinCubrir',
        'fisicoDep11',
        'libre',
        'pendienteReparto',
        'repartoAbierto',
        'reservadasTotal',
        'sku',
        'transitoDep12',
        'utilizablePara',
        'waitlistCpst',
      ].sort()
    );
    expect(b._version).toBe(4);
    expect(b.demandaSapSinCubrir).toBe(null);
  });

  it('STOCK_LABELS incluye repartoAbierto, NO incluye demandaSapSinCubrir', () => {
    expect(STOCK_LABELS.repartoAbierto).toBe('En reparto pendiente (no reserva)');
    expect(STOCK_LABELS.backorderApp).toBe('Back order (app)');
    expect(STOCK_LABELS).not.toHaveProperty('demandaSapSinCubrir');
  });

  it('pendienteReparto === alias de repartoAbierto (compat v1391)', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 7,
        pedidos: [_ped({ lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] })],
        ingresos: [{ _fsId: 'ing1', sku: 'X', status: 'pending', qtyIngresada: 5 }],
      }),
      { now: NOW }
    );
    expect(b.pendienteReparto.qty).toBe(b.repartoAbierto.qty);
    expect(b.pendienteReparto.repartoId).toBe(b.repartoAbierto.repartoId);
  });
});

describe('v1392 §40 reservadasTotal NO incluye BO ni repartoAbierto', () => {
  it('fisico 10, BO 5, confirmed 3, ASIG 2 → reservadas=5 (3+2), libre=5', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 10,
        pedidos: [
          _ped({ _fsId: 'p1', lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] }),
          _ped({ _fsId: 'p2', lines: [{ code: 'X', state: 'confirmed', qtyOpen: 3 }] }),
          _ped({
            _fsId: 'p3',
            lines: [
              { code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: daysAgo(1) },
            ],
          }),
        ],
      }),
      { now: NOW }
    );
    expect(b.backorderApp.total).toBe(5);
    expect(b.confirmadasSinFacturar.total).toBe(3);
    expect(b.asignadas.total).toBe(2);
    expect(b.reservadasTotal).toBe(5);
    expect(b.libre).toBe(5);
  });

  it('repartoAbierto con qty=6 informativo, libre NO baja', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 7,
        pedidos: [
          _ped({ _fsId: 'p1', lines: [{ code: 'X', state: 'BO', qtyOpen: 10 }] }),
          _ped({
            _fsId: 'p2',
            lines: [
              { code: 'X', state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(1) },
            ],
          }),
        ],
        ingresos: [
          { _fsId: 'ing1', sku: 'X', status: 'pending', qtyIngresada: 6, assignments: [] },
        ],
      }),
      { now: NOW }
    );
    expect(b.repartoAbierto.qty).toBe(6);
    expect(b.repartoAbierto.repartoId).toBe('ing1');
    expect(b.repartoAbierto.status).toBe('pending');
    expect(b.reservadasTotal).toBe(1);
    expect(b.libre).toBe(6);
  });
});

describe('v1392 §40 fixtures CUDC201HG reales del prompt', () => {
  it('mañana + reparto abierto 6: reservadas 1, libre 6', () => {
    const b = getStockBreakdown(
      'CUDC201HG',
      _makeDeps({
        fisico: 7,
        pedidos: [
          _ped({
            _fsId: 'p_grau',
            clientCardCode: 'C_GRAU',
            clientName: 'GRAUBERGER',
            lines: [
              {
                code: 'CUDC201HG',
                state: 'ASIG',
                qtyOpen: 1,
                asigReserva: true,
                asigAt: daysAgo(1),
              },
            ],
          }),
          _ped({
            _fsId: 'p_a',
            clientCardCode: 'C_ANDRILI',
            clientName: 'ANDRILI',
            lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 2 }],
          }),
          _ped({
            _fsId: 'p_b',
            clientCardCode: 'C_ANT',
            clientName: 'ANTONINI',
            lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 2 }],
          }),
          _ped({
            _fsId: 'p_c',
            clientCardCode: 'C_IER',
            clientName: 'IERONIMO',
            lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 1 }],
          }),
          _ped({
            _fsId: 'p_d',
            clientCardCode: 'C_4N',
            clientName: '4 NARICES',
            lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 2 }],
          }),
          _ped({
            _fsId: 'p_e',
            clientCardCode: 'C_MAS',
            clientName: 'MASERA',
            lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 3 }],
          }),
        ],
        ingresos: [
          {
            _fsId: 'ing_wXqG9',
            sku: 'CUDC201HG',
            status: 'pending',
            qtyIngresada: 6,
            assignments: [],
          },
        ],
      }),
      { now: NOW }
    );
    expect(b.fisicoDep11).toBe(7);
    // Mariano dijo "11u BO" pero la suma de los 5 clientes es 10u (ver informe E0).
    expect(b.backorderApp.total).toBe(10);
    expect(b.asignadas.total).toBe(1);
    expect(b.repartoAbierto.qty).toBe(6);
    expect(b.reservadasTotal).toBe(1);
    expect(b.libre).toBe(6);
  });

  it('Pablo asignó 4u (ASIG pasa a 5), reparto cerrado: reservadas 5, libre 2', () => {
    const b = getStockBreakdown(
      'CUDC201HG',
      _makeDeps({
        fisico: 7,
        pedidos: [
          _ped({
            _fsId: 'p_grau',
            lines: [
              {
                code: 'CUDC201HG',
                state: 'ASIG',
                qtyOpen: 1,
                asigReserva: true,
                asigAt: daysAgo(1),
              },
            ],
          }),
          _ped({
            _fsId: 'p_a',
            lines: [
              {
                code: 'CUDC201HG',
                state: 'ASIG',
                qtyOpen: 1,
                asigReserva: true,
                asigAt: daysAgo(0),
              },
            ],
          }),
          _ped({
            _fsId: 'p_b',
            lines: [
              {
                code: 'CUDC201HG',
                state: 'ASIG',
                qtyOpen: 1,
                asigReserva: true,
                asigAt: daysAgo(0),
              },
            ],
          }),
          _ped({
            _fsId: 'p_c',
            lines: [
              {
                code: 'CUDC201HG',
                state: 'ASIG',
                qtyOpen: 1,
                asigReserva: true,
                asigAt: daysAgo(0),
              },
            ],
          }),
          _ped({
            _fsId: 'p_d',
            lines: [
              {
                code: 'CUDC201HG',
                state: 'ASIG',
                qtyOpen: 1,
                asigReserva: true,
                asigAt: daysAgo(0),
              },
            ],
          }),
          _ped({ _fsId: 'p_rest', lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 7 }] }),
        ],
        ingresos: [],
      }),
      { now: NOW }
    );
    expect(b.asignadas.total).toBe(5);
    expect(b.backorderApp.total).toBe(7);
    expect(b.repartoAbierto.qty).toBe(0);
    expect(b.reservadasTotal).toBe(5);
    expect(b.libre).toBe(2);
  });

  it('sin reparto ni ASIG: libre 7 aunque BO 11', () => {
    const b = getStockBreakdown(
      'CUDC201HG',
      _makeDeps({
        fisico: 7,
        pedidos: [
          _ped({ _fsId: 'p_bo', lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 11 }] }),
        ],
        ingresos: [],
      }),
      { now: NOW }
    );
    expect(b.backorderApp.total).toBe(11);
    expect(b.asignadas.total).toBe(0);
    expect(b.reservadasTotal).toBe(0);
    expect(b.libre).toBe(7);
  });
});

describe('v1392 §40 utilizablePara: BO del cliente NO cuenta', () => {
  it('cliente con BO 10 propio NO suma a utilizablePara', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 5,
        pedidos: [
          _ped({
            _fsId: 'p1',
            clientCardCode: 'CA',
            clientName: 'A',
            lines: [{ code: 'X', state: 'BO', qtyOpen: 10 }],
          }),
        ],
      }),
      { now: NOW }
    );
    expect(b.libre).toBe(5);
    expect(b.utilizablePara('CA')).toBe(5);
  });

  it('cliente con ASIG propia 1u + BO otros 10: utilizablePara CA = min(fisico, libre+asigPropia)', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 5,
        pedidos: [
          _ped({
            _fsId: 'p1',
            clientCardCode: 'CA',
            clientName: 'A',
            lines: [
              { code: 'X', state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(1) },
            ],
          }),
          _ped({
            _fsId: 'p2',
            clientCardCode: 'CB',
            clientName: 'B',
            lines: [{ code: 'X', state: 'BO', qtyOpen: 10 }],
          }),
        ],
      }),
      { now: NOW }
    );
    expect(b.libre).toBe(4);
    expect(b.utilizablePara('CA')).toBe(5);
    expect(b.utilizablePara('CB')).toBe(4);
  });
});

describe('v1392 §40 TTL BO 90d en bucket backorderApp (cola/forecast)', () => {
  it('BO >90d NO entra al bucket backorderApp (filtro para cola)', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 10,
        pedidos: [
          _ped({ createdAt: daysAgo(95), lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] }),
        ],
      }),
      { now: NOW }
    );
    expect(b.backorderApp.total).toBe(0);
  });

  it('BO 30d SI entra al bucket backorderApp', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 10,
        pedidos: [
          _ped({ createdAt: daysAgo(30), lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] }),
        ],
      }),
      { now: NOW }
    );
    expect(b.backorderApp.total).toBe(5);
  });
});

describe('v1392 §40 repartoAbierto descuenta assignments ya aplicadas', () => {
  it('qtyIng=10, assignments suman 3 → repartoAbierto.qty = 7', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 20,
        pedidos: [],
        ingresos: [
          {
            _fsId: 'ing1',
            sku: 'X',
            status: 'in_progress',
            qtyIngresada: 10,
            assignments: [
              { pedidoId: 'pX', lineIndex: 0, qtyAsignada: 2 },
              { pedidoId: 'pY', lineIndex: 1, qtyAsignada: 1 },
            ],
          },
        ],
      }),
      { now: NOW }
    );
    expect(b.repartoAbierto.qty).toBe(7);
    expect(b.repartoAbierto.status).toBe('in_progress');
  });

  it('qtyIng=5, assignments suman 5 → repartoAbierto.qty = 0', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 20,
        pedidos: [],
        ingresos: [
          {
            _fsId: 'ing1',
            sku: 'X',
            status: 'in_progress',
            qtyIngresada: 5,
            assignments: [{ pedidoId: 'pX', lineIndex: 0, qtyAsignada: 5 }],
          },
        ],
      }),
      { now: NOW }
    );
    expect(b.repartoAbierto.qty).toBe(0);
  });
});

describe('v1392 §38 confirmed/ASIG TTL sigue vivo', () => {
  it('confirmed 30d NO cuenta (TTL §38)', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 10,
        pedidos: [
          _ped({
            confirmedAt: daysAgo(30),
            lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }],
          }),
        ],
      }),
      { now: NOW }
    );
    expect(b.confirmadasSinFacturar.total).toBe(0);
  });

  it('ASIG 30d NO cuenta (TTL 7d)', () => {
    const b = getStockBreakdown(
      'X',
      _makeDeps({
        fisico: 10,
        pedidos: [
          _ped({
            lines: [
              { code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: daysAgo(30) },
            ],
          }),
        ],
      }),
      { now: NOW }
    );
    expect(b.asignadas.total).toBe(0);
  });
});

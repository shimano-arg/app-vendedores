// @ts-check
/**
 * E1 v1391 — getStockBreakdown: una sola fuente de verdad para stock
 * de un SKU en todas las pantallas. Invariantes:
 *   - reservadasTotal == backorderApp.total + confirmadasSinFacturar.total + asignadas.total
 *   - libre == max(0, fisicoDep11 - reservadasTotal)
 *   - pendienteReparto.qty == max(0, fisicoDep11 - asignadas - confirmadas) si BO>0, else 0
 *   - utilizablePara(cardCode) == libre + reservasPropias(cardCode)
 *   - Schema shape fijo (test de bucket nuevo falla).
 *
 * TTL: reusa lineReservesStock (CLAUDE.md §36 confirmed sin fecha,
 *       §37 BO 90d, §38 confirmed hard cap 60d).
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

const _makeDeps = ({ fisico = 0, transito = 0, pedidos = [], waitlist = [], ingresos = [], sapBackorderSnapshot = null }) => ({
  getStockFisico: () => fisico,
  getStockTransito: () => transito,
  pedidos,
  waitlistEntries: waitlist,
  ingresosRepartoActivos: ingresos,
  sapBackorderSnapshot,
});

describe('getStockBreakdown — schema shape fijo', () => {
  it('devuelve exactamente los campos documentados (nada nuevo sin avisar)', () => {
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
        'reservadasTotal',
        'sku',
        'transitoDep12',
        'utilizablePara',
      ].sort()
    );
    expect(b._version).toBe(1);
  });

  it('STOCK_LABELS tiene labels para todos los conceptos UI', () => {
    expect(STOCK_LABELS).toMatchObject({
      demandaSapSinCubrir: expect.any(String),
      backorderApp: expect.any(String),
      confirmadasSinFacturar: expect.any(String),
      asignadas: expect.any(String),
      reservadasTotal: expect.any(String),
      fisicoDep11: expect.any(String),
      transitoDep12: expect.any(String),
      libre: expect.any(String),
      pendienteReparto: expect.any(String),
    });
  });
});

describe('getStockBreakdown — invariante reservadasTotal', () => {
  it('reservadasTotal == backorderApp.total + confirmadasSinFacturar.total + asignadas.total', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [
        _ped({ _fsId: 'p1', clientName: 'CA', lines: [{ code: 'X', state: 'BO', qtyOpen: 3 }] }),
        _ped({ _fsId: 'p2', clientName: 'CB', lines: [{ code: 'X', state: 'confirmed', qtyOpen: 2 }] }),
        _ped({ _fsId: 'p3', clientName: 'CC', lines: [{ code: 'X', state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(1) }] }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.backorderApp.total).toBe(3);
    expect(b.confirmadasSinFacturar.total).toBe(2);
    expect(b.asignadas.total).toBe(1);
    expect(b.reservadasTotal).toBe(6);
  });
});

describe('getStockBreakdown — invariante libre', () => {
  it('libre == max(0, fisicoDep11 - reservadasTotal)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [_ped({ lines: [{ code: 'X', state: 'BO', qtyOpen: 3 }] })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.libre).toBe(7);
  });

  it('libre == 0 cuando sobre-reserva', () => {
    const deps = _makeDeps({
      fisico: 2,
      pedidos: [_ped({ lines: [{ code: 'X', state: 'BO', qtyOpen: 10 }] })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.libre).toBe(0);
  });
});

describe('getStockBreakdown — pendienteReparto', () => {
  it('pendienteReparto.qty > 0 cuando hay BO + físico > asig+confirmed', () => {
    const deps = _makeDeps({
      fisico: 7,
      pedidos: [
        _ped({ _fsId: 'p1', clientName: 'CA', lines: [{ code: 'X', state: 'BO', qtyOpen: 10 }] }),
        _ped({ _fsId: 'p2', clientName: 'CB', lines: [{ code: 'X', state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(1) }] }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.pendienteReparto.qty).toBe(6);
    expect(b.pendienteReparto.repartoId).toBe(null);
  });

  it('pendienteReparto.qty == 0 si NO hay BO (nada que repartir)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [
        _ped({ lines: [{ code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: daysAgo(1) }] }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.pendienteReparto.qty).toBe(0);
  });

  it('pendienteReparto.repartoId toma el id del ingresos_reparto activo si existe', () => {
    const deps = _makeDeps({
      fisico: 7,
      pedidos: [_ped({ lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] })],
      ingresos: [{ _fsId: 'ing_abc', sku: 'X', status: 'pending' }],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.pendienteReparto.repartoId).toBe('ing_abc');
  });
});

describe('getStockBreakdown — utilizablePara (fórmula §33/§35)', () => {
  it('cliente con ASIG propia: utilizablePara == fisico mientras no exceda', () => {
    // Pattern CPST: cliente CA tiene ASIG=1 propia, CB tiene BO=5. Fisico=7.
    // Para CA, su ASIG propia NO cuenta como "comprometido ajeno".
    // utilizablePara('CA') debe ser al menos su reserva propia + residual libre.
    const deps = _makeDeps({
      fisico: 7,
      pedidos: [
        _ped({ _fsId: 'p1', clientCardCode: 'CA', clientName: 'ANDRILI', lines: [{ code: 'X', state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(1) }] }),
        _ped({ _fsId: 'p2', clientCardCode: 'CB', clientName: 'BROBRO', lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    // libre = max(0, 7 - (1 ASIG + 5 BO)) = 1
    expect(b.libre).toBe(1);
    // utilizablePara(CA) = su reserva propia (1 ASIG) + residual = 1 + 1 = 2
    expect(b.utilizablePara('CA')).toBe(2);
    // utilizablePara(CB) = su reserva propia (5 BO contributing as own) + residual = 5 + 1 = 6
    expect(b.utilizablePara('CB')).toBe(6);
    // utilizablePara desconocido = solo libre
    expect(b.utilizablePara('ZZZ')).toBe(1);
  });
});

describe('getStockBreakdown — TTL (reglas §36 §37 §38)', () => {
  it('§37: BO 30d SI cuenta (BO no vence a 7d)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [_ped({ createdAt: daysAgo(30), lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.backorderApp.total).toBe(5);
  });

  it('§37: BO 95d NO cuenta (red seguridad 90d)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [_ped({ createdAt: daysAgo(95), lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.backorderApp.total).toBe(0);
  });

  it('§38: confirmed 30d NO cuenta (soft TTL 7d)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [_ped({ confirmedAt: daysAgo(30), lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }] })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.confirmadasSinFacturar.total).toBe(0);
  });

  it('§38: confirmed 3d SI cuenta (dentro soft 7d)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [_ped({ confirmedAt: daysAgo(3), lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }] })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.confirmadasSinFacturar.total).toBe(5);
  });

  it('§36: confirmed sin confirmedAt NO cuenta', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [{ _fsId: 'p1', closedAt: null, createdAt: daysAgo(1), lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }] }],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.confirmadasSinFacturar.total).toBe(0);
  });

  it('ASIG 30d NO cuenta (TTL 7d sin cambios)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [_ped({ lines: [{ code: 'X', state: 'ASIG', qtyOpen: 2, asigReserva: true, asigAt: daysAgo(30) }] })],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.asignadas.total).toBe(0);
  });
});

describe('getStockBreakdown — demandaSapSinCubrir', () => {
  it('null si no se pasa sapBackorderSnapshot', () => {
    const b = getStockBreakdown('X', _makeDeps({}), { now: NOW });
    expect(b.demandaSapSinCubrir).toBe(null);
  });

  it('alias sin TTL: suma BO total + confirmed total crudo cuando se activa', () => {
    // Semántica E0: Modal Backorder lee globalPedidos SIN TTL. Si el caller
    // pasa opts.includeStale=true, el breakdown devuelve ese dato.
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [
        _ped({ createdAt: daysAgo(95), lines: [{ code: 'X', state: 'BO', qtyOpen: 5 }] }), // stale
        _ped({ confirmedAt: daysAgo(30), lines: [{ code: 'X', state: 'confirmed', qtyOpen: 3 }] }), // stale
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW, includeStale: true });
    // demandaSapSinCubrir = BO stale + confirmed stale (lo que ve Modal Backorder)
    expect(b.demandaSapSinCubrir).not.toBe(null);
    expect(b.demandaSapSinCubrir.total).toBe(8);
  });
});

describe('getStockBreakdown — porCliente arrays', () => {
  it('backorderApp.porCliente agrupa por cardCode', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [
        _ped({ _fsId: 'p1', clientCardCode: 'CA', clientName: 'ANDRILI', lines: [{ code: 'X', state: 'BO', qtyOpen: 2 }] }),
        _ped({ _fsId: 'p2', clientCardCode: 'CA', clientName: 'ANDRILI', lines: [{ code: 'X', state: 'BO', qtyOpen: 3 }] }),
        _ped({ _fsId: 'p3', clientCardCode: 'CB', clientName: 'BROBRO', lines: [{ code: 'X', state: 'BO', qtyOpen: 1 }] }),
      ],
    });
    const b = getStockBreakdown('X', deps, { now: NOW });
    expect(b.backorderApp.total).toBe(6);
    expect(b.backorderApp.porCliente).toHaveLength(2);
    const andrili = b.backorderApp.porCliente.find((c) => c.cardCode === 'CA');
    expect(andrili.qty).toBe(5);
    expect(andrili.clientName).toBe('ANDRILI');
  });
});

describe('getStockBreakdown — CUDC201HG real-world fixture', () => {
  it('fisico=7, BO vigente=2 ANDRILI, ASIG=1 GRAUBERGER, confirmed=0 → libre=4', () => {
    const deps = _makeDeps({
      fisico: 7,
      transito: 24,
      pedidos: [
        // BO vigente ANDRILI 2u 6d atrás
        _ped({ _fsId: 'p_andrili', clientCardCode: 'C_ANDRILI', clientName: 'ANDRILI', createdAt: daysAgo(6), lines: [{ code: 'CUDC201HG', state: 'BO', qtyOpen: 2 }] }),
        // ASIG vigente GRAUBERGER 1u 1d atrás
        _ped({ _fsId: 'p_grauberger', clientCardCode: 'C_GRAU', clientName: 'GRAUBERGER', lines: [{ code: 'CUDC201HG', state: 'ASIG', qtyOpen: 1, asigReserva: true, asigAt: daysAgo(1) }] }),
        // confirmed 15d (BROBRO) - NO vigente
        _ped({ _fsId: 'p_brobro', clientCardCode: 'C_BROBRO', clientName: 'BROBRO', confirmedAt: daysAgo(15), lines: [{ code: 'CUDC201HG', state: 'confirmed', qtyOpen: 8 }] }),
      ],
    });
    const b = getStockBreakdown('CUDC201HG', deps, { now: NOW });
    expect(b.fisicoDep11).toBe(7);
    expect(b.transitoDep12).toBe(24);
    expect(b.backorderApp.total).toBe(2);
    expect(b.confirmadasSinFacturar.total).toBe(0);
    expect(b.asignadas.total).toBe(1);
    expect(b.reservadasTotal).toBe(3);
    expect(b.libre).toBe(4);
    expect(b.pendienteReparto.qty).toBe(6); // max(0, 7 - 1 ASIG - 0 confirmed) con BO>0
  });
});

// @ts-check
/**
 * E3 v1384 — invariante breakdown de getStockDesglose:
 *   comprometido === breakdown.confirmed + .BO + .ASIG + .WAITLIST_CPST
 *   real === max(0, fisico - comprometido)
 *
 * La columna "Reservadas" del modal pedido ahora muestra `desg.comprometido`,
 * entonces el tooltip con los 4 buckets debe sumar siempre al total mostrado.
 */
import { describe, expect, it } from 'vitest';
import { getStockDesglose } from '../../../src/pure/stock-realmente-disponible.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const nowIso = new Date(NOW).toISOString();

const _lineConfirmed = (sku, q, extra = {}) =>
  Object.assign({ code: sku, state: 'confirmed', qtyOpen: q }, extra);
const _lineBO = (sku, q) => ({ code: sku, state: 'BO', qtyOpen: q });
const _lineASIG = (sku, q) => ({
  code: sku,
  state: 'ASIG',
  qtyOpen: q,
  asigAt: nowIso,
  asigReserva: true,
});

const _ped = (opts) => ({
  _fsId: 'p',
  closedAt: null,
  createdAt: nowIso,
  confirmedAt: nowIso,
  ...opts,
});

const _makeDeps = ({ fisico = 0, pedidos = [], waitlist = [] }) => ({
  getStockFisico: () => fisico,
  pedidos,
  waitlistEntries: waitlist,
});

describe('getStockDesglose invariant v1392 §40', () => {
  it('v1392 §40: breakdown muestra BO en bucket pero NO suma a comprometido', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [
        _ped({ lines: [_lineConfirmed('X', 3)] }),
        _ped({ lines: [_lineBO('X', 5)] }),
        _ped({ lines: [_lineASIG('X', 2)] }),
      ],
    });
    const desg = getStockDesglose('X', deps, { now: NOW });
    // BO sigue apareciendo en breakdown (informativo), pero NO suma a comprometido.
    expect(desg.breakdown.confirmed).toBe(3);
    expect(desg.breakdown.BO).toBe(5);
    expect(desg.breakdown.ASIG).toBe(2);
    expect(desg.comprometido).toBe(5); // 3 + 2 (BO no cuenta)
    expect(desg.real).toBe(5); // 10 - 5
  });

  it('v1393 §40.1: WAITLIST_CPST aparece en breakdown pero NO suma a comprometido', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [],
      waitlist: [
        {
          source: 'stock-asignado-batch',
          items: [{ code: 'X', qty: 4 }],
        },
      ],
    });
    const desg = getStockDesglose('X', deps, { now: NOW });
    expect(desg.breakdown.WAITLIST_CPST).toBe(4); // informativo
    expect(desg.comprometido).toBe(0); // waitlist NO cuenta
    expect(desg.real).toBe(10);
  });

  it('v1392 §40: BO no suma a comprometido — real = fisico', () => {
    const deps = _makeDeps({
      fisico: 3,
      pedidos: [_ped({ lines: [_lineBO('X', 10)] })],
    });
    const desg = getStockDesglose('X', deps, { now: NOW });
    expect(desg.fisico).toBe(3);
    expect(desg.comprometido).toBe(0); // BO no cuenta
    expect(desg.real).toBe(3); // libre completo
  });

  it('v1392 §40: sobre-reserva con confirmed+ASIG — real = 0', () => {
    const deps = _makeDeps({
      fisico: 3,
      pedidos: [_ped({ lines: [_lineConfirmed('X', 10)] })],
    });
    const desg = getStockDesglose('X', deps, { now: NOW });
    expect(desg.comprometido).toBe(10);
    expect(desg.real).toBe(0);
  });

  it('confirmed sin confirmedAt NO cuenta en breakdown (regla §36)', () => {
    const deps = _makeDeps({
      fisico: 10,
      pedidos: [
        { _fsId: 'p1', closedAt: null, createdAt: nowIso, lines: [_lineConfirmed('X', 5)] },
      ],
    });
    const desg = getStockDesglose('X', deps, { now: NOW });
    expect(desg.breakdown.confirmed).toBe(0);
    expect(desg.comprometido).toBe(0);
    expect(desg.real).toBe(10);
  });
});

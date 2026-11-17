// @ts-check
import { describe, expect, it } from 'vitest';
import { lineReservesStock as lineReservesStockMirror } from '../../../functions/core/pedido-snapshot-core.js';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';

/**
 * v8 §E2 FIX-A2 (2026-11-17) — log `transito_source_missing` en fail-open.
 *
 * El 3er parámetro `opts` es opcional. Si viene `opts.log`, se invoca cuando
 * la rama `enTransito=true` hace fail-open por falta de fecha de referencia.
 * Compat 100% con callers existentes (sin opts → skip silencioso).
 */

const NOW = new Date('2026-11-17T12:00:00Z').getTime();

describe('v8 §E2 FIX-A2 — log transito_source_missing (src/pure)', () => {
  it('T1: ASIG enTransito=true sin fechas + log provisto → invoca log con shape correcto', () => {
    const line = { code: 'SKUX', state: 'ASIG', qtyOpen: 5, enTransito: true };
    const pedido = {}; // sin createdAt / confirmedAt
    const calls = [];
    const log = (type, payload) => calls.push({ type, payload });

    const result = lineReservesStock(line, NOW, pedido, { log, pedidoId: 'P1', lineIndex: 3 });

    expect(result).toBe(true); // fail-open: reserva igual
    expect(calls.length).toBe(1);
    expect(calls[0].type).toBe('transito_source_missing');
    expect(calls[0].payload.sku).toBe('SKUX');
    expect(calls[0].payload.pedidoId).toBe('P1');
    expect(calls[0].payload.lineIndex).toBe(3);
    expect(calls[0].payload.state).toBe('ASIG');
    expect(calls[0].payload.hasAsigAt).toBe(false);
    expect(calls[0].payload.hasAsigAtTransito).toBe(false);
    expect(calls[0].payload.hasCreatedAt).toBe(false);
  });

  it('T2: ASIG enTransito=true sin fechas sin log → no rompe (compat)', () => {
    const line = { code: 'SKUY', state: 'ASIG', qtyOpen: 1, enTransito: true };
    const pedido = {};

    // Sin opts.
    expect(() => lineReservesStock(line, NOW, pedido)).not.toThrow();
    expect(lineReservesStock(line, NOW, pedido)).toBe(true);

    // Opts sin log (válido).
    expect(() => lineReservesStock(line, NOW, pedido, {})).not.toThrow();

    // Opts.log no es función: silencio.
    expect(() => lineReservesStock(line, NOW, pedido, { log: 'not-a-fn' })).not.toThrow();
  });

  it('T3: ASIG enTransito=true con asigAtTransito válido → NO llama log (hay fecha)', () => {
    const line = {
      code: 'SKUZ',
      state: 'ASIG',
      qtyOpen: 2,
      enTransito: true,
      asigAtTransito: '2026-11-15T10:00:00Z',
    };
    const calls = [];
    const log = (type, payload) => calls.push({ type, payload });

    const result = lineReservesStock(line, NOW, {}, { log });

    expect(result).toBe(true);
    expect(calls.length).toBe(0); // había fecha → no se logueó
  });

  it('T4: enTransito=false → NO llama log (no aplica la rama tránsito)', () => {
    const line = { code: 'SKUW', state: 'ASIG', qtyOpen: 1, enTransito: false };
    const calls = [];
    const log = (type, payload) => calls.push({ type, payload });

    lineReservesStock(line, NOW, {}, { log });

    expect(calls.length).toBe(0);
  });

  it('T5: confirmed enTransito=true sin fechas → log con state=confirmed', () => {
    const line = { code: 'CS1', state: 'confirmed', qtyOpen: 2, enTransito: true };
    const pedido = { _fsId: 'PCS1' };
    const calls = [];
    const log = (type, payload) => calls.push({ type, payload });

    const result = lineReservesStock(line, NOW, pedido, { log });

    expect(result).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].payload.state).toBe('confirmed');
    expect(calls[0].payload.pedidoId).toBe('PCS1'); // fallback desde pedido._fsId
    expect(calls[0].payload.hasConfirmedAtTransito).toBe(false);
    expect(calls[0].payload.hasPedidoConfirmedAt).toBe(false);
  });

  it('T6: callback que throw no rompe la fn', () => {
    const line = { code: 'SX', state: 'ASIG', qtyOpen: 1, enTransito: true };
    const log = () => {
      throw new Error('boom');
    };

    expect(() => lineReservesStock(line, NOW, {}, { log })).not.toThrow();
    expect(lineReservesStock(line, NOW, {}, { log })).toBe(true);
  });
});

describe('v8 §E2 FIX-A2 mirror — log transito_source_missing (functions/core)', () => {
  it('mirror: ASIG enTransito sin fechas → log invocado igual que src/pure', () => {
    const line = { code: 'SKUMIR', state: 'ASIG', qtyOpen: 3, enTransito: true };
    const calls = [];
    const log = (type, payload) => calls.push({ type, payload });

    lineReservesStockMirror(line, NOW, {}, { log, pedidoId: 'PM1', lineIndex: 0 });

    expect(calls.length).toBe(1);
    expect(calls[0].type).toBe('transito_source_missing');
    expect(calls[0].payload.sku).toBe('SKUMIR');
    expect(calls[0].payload.state).toBe('ASIG');
  });

  it('mirror: compat sin opts', () => {
    const line = { code: 'X', state: 'ASIG', qtyOpen: 1, enTransito: true };
    expect(() => lineReservesStockMirror(line, NOW, {})).not.toThrow();
    expect(lineReservesStockMirror(line, NOW, {})).toBe(true);
  });
});

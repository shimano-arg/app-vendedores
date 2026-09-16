import { describe, expect, it, vi } from 'vitest';
import {
  getStockPorCliente,
  getStockPorClienteMemo,
} from '../../src/pure/stock-realmente-disponible.js';

function makePedidos() {
  return [
    {
      _fsId: 'p1',
      clientCardCode: 'C001',
      lines: [{ code: 'SKU1', state: 'confirmed', qtyOpen: 5 }],
    },
    {
      _fsId: 'p2',
      clientCardCode: 'C002',
      lines: [{ code: 'SKU1', state: 'ASIG', qtyOpen: 3 }],
    },
  ];
}

function makeDeps(pedidos, fisicoMap = { SKU1: 20 }) {
  return {
    getStockFisico: vi.fn((sku) => fisicoMap[sku] || 0),
    pedidos,
  };
}

describe('getStockPorClienteMemo', () => {
  it('cache hit: 2do call con mismos (sku, cardCode, pedidos, fisico) NO re-computa', () => {
    const pedidos = makePedidos();
    const deps = makeDeps(pedidos);
    const raw = getStockPorCliente('SKU1', 'C001', deps);
    deps.getStockFisico.mockClear();

    const first = getStockPorClienteMemo('SKU1', 'C001', deps);
    const callsFirst = deps.getStockFisico.mock.calls.length;
    const second = getStockPorClienteMemo('SKU1', 'C001', deps);
    const callsSecond = deps.getStockFisico.mock.calls.length;

    // 2do call solo pregunta fisico (para key), NO itera pedidos.
    // La diferencia entre callsFirst y callsSecond debe ser 1 (solo el
    // lookup de fisico para key), no 2 (fisico + iteración interna).
    expect(callsSecond - callsFirst).toBe(1);
    // Mismo resultado.
    expect(second).toEqual(first);
    expect(second).toEqual(raw);
  });

  it('cache miss: cardCode distinto → re-computa', () => {
    const pedidos = makePedidos();
    const deps = makeDeps(pedidos);

    const a = getStockPorClienteMemo('SKU1', 'C001', deps);
    const b = getStockPorClienteMemo('SKU1', 'C002', deps);

    // Datos distintos: C001 tiene 5 reservados por sí, C002 tiene 3.
    expect(a.reservadasPorCliente).toBe(5);
    expect(b.reservadasPorCliente).toBe(3);
  });

  it('cache miss: sku distinto → re-computa', () => {
    const pedidos = makePedidos();
    const deps = makeDeps(pedidos, { SKU1: 20, SKU2: 10 });

    const a = getStockPorClienteMemo('SKU1', 'C001', deps);
    const b = getStockPorClienteMemo('SKU2', 'C001', deps);
    expect(a.fisico).toBe(20);
    expect(b.fisico).toBe(10);
  });

  it('cache miss: fisico cambio → re-computa (stock snapshot updated)', () => {
    const pedidos = makePedidos();
    let currentFisico = 20;
    const deps = {
      getStockFisico: () => currentFisico,
      pedidos,
    };

    const a = getStockPorClienteMemo('SKU1', 'C001', deps);
    currentFisico = 50; // stock snapshot bumpea
    const b = getStockPorClienteMemo('SKU1', 'C001', deps);

    expect(a.fisico).toBe(20);
    expect(b.fisico).toBe(50); // NO cachea el viejo 20
  });

  it('invalidación al cambiar pedidos ref (Firestore onSnapshot)', () => {
    const pedidos1 = makePedidos();
    const deps1 = makeDeps(pedidos1);
    const first = getStockPorClienteMemo('SKU1', 'C001', deps1);
    expect(first.reservadasPorCliente).toBe(5);

    // Simular snapshot nuevo: array nuevo, misma data + 1 line extra.
    const pedidos2 = [
      ...makePedidos(),
      {
        _fsId: 'p3',
        clientCardCode: 'C001',
        lines: [{ code: 'SKU1', state: 'BO', qtyOpen: 7 }],
      },
    ];
    const deps2 = makeDeps(pedidos2);
    const second = getStockPorClienteMemo('SKU1', 'C001', deps2);

    // Nueva ref → cache miss → re-computa con las 3 lines de C001.
    expect(second.reservadasPorCliente).toBe(12); // 5 + 7
  });

  it('resultado idéntico a getStockPorCliente (no-cache) — misma API', () => {
    const pedidos = makePedidos();
    const deps = makeDeps(pedidos);
    const raw = getStockPorCliente('SKU1', 'C001', deps);
    const memo = getStockPorClienteMemo('SKU1', 'C001', deps);
    expect(memo).toEqual(raw);
    expect(memo.fisico).toBe(20);
    expect(memo.reservadasPorCliente).toBe(5);
    expect(memo.reservadasPorOtros).toBe(3);
    expect(memo.libreParaCliente).toBe(17); // 20 - 3
    expect(memo.disponibleReal).toBe(12); // 20 - 5 - 3
    expect(memo.yaEnOtroPedido).toHaveLength(1);
    expect(memo.yaEnOtroPedido[0].pedidoId).toBe('p1');
  });

  it('pedidos null/undefined → fallback sin cache (llama fn base)', () => {
    const deps = {
      getStockFisico: () => 10,
      pedidos: null,
    };
    const result = getStockPorClienteMemo('SKU1', 'C001', deps);
    // getStockPorCliente handlea pedidos no-array como [] → libre = fisico.
    expect(result.fisico).toBe(10);
    expect(result.reservadasPorCliente).toBe(0);
    expect(result.libreParaCliente).toBe(10);
  });

  it('sku vacio → early return (no cache lookup)', () => {
    const pedidos = makePedidos();
    const deps = makeDeps(pedidos);
    const result = getStockPorClienteMemo('', 'C001', deps);
    expect(result.fisico).toBe(0);
    expect(result.reservadasPorCliente).toBe(0);
  });

  it('TTL: el timestamp cachea; safety net para mutación in-place de pedidos', () => {
    // El fallback de 5s protege contra mutation in-place de globalPedidos.
    // Aquí verificamos que dentro del TTL, el cache sirve.
    const pedidos = makePedidos();
    const deps = makeDeps(pedidos);
    getStockPorClienteMemo('SKU1', 'C001', deps);

    // Mutación in-place: agregar linea sin cambiar ref. Sin TTL, el cache
    // devolveria stale. Con TTL 5s, dentro de 5s cachea (aceptado por design),
    // despues de 5s recomputa.
    pedidos.push({
      _fsId: 'p3',
      clientCardCode: 'C001',
      lines: [{ code: 'SKU1', state: 'BO', qtyOpen: 99 }],
    });

    const withinTtl = getStockPorClienteMemo('SKU1', 'C001', deps);
    // Dentro del TTL: cache viejo (stale acceptado).
    expect(withinTtl.reservadasPorCliente).toBe(5);
  });
});

// v957 (2026-09-16, Fase 2): ASIG con asigReserva=false no cuenta en el desglose
describe('getStockPorCliente — v957 asigReserva=false', () => {
  it('ASIG sin reserva de otro cliente NO reduce libreParaCliente', () => {
    const pedidos = [
      // Otro cliente con ASIG sin reserva (cliente B/C) — no bloquea a nadie
      {
        _fsId: 'p_otro',
        clientCardCode: 'C_OTRO',
        lines: [{ code: 'SKU1', state: 'ASIG', qtyOpen: 6, asigReserva: false }],
      },
    ];
    const deps = makeDeps(pedidos);
    const r = getStockPorCliente('SKU1', 'C_MIO', deps);
    expect(r.fisico).toBe(20);
    expect(r.reservadasPorOtros).toBe(0);
    expect(r.libreParaCliente).toBe(20); // el ASIG sin reserva no cuenta
    expect(r.disponibleReal).toBe(20);
  });

  it('ASIG sin reserva del MISMO cliente tampoco cuenta en reservadasPorCliente', () => {
    const pedidos = [
      {
        _fsId: 'p_mio',
        clientCardCode: 'C_MIO',
        lines: [{ code: 'SKU1', state: 'ASIG', qtyOpen: 4, asigReserva: false }],
      },
    ];
    const deps = makeDeps(pedidos);
    const r = getStockPorCliente('SKU1', 'C_MIO', deps);
    // La linea existe en el pedido pero no reserva stock — no aparece en el
    // desglose de reservas.
    expect(r.reservadasPorCliente).toBe(0);
    expect(r.libreParaCliente).toBe(20);
  });

  it('ASIG con reserva sigue contando normal (retrocompat)', () => {
    const pedidos = [
      {
        _fsId: 'p_otro',
        clientCardCode: 'C_OTRO',
        lines: [{ code: 'SKU1', state: 'ASIG', qtyOpen: 4, asigReserva: true }],
      },
    ];
    const deps = makeDeps(pedidos);
    const r = getStockPorCliente('SKU1', 'C_MIO', deps);
    expect(r.reservadasPorOtros).toBe(4);
    expect(r.libreParaCliente).toBe(16);
  });
});

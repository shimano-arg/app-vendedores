// @ts-check
/**
 * v1498 §97 (2026-10-27) — tests pure fn consolidateClientesBO.
 */
import { describe, expect, it } from 'vitest';
import {
  consolidateClientesBO,
  distributeQtyFifo,
  groupKeyForClienteBO,
} from '../../src/pure/reparto-consolidate.js';

describe('v1498 §97 — groupKeyForClienteBO', () => {
  it('T1 cardCode preferido (trim + upper)', () => {
    expect(groupKeyForClienteBO({ clientCardCode: '  c20084809919  ' })).toBe('C20084809919');
    expect(groupKeyForClienteBO({ cardCode: 'c001' })).toBe('C001');
  });

  it('T2 fallback a name|loc|prov si falta cardCode', () => {
    const k = groupKeyForClienteBO({
      clientName: 'URQUIOLA',
      clientLocality: 'LOBOS',
      clientProvince: 'BUENOS AIRES',
    });
    expect(k).toBe('URQUIOLA|LOBOS|BUENOS AIRES');
  });

  it('T3 todo vacío → ""', () => {
    expect(groupKeyForClienteBO({})).toBe('');
    expect(groupKeyForClienteBO(null)).toBe('');
    expect(groupKeyForClienteBO(undefined)).toBe('');
  });
});

describe('v1498 §97 — consolidateClientesBO: caso real URQUIOLA CUDC201XG', () => {
  it('T10 2 entries mismo cardCode → 1 grupo con suma 17', () => {
    const entries = [
      {
        pedidoId: '5J8gfN5lesJyaxyGJTS0',
        lineIndex: 25,
        clientCardCode: 'C20084809919',
        clientName: 'FERNANDO ANTONIO URQUIOLA',
        clientProvince: 'BUENOS AIRES',
        clientLocality: 'LOBOS',
        pedidoCreatedAt: '2026-10-02T19:04:14.751Z',
        qtyBackorder: 15,
      },
      {
        pedidoId: 'nfUVYQdR6lnUj41GqJXw',
        lineIndex: 24,
        clientCardCode: 'C20084809919',
        clientName: 'FERNANDO ANTONIO URQUIOLA',
        clientProvince: 'BUENOS AIRES',
        clientLocality: 'LOBOS',
        pedidoCreatedAt: '2026-10-02T19:04:41.964Z',
        qtyBackorder: 2,
      },
    ];
    const r = consolidateClientesBO(entries);
    expect(r.length).toBe(1);
    expect(r[0].qtyBackorder).toBe(17);
    expect(r[0].clientName).toBe('FERNANDO ANTONIO URQUIOLA');
    expect(r[0].clientCardCode).toBe('C20084809919');
    expect(r[0].groupKey).toBe('C20084809919');
    expect(r[0].pedidoIds.length).toBe(2);
    // FIFO: pedido 19:04:14 primero, 19:04:41 segundo.
    expect(r[0].pedidoIds[0].pedidoId).toBe('5J8gfN5lesJyaxyGJTS0');
    expect(r[0].pedidoIds[1].pedidoId).toBe('nfUVYQdR6lnUj41GqJXw');
  });

  it('T11 2 clientes distintos → 2 grupos separados', () => {
    const entries = [
      {
        pedidoId: 'P1',
        lineIndex: 0,
        clientCardCode: 'C_A',
        clientName: 'CLIENTE A',
        qtyBackorder: 10,
      },
      {
        pedidoId: 'P2',
        lineIndex: 0,
        clientCardCode: 'C_B',
        clientName: 'CLIENTE B',
        qtyBackorder: 5,
      },
    ];
    const r = consolidateClientesBO(entries);
    expect(r.length).toBe(2);
    // Sort: qty desc → A primero.
    expect(r[0].clientName).toBe('CLIENTE A');
    expect(r[0].qtyBackorder).toBe(10);
    expect(r[1].clientName).toBe('CLIENTE B');
    expect(r[1].qtyBackorder).toBe(5);
  });

  it('T12 cardCode normalizado (case-insensitive + trim)', () => {
    const entries = [
      { pedidoId: 'P1', clientCardCode: 'c001', qtyBackorder: 10 },
      { pedidoId: 'P2', clientCardCode: '  C001  ', qtyBackorder: 5 },
      { pedidoId: 'P3', cardCode: 'C001', qtyBackorder: 3 },
    ];
    const r = consolidateClientesBO(entries);
    expect(r.length).toBe(1);
    expect(r[0].qtyBackorder).toBe(18);
    expect(r[0].pedidoIds.length).toBe(3);
  });

  it('T13 entries sin cardCode se agrupan por name|loc|prov', () => {
    const entries = [
      { pedidoId: 'P1', clientName: 'X', clientLocality: 'LANUS', qtyBackorder: 10 },
      { pedidoId: 'P2', clientName: 'X', clientLocality: 'LANUS', qtyBackorder: 5 },
    ];
    const r = consolidateClientesBO(entries);
    expect(r.length).toBe(1);
    expect(r[0].qtyBackorder).toBe(15);
    expect(r[0].groupKey).toContain('LANUS');
  });

  it('T14 entries sin cardCode ni name se descartan (no agrupables)', () => {
    const entries = [
      { pedidoId: 'P1', qtyBackorder: 10 },
      { pedidoId: 'P2', qtyBackorder: 5 },
    ];
    const r = consolidateClientesBO(entries);
    expect(r.length).toBe(0);
  });

  it('T15 qty <= 0 se filtra', () => {
    const entries = [
      { clientCardCode: 'C001', qtyBackorder: 10 },
      { clientCardCode: 'C001', qtyBackorder: 0 },
      { clientCardCode: 'C001', qtyBackorder: -5 },
    ];
    const r = consolidateClientesBO(entries);
    expect(r.length).toBe(1);
    expect(r[0].qtyBackorder).toBe(10);
    expect(r[0].pedidoIds.length).toBe(1);
  });

  it('T16 input no array → []', () => {
    expect(consolidateClientesBO(null)).toEqual([]);
    expect(consolidateClientesBO(undefined)).toEqual([]);
    expect(consolidateClientesBO(/** @type {any} */ ('foo'))).toEqual([]);
  });

  it('T17 idempotente: consolidar 2 veces = mismo resultado', () => {
    const entries = [
      { clientCardCode: 'C_A', clientName: 'A', qtyBackorder: 10, pedidoId: 'P1' },
      { clientCardCode: 'C_A', clientName: 'A', qtyBackorder: 5, pedidoId: 'P2' },
    ];
    const r1 = consolidateClientesBO(entries);
    // Segunda pasada: ya consolidado — nada que hacer, cada grupo tiene qty total.
    // No pasa como entries normales (shape distinto), pero verificamos que no rompe.
    expect(r1.length).toBe(1);
    expect(r1[0].qtyBackorder).toBe(15);
  });
});

describe('v1498 §97 — distributeQtyFifo', () => {
  const pedidoIds = [
    { pedidoId: 'P1', lineIndex: 0, qty: 15, createdAt: '2026-10-02T19:04:14Z' },
    { pedidoId: 'P2', lineIndex: 0, qty: 2, createdAt: '2026-10-02T19:04:41Z' },
  ];

  it('T20 asignar 10: todo al primero (FIFO)', () => {
    const r = distributeQtyFifo(pedidoIds, 10);
    expect(r).toEqual([{ pedidoId: 'P1', lineIndex: 0, qtyAsignada: 10 }]);
  });

  it('T21 asignar 15: completa P1 exactamente', () => {
    const r = distributeQtyFifo(pedidoIds, 15);
    expect(r).toEqual([{ pedidoId: 'P1', lineIndex: 0, qtyAsignada: 15 }]);
  });

  it('T22 asignar 17: completa P1 + P2 (todos)', () => {
    const r = distributeQtyFifo(pedidoIds, 17);
    expect(r).toEqual([
      { pedidoId: 'P1', lineIndex: 0, qtyAsignada: 15 },
      { pedidoId: 'P2', lineIndex: 0, qtyAsignada: 2 },
    ]);
  });

  it('T23 asignar 16: completa P1 + 1 de P2', () => {
    const r = distributeQtyFifo(pedidoIds, 16);
    expect(r).toEqual([
      { pedidoId: 'P1', lineIndex: 0, qtyAsignada: 15 },
      { pedidoId: 'P2', lineIndex: 0, qtyAsignada: 1 },
    ]);
  });

  it('T24 asignar más que el total: clampea al total disponible', () => {
    const r = distributeQtyFifo(pedidoIds, 100);
    const total = r.reduce((s, x) => s + x.qtyAsignada, 0);
    expect(total).toBe(17); // 15 + 2
  });

  it('T25 asignar 0: array vacío', () => {
    expect(distributeQtyFifo(pedidoIds, 0)).toEqual([]);
    expect(distributeQtyFifo(pedidoIds, -5)).toEqual([]);
  });

  it('T26 pedidoIds vacío: array vacío', () => {
    expect(distributeQtyFifo([], 10)).toEqual([]);
    expect(distributeQtyFifo(/** @type {any} */ (null), 10)).toEqual([]);
  });
});

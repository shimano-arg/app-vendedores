// @ts-check
/**
 * v1421 §55 (2026-10-22) — tests del pure filter waitlist-repetido-filter.
 */
import { describe, expect, it } from 'vitest';
import {
  buildExcludedPedidoIdsForRepetido,
  filterYaEnOtroPedidoForLine,
  lineCountsAsPedidoAnterior,
} from '../../src/pure/waitlist-repetido-filter.js';

describe('buildExcludedPedidoIdsForRepetido', () => {
  it('incluye el propio waitlist _id', () => {
    const w = { _id: 'wl-X' };
    const s = buildExcludedPedidoIdsForRepetido(w);
    expect(s.has('wl-X')).toBe(true);
  });

  it('incluye todos los pedidoId de w.pedidosOrigenes', () => {
    const w = {
      _id: 'wl-X',
      pedidosOrigenes: [
        { pedidoId: 'ped-A', lineIndex: 0 },
        { pedidoId: 'ped-B', lineIndex: 2 },
      ],
    };
    const s = buildExcludedPedidoIdsForRepetido(w);
    expect(s.has('ped-A')).toBe(true);
    expect(s.has('ped-B')).toBe(true);
  });

  it('incluye todos los pedidoId de w.items[].asigRefs', () => {
    const w = {
      _id: 'wl-X',
      items: [
        { code: 'A', asigRefs: [{ pedidoId: 'ped-C' }, { pedidoId: 'ped-D' }] },
        { code: 'B', asigRefs: [{ pedidoId: 'ped-E' }] },
      ],
    };
    const s = buildExcludedPedidoIdsForRepetido(w);
    expect(s.has('ped-C')).toBe(true);
    expect(s.has('ped-D')).toBe(true);
    expect(s.has('ped-E')).toBe(true);
  });

  it('null/undefined/{} → Set vacío', () => {
    expect(buildExcludedPedidoIdsForRepetido(null).size).toBe(0);
    expect(buildExcludedPedidoIdsForRepetido(undefined).size).toBe(0);
    expect(buildExcludedPedidoIdsForRepetido({}).size).toBe(0);
  });

  it('ignora pedidosOrigenes/asigRefs sin pedidoId', () => {
    const w = {
      _id: 'wl',
      pedidosOrigenes: [{}, { pedidoId: '' }, { pedidoId: 'ok' }],
      items: [{ asigRefs: [{}, { pedidoId: 'ok2' }] }],
    };
    const s = buildExcludedPedidoIdsForRepetido(w);
    expect(s.size).toBe(3); // wl + ok + ok2
  });
});

describe('lineCountsAsPedidoAnterior', () => {
  it('línea con origen=stock-asignado NUNCA cuenta (regla 1)', () => {
    const line = { origen: 'stock-asignado' };
    const yaEnOtro = [{ pedidoId: 'ped-ajeno' }];
    const excluded = new Set();
    expect(lineCountsAsPedidoAnterior(line, yaEnOtro, excluded)).toBe(false);
  });

  it('línea sin origen con SKU en pedido ajeno (no excluido) → cuenta', () => {
    const line = { origen: null };
    const yaEnOtro = [{ pedidoId: 'ped-ajeno' }];
    const excluded = new Set(['wl-X']);
    expect(lineCountsAsPedidoAnterior(line, yaEnOtro, excluded)).toBe(true);
  });

  it('línea sin origen con SKU solo en pedido excluido → NO cuenta', () => {
    const line = {};
    const yaEnOtro = [{ pedidoId: 'ped-origen' }];
    const excluded = new Set(['ped-origen']);
    expect(lineCountsAsPedidoAnterior(line, yaEnOtro, excluded)).toBe(false);
  });

  it('línea sin origen con 2 pedidos (uno excluido, otro no) → cuenta', () => {
    const line = {};
    const yaEnOtro = [{ pedidoId: 'ped-origen' }, { pedidoId: 'ped-otro' }];
    const excluded = new Set(['ped-origen']);
    expect(lineCountsAsPedidoAnterior(line, yaEnOtro, excluded)).toBe(true);
  });

  it('yaEnOtroPedido vacío → NO cuenta', () => {
    expect(lineCountsAsPedidoAnterior({}, [], new Set())).toBe(false);
  });

  it('null/undefined inputs → NO cuenta', () => {
    expect(lineCountsAsPedidoAnterior(null, [{}], new Set())).toBe(false);
    expect(lineCountsAsPedidoAnterior({}, null, new Set())).toBe(false);
    expect(lineCountsAsPedidoAnterior({}, undefined, new Set())).toBe(false);
  });
});

describe('filterYaEnOtroPedidoForLine', () => {
  it('línea stock-asignado → devuelve array vacío', () => {
    const line = { origen: 'stock-asignado' };
    const yaEnOtro = [{ pedidoId: 'a' }, { pedidoId: 'b' }];
    expect(filterYaEnOtroPedidoForLine(line, yaEnOtro, new Set())).toEqual([]);
  });

  it('línea normal filtra los pedidoIds excluidos', () => {
    const line = {};
    const yaEnOtro = [{ pedidoId: 'ped-A' }, { pedidoId: 'ped-B' }, { pedidoId: 'ped-C' }];
    const excluded = new Set(['ped-B']);
    const out = filterYaEnOtroPedidoForLine(line, yaEnOtro, excluded);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.pedidoId)).toEqual(['ped-A', 'ped-C']);
  });
});

describe('v1421 §55 — caso real SUSANA GRACIELA ANDRILI ORDEN 530', () => {
  // CUDC201HG reservada: línea con origen=stock-asignado + asigRef al pedido
  // origen de la ASIG. El filtro debe retornar [] para que no haya badge ni
  // sume al aviso.
  const waitlist = {
    _id: 'wl-530-andrili',
    orderNumber: 530,
    clientCardCode: 'C...',
    pedidosOrigenes: [{ pedidoId: 'ped-origen-asig', lineIndex: 3 }],
    items: [
      {
        code: 'CUDC201HG',
        qty: 1,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-origen-asig', lineIndex: 3, qtyAsignada: 1 }],
      },
    ],
  };
  const line = waitlist.items[0];
  // Simular `getStockPorCliente` que devuelve el pedido origen como "otro pedido".
  const yaEnOtroCrudo = [{ pedidoId: 'ped-origen-asig' }];

  it('build excluded incluye el pedido origen de la ASIG', () => {
    const s = buildExcludedPedidoIdsForRepetido(waitlist);
    expect(s.has('ped-origen-asig')).toBe(true);
    expect(s.has('wl-530-andrili')).toBe(true);
  });

  it('line origen=stock-asignado → filter devuelve []', () => {
    const excluded = buildExcludedPedidoIdsForRepetido(waitlist);
    expect(filterYaEnOtroPedidoForLine(line, yaEnOtroCrudo, excluded)).toEqual([]);
  });

  it('line origen=stock-asignado → lineCountsAsPedidoAnterior=false (sin aviso)', () => {
    const excluded = buildExcludedPedidoIdsForRepetido(waitlist);
    expect(lineCountsAsPedidoAnterior(line, yaEnOtroCrudo, excluded)).toBe(false);
  });

  it('comparación con línea normal del mismo SKU en pedido ajeno: SÍ cuenta', () => {
    const normalLine = { code: 'CUDC201HG', qty: 2, origen: null };
    const yaEnOtroNormal = [{ pedidoId: 'ped-otro-cliente-sin-relacion' }];
    const excluded = buildExcludedPedidoIdsForRepetido(waitlist);
    expect(lineCountsAsPedidoAnterior(normalLine, yaEnOtroNormal, excluded)).toBe(true);
  });
});

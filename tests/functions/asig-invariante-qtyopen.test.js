// @ts-check
/**
 * v1520 (2026-10-29) — invariante: ninguna escritura del reparto deja una
 * línea state='ASIG' con qtyOpen<=0.
 *
 * Precedente: REBORN SRL CLC66H2PY (pedido 8lGQkjUJfZwqsfnNw4iw). Una ASIG
 * con entregable 0 pasaba por revertSobreAsignadas y quedaba qty=0/qtyOpen=0
 * con state='ASIG' (zombie). El CPST la tomaba como origen y bloqueaba.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findZombieAsigLines } from '../../functions/core/asig-invariant.js';
import { applyRepartoManualCore, revertSobreAsignadas } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const nowIso = NOW.toISOString();
const asigAt = new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString();

describe('findZombieAsigLines', () => {
  it('devuelve índices ASIG con qtyOpen<=0', () => {
    expect(
      findZombieAsigLines([
        { state: 'ASIG', qtyOpen: 2 },
        { state: 'ASIG', qtyOpen: 0 },
        { state: 'BO', qtyOpen: 0 },
        { state: 'ASIG' },
        null,
      ])
    ).toEqual([1, 3]);
  });
});

// ---------- revertSobreAsignadas ----------
function fakeDbPedidos(pedidos) {
  const updates = [];
  return {
    _updates: updates,
    collection(name) {
      return {
        where() {
          return {
            get: async () =>
              name === 'pedidos'
                ? { forEach: (cb) => pedidos.forEach(cb), docs: pedidos }
                : { forEach: () => {}, docs: [] },
            where() {
              return this;
            },
          };
        },
        doc: (id) => ({
          update: async (data) => {
            updates.push({ id, data });
          },
        }),
      };
    },
  };
}
const pedDoc = (id, data) => ({ id, data: () => data });
const snap = (whs) => ({ warehouseBreakdown: JSON.stringify(whs) });

describe('revertSobreAsignadas — entregable 0 no deja zombie', () => {
  it('ASIG 2 / físico 0 → la línea vuelve entera a BO, sin ASIG en 0 ni línea extra', async () => {
    const fbDb = fakeDbPedidos([
      pedDoc('PED_REBORN', {
        closedAt: null,
        clientCardCode: 'C30710852762',
        clientName: 'REBORN SRL',
        createdAt: asigAt,
        lines: [
          { code: 'CLC66H2PY', state: 'ASIG', qty: 2, qtyOpen: 2, asigReserva: true, asigAt },
        ],
      }),
    ]);
    const r = await revertSobreAsignadas(
      { fbDb, now: () => NOW, log: () => {} },
      snap({ CLC66H2PY: { 11: 0 } })
    );
    expect(r.errors).toEqual([]);
    expect(fbDb._updates).toHaveLength(1);
    const lines = fbDb._updates[0].data.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      state: 'BO',
      qty: 2,
      qtyOpen: 2,
      asigReserva: false,
      asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
      asigRevertidaBy: 'system:reconcile',
    });
    expect(findZombieAsigLines(lines)).toEqual([]);
  });

  it('regresión: ASIG 6 / físico 2 sigue partiendo en ASIG 2 + BO 4', async () => {
    const fbDb = fakeDbPedidos([
      pedDoc('p1', {
        closedAt: null,
        clientCardCode: 'CA',
        createdAt: asigAt,
        lines: [{ code: 'X', state: 'ASIG', qty: 6, qtyOpen: 6, asigReserva: true, asigAt }],
      }),
    ]);
    await revertSobreAsignadas({ fbDb, now: () => NOW, log: () => {} }, snap({ X: { 11: 2 } }));
    const lines = fbDb._updates[0].data.lines;
    expect(lines.map((l) => [l.state, l.qty, l.qtyOpen])).toEqual([
      ['ASIG', 2, 2],
      ['BO', 4, 4],
    ]);
  });

  it('dos ASIG del mismo producto, físico alcanza solo la primera → la segunda vuelve a BO en su lugar', async () => {
    const fbDb = fakeDbPedidos([
      pedDoc('p1', {
        closedAt: null,
        clientCardCode: 'CA',
        createdAt: asigAt,
        lines: [
          { code: 'X', state: 'ASIG', qty: 2, qtyOpen: 2, asigReserva: true, asigAt },
          { code: 'X', state: 'ASIG', qty: 3, qtyOpen: 3, asigReserva: true, asigAt: nowIso },
        ],
      }),
    ]);
    await revertSobreAsignadas({ fbDb, now: () => NOW, log: () => {} }, snap({ X: { 11: 2 } }));
    const lines = fbDb._updates[0].data.lines;
    expect(lines.map((l) => [l.state, l.qtyOpen])).toEqual([
      ['ASIG', 2],
      ['BO', 3],
    ]);
    expect(findZombieAsigLines(lines)).toEqual([]);
  });
});

// ---------- applyRepartoManualCore ----------
function fakeDbReparto({ ingreso, pedido, fisico }) {
  const mem = { pedido };
  const pedidoRef = { get: async () => ({ exists: true, data: () => mem.pedido }), _mem: mem };
  const ingresoRef = {
    get: async () => ({ exists: true, data: () => ingreso }),
    update: async (d) => Object.assign(ingreso, d),
  };
  return {
    _mem: mem,
    collection(name) {
      return {
        doc: (id) => {
          if (name === 'ingresos_reparto') return ingresoRef;
          if (name === 'app_config' && id === 'stock_snapshot')
            return {
              get: async () => ({
                exists: true,
                data: () => ({ warehouseBreakdown: JSON.stringify({ CLC66H2PY: { 11: fisico } }) }),
              }),
            };
          if (name === 'pedidos') return pedidoRef;
          return { get: async () => ({ exists: false }) };
        },
        where() {
          return {
            get: async () => ({ forEach: () => {} }),
            where() {
              return this;
            },
            limit() {
              return this;
            },
          };
        },
        add: async () => ({ id: 'x' }),
      };
    },
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => ref.get(),
        update: (ref, data) => {
          if (ref._mem) ref._mem.pedido = { ...ref._mem.pedido, ...data };
        },
      }),
  };
}

describe('applyRepartoManualCore — invariante en la transacción', () => {
  it('una zombie previa en OTRA línea del pedido no bloquea el reparto de la BO', async () => {
    const ingreso = {
      sku: 'CLC66H2PY',
      qtyIngresada: 2,
      detectedAt: nowIso,
      status: 'pending',
      clientesBO: [
        {
          pedidoId: 'PED_REBORN',
          lineIndex: 1,
          clientCardCode: 'C30710852762',
          clientName: 'REBORN SRL',
          qtyBackorder: 2,
        },
      ],
    };
    const pedido = {
      closedAt: null,
      clientCardCode: 'C30710852762',
      clientName: 'REBORN SRL',
      lines: [
        { code: 'CLC66H2PY', state: 'ASIG', qty: 0, qtyOpen: 0 },
        { code: 'CLC66H2PY', state: 'BO', qty: 2, qtyOpen: 2 },
      ],
    };
    const fbDb = fakeDbReparto({ ingreso, pedido, fisico: 2 });
    const r = await applyRepartoManualCore(
      { fbDb, now: () => NOW, log: () => {} },
      {
        ingresoId: 'ING1',
        assignments: [{ pedidoId: 'PED_REBORN', lineIndex: 1, qtyAsignada: 2 }],
        eliminations: [],
        appliedByEmail: 'pablo@shimano.com.ar',
      }
    );
    expect(r.errors || []).toEqual([]);
    expect(fbDb._mem.pedido.lines[1]).toMatchObject({ state: 'ASIG', qtyOpen: 2 });
  });

  it('contrato: la transacción valida findZombieAsigLines antes de tx.update', () => {
    const src = readFileSync(
      new URL('../../functions/core/reparto-core.js', import.meta.url),
      'utf8'
    );
    const i = src.indexOf('// v1520 invariante ASIG qtyOpen>0');
    expect(i).toBeGreaterThan(-1);
    const tramo = src.slice(i, i + 1200);
    expect(tramo).toContain('findZombieAsigLines(lines)');
    expect(tramo.indexOf('throw')).toBeLessThan(tramo.indexOf('tx.update(pedidoRef'));
  });
});

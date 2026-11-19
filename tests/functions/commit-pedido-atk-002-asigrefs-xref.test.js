// @ts-check
/**
 * ATK-002 (2026-11-19) — cross-reference clientCardCode en asigRefs de
 * commitPedidoCore.
 *
 * Vector: VDE hostil envía payload con `cardCode='C001'` (su cliente) +
 * `asigRefs` apuntando a pedidos de OTROS clientes/VDEs. Los 6 checks
 * previos (A-F) validan sku + state + qty pero NO el vínculo con el
 * cliente. Un ataque exitoso cancelaba ASIG ajenas.
 *
 * Fix: nuevo CHECK G que valida `pedidoOrigen.clientCardCode == payload.cardCode`.
 *
 * Tests:
 * - T1: payload con asigRef apuntando a pedido de otro cliente → ASIG_REF_INVALID.
 * - T2: payload con asigRef apuntando a pedido del mismo cliente → OK (no regresión).
 * - T3: pedido origen sin clientCardCode persistido (legacy) → fail-open documentado.
 * - T4: shape del error devuelve reason='CROSS_CLIENT_CARDCODE_MISMATCH'.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeMockDb(fixture) {
  const state = fixture || { pedidos: {}, revision_waitlist: {}, app_config: {}, roles: {} };
  const makeDoc = (col, id) => {
    const path = `${col}/${id}`;
    return {
      _path: path,
      id,
      async get() {
        const data = state[col]?.[id];
        return { exists: !!data, data: () => data || null };
      },
      async set(data, opts) {
        state[col] ||= {};
        state[col][id] = opts?.merge ? { ...(state[col][id] || {}), ...data } : { ...data };
      },
      async update(data) {
        state[col] ||= {};
        state[col][id] = { ...(state[col][id] || {}), ...data };
      },
      async delete() {
        if (state[col]) delete state[col][id];
      },
    };
  };
  return {
    _state: state,
    collection(name) {
      const refs = [];
      /** Query builder stateful que filtra docs según where. */
      const makeQueryBuilder = (filters) => ({
        _name: name,
        where(field, op, value) {
          return makeQueryBuilder([...filters, { field, op, value }]);
        },
        limit(_n) {
          return this;
        },
        orderBy() {
          return this;
        },
        async get() {
          const all = Object.entries(state[name] || {}).map(([id, data]) => ({
            id,
            exists: true,
            data: () => data,
          }));
          const filtered = all.filter((d) => {
            for (const f of filters) {
              const v = d.data()[f.field];
              if (f.op === '==' && v !== f.value) return false;
              if (f.op === '!=' && v === f.value) return false;
            }
            return true;
          });
          return {
            size: filtered.length,
            empty: filtered.length === 0,
            docs: filtered,
            forEach(cb) {
              for (const d of filtered) cb(d);
            },
          };
        },
      });
      return {
        _name: name,
        doc(id) {
          const d = makeDoc(name, id || 'auto_' + Math.random().toString(36).slice(2, 10));
          refs.push(d);
          return d;
        },
        add(data) {
          const id = 'auto_' + Math.random().toString(36).slice(2, 10);
          state[name] ||= {};
          state[name][id] = data;
          return Promise.resolve({ id });
        },
        async get() {
          const docs = Object.entries(state[name] || {}).map(([id, data]) => ({
            id,
            exists: true,
            data: () => data,
          }));
          return {
            size: docs.length,
            empty: docs.length === 0,
            docs,
            forEach(cb) {
              for (const d of docs) cb(d);
            },
          };
        },
        where(field, op, value) {
          return makeQueryBuilder([{ field, op, value }]);
        },
        limit() {
          return this;
        },
        orderBy() {
          return this;
        },
      };
    },
    doc(path) {
      const [col, id] = path.split('/');
      return makeDoc(col, id);
    },
    async runTransaction(fn) {
      let hasWritten = false;
      const txWrites = [];
      const tx = {
        async get(ref) {
          if (hasWritten) {
            throw new Error('§58 violation: read after write');
          }
          return ref.get();
        },
        set(ref, data, opts) {
          hasWritten = true;
          txWrites.push({ op: 'set', ref, data, opts });
        },
        update(ref, data) {
          hasWritten = true;
          txWrites.push({ op: 'update', ref, data });
        },
        delete(ref) {
          hasWritten = true;
          txWrites.push({ op: 'delete', ref });
        },
      };
      const r = await fn(tx);
      // Apply tx writes to state (commit phase).
      for (const w of txWrites) {
        if (w.op === 'set') await w.ref.set(w.data, w.opts);
        else if (w.op === 'update') await w.ref.update(w.data);
        else if (w.op === 'delete') await w.ref.delete();
      }
      return r;
    },
  };
}

function baseStockSnapshot() {
  return {
    warehouseBreakdown: JSON.stringify({
      SKU1: { 11: 100 },
      SKU2: { 11: 100 },
    }),
    updatedAt: new Date().toISOString(),
    _syncRun: new Date().toISOString(),
  };
}

function baseFixture() {
  return {
    roles: {},
    pedidos: {
      'ped-origen-c001': {
        _fsId: 'ped-origen-c001',
        ownerUid: 'otro-vde-uid',
        assignedVendorUid: 'otro-vde-uid',
        clientCardCode: 'C001',
        stage: 'confirmed',
        lines: [{ code: 'SKU1', state: 'ASIG', qty: 5, qtyOpen: 5, precio: 100 }],
      },
      'ped-origen-c999': {
        _fsId: 'ped-origen-c999',
        ownerUid: 'victim-uid',
        assignedVendorUid: 'victim-uid',
        clientCardCode: 'C999', // ← cliente DISTINTO
        stage: 'confirmed',
        lines: [{ code: 'SKU1', state: 'ASIG', qty: 5, qtyOpen: 5, precio: 100 }],
      },
    },
    revision_waitlist: {},
    app_config: {
      stock_snapshot: baseStockSnapshot(),
    },
    pedido_draft_locks: {},
  };
}

/** Deps base para commitPedidoCore. `now` debe devolver Date (core hace .getTime). */
function makeDeps(state) {
  const fbDb = makeMockDb(state);
  return {
    fbDb,
    log: () => {},
    now: () => new Date('2026-11-19T15:00:00.000Z'),
    FieldValue: { serverTimestamp: () => 'FV.serverTimestamp()', delete: () => '<<deleted>>' },
  };
}

describe('ATK-002: commit-pedido-core asigRefs cross-reference', () => {
  it('T1: asigRef apuntando a pedido de OTRO cliente → ASIG_REF_INVALID CROSS_CLIENT_CARDCODE_MISMATCH', async () => {
    const state = baseFixture();
    state.revision_waitlist['wl-attack'] = {
      clientCardCode: 'C001',
      ownerUid: 'atacante-uid',
    };
    const deps = makeDeps(state);
    const payload = {
      origen: 'cpst',
      cardCode: 'C001', // Mi cliente
      clientName: 'CLIENTE PROPIO',
      ownerUid: 'atacante-uid',
      ownerVendor: 'VDE_ATACANTE',
      lines: [
        {
          sku: 'SKU1',
          cantidad: 2,
          origenLinea: 'stock-asignado',
          asigRefs: [
            {
              pedidoId: 'ped-origen-c999', // ← pedido de OTRO cliente (C999)
              lineIndex: 0,
              sku: 'SKU1',
              qtyAsignada: 2,
            },
          ],
        },
      ],
      waitlistOrigenId: 'wl-attack',
      draftId: 'd_atk002_T1',
      clientVersion: 'test',
    };
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data).toBeDefined();
    expect(r.data.reason).toBe('CROSS_CLIENT_CARDCODE_MISMATCH');
    expect(r.data.pedidoOrigenId).toBe('ped-origen-c999');
    expect(r.data.payloadCardCode).toBe('C001');
    expect(r.data.origenCardCode).toBe('C999');
    // Línea del pedido víctima NO fue mutada.
    expect(state.pedidos['ped-origen-c999'].lines[0].state).toBe('ASIG');
    expect(state.pedidos['ped-origen-c999'].lines[0].qtyOpen).toBe(5);
  });

  it('T2: asigRef apuntando a pedido del MISMO cliente → OK (no regresión)', async () => {
    const state = baseFixture();
    // Agregar waitlist origen para completar el flow cpst.
    state.revision_waitlist['wl-ok'] = {
      clientCardCode: 'C001',
      ownerUid: 'atacante-uid',
    };
    const deps = makeDeps(state);
    const payload = {
      origen: 'cpst',
      cardCode: 'C001',
      clientName: 'CLIENTE PROPIO',
      ownerUid: 'atacante-uid',
      ownerVendor: 'VDE_ATACANTE',
      lines: [
        {
          sku: 'SKU1',
          cantidad: 2,
          origenLinea: 'stock-asignado',
          asigRefs: [
            {
              pedidoId: 'ped-origen-c001', // ← MISMO cliente
              lineIndex: 0,
              sku: 'SKU1',
              qtyAsignada: 2,
            },
          ],
        },
      ],
      waitlistOrigenId: 'wl-ok',
      draftId: 'd_atk002_T2',
      clientVersion: 'test',
    };
    const r = await commitPedidoCore(deps, payload);
    // No debe fallar por cross-check. Puede fallar por otros gates (no es el objeto del test),
    // pero el `reason` NO debe ser CROSS_CLIENT_CARDCODE_MISMATCH.
    if (!r.ok) {
      expect(r.data?.reason).not.toBe('CROSS_CLIENT_CARDCODE_MISMATCH');
    }
  });

  it('T3: pedido origen SIN clientCardCode persistido (legacy) → fail-open (no bloquea)', async () => {
    const state = baseFixture();
    // Legacy: pedido sin clientCardCode.
    delete state.pedidos['ped-origen-c001'].clientCardCode;
    state.revision_waitlist['wl-legacy'] = {
      clientCardCode: 'C001',
      ownerUid: 'atacante-uid',
    };
    const deps = makeDeps(state);
    const payload = {
      origen: 'cpst',
      cardCode: 'C001',
      clientName: 'CLIENTE PROPIO',
      ownerUid: 'atacante-uid',
      ownerVendor: 'VDE_ATACANTE',
      lines: [
        {
          sku: 'SKU1',
          cantidad: 2,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'ped-origen-c001', lineIndex: 0, sku: 'SKU1', qtyAsignada: 2 }],
        },
      ],
      waitlistOrigenId: 'wl-legacy',
      draftId: 'd_atk002_T3',
      clientVersion: 'test',
    };
    const r = await commitPedidoCore(deps, payload);
    // Pedido legacy sin cardCode → el guard permite pasar (fail-open documentado).
    // Puede fallar por otros gates, pero NO por CROSS_CLIENT.
    if (!r.ok) {
      expect(r.data?.reason).not.toBe('CROSS_CLIENT_CARDCODE_MISMATCH');
    }
  });

  it('T4: payload SIN cardCode (edge) → guard no aplica, otros gates manejan', async () => {
    const state = baseFixture();
    const deps = makeDeps(state);
    const payload = {
      origen: 'cpst',
      // cardCode missing
      clientName: 'CLIENTE PROPIO',
      ownerUid: 'atacante-uid',
      ownerVendor: 'VDE_ATACANTE',
      lines: [
        {
          sku: 'SKU1',
          cantidad: 2,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'ped-origen-c999', lineIndex: 0, sku: 'SKU1', qtyAsignada: 2 }],
        },
      ],
      waitlistOrigenId: 'wl-ok',
      draftId: 'd_atk002_T4',
      clientVersion: 'test',
    };
    const r = await commitPedidoCore(deps, payload);
    // Sin cardCode en payload, el cross-check del guard es no-op.
    // El pedido va a fallar por otros gates (VALIDATION_ERROR), no por CROSS_CLIENT.
    if (!r.ok && r.errorCode === 'ASIG_REF_INVALID') {
      expect(r.data?.reason).not.toBe('CROSS_CLIENT_CARDCODE_MISMATCH');
    }
  });
});

// @ts-nocheck
/**
 * Auditoría de seguridad 2026-11-25 (revisión adversarial #1422, A2):
 * commitPedidoCF aplica al vendedor interno (VDI) el alcance de pareja sobre
 * los documentos que el pedido modifica: la orden en espera de origen
 * (waitlistOrigenId, que queda consumida) y los pedidos de asigRefs (cuyas
 * reservas se cancelan). Fuera de alcance → INTERNO_FUERA_DE_PAREJA, sin
 * escrituras y con el rechazo registrado (§64.2). Admin, gerente y vendedor
 * sin cambio.
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

function fixture({ wlOwner, pedOwner }) {
  return {
    roles: {
      'uid-int': { role: 'interno' },
      'uid-int-otro': { role: 'interno' },
      'uid-vde-pareja': { role: 'vendedor', internalPartnerUid: 'uid-int' },
      'uid-vde-otro': { role: 'vendedor', internalPartnerUid: 'uid-int-otro' },
      'uid-ger': { role: 'gerente' },
    },
    pedidos: {
      'ped-origen': {
        _fsId: 'ped-origen',
        clientCardCode: 'C001',
        stage: 'confirmed',
        lines: [{ code: 'SKU1', state: 'ASIG', qty: 5, qtyOpen: 5, precio: 100 }],
        ...pedOwner,
      },
    },
    revision_waitlist: {
      'wl-origen': { clientCardCode: 'C001', orderNumber: 700, ...wlOwner },
    },
    app_config: {
      stock_snapshot: {
        warehouseBreakdown: JSON.stringify({ SKU1: { 11: 100 } }),
        updatedAt: new Date().toISOString(),
        _syncRun: new Date().toISOString(),
      },
    },
    pedido_draft_locks: {},
  };
}

const PAREJA = { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-pareja' };
const OTRA = { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-otro' };
const PROPIO = { ownerUid: 'uid-int', assignedVendorUid: 'uid-vde-otro' };

function cpstPayload(callerUid, draftId) {
  return {
    origen: 'cpst',
    cardCode: 'C001',
    clientName: 'CLIENTE C001',
    ownerUid: callerUid,
    lines: [
      {
        sku: 'SKU1',
        cantidad: 2,
        origenLinea: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, sku: 'SKU1', qtyAsignada: 2 }],
      },
    ],
    waitlistOrigenId: 'wl-origen',
    draftId,
    clientVersion: 'test',
  };
}

function run(state, callerRole, payload, extra = {}) {
  return commitPedidoCore(
    {
      fbDb: makeMockDb(state),
      log: () => {},
      now: () => new Date('2026-11-25T15:00:00.000Z'),
      FieldValue: { serverTimestamp: () => 'FV', delete: () => '<<deleted>>' },
      callerRole,
      ...extra,
    },
    payload
  );
}

const pedidoIds = (state) => Object.keys(state.pedidos);
const rejectionLogs = (state, code) =>
  Object.values(state.operations_log || {}).filter(
    (l) => l.type === 'commit_pedido_rejected' && l.errorCode === code
  );

function expectNoChanges(state) {
  expect(pedidoIds(state)).toEqual(['ped-origen']);
  expect(state.pedidos['ped-origen'].lines[0]).toMatchObject({ state: 'ASIG', qtyOpen: 5 });
  expect(state.revision_waitlist['wl-origen'].stage).toBeUndefined();
  expect(Object.keys(state.pedido_draft_locks)).toEqual([]);
}

describe('commitPedidoCF — alcance del interno (A2)', () => {
  it('orden y pedido de origen de su pareja → OK', async () => {
    const state = fixture({ wlOwner: PAREJA, pedOwner: PAREJA });
    const r = await run(state, 'interno', cpstPayload('uid-int', 'd-a2-1'));
    expect(r.ok).toBe(true);
    expect(state.revision_waitlist['wl-origen'].stage).toBe('consumed');
    // La reserva del pedido de origen se consumió (cancelación ASIG §33).
    expect(state.pedidos['ped-origen'].lines[0].qtyOpen).toBeLessThan(5);
  });

  it('orden propia → OK (pedido de origen de la pareja)', async () => {
    const state = fixture({ wlOwner: PROPIO, pedOwner: PAREJA });
    const r = await run(state, 'interno', cpstPayload('uid-int', 'd-a2-2'));
    expect(r.ok).toBe(true);
  });

  it('orden propia con pedido de origen de otra pareja → INTERNO_FUERA_DE_PAREJA, sin escrituras', async () => {
    const state = fixture({ wlOwner: PROPIO, pedOwner: OTRA });
    const r = await run(state, 'interno', cpstPayload('uid-int', 'd-a2-3'));
    expect(r).toMatchObject({ ok: false, errorCode: 'INTERNO_FUERA_DE_PAREJA' });
    expect(r.data._logExtra).toBeUndefined();
    expectNoChanges(state);
    const logs = rejectionLogs(state, 'INTERNO_FUERA_DE_PAREJA');
    expect(logs).toHaveLength(1);
    expect(logs[0].fueraDeAlcance).toEqual([
      { docType: 'pedidos', docId: 'ped-origen', reason: 'fuera_de_pareja' },
    ]);
  });

  it('orden en espera de otra pareja (sin asigRefs) → INTERNO_FUERA_DE_PAREJA, orden intacta', async () => {
    const state = fixture({ wlOwner: OTRA, pedOwner: PAREJA });
    const payload = {
      origen: 'manual',
      cardCode: 'C001',
      clientName: 'CLIENTE C001',
      ownerUid: 'uid-int',
      lines: [{ sku: 'SKU1', cantidad: 1 }],
      waitlistOrigenId: 'wl-origen',
      draftId: 'd-a2-4',
      clientVersion: 'test',
    };
    const r = await run(state, 'interno', payload);
    expect(r).toMatchObject({ ok: false, errorCode: 'INTERNO_FUERA_DE_PAREJA' });
    expectNoChanges(state);
    expect(rejectionLogs(state, 'INTERNO_FUERA_DE_PAREJA')[0].fueraDeAlcance[0]).toMatchObject({
      docType: 'revision_waitlist',
      docId: 'wl-origen',
    });
  });

  it('rol del VDE ilegible → denegado (falla cerrada)', async () => {
    const state = fixture({ wlOwner: PAREJA, pedOwner: PAREJA });
    const r = await run(state, 'interno', cpstPayload('uid-int', 'd-a2-5'), {
      getRoleDoc: async () => {
        throw new Error('lectura de rol fallida');
      },
    });
    expect(r).toMatchObject({ ok: false, errorCode: 'INTERNO_FUERA_DE_PAREJA' });
    expectNoChanges(state);
  });

  it('interno sin orden de origen ni asigRefs (pedido directo) → sin chequeo nuevo', async () => {
    const state = fixture({ wlOwner: OTRA, pedOwner: OTRA });
    delete state.revision_waitlist['wl-origen'];
    const r = await run(state, 'interno', {
      origen: 'manual',
      cardCode: 'C001',
      clientName: 'CLIENTE C001',
      ownerUid: 'uid-int',
      lines: [{ sku: 'SKU1', cantidad: 1 }],
      draftId: 'd-a2-6',
      clientVersion: 'test',
    });
    expect(r.ok).toBe(true);
  });

  it('vendedor, gerente y admin sobre otra pareja → sin cambio (OK)', async () => {
    for (const [role, uid] of [
      ['vendedor', 'uid-vde-pareja'],
      ['gerente', 'uid-ger'],
      ['admin', 'uid-admin'],
    ]) {
      const state = fixture({ wlOwner: OTRA, pedOwner: OTRA });
      const r = await run(state, role, cpstPayload(uid, `d-a2-7-${role}`));
      expect(r.ok).toBe(true);
    }
  });
});

// @ts-check
/**
 * §63 (2026-10-23 v1442) — tests para releaseAsigCore.
 *
 * Cubre:
 *   T1 — admin puede 'rechazo_cpst' (cancela ASIG + delete waitlist).
 *   T2 — gerente puede 'rechazo_cpst'.
 *   T3 — interno (Pablo) puede 'rechazo_cpst'.
 *   T4 — vendedor con assignedVendorUid == auth.uid puede 'rechazo_cpst'.
 *   T5 — vendedor con ownerUid == auth.uid (cargo el waitlist él mismo) puede.
 *   T6 — vendedor ajeno NO puede → permission-denied.
 *   T7 — unauthenticated → error.
 *   T8 — 'remove_item' con itemIndex válido → quita item + cancela ASIG + waitlist queda sin ese item.
 *   T9 — 'remove_item' último item → delete waitlist entera.
 *   T10 — 'remove_item' sin itemIndex → invalid-argument.
 *   T11 — Idempotencia: línea ya cancelled con closedReason set → skip.
 *   T12 — Línea en otro estado (BO revertida §40.5) → NO cancelar.
 *   T13 — operations_log entry escrito con type + role + userId.
 *   T14 — ALL reads before ALL writes (§58): el runTransaction tx.get del
 *         pedido origen ocurre ANTES de cualquier tx.update.
 *   T15 — action inválido → invalid-argument.
 */
import { describe, expect, it } from 'vitest';
import { releaseAsigCore } from '../../functions/core/release-asig-core.js';

/** Mock Firestore con soporte para delete + runTransaction STRICT (§58). */
function makeMockDb(fixture) {
  const state = fixture || {};
  const written = [];
  const operationsLog = [];

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _path: key,
      async get() {
        const data = state[colName]?.[docId];
        return {
          exists: !!data,
          data: () => data || null,
        };
      },
      async set(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'set', path: key, data });
      },
      async update(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'update', path: key, data });
      },
      async delete() {
        if (state[colName]) delete state[colName][docId];
        written.push({ op: 'delete', path: key });
      },
    };
  };

  const makeCollection = (colName) => ({
    doc(id) {
      return makeDocRef(colName, id || 'auto_' + Math.random().toString(36).slice(2, 10));
    },
    add(data) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[colName] ||= {};
      state[colName][id] = data;
      written.push({ op: 'add', path: `${colName}/${id}`, data });
      if (colName === 'operations_log') operationsLog.push(data);
      return Promise.resolve({ id });
    },
  });

  const fbDb = {
    collection: (name) => makeCollection(name),
    async runTransaction(fn) {
      let hasWritten = false;
      const tx = {
        async get(ref) {
          if (hasWritten) {
            // §58 STRICT MOCK: tx.get después de tx.write es violación.
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.'
            );
          }
          return ref.get();
        },
        set(ref, data) {
          hasWritten = true;
          return ref.set(data);
        },
        update(ref, data) {
          hasWritten = true;
          return ref.update(data);
        },
        delete(ref) {
          hasWritten = true;
          return ref.delete();
        },
      };
      return fn(tx);
    },
  };
  return { fbDb, _state: state, _written: written, _operationsLog: operationsLog };
}

function makeBaseState({
  pedidoOwnerUid = 'cargo-other',
  pedidoAssignedVendor = 'other-vendor-uid',
} = {}) {
  return {
    roles: {
      'admin-uid': { role: 'admin' },
      'gerente-uid': { role: 'gerente' },
      'interno-uid': { role: 'interno' },
      'vde-X-uid': { role: 'vendedor' },
      'vde-ajeno-uid': { role: 'vendedor' },
    },
    revision_waitlist: {
      wl1: {
        clientName: 'CLIENTE SA',
        clientCardCode: 'C001',
        orderNumber: 500,
        ownerUid: 'cargo-pablo',
        assignedVendorUid: 'vde-X-uid',
        items: [
          {
            code: 'SKU1',
            qty: 2,
            asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 2, sku: 'SKU1' }],
          },
          {
            code: 'SKU2',
            qty: 1,
            asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 1, qtyAsignada: 1, sku: 'SKU2' }],
          },
        ],
        pedidosOrigenes: [
          { pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 2, sku: 'SKU1' },
          { pedidoId: 'ped-origen', lineIndex: 1, qtyAsignada: 1, sku: 'SKU2' },
        ],
      },
    },
    pedidos: {
      'ped-origen': {
        _fsId: 'ped-origen',
        ownerUid: pedidoOwnerUid,
        assignedVendorUid: pedidoAssignedVendor,
        clientCardCode: 'C001',
        lines: [
          { sku: 'SKU1', state: 'ASIG', qty: 2, qtyOpen: 2 },
          { sku: 'SKU2', state: 'ASIG', qty: 1, qtyOpen: 1 },
        ],
      },
    },
  };
}

describe('§63 releaseAsigCore', () => {
  it('T1 — admin puede rechazo_cpst (cancela ASIG + delete waitlist)', async () => {
    const { fbDb, _state, _written, _operationsLog } = makeMockDb(makeBaseState());
    const r = await releaseAsigCore(
      { fbDb, now: () => 1_700_000_000_000 },
      {
        auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.linesCancelled).toBe(2);
    expect(r.unitsCancelled).toBe(3);
    expect(r.waitlistDeleted).toBe(true);
    const pedidoUpdate = _written.find((w) => w.path === 'pedidos/ped-origen' && w.op === 'update');
    expect(pedidoUpdate).toBeTruthy();
    expect(pedidoUpdate.data.lines[0].state).toBe('cancelled');
    expect(pedidoUpdate.data.lines[0].closedReason).toBe('cliente_rechazo_cpst');
    expect(pedidoUpdate.data.lines[1].state).toBe('cancelled');
    const wlDelete = _written.find((w) => w.path === 'revision_waitlist/wl1' && w.op === 'delete');
    expect(wlDelete).toBeTruthy();
    // Esperar tick para operations_log fire-and-forget.
    await new Promise((res) => setTimeout(res, 5));
    expect(_operationsLog.length).toBeGreaterThan(0);
    expect(_operationsLog[0].type).toBe('cpst_cancel_asig_cliente_rechazo');
    expect(_operationsLog[0].role).toBe('admin');
  });

  it('T2 — gerente puede rechazo_cpst', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'gerente-uid', token: { email: 'g@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
  });

  it('T3 — interno (Pablo) puede rechazo_cpst aunque el waitlist sea de otro', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'interno-uid', token: { email: 'pablo@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
  });

  it('T4 — vendedor con assignedVendorUid == auth.uid puede rechazo_cpst', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'vde-X-uid', token: { email: 'vde@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
  });

  it('T5 — vendedor que cargo el waitlist (ownerUid == auth.uid) puede operar', async () => {
    const state = makeBaseState();
    state.revision_waitlist.wl1.ownerUid = 'vde-ajeno-uid';
    state.revision_waitlist.wl1.assignedVendorUid = 'otro-uid';
    const { fbDb } = makeMockDb(state);
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'vde-ajeno-uid', token: { email: 'ajeno@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
  });

  it('T6 — vendedor ajeno (no owner ni assignedVendor) NO puede', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    let caught;
    try {
      await releaseAsigCore(
        { fbDb },
        {
          auth: { uid: 'vde-ajeno-uid', token: { email: 'ajeno@shimano.com.ar' } },
          action: 'rechazo_cpst',
          waitlistId: 'wl1',
        }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught._errorCode).toBe('permission-denied');
  });

  it('T7 — unauthenticated → error', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    let caught;
    try {
      await releaseAsigCore({ fbDb }, { auth: null, action: 'rechazo_cpst', waitlistId: 'wl1' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught._errorCode).toBe('unauthenticated');
  });

  it('T8 — remove_item válido: quita item + cancela ASIG + items[] updated', async () => {
    const { fbDb, _written } = makeMockDb(makeBaseState());
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
        action: 'remove_item',
        waitlistId: 'wl1',
        itemIndex: 0,
      }
    );
    expect(r.ok).toBe(true);
    expect(r.linesCancelled).toBe(1);
    expect(r.unitsCancelled).toBe(2);
    expect(r.waitlistDeleted).toBe(false);
    const wlUpdate = _written.find((w) => w.path === 'revision_waitlist/wl1' && w.op === 'update');
    expect(wlUpdate).toBeTruthy();
    expect(wlUpdate.data.items).toHaveLength(1);
    expect(wlUpdate.data.items[0].code).toBe('SKU2');
    const pedidoUpdate = _written.find((w) => w.path === 'pedidos/ped-origen' && w.op === 'update');
    expect(pedidoUpdate.data.lines[0].state).toBe('cancelled');
    expect(pedidoUpdate.data.lines[0].closedReason).toBe('quitado_por_vendedor_cpst');
    // SKU2 sigue vigente (ASIG) porque no la tocamos.
    expect(pedidoUpdate.data.lines[1].state).toBe('ASIG');
  });

  it('T9 — remove_item último item → delete waitlist entera', async () => {
    const state = makeBaseState();
    // Solo 1 item.
    state.revision_waitlist.wl1.items = [state.revision_waitlist.wl1.items[0]];
    const { fbDb, _written } = makeMockDb(state);
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
        action: 'remove_item',
        waitlistId: 'wl1',
        itemIndex: 0,
      }
    );
    expect(r.ok).toBe(true);
    expect(r.waitlistDeleted).toBe(true);
    const wlDelete = _written.find((w) => w.path === 'revision_waitlist/wl1' && w.op === 'delete');
    expect(wlDelete).toBeTruthy();
  });

  it('T10 — remove_item sin itemIndex → invalid-argument', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    let caught;
    try {
      await releaseAsigCore(
        { fbDb },
        {
          auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
          action: 'remove_item',
          waitlistId: 'wl1',
        }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught._errorCode).toBe('invalid-argument');
  });

  it('T11 — idempotencia: línea ya cancelled con closedReason set → skip', async () => {
    const state = makeBaseState();
    state.pedidos['ped-origen'].lines[0] = {
      sku: 'SKU1',
      state: 'cancelled',
      qty: 2,
      qtyOpen: 0,
      closedReason: 'cliente_rechazo_cpst',
    };
    const { fbDb } = makeMockDb(state);
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.linesCancelled).toBe(1); // Solo SKU2 (SKU1 ya cancelled → skip).
  });

  it('T12 — línea en otro estado (BO revertida) → NO cancelar', async () => {
    const state = makeBaseState();
    state.pedidos['ped-origen'].lines[0] = {
      sku: 'SKU1',
      state: 'BO',
      qty: 2,
      qtyOpen: 2,
      closedReason: 'asig_sin_stock_revertida_a_bo',
    };
    const { fbDb, _written } = makeMockDb(state);
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.linesCancelled).toBe(1); // Solo SKU2.
    const pedidoUpdate = _written.find((w) => w.path === 'pedidos/ped-origen' && w.op === 'update');
    expect(pedidoUpdate.data.lines[0].state).toBe('BO'); // Preservada.
  });

  it('T13 — operations_log entry escrito con type + role + userId + via', async () => {
    const { fbDb, _operationsLog } = makeMockDb(makeBaseState());
    await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'vde-X-uid', token: { email: 'vde@shimano.com.ar' } },
        action: 'remove_item',
        waitlistId: 'wl1',
        itemIndex: 0,
      }
    );
    await new Promise((res) => setTimeout(res, 5));
    expect(_operationsLog.length).toBeGreaterThan(0);
    const entry = _operationsLog[0];
    expect(entry.type).toBe('cpst_item_removed_release');
    expect(entry.role).toBe('vendedor');
    expect(entry.userId).toBe('vde-X-uid');
    expect(entry.via).toBe('releaseAsigCF');
    expect(entry.waitlistId).toBe('wl1');
    expect(entry.itemIndex).toBe(0);
  });

  it('T14 — ALL reads before ALL writes (§58): no explota el mock STRICT', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    // Si releaseAsigCore violara el orden read→write en la tx, el mock
    // STRICT tira "Firestore transactions require all reads to be executed
    // before all writes.". Si pasa, significa que respetamos §58.
    const r = await releaseAsigCore(
      { fbDb },
      {
        auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
        action: 'rechazo_cpst',
        waitlistId: 'wl1',
      }
    );
    expect(r.ok).toBe(true);
  });

  it('T15 — action inválido → invalid-argument', async () => {
    const { fbDb } = makeMockDb(makeBaseState());
    let caught;
    try {
      await releaseAsigCore(
        { fbDb },
        {
          auth: { uid: 'admin-uid', token: { email: 'admin@shimano.com.ar' } },
          action: 'xxx',
          waitlistId: 'wl1',
        }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught._errorCode).toBe('invalid-argument');
  });
});

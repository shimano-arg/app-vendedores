// @ts-check
// Auditoría de seguridad 2026-11-25: las Cloud Functions que modifican
// pedidos u órdenes en espera aplican al interno (VDI) el mismo alcance que
// firestore.rules: propios o de su VDE pareja. Fuera de pareja = denegado sin
// escribir. Admin y gerente sin cambio.
import { describe, expect, it } from 'vitest';
import { updateAsigLineState } from '../../functions/core/asig-recycle-core.js';
import { movePedidoToWaitlistCore } from '../../functions/core/move-pedido-to-waitlist-core.js';
import { releaseAsigCore } from '../../functions/core/release-asig-core.js';
import { unifyWaitlistsCore } from '../../functions/core/unify-waitlists-core.js';
import { updatePedidoLinesCore } from '../../functions/core/update-pedido-lines-core.js';

/** Mock Firestore en memoria con transacción STRICT (§58). */
function makeMockDb() {
  const store = new Map();
  /** @type {any[]} */
  const writes = [];
  let auto = 0;
  const docRef = (/** @type {string} */ path) => ({
    _path: path,
    id: path.split('/').pop(),
    async get() {
      const exists = store.has(path);
      return { exists, data: () => (exists ? { ...store.get(path) } : undefined) };
    },
    async set(/** @type {any} */ data) {
      store.set(path, { ...data });
      writes.push({ type: 'set', path, data });
    },
    async update(/** @type {any} */ data) {
      store.set(path, { ...(store.get(path) || {}), ...data });
      writes.push({ type: 'update', path, data });
    },
    async delete() {
      store.delete(path);
      writes.push({ type: 'delete', path });
    },
  });
  const query = (/** @type {string} */ name, /** @type {any[]} */ filters) => ({
    where(/** @type {string} */ field, /** @type {string} */ _op, /** @type {any} */ value) {
      return query(name, filters.concat([{ field, value }]));
    },
    limit() {
      return query(name, filters);
    },
    async get() {
      const docs = [];
      for (const [k, v] of store.entries()) {
        if (!k.startsWith(name + '/')) continue;
        if (filters.every((f) => v[f.field] === f.value)) {
          docs.push({ id: k.slice(name.length + 1), data: () => ({ ...v }) });
        }
      }
      return { size: docs.length, docs, forEach: (/** @type {any} */ cb) => docs.forEach(cb) };
    },
  });
  const collection = (/** @type {string} */ name) => ({
    doc(/** @type {string} */ id) {
      if (id) return docRef(`${name}/${id}`);
      auto += 1;
      return docRef(`${name}/auto-${auto}`);
    },
    async add(/** @type {any} */ data) {
      auto += 1;
      const id = `auto-${auto}`;
      store.set(`${name}/${id}`, { ...data });
      writes.push({ type: 'add', path: `${name}/${id}`, data });
      return { id };
    },
    where(/** @type {string} */ field, /** @type {string} */ op, /** @type {any} */ value) {
      return query(name, []).where(field, op, value);
    },
  });
  async function runTransaction(/** @type {any} */ fn) {
    let hasWritten = false;
    const tx = {
      async get(/** @type {any} */ ref) {
        if (hasWritten) {
          throw new Error(
            'Firestore transactions require all reads to be executed before all writes.'
          );
        }
        return ref.get();
      },
      set(/** @type {any} */ ref, /** @type {any} */ data) {
        hasWritten = true;
        store.set(ref._path, { ...data });
        writes.push({ type: 'set', path: ref._path, data });
      },
      update(/** @type {any} */ ref, /** @type {any} */ data) {
        hasWritten = true;
        store.set(ref._path, { ...(store.get(ref._path) || {}), ...data });
        writes.push({ type: 'update', path: ref._path, data });
      },
      delete(/** @type {any} */ ref) {
        hasWritten = true;
        store.delete(ref._path);
        writes.push({ type: 'delete', path: ref._path });
      },
    };
    return fn(tx);
  }
  const db = { collection, runTransaction, _store: store, _writes: writes };
  // Roles de la pareja de prueba.
  store.set('roles/uid-admin', { role: 'admin' });
  store.set('roles/uid-ger', { role: 'gerente' });
  store.set('roles/uid-int', { role: 'interno' });
  store.set('roles/uid-int-otro', { role: 'interno' });
  store.set('roles/uid-vde-pareja', { role: 'vendedor', internalPartnerUid: 'uid-int' });
  store.set('roles/uid-vde-otro', { role: 'vendedor', internalPartnerUid: 'uid-int-otro' });
  return db;
}

/** Writes de negocio (excluye el log de auditoría). */
function businessWrites(/** @type {any} */ db) {
  return db._writes.filter((/** @type {any} */ w) => !w.path.startsWith('operations_log/'));
}

const rolIlegible = async () => {
  throw new Error('lectura de rol fallida');
};
const authOf = (/** @type {string} */ uid) => ({
  uid,
  token: { email: `${uid}@shimano.com.ar` },
});

// Dueños de prueba: propio / pareja (cargado por el gerente para un cliente
// de la pareja) / otra pareja.
const OWNERS = {
  propio: { ownerUid: 'uid-int', assignedVendorUid: 'uid-vde-otro' },
  pareja: { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-pareja' },
  otra: { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-otro' },
};

// ---------------------------------------------------------------------------
describe('updatePedidoLinesCF — alcance del interno', () => {
  const seed = (/** @type {any} */ db, /** @type {any} */ owner) =>
    db._store.set('pedidos/ped1', {
      stage: 'pending',
      transferidoSAP: null,
      lines: [{ code: 'A', qty: 1, precio: 100 }],
      ...owner,
    });
  const payload = { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 150 }] };
  const run = (
    /** @type {any} */ db,
    /** @type {string} */ uid,
    /** @type {string} */ role,
    extra = {}
  ) => updatePedidoLinesCore({ fbDb: db, ...extra }, payload, { uid, email: '', role });

  it('interno sobre pedido de su pareja → OK', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    const r = await run(db, 'uid-int', 'interno');
    expect(r.ok).toBe(true);
  });

  it('interno sobre pedido propio → OK', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.propio);
    expect((await run(db, 'uid-int', 'interno')).ok).toBe(true);
  });

  it('interno sobre pedido de otra pareja → INTERNO_FUERA_DE_PAREJA sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.otra);
    const r = await run(db, 'uid-int', 'interno');
    expect(r).toMatchObject({ ok: false, errorCode: 'INTERNO_FUERA_DE_PAREJA' });
    expect(businessWrites(db)).toEqual([]);
    expect(db._store.get('pedidos/ped1').lines[0].precio).toBe(100);
  });

  it('rol del VDE ilegible → denegado sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    const r = await run(db, 'uid-int', 'interno', { getRoleDoc: rolIlegible });
    expect(r).toMatchObject({ ok: false, errorCode: 'INTERNO_FUERA_DE_PAREJA' });
    expect(businessWrites(db)).toEqual([]);
  });

  it('admin y gerente sobre otra pareja → OK (sin cambio)', async () => {
    for (const [uid, role] of [
      ['uid-admin', 'admin'],
      ['uid-ger', 'gerente'],
    ]) {
      const db = makeMockDb();
      seed(db, OWNERS.otra);
      expect((await run(db, uid, role)).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('updateAsigLineStateCF — alcance del interno', () => {
  const seed = (/** @type {any} */ db, /** @type {any} */ owner) =>
    db._store.set('pedidos/P1', {
      clientCardCode: 'C001',
      closedAt: null,
      lines: [
        { code: 'SKU-A', qty: 2, qtyOpen: 2, qtyCancelled: 0, qtyRecycled: 0, state: 'ASIG' },
      ],
      ...owner,
    });
  const run = (/** @type {any} */ db, /** @type {string} */ uid, extra = {}) =>
    updateAsigLineState(
      {
        fbDb: db,
        log: () => {},
        getUserRole: async (u) => (db._store.get(`roles/${u}`) || {}).role || null,
        ...extra,
      },
      { uid, email: `${uid}@shimano.com.ar` },
      { sourcePedidoId: 'P1', sourceLineIndex: 0, qty: 1, action: 'cancelled' }
    );

  it('interno pareja → OK; interno propio → OK', async () => {
    for (const owner of [OWNERS.pareja, OWNERS.propio]) {
      const db = makeMockDb();
      seed(db, owner);
      expect((await run(db, 'uid-int')).success).toBe(true);
    }
  });

  it('interno otra pareja → permission-denied con errorCode y sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.otra);
    await expect(run(db, 'uid-int')).rejects.toMatchObject({
      code: 'permission-denied',
      details: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(businessWrites(db)).toEqual([]);
  });

  it('rol del VDE ilegible → denegado', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    await expect(run(db, 'uid-int', { getRoleDoc: rolIlegible })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(businessWrites(db)).toEqual([]);
  });

  it('admin y gerente sobre otra pareja → OK', async () => {
    for (const uid of ['uid-admin', 'uid-ger']) {
      const db = makeMockDb();
      seed(db, OWNERS.otra);
      expect((await run(db, uid)).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('movePedidoToWaitlistCF — alcance del interno (solo pedido propio)', () => {
  const seed = (/** @type {any} */ db, /** @type {any} */ owner) =>
    db._store.set('pedidos/ped1', {
      stage: 'pending',
      clientName: 'CLIENTE X',
      clientCardCode: 'C001',
      lines: [{ sku: 'A', code: 'A', qty: 2, qtyOpen: 2, precio: 100 }],
      transferidoSAP: null,
      ...owner,
    });
  const run = (/** @type {any} */ db, /** @type {string} */ uid, extra = {}) =>
    movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1_000_000, ...extra },
      { auth: authOf(uid), pedidoId: 'ped1' }
    );

  it('interno sobre pedido propio → OK (pedido movido)', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.propio);
    const r = await run(db, 'uid-int');
    expect(r.ok).toBe(true);
    expect(db._store.has('pedidos/ped1')).toBe(false);
  });

  it('interno sobre pedido de su pareja → INTERNO_SOLO_PEDIDO_PROPIO sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    await expect(run(db, 'uid-int')).rejects.toMatchObject({
      _errorCode: 'permission-denied',
      _errorData: { errorCode: 'INTERNO_SOLO_PEDIDO_PROPIO' },
    });
    expect(businessWrites(db)).toEqual([]);
    expect(db._store.has('pedidos/ped1')).toBe(true);
  });

  it('interno sobre otra pareja → INTERNO_FUERA_DE_PAREJA, sin writes, rechazo logueado', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.otra);
    await expect(run(db, 'uid-int')).rejects.toMatchObject({
      _errorData: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(businessWrites(db)).toEqual([]);
    const logs = db._writes.filter((/** @type {any} */ w) => w.path.startsWith('operations_log/'));
    expect(logs.length).toBe(1);
    expect(logs[0].data).toMatchObject({
      type: 'move_pedido_rejected',
      errorCode: 'INTERNO_FUERA_DE_PAREJA',
    });
  });

  it('rol del VDE ilegible → denegado sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    await expect(run(db, 'uid-int', { getRoleDoc: rolIlegible })).rejects.toMatchObject({
      _errorData: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(businessWrites(db)).toEqual([]);
  });

  it('admin y gerente sobre otra pareja → OK', async () => {
    for (const uid of ['uid-admin', 'uid-ger']) {
      const db = makeMockDb();
      seed(db, OWNERS.otra);
      expect((await run(db, uid)).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('releaseAsigCF — alcance del interno', () => {
  const seed = (/** @type {any} */ db, /** @type {any} */ owner) => {
    db._store.set('revision_waitlist/wl1', {
      clientCardCode: 'C001',
      orderNumber: 500,
      items: [
        {
          code: 'SKU1',
          qty: 2,
          asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 2, sku: 'SKU1' }],
        },
      ],
      ...owner,
    });
    db._store.set('pedidos/ped-origen', {
      clientCardCode: 'C001',
      ownerUid: 'uid-ger',
      lines: [{ sku: 'SKU1', state: 'ASIG', qty: 2, qtyOpen: 2 }],
    });
  };
  const run = (/** @type {any} */ db, /** @type {string} */ uid, extra = {}) =>
    releaseAsigCore(
      { fbDb: db, now: () => 1_700_000_000_000, ...extra },
      { auth: authOf(uid), action: 'rechazo_cpst', waitlistId: 'wl1' }
    );

  it('interno pareja → OK; interno propio → OK', async () => {
    for (const owner of [OWNERS.pareja, OWNERS.propio]) {
      const db = makeMockDb();
      seed(db, owner);
      expect((await run(db, 'uid-int')).ok).toBe(true);
    }
  });

  it('interno otra pareja → INTERNO_FUERA_DE_PAREJA sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.otra);
    await expect(run(db, 'uid-int')).rejects.toMatchObject({
      _errorCode: 'permission-denied',
      _errorDetails: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(businessWrites(db)).toEqual([]);
    expect(db._store.has('revision_waitlist/wl1')).toBe(true);
  });

  it('rol del VDE ilegible → denegado sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    await expect(run(db, 'uid-int', { getRoleDoc: rolIlegible })).rejects.toMatchObject({
      _errorDetails: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(businessWrites(db)).toEqual([]);
  });

  it('admin y gerente sobre otra pareja → OK', async () => {
    for (const uid of ['uid-admin', 'uid-ger']) {
      const db = makeMockDb();
      seed(db, OWNERS.otra);
      expect((await run(db, uid)).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('unifyWaitlistsCF — alcance del interno', () => {
  const seedWL = (
    /** @type {any} */ db,
    /** @type {string} */ id,
    /** @type {any} */ owner,
    items
  ) =>
    db._store.set(`revision_waitlist/${id}`, {
      clientCardCode: 'C001',
      createdAt: '2026-11-15T00:00:00Z',
      stage: 'active',
      orderNumber: id,
      items: items || [{ code: 'A', qty: 1 }],
      ...owner,
    });
  const run = (/** @type {any} */ db, /** @type {string} */ uid, extra = {}) =>
    unifyWaitlistsCore(
      { fbDb: db, now: () => 1_000_000, ...extra },
      { auth: authOf(uid), targetWaitlistId: 'wl-t', absorbedWaitlistIds: ['wl-a'] }
    );

  it('interno con target y absorbida de su pareja/propias → OK', async () => {
    const db = makeMockDb();
    seedWL(db, 'wl-t', OWNERS.pareja);
    seedWL(db, 'wl-a', OWNERS.propio, [{ code: 'B', qty: 2 }]);
    const r = await run(db, 'uid-int');
    expect(r.ok).toBe(true);
    expect(db._store.get('revision_waitlist/wl-a').stage).toBe('consumed');
  });

  it('absorbida de otra pareja → INTERNO_FUERA_DE_PAREJA sin writes', async () => {
    const db = makeMockDb();
    seedWL(db, 'wl-t', OWNERS.pareja);
    seedWL(db, 'wl-a', OWNERS.otra, [{ code: 'B', qty: 2 }]);
    await expect(run(db, 'uid-int')).rejects.toMatchObject({
      _errorCode: 'permission-denied',
      _errorData: { errorCode: 'INTERNO_FUERA_DE_PAREJA', waitlistFueraDeAlcance: 'wl-a' },
    });
    expect(businessWrites(db)).toEqual([]);
    expect(db._store.get('revision_waitlist/wl-a').stage).toBe('active');
  });

  it('rol del VDE ilegible → denegado sin writes', async () => {
    const db = makeMockDb();
    seedWL(db, 'wl-t', OWNERS.pareja);
    seedWL(db, 'wl-a', OWNERS.pareja, [{ code: 'B', qty: 2 }]);
    await expect(run(db, 'uid-int', { getRoleDoc: rolIlegible })).rejects.toMatchObject({
      _errorData: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(businessWrites(db)).toEqual([]);
  });

  it('admin y gerente sobre otra pareja → OK', async () => {
    for (const uid of ['uid-admin', 'uid-ger']) {
      const db = makeMockDb();
      seedWL(db, 'wl-t', OWNERS.otra);
      seedWL(db, 'wl-a', OWNERS.otra, [{ code: 'B', qty: 2 }]);
      expect((await run(db, uid)).ok).toBe(true);
    }
  });
});

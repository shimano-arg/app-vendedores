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

  // B1 (revisión 2026-11-25): cancelar la última ASIG de un pedido de la
  // pareja no lo cierra (closedAt queda fuera, igual que en las rules); si
  // el pedido es propio, sí.
  const runAll = (/** @type {any} */ db, /** @type {string} */ uid) =>
    updateAsigLineState(
      {
        fbDb: db,
        log: () => {},
        getUserRole: async (u) => (db._store.get(`roles/${u}`) || {}).role || null,
      },
      { uid, email: `${uid}@shimano.com.ar` },
      { sourcePedidoId: 'P1', sourceLineIndex: 0, qty: 2, action: 'cancelled' }
    );

  it('interno pareja cancela la última ASIG → línea cancelada, pedido sin closedAt', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    const r = await runAll(db, 'uid-int');
    expect(r).toMatchObject({ success: true, pedidoClosed: false });
    const p = db._store.get('pedidos/P1');
    expect(p.lines[0]).toMatchObject({ state: 'cancelled', qtyOpen: 0 });
    expect(p.closedAt).toBeNull();
    expect(p.closedReason).toBeUndefined();
  });

  it('interno propio / admin cancela la última ASIG → pedido cerrado (sin cambio)', async () => {
    for (const [owner, uid] of [
      [OWNERS.propio, 'uid-int'],
      [OWNERS.otra, 'uid-admin'],
    ]) {
      const db = makeMockDb();
      seed(db, owner);
      const r = await runAll(db, /** @type {string} */ (uid));
      expect(r.pedidoClosed).toBe(true);
      expect(db._store.get('pedidos/P1').closedAt).toBeTruthy();
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

  // B6 (revisión 2026-11-25): con el rol legible, un pedido de la pareja da
  // INTERNO_SOLO_PEDIDO_PROPIO (la pareja se reconoce, pero no alcanza para
  // mover). Con el rol ilegible la pareja NO se reconoce: se evalúa el rol
  // del VDE (lectura que falla) y se cae a INTERNO_FUERA_DE_PAREJA. Ese
  // cambio de código es la prueba de que el camino falla cerrado.
  it('rol del VDE ilegible → la pareja no se reconoce (falla cerrada), sin writes', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    let lecturas = 0;
    const getRoleDoc = async () => {
      lecturas += 1;
      throw new Error('lectura de rol fallida');
    };
    await expect(run(db, 'uid-int', { getRoleDoc })).rejects.toMatchObject({
      _errorData: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(lecturas).toBeGreaterThan(0);
    expect(businessWrites(db)).toEqual([]);
    expect(db._store.has('pedidos/ped1')).toBe(true);
    const logs = db._writes.filter((/** @type {any} */ w) => w.path.startsWith('operations_log/'));
    expect(logs.map((/** @type {any} */ l) => l.data.errorCode)).toEqual([
      'INTERNO_FUERA_DE_PAREJA',
    ]);
  });

  it('pedido propio con rol de VDE ilegible → OK (no depende de leer roles)', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.propio);
    expect((await run(db, 'uid-int', { getRoleDoc: rolIlegible })).ok).toBe(true);
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
  // `pedidoOwner`: dueño del pedido de origen (por defecto, de la pareja:
  // cargado por el gerente para un cliente del VDE pareja).
  const seed = (
    /** @type {any} */ db,
    /** @type {any} */ owner,
    /** @type {any} */ pedidoOwner = OWNERS.pareja,
    /** @type {any} */ pedidoExtra = {}
  ) => {
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
      lines: [{ sku: 'SKU1', state: 'ASIG', qty: 2, qtyOpen: 2 }],
      ...pedidoOwner,
      ...pedidoExtra,
    });
  };
  const run = (/** @type {any} */ db, /** @type {string} */ uid, extra = {}) =>
    releaseAsigCore(
      { fbDb: db, now: () => 1_700_000_000_000, ...extra },
      { auth: authOf(uid), action: 'rechazo_cpst', waitlistId: 'wl1' }
    );

  it('interno propio → OK (rechazo_cpst y remove_item); interno pareja → OK en remove_item', async () => {
    for (const [owner, action] of [
      [OWNERS.propio, 'rechazo_cpst'],
      [OWNERS.propio, 'remove_item'],
      [OWNERS.pareja, 'remove_item'],
    ]) {
      const db = makeMockDb();
      seed(db, owner);
      const r = await releaseAsigCore(
        { fbDb: db, now: () => 1_700_000_000_000 },
        { auth: authOf('uid-int'), action, waitlistId: 'wl1', itemIndex: 0 }
      );
      expect(r.ok).toBe(true);
    }
  });

  // N5 (re-revisión #1422 R2): rechazo_cpst borra la orden en espera; el
  // interno solo borra órdenes propias (mismo criterio que firestore.rules).
  it('interno pareja → rechazo_cpst denegado con WAITLIST_BORRAR_SOLO_PROPIA, sin writes y con log', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja);
    await expect(run(db, 'uid-int')).rejects.toMatchObject({
      _errorCode: 'permission-denied',
      _errorDetails: { errorCode: 'WAITLIST_BORRAR_SOLO_PROPIA' },
    });
    expect(businessWrites(db)).toEqual([]);
    expect(db._store.has('revision_waitlist/wl1')).toBe(true);
    expect(db._store.get('pedidos/ped-origen').lines[0].state).toBe('ASIG');
    const logs = db._writes.filter((/** @type {any} */ w) => w.path.startsWith('operations_log/'));
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toMatchObject({
      type: 'release_asig_rejected',
      errorCode: 'WAITLIST_BORRAR_SOLO_PROPIA',
      reason: 'orden_de_pareja',
      aborted: true,
    });
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

  // A1 (revisión 2026-11-25): la orden es propia (o de la pareja), pero el
  // pedido de origen al que apunta es de otra pareja.
  it('orden propia con pedido de origen de otra pareja → denegado, cero escrituras', async () => {
    for (const owner of [OWNERS.propio, OWNERS.pareja]) {
      for (const action of ['rechazo_cpst', 'remove_item']) {
        // rechazo_cpst sobre orden de la pareja ya corta antes (N5).
        if (owner === OWNERS.pareja && action === 'rechazo_cpst') continue;
        const db = makeMockDb();
        seed(db, owner, OWNERS.otra);
        await expect(
          releaseAsigCore(
            { fbDb: db, now: () => 1_700_000_000_000 },
            { auth: authOf('uid-int'), action, waitlistId: 'wl1', itemIndex: 0 }
          )
        ).rejects.toMatchObject({
          _errorCode: 'permission-denied',
          _errorDetails: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
        });
        expect(businessWrites(db)).toEqual([]);
        expect(db._store.has('revision_waitlist/wl1')).toBe(true);
        expect(db._store.get('pedidos/ped-origen').lines[0].state).toBe('ASIG');
        // El rechazo queda registrado (§64.2) y el detalle no viaja al cliente.
        const logs = db._writes.filter((/** @type {any} */ w) =>
          w.path.startsWith('operations_log/')
        );
        expect(logs.length).toBe(1);
        expect(logs[0].data).toMatchObject({
          type: 'release_asig_rejected',
          errorCode: 'INTERNO_FUERA_DE_PAREJA',
          aborted: true,
        });
      }
    }
  });

  it('pedido de origen con rol del VDE ilegible → denegado (falla cerrada)', async () => {
    const db = makeMockDb();
    // Orden propia (pasa sin leer roles); el pedido solo entra por pareja.
    seed(db, OWNERS.propio, OWNERS.pareja);
    await expect(run(db, 'uid-int', { getRoleDoc: rolIlegible })).rejects.toMatchObject({
      _errorDetails: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(businessWrites(db)).toEqual([]);
  });

  it('pedido de origen propio del interno → OK', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.propio, { ownerUid: 'uid-int' });
    expect((await run(db, 'uid-int')).ok).toBe(true);
  });

  // M3 (revisión 2026-11-25): el interno ya no es privilegiado en este CF,
  // así que pasa por el chequeo entre clientes. Pedidos viejos sin
  // clientCardCode → CLIENT_DATA_MISSING (antes operaba). Intencional.
  it('interno de la pareja con pedido de origen sin clientCardCode → CLIENT_DATA_MISSING', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.pareja, OWNERS.pareja, { clientCardCode: '' });
    await expect(
      releaseAsigCore(
        { fbDb: db, now: () => 1_700_000_000_000 },
        { auth: authOf('uid-int'), action: 'remove_item', waitlistId: 'wl1', itemIndex: 0 }
      )
    ).rejects.toMatchObject({
      _errorCode: 'failed-precondition',
      _errorDetails: { errorCode: 'CLIENT_DATA_MISSING' },
    });
    expect(businessWrites(db)).toEqual([]);
  });

  it('admin y gerente sobre otra pareja → OK', async () => {
    for (const uid of ['uid-admin', 'uid-ger']) {
      const db = makeMockDb();
      seed(db, OWNERS.otra, OWNERS.otra);
      expect((await run(db, uid)).ok).toBe(true);
    }
  });

  it('admin con pedido de origen sin clientCardCode → OK (sin cambio)', async () => {
    const db = makeMockDb();
    seed(db, OWNERS.otra, OWNERS.otra, { clientCardCode: '' });
    expect((await run(db, 'uid-admin')).ok).toBe(true);
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

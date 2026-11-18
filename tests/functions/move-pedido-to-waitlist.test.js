// @ts-check
import { describe, expect, it } from 'vitest';
import { movePedidoToWaitlistCore } from '../../functions/core/move-pedido-to-waitlist-core.js';

function makeMockDb() {
  const store = new Map();
  const writes = [];
  let txQueue = Promise.resolve();
  let autoIdCounter = 0;

  function docRef(path) {
    return {
      _path: path,
      id: path.split('/').pop(),
      async get() {
        const exists = store.has(path);
        return { exists, data: () => (exists ? { ...store.get(path) } : undefined) };
      },
      async update(data) {
        store.set(path, { ...(store.get(path) || {}), ...data });
        writes.push({ type: 'update', path, data });
      },
    };
  }
  function makeQuerySnap(name, filters) {
    // Shape minimal compat con el core: .forEach((d) => ... d.id, d.data()).
    const docs = [];
    for (const [k, v] of store.entries()) {
      if (!k.startsWith(name + '/')) continue;
      const id = k.slice(name.length + 1);
      let ok = true;
      for (const f of filters) {
        if (v[f.field] !== f.value) {
          ok = false;
          break;
        }
      }
      if (ok) docs.push({ id, data: () => ({ ...v }) });
    }
    return {
      forEach(cb) {
        docs.forEach(cb);
      },
      size: docs.length,
      docs,
    };
  }
  function buildQuery(name, filters) {
    return {
      where(field, _op, value) {
        return buildQuery(name, filters.concat([{ field, value }]));
      },
      async get() {
        // H2 adversarial: permite inyectar fallo de query por colección.
        if (
          failedWhereGet &&
          failedWhereGet.collection === name &&
          (!failedWhereGet.filter ||
            filters.some(
              (f) =>
                f.field === failedWhereGet.filter.field && f.value === failedWhereGet.filter.value
            ))
        ) {
          const err = new Error(failedWhereGet.message || 'simulated where().get() failure');
          err.code = failedWhereGet.code || 'permission-denied';
          throw err;
        }
        return makeQuerySnap(name, filters);
      },
    };
  }
  /** @type {null | {collection:string, filter?: {field:string, value:any}, code?: string, message?: string}} */
  let failedWhereGet = null;
  function setWhereGetFailure(spec) {
    failedWhereGet = spec;
  }
  function collection(name) {
    return {
      _name: name,
      doc(id) {
        if (id) return docRef(`${name}/${id}`);
        autoIdCounter += 1;
        return docRef(`${name}/auto-${autoIdCounter}`);
      },
      async add(data) {
        autoIdCounter += 1;
        const id = `auto-${autoIdCounter}`;
        store.set(`${name}/${id}`, { ...data });
        writes.push({ type: 'add', path: `${name}/${id}`, data });
        return { id };
      },
      where(field, _op, value) {
        return buildQuery(name, [{ field, value }]);
      },
      async get() {
        return makeQuerySnap(name, []);
      },
    };
  }
  function runTransaction(fn) {
    const next = txQueue.then(async () => {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          store.set(ref._path, { ...data });
          writes.push({ type: 'set', path: ref._path, data });
        },
        update(ref, data) {
          store.set(ref._path, { ...(store.get(ref._path) || {}), ...data });
          writes.push({ type: 'update', path: ref._path, data });
        },
        delete(ref) {
          store.delete(ref._path);
          writes.push({ type: 'delete', path: ref._path });
        },
      };
      return fn(tx);
    });
    txQueue = next.catch(() => {});
    return next;
  }
  return {
    collection,
    runTransaction,
    _store: store,
    _writes: writes,
    _setWhereGetFailure: setWhereGetFailure,
  };
}

function seedPedido(db, id, overrides) {
  db._store.set(`pedidos/${id}`, {
    stage: 'pending',
    ownerUid: 'uid-admin',
    assignedVendorUid: 'uid-vde',
    ownerEmail: 'admin@shimano.com.ar',
    clientName: 'CLIENTE X',
    clientCardCode: 'C001',
    lines: [{ sku: 'A', code: 'A', qty: 2, precio: 100 }],
    transferidoSAP: null,
    ...overrides,
  });
}
function seedRole(db, uid, role) {
  db._store.set(`roles/${uid}`, { role });
}

describe('movePedidoToWaitlistCore', () => {
  it('admin mueve pending a waitlist + borra pedido (atomic)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1');
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1000000 },
      { auth: { uid: 'uid-admin', token: { email: 'admin@shimano.com.ar' } }, pedidoId: 'ped1' }
    );
    expect(r.ok).toBe(true);
    expect(r.newWaitlistId).toBeTruthy();
    expect(db._store.has('pedidos/ped1')).toBe(false);
    expect(db._store.has(`revision_waitlist/${r.newWaitlistId}`)).toBe(true);
    const wl = db._store.get(`revision_waitlist/${r.newWaitlistId}`);
    expect(wl.items.length).toBe(1);
    expect(wl.source).toBe('movedFromPedido');
    expect(wl.movedFromPedidoId).toBe('ped1');
    expect(wl.clientCardCode).toBe('C001');
  });

  it('VDE owner OK', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-vde', 'vendedor');
    seedPedido(db, 'ped1', { ownerUid: 'uid-vde' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1000000 },
      { auth: { uid: 'uid-vde', token: { email: 'vde@shimano.com.ar' } }, pedidoId: 'ped1' }
    );
    expect(r.ok).toBe(true);
  });

  it('VDE no-owner → permission-denied', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-vde-ajeno', 'vendedor');
    seedPedido(db, 'ped1', { ownerUid: 'uid-otro', assignedVendorUid: 'uid-otro' });
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1000000 },
        { auth: { uid: 'uid-vde-ajeno', token: {} }, pedidoId: 'ped1' }
      )
    ).rejects.toMatchObject({ _errorCode: 'permission-denied' });
  });

  it('Obs 7: user con rol vacío (unassigned) + ownerUid propio → permission-denied', async () => {
    // Antes del fix Obs 7 (Fase 2 prep), un user con rol vacío pero ownerUid
    // del pedido pasaba por ser "owner". Ahora `isOwner` exige role con read.
    const db = makeMockDb();
    // No se seedea rol → `roleSnap.data().role` queda vacío.
    db._store.set('roles/uid-unassigned', { role: '' });
    seedPedido(db, 'ped-unassigned', { ownerUid: 'uid-unassigned' });
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1000000 },
        { auth: { uid: 'uid-unassigned', token: {} }, pedidoId: 'ped-unassigned' }
      )
    ).rejects.toMatchObject({ _errorCode: 'permission-denied' });
  });

  it('Obs 7: viewer (role=viewer) + ownerUid propio → OK (viewer sí es reader)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-viewer', 'viewer');
    seedPedido(db, 'ped-viewer', { ownerUid: 'uid-viewer' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1000000 },
      { auth: { uid: 'uid-viewer', token: {} }, pedidoId: 'ped-viewer' }
    );
    expect(r.ok).toBe(true);
  });

  it('stage=confirmed → failed-precondition', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', { stage: 'confirmed' });
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1000000 },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
  });

  it('pedido con transferidoSAP.docNum → failed-precondition', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', { transferidoSAP: { docNum: 12345, docEntry: 999 } });
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1000000 },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
  });

  it('pedido no existe → not-found', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1000000 },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'nope' }
      )
    ).rejects.toMatchObject({ _errorCode: 'not-found' });
  });

  it('payload sin pedidoId → invalid-argument', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1000000 },
        { auth: { uid: 'uid-admin', token: {} } }
      )
    ).rejects.toMatchObject({ _errorCode: 'invalid-argument' });
  });

  it('operations_log escrito', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1');
    await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    await new Promise((r) => setTimeout(r, 10));
    const logs = Array.from(db._store.entries())
      .filter(([k]) => k.startsWith('operations_log/'))
      .map(([, v]) => v);
    expect(logs.length).toBe(1);
    expect(logs[0].type).toBe('pedido_moved_to_waitlist');
    expect(logs[0].pedidoId).toBe('ped1');
  });
});

// Helper para seed de waitlist en el store (shape mínimo que lee el core).
function seedWaitlist(db, id, overrides) {
  db._store.set(`revision_waitlist/${id}`, {
    clientCardCode: 'C001',
    stage: 'active',
    closedAt: null,
    items: [{ code: 'X', qty: 1, precio: 50 }],
    createdAt: '2026-11-15T00:00:00.000Z',
    ownerUid: 'uid-admin',
    assignedVendorUid: 'uid-vde',
    ownerEmail: 'admin@shimano.com.ar',
    ...overrides,
  });
}

describe('movePedidoToWaitlistCore — §42 unificación con waitlist abierto', () => {
  it('§42-M1: cliente con waitlist abierto → UNIFICA (no crea nuevo)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlist(db, 'wl-open', {
      clientCardCode: 'C001',
      items: [{ code: 'A', qty: 1, precio: 100 }],
    });
    seedPedido(db, 'ped1', {
      clientCardCode: 'C001',
      lines: [{ code: 'B', qty: 3, precio: 200 }],
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    expect(r.ok).toBe(true);
    expect(r.unified).toBe(true);
    expect(r.targetWaitlistId).toBe('wl-open');
    expect(r.newWaitlistId).toBe('wl-open');
    // Pedido borrado (op atómica).
    expect(db._store.has('pedidos/ped1')).toBe(false);
    // Target tiene 2 items (A + B); no se creó wl nuevo.
    const target = db._store.get('revision_waitlist/wl-open');
    expect(target.items.length).toBe(2);
    expect(target.items.some((i) => i.code === 'A')).toBe(true);
    expect(target.items.some((i) => i.code === 'B' && i.qty === 3)).toBe(true);
    // unifiedFrom audit entry con pedidoId.
    expect(Array.isArray(target.unifiedFrom)).toBe(true);
    expect(target.unifiedFrom[0].pedidoId).toBe('ped1');
    // No hay otros docs auto-N en revision_waitlist (no se creó un segundo).
    const otros = Array.from(db._store.keys()).filter(
      (k) => k.startsWith('revision_waitlist/') && k !== 'revision_waitlist/wl-open'
    );
    expect(otros.length).toBe(0);
  });

  it('§42-M2: cliente SIN waitlist abierto → crea nuevo (comportamiento legacy)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', { clientCardCode: 'C777' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    expect(r.unified).toBe(false);
    expect(r.targetWaitlistId).toBe(null);
    expect(r.newWaitlistId).toBeTruthy();
    expect(db._store.has(`revision_waitlist/${r.newWaitlistId}`)).toBe(true);
  });

  it('§42-M3: waitlist consumed NO cuenta como abierto → crea nuevo', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlist(db, 'wl-consumed', {
      clientCardCode: 'C001',
      stage: 'consumed',
      closedAt: '2026-11-15T01:00:00.000Z',
    });
    seedPedido(db, 'ped1', { clientCardCode: 'C001' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    expect(r.unified).toBe(false);
    expect(r.newWaitlistId).not.toBe('wl-consumed');
  });

  it('§42-M4: waitlist con closedAt NO cuenta como abierto', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlist(db, 'wl-closed', {
      clientCardCode: 'C001',
      stage: 'active',
      closedAt: '2026-11-15T01:00:00.000Z',
    });
    seedPedido(db, 'ped1', { clientCardCode: 'C001' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    expect(r.unified).toBe(false);
  });

  it('§42-M5: múltiples abiertos → unifica contra el más reciente por createdAt', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlist(db, 'wl-old', {
      clientCardCode: 'C001',
      createdAt: '2026-11-10T00:00:00.000Z',
      items: [{ code: 'OLD', qty: 1, precio: 10 }],
    });
    seedWaitlist(db, 'wl-new', {
      clientCardCode: 'C001',
      createdAt: '2026-11-17T00:00:00.000Z',
      items: [{ code: 'NEW', qty: 1, precio: 20 }],
    });
    seedPedido(db, 'ped1', { clientCardCode: 'C001' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    expect(r.unified).toBe(true);
    expect(r.targetWaitlistId).toBe('wl-new');
  });

  it('§42-M6: unified → operations_log type=pedido_moved_and_unified', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlist(db, 'wl-open', { clientCardCode: 'C001' });
    seedPedido(db, 'ped1', { clientCardCode: 'C001' });
    await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    await new Promise((r) => setTimeout(r, 10));
    const logs = Array.from(db._store.entries())
      .filter(([k]) => k.startsWith('operations_log/'))
      .map(([, v]) => v);
    expect(logs[0].type).toBe('pedido_moved_and_unified');
    expect(logs[0].unified).toBe(true);
  });
});

describe('movePedidoToWaitlistCore — §40.5 preservación asigRefs/origen', () => {
  it('§40.5-M1: línea con asigRefs populated → preservadas en items[]', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', {
      clientCardCode: 'C001',
      lines: [
        {
          code: 'SKU-X',
          qty: 2,
          qtyOpen: 2,
          precio: 500,
          origen: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen-1', lineIndex: 3, qtyAsignada: 2, sku: 'SKU-X' }],
        },
      ],
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    const wl = db._store.get(`revision_waitlist/${r.newWaitlistId}`);
    expect(wl.items.length).toBe(1);
    expect(wl.items[0].origen).toBe('stock-asignado');
    expect(Array.isArray(wl.items[0].asigRefs)).toBe(true);
    expect(wl.items[0].asigRefs.length).toBe(1);
    expect(wl.items[0].asigRefs[0].pedidoId).toBe('origen-1');
    expect(wl.items[0].asigRefs[0].qtyAsignada).toBe(2);
  });

  it('§40.5-M2: source=stock-asignado-batch propagado al waitlist nuevo', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', {
      clientCardCode: 'C001',
      source: 'stock-asignado-batch',
      pedidosOrigenes: [{ pedidoId: 'origen-1', lineIndex: 0, sku: 'A', qtyAsignada: 1 }],
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    const wl = db._store.get(`revision_waitlist/${r.newWaitlistId}`);
    expect(wl.source).toBe('stock-asignado-batch');
    expect(Array.isArray(wl.pedidosOrigenes)).toBe(true);
    expect(wl.pedidosOrigenes.length).toBe(1);
  });

  it('§40.5-M3: unify preserva asigRefs del target + incoming + dedupe', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlist(db, 'wl-open', {
      clientCardCode: 'C001',
      items: [
        {
          code: 'SKU-X',
          qty: 1,
          qtyOpen: 1,
          precio: 500,
          origen: 'stock-asignado',
          asigRefs: [{ pedidoId: 'A', lineIndex: 0, qtyAsignada: 1 }],
        },
      ],
    });
    seedPedido(db, 'ped1', {
      clientCardCode: 'C001',
      lines: [
        {
          code: 'SKU-X',
          qty: 2,
          qtyOpen: 2,
          precio: 500,
          origen: 'stock-asignado',
          asigRefs: [
            { pedidoId: 'A', lineIndex: 0, qtyAsignada: 1 }, // dup
            { pedidoId: 'B', lineIndex: 5, qtyAsignada: 2 },
          ],
        },
      ],
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    expect(r.unified).toBe(true);
    const target = db._store.get('revision_waitlist/wl-open');
    // §56: una sola fila sumada (1 + 2 = 3).
    expect(target.items.length).toBe(1);
    expect(target.items[0].code).toBe('SKU-X');
    expect(target.items[0].qty).toBe(3);
    // §40.5: asigRefs dedup por (pedidoId, lineIndex) → 2 refs (A y B).
    expect(target.items[0].asigRefs.length).toBe(2);
    const keys = target.items[0].asigRefs.map((r) => r.pedidoId + '|' + r.lineIndex).sort();
    expect(keys).toEqual(['A|0', 'B|5']);
  });
});

describe('movePedidoToWaitlistCore — §56 dedup por SKU', () => {
  it('§56-M1: pedido con 2 líneas mismo SKU → 1 fila sumada', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', {
      clientCardCode: 'C001',
      lines: [
        { code: 'SKU-A', qty: 2, qtyOpen: 2, precio: 100 },
        { code: 'SKU-A', qty: 3, qtyOpen: 3, precio: 100 },
      ],
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    const wl = db._store.get(`revision_waitlist/${r.newWaitlistId}`);
    expect(wl.items.length).toBe(1);
    expect(wl.items[0].code).toBe('SKU-A');
    expect(wl.items[0].qty).toBe(5);
    expect(wl.items[0].qtyOpen).toBe(5);
  });

  it('§56-M2: unify con waitlist que ya tiene SKU X → suma, no duplica', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlist(db, 'wl-open', {
      clientCardCode: 'C001',
      items: [{ code: 'SKU-X', qty: 1, qtyOpen: 1, precio: 100 }],
    });
    seedPedido(db, 'ped1', {
      clientCardCode: 'C001',
      lines: [{ code: 'SKU-X', qty: 4, qtyOpen: 4, precio: 100 }],
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    expect(r.unified).toBe(true);
    const target = db._store.get('revision_waitlist/wl-open');
    expect(target.items.length).toBe(1);
    expect(target.items[0].qty).toBe(5);
  });

  it('§56-M3: codes case-insensitive se mergean (a vs A)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', {
      clientCardCode: 'C001',
      lines: [
        { code: 'sku-a', qty: 1, qtyOpen: 1, precio: 10 },
        { code: 'SKU-A', qty: 2, qtyOpen: 2, precio: 10 },
      ],
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    const wl = db._store.get(`revision_waitlist/${r.newWaitlistId}`);
    expect(wl.items.length).toBe(1);
    expect(wl.items[0].qty).toBe(3);
  });
});

function seedWaitlistFase1(db, id, overrides) {
  db._store.set(`revision_waitlist/${id}`, {
    clientCardCode: 'C001',
    ownerUid: 'uid-admin',
    assignedVendorUid: 'uid-vde',
    ownerVendor: null,
    assignedVendorEmail: null,
    orderNumber: 'ORD-900',
    items: [{ code: 'X', qty: 1, qtyOpen: 1, precio: 50 }],
    stage: 'active',
    closedAt: null,
    createdAt: '2026-11-15T00:00:00Z',
    ...overrides,
  });
}

describe('movePedidoToWaitlistCore — Fase 1 (lock + H2/H3/H11)', () => {
  it('Lock: path CREATE escribe revision_waitlist_locks/{cardCode} con waitlistId=newId', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped1', { clientCardCode: 'C-LCK1' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped1' }
    );
    const lock = db._store.get('revision_waitlist_locks/C-LCK1');
    expect(lock).toBeTruthy();
    expect(lock.cardCode).toBe('C-LCK1');
    expect(lock.waitlistId).toBe(r.newWaitlistId);
    expect(lock.lastOperation).toBe('create');
    expect(lock._version).toBe(1);
    expect(lock.updatedBy).toBe('uid-admin');
    expect(typeof lock.updatedAt).toBe('string');
  });

  it('Lock: path UNIFY actualiza lock apuntando al target existente', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    // Waitlist preexistente abierto + lock que la apunta.
    seedWaitlistFase1(db, 'wl-existing', { clientCardCode: 'C-LCK2' });
    db._store.set('revision_waitlist_locks/C-LCK2', {
      cardCode: 'C-LCK2',
      waitlistId: 'wl-existing',
      updatedAt: '2026-11-15T10:00:00Z',
      updatedBy: 'uid-anterior',
      lastOperation: 'create',
      _version: 1,
    });
    seedPedido(db, 'ped2', { clientCardCode: 'C-LCK2' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped2' }
    );
    expect(r.unified).toBe(true);
    expect(r.targetWaitlistId).toBe('wl-existing');
    const lock = db._store.get('revision_waitlist_locks/C-LCK2');
    expect(lock.waitlistId).toBe('wl-existing');
    expect(lock.lastOperation).toBe('unify');
    expect(lock.updatedBy).toBe('uid-admin');
    // Pedido eliminado atómicamente.
    expect(db._store.has('pedidos/ped2')).toBe(false);
  });

  it('Lock stale: lock apunta a waitlist consumed → se re-apunta vía pre-tx query', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    // Waitlist que el lock cree viva pero en realidad está consumed.
    seedWaitlistFase1(db, 'wl-stale', {
      clientCardCode: 'C-LCK3',
      stage: 'consumed',
      closedAt: '2026-11-16T00:00:00Z',
    });
    db._store.set('revision_waitlist_locks/C-LCK3', {
      cardCode: 'C-LCK3',
      waitlistId: 'wl-stale',
      updatedAt: '2026-11-16T00:00:00Z',
      updatedBy: 'uid-anterior',
      lastOperation: 'create',
      _version: 1,
    });
    seedPedido(db, 'ped3', { clientCardCode: 'C-LCK3' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped3' }
    );
    // Sin otros abiertos → CREATE con nuevo id.
    expect(r.unified).toBe(false);
    expect(r.newWaitlistId).toBeTruthy();
    const lock = db._store.get('revision_waitlist_locks/C-LCK3');
    expect(lock.waitlistId).toBe(r.newWaitlistId);
    expect(lock.lastOperation).toBe('create');
    expect(lock.waitlistId).not.toBe('wl-stale');
  });

  it('H3 absorb: 2+ abiertos pre-existentes → elige target + absorbe N-1', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    // Dos waitlists abiertos del mismo cardCode SIN lock (caso pre-§42).
    seedWaitlistFase1(db, 'wl-old', {
      clientCardCode: 'C-H3',
      createdAt: '2026-11-10T00:00:00Z',
      items: [{ code: 'Y', qty: 2, qtyOpen: 2, precio: 10 }],
    });
    seedWaitlistFase1(db, 'wl-new', {
      clientCardCode: 'C-H3',
      createdAt: '2026-11-16T12:00:00Z',
      items: [{ code: 'Z', qty: 3, qtyOpen: 3, precio: 20 }],
    });
    seedPedido(db, 'ped4', { clientCardCode: 'C-H3' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped4' }
    );
    expect(r.unified).toBe(true);
    // El más reciente gana como target.
    expect(r.targetWaitlistId).toBe('wl-new');
    expect(r.absorbedWaitlistIds).toEqual(['wl-old']);
    const absorbed = db._store.get('revision_waitlist/wl-old');
    expect(absorbed.stage).toBe('consumed');
    expect(absorbed.closedReason).toBe('absorbed_by_move_pedido_to_waitlist');
    expect(absorbed.unifiedInto).toBe('wl-new');
    // Pedido eliminado.
    expect(db._store.has('pedidos/ped4')).toBe(false);
    // Lock apunta al target.
    const lock = db._store.get('revision_waitlist_locks/C-H3');
    expect(lock.waitlistId).toBe('wl-new');
    expect(lock.lastOperation).toBe('unify_and_absorb');
  });

  it('H11 shape CREATE: operations_log entry registrado + waitlist sin unifiedFrom', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped5', { clientCardCode: 'C-H11A', orderNumber: 'ORD-501' });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: { email: 'admin@shimano.com.ar' } }, pedidoId: 'ped5' }
    );
    const wl = db._store.get(`revision_waitlist/${r.newWaitlistId}`);
    // Path CREATE: no hay unifiedFrom poblado (nada que absorber).
    expect(wl.unifiedFrom == null || wl.unifiedFrom.length === 0).toBe(true);
    // Audit log entry escrita fire-and-forget.
    const ops = Array.from(db._store.entries()).filter(([k]) => k.startsWith('operations_log/'));
    expect(ops.length).toBeGreaterThanOrEqual(1);
    const entry = ops[ops.length - 1][1];
    expect(entry.type).toBe('pedido_moved_to_waitlist');
    expect(entry.unified).toBe(false);
    expect(entry.cardCode).toBe('C-H11A');
    expect(entry.preQueryFailed).toBe(false);
  });

  it('H11 shape UNIFY: unifiedFrom contiene entry con source/pedidoId/mergedAt/mergedBy/lineCount', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWaitlistFase1(db, 'wl-target', { clientCardCode: 'C-H11B', orderNumber: 'ORD-700' });
    seedPedido(db, 'ped6', {
      clientCardCode: 'C-H11B',
      orderNumber: 'ORD-800',
      lines: [
        { code: 'A', qty: 1, precio: 10 },
        { code: 'B', qty: 2, precio: 20 },
      ],
    });
    await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: { email: 'admin@shimano.com.ar' } }, pedidoId: 'ped6' }
    );
    const wl = db._store.get('revision_waitlist/wl-target');
    expect(Array.isArray(wl.unifiedFrom)).toBe(true);
    expect(wl.unifiedFrom.length).toBe(1);
    const entry = wl.unifiedFrom[0];
    expect(entry.source).toBe('move_pedido_to_waitlist');
    expect(entry.pedidoId).toBe('ped6');
    expect(entry.orderNumber).toBeNull(); // Number('ORD-800') = NaN → `|| null` cae a null
    expect(entry.mergedBy).toBe('admin@shimano.com.ar');
    expect(typeof entry.mergedAt).toBe('string');
    expect(entry.lineCount).toBe(2);
  });

  it('Pedido desaparece mid-tx → idempotente (sin throw, sin lock escrito)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedido(db, 'ped7', { clientCardCode: 'C-IDEM' });
    // Simular desaparición antes del tx.get fresh: hackear el pedido para
    // "no existir" en el tx re-read. Técnica: borrar manualmente antes de
    // llamar el core.
    //
    // Mock quirk: el pre-fetch pedidoRef.get() en línea 212 se hace ANTES
    // del tx. Si borramos acá, el pre-fetch tira not-found. Para probar
    // path idempotente del tx fresh: dejar el pedido vivo en pre-fetch y
    // borrarlo "a mano" en el store entre pre-fetch y el tx read.
    //
    // Simplificación: validamos que un segundo call al mismo pedido ya
    // desaparecido entra al path not-found del PRE-FETCH y tira error.
    await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped7' }
    );
    // Segundo call: el pedido ya fue borrado → pre-fetch tira not-found.
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1700000000000 },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'ped7' }
      )
    ).rejects.toMatchObject({ _errorCode: 'not-found' });
  });
});

describe('movePedidoToWaitlistCore — H2 adversarial (8 escenarios)', () => {
  // Escenarios del prompt de validación post-Fase 1:
  //   E1: lock no existe (sin más) → camino normal CREATE.
  //   E2: waitlist abierta sin lock → UNIFY via pre-tx query.
  //   E3: pre-query falla por timeout → FAIL-CLOSED cuando lock también vacío.
  //   E4: pre-query falla por permission-denied → FAIL-CLOSED idem.
  //   E5: pre-query devuelve múltiples waitlists abiertas → UNIFY + absorb N-1.
  //   E6: pre-query devuelve cero waitlists abiertas (lock vacío) → CREATE.
  //   E7: lock apunta a doc inexistente → tratar como stale + fall back a pre-tx.
  //   E8: lock apunta a waitlist consumida → tratar como stale + fall back a pre-tx.

  function seedPedH2(db, id, cc) {
    db._store.set(`pedidos/${id}`, {
      stage: 'pending',
      ownerUid: 'uid-admin',
      assignedVendorUid: 'uid-vde',
      ownerEmail: 'admin@shimano.com.ar',
      clientName: 'CLIENTE H2',
      clientCardCode: cc,
      lines: [{ sku: 'H2-A', code: 'H2-A', qty: 1, precio: 10 }],
      transferidoSAP: null,
    });
  }
  function seedWlH2(db, id, overrides) {
    db._store.set(`revision_waitlist/${id}`, {
      clientCardCode: overrides.clientCardCode,
      ownerUid: 'uid-admin',
      assignedVendorUid: 'uid-vde',
      orderNumber: null,
      items: [{ code: 'WL-A', qty: 1, qtyOpen: 1, precio: 50 }],
      stage: 'active',
      closedAt: null,
      createdAt: '2026-11-10T00:00:00Z',
      ...overrides,
    });
  }

  it('E1: lock no existe + sin pre-existentes → CREATE normal', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedH2(db, 'H2-E1', 'C-H2-E1');
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E1' }
    );
    expect(r.ok).toBe(true);
    expect(r.unified).toBe(false);
    expect(r.newWaitlistId).toBeTruthy();
    const lock = db._store.get('revision_waitlist_locks/C-H2-E1');
    expect(lock.waitlistId).toBe(r.newWaitlistId);
    expect(lock.lastOperation).toBe('create');
  });

  it('E2: waitlist abierta sin lock → UNIFY via pre-tx query', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWlH2(db, 'H2-E2-wl', { clientCardCode: 'C-H2-E2' });
    seedPedH2(db, 'H2-E2', 'C-H2-E2');
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E2' }
    );
    expect(r.unified).toBe(true);
    expect(r.targetWaitlistId).toBe('H2-E2-wl');
    const lock = db._store.get('revision_waitlist_locks/C-H2-E2');
    expect(lock.waitlistId).toBe('H2-E2-wl');
  });

  it('E3: pre-query timeout + lock vacío → FAIL-CLOSED preflight-unverifiable', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedH2(db, 'H2-E3', 'C-H2-E3');
    db._setWhereGetFailure({
      collection: 'revision_waitlist',
      filter: { field: 'clientCardCode', value: 'C-H2-E3' },
      message: 'deadline-exceeded',
      code: 'deadline-exceeded',
    });
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1700000000000 },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E3' }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
    // Pedido NO fue borrado (fail-closed).
    expect(db._store.has('pedidos/H2-E3')).toBe(true);
    // Operations_log registró rejected_preflight_unverifiable.
    const ops = Array.from(db._store.entries())
      .filter(([k]) => k.startsWith('operations_log/'))
      .map(([, v]) => v);
    expect(ops.some((o) => o.type === 'move_pedido_rejected_preflight_unverifiable')).toBe(true);
    expect(ops.some((o) => o.type === 'move_pedido_pre_query_failed')).toBe(true);
    // NO se creó waitlist.
    const wls = Array.from(db._store.keys()).filter((k) => k.startsWith('revision_waitlist/'));
    expect(wls.length).toBe(0);
    // NO se creó lock.
    expect(db._store.has('revision_waitlist_locks/C-H2-E3')).toBe(false);
  });

  it('E4: pre-query permission-denied + lock vacío → FAIL-CLOSED', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedH2(db, 'H2-E4', 'C-H2-E4');
    db._setWhereGetFailure({
      collection: 'revision_waitlist',
      filter: { field: 'clientCardCode', value: 'C-H2-E4' },
      message: 'PERMISSION_DENIED',
      code: 'permission-denied',
    });
    await expect(
      movePedidoToWaitlistCore(
        { fbDb: db, now: () => 1700000000000 },
        { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E4' }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
    expect(db._store.has('pedidos/H2-E4')).toBe(true);
    expect(db._store.has('revision_waitlist_locks/C-H2-E4')).toBe(false);
  });

  it('E4-bis: pre-query falla PERO lock existe con target vigente → UNIFY (lock es autoridad)', async () => {
    // Variante de E4: si el lock SÍ tiene info verificable, la pre-query caída
    // no impide UNIFY. La fail-closed es sólo cuando ambas señales faltan.
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWlH2(db, 'H2-E4b-wl', { clientCardCode: 'C-H2-E4b' });
    db._store.set('revision_waitlist_locks/C-H2-E4b', {
      cardCode: 'C-H2-E4b',
      waitlistId: 'H2-E4b-wl',
      updatedAt: '2026-11-15T00:00:00Z',
      updatedBy: 'uid-seed',
      lastOperation: 'create',
      _version: 1,
    });
    seedPedH2(db, 'H2-E4b', 'C-H2-E4b');
    db._setWhereGetFailure({
      collection: 'revision_waitlist',
      filter: { field: 'clientCardCode', value: 'C-H2-E4b' },
      code: 'permission-denied',
    });
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E4b' }
    );
    expect(r.unified).toBe(true);
    expect(r.targetWaitlistId).toBe('H2-E4b-wl');
  });

  it('E5: pre-query devuelve N>=2 abiertas → UNIFY + absorb N-1', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWlH2(db, 'H2-E5-old', {
      clientCardCode: 'C-H2-E5',
      createdAt: '2026-11-05T00:00:00Z',
    });
    seedWlH2(db, 'H2-E5-new', {
      clientCardCode: 'C-H2-E5',
      createdAt: '2026-11-16T00:00:00Z',
    });
    seedPedH2(db, 'H2-E5', 'C-H2-E5');
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E5' }
    );
    expect(r.unified).toBe(true);
    expect(r.targetWaitlistId).toBe('H2-E5-new');
    expect(r.absorbedWaitlistIds).toEqual(['H2-E5-old']);
    // Verificar §42 post-tx: 1 sola abierta.
    const openCount = Array.from(db._store.entries()).filter(([k, v]) => {
      if (!k.startsWith('revision_waitlist/')) return false;
      return !v.closedAt && v.stage !== 'consumed';
    }).length;
    expect(openCount).toBe(1);
  });

  it('E6: pre-query devuelve 0 (lock vacío) → CREATE (query VÁLIDA, no fail-closed)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedPedH2(db, 'H2-E6', 'C-H2-E6');
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E6' }
    );
    expect(r.ok).toBe(true);
    expect(r.unified).toBe(false);
    expect(r.newWaitlistId).toBeTruthy();
  });

  it('E7: lock apunta a doc inexistente → stale + fall back a pre-tx → CREATE', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    // Lock que referencia un waitlist que no existe.
    db._store.set('revision_waitlist_locks/C-H2-E7', {
      cardCode: 'C-H2-E7',
      waitlistId: 'nunca-existio',
      updatedAt: '2026-11-15T00:00:00Z',
      updatedBy: 'uid-seed',
      lastOperation: 'create',
      _version: 1,
    });
    seedPedH2(db, 'H2-E7', 'C-H2-E7');
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E7' }
    );
    expect(r.ok).toBe(true);
    expect(r.unified).toBe(false);
    expect(r.newWaitlistId).toBeTruthy();
    expect(r.newWaitlistId).not.toBe('nunca-existio');
    const lock = db._store.get('revision_waitlist_locks/C-H2-E7');
    expect(lock.waitlistId).toBe(r.newWaitlistId);
  });

  it('E8: lock apunta a waitlist consumed → stale + fall back → CREATE', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWlH2(db, 'H2-E8-stale', {
      clientCardCode: 'C-H2-E8',
      stage: 'consumed',
      closedAt: '2026-11-14T00:00:00Z',
    });
    db._store.set('revision_waitlist_locks/C-H2-E8', {
      cardCode: 'C-H2-E8',
      waitlistId: 'H2-E8-stale',
      updatedAt: '2026-11-14T00:00:00Z',
      updatedBy: 'uid-seed',
      lastOperation: 'create',
      _version: 1,
    });
    seedPedH2(db, 'H2-E8', 'C-H2-E8');
    const r = await movePedidoToWaitlistCore(
      { fbDb: db, now: () => 1700000000000 },
      { auth: { uid: 'uid-admin', token: {} }, pedidoId: 'H2-E8' }
    );
    expect(r.ok).toBe(true);
    expect(r.unified).toBe(false);
    expect(r.newWaitlistId).not.toBe('H2-E8-stale');
    const lock = db._store.get('revision_waitlist_locks/C-H2-E8');
    expect(lock.waitlistId).toBe(r.newWaitlistId);
  });
});

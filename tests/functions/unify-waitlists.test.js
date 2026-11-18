// @ts-check
import { describe, expect, it } from 'vitest';
import { unifyWaitlistsCore } from '../../functions/core/unify-waitlists-core.js';

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
      };
      return fn(tx);
    });
    txQueue = next.catch(() => {});
    return next;
  }
  return { collection, runTransaction, _store: store, _writes: writes };
}

function seedWL(db, id, overrides) {
  db._store.set(`revision_waitlist/${id}`, {
    clientCardCode: 'C001',
    ownerUid: 'uid-admin',
    assignedVendorUid: 'uid-vde-x',
    assignedVendorEmail: 'vde@shimano.com.ar',
    ownerVendor: 'VDE-X',
    createdAt: '2026-11-15T00:00:00Z',
    stage: 'active',
    orderNumber: 'ORD-1',
    items: [{ code: 'A', qty: 1 }],
    ...overrides,
  });
}
function seedRole(db, uid, role) {
  db._store.set(`roles/${uid}`, { role });
}

describe('unifyWaitlistsCore', () => {
  it('admin unify 2 waitlists mismo cardCode → OK', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-target', { items: [{ code: 'A', qty: 1 }] });
    seedWL(db, 'wl-abs1', { items: [{ code: 'B', qty: 2 }] });
    const r = await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: { email: 'admin@shimano.com.ar' } },
        targetWaitlistId: 'wl-target',
        absorbedWaitlistIds: ['wl-abs1'],
      }
    );
    expect(r.ok).toBe(true);
    expect(r.absorbedCount).toBe(1);
    const target = db._store.get('revision_waitlist/wl-target');
    expect(target.items.length).toBe(2);
    // H11: shape canónico de unifiedFrom = array de objetos.
    expect(Array.isArray(target.unifiedFrom)).toBe(true);
    expect(target.unifiedFrom.some((e) => e && e.waitlistId === 'wl-abs1')).toBe(true);
    const abs = db._store.get('revision_waitlist/wl-abs1');
    expect(abs.stage).toBe('consumed');
    expect(abs.unifiedInto).toBe('wl-target');
  });

  it('cardCodes distintos → failed-precondition', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { clientCardCode: 'C001' });
    seedWL(db, 'wl-a', { clientCardCode: 'C002' });
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['wl-a'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
  });

  it('target ya consumed → failed-precondition', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { stage: 'consumed' });
    seedWL(db, 'wl-a');
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['wl-a'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
  });

  it('absorbed ya consumed → failed-precondition', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t');
    seedWL(db, 'wl-a', { stage: 'consumed' });
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['wl-a'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
  });

  it('VDE con todos los docs assignedVendorUid=self → OK', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-vde', 'vendedor');
    seedWL(db, 'wl-t', { assignedVendorUid: 'uid-vde' });
    seedWL(db, 'wl-a', { assignedVendorUid: 'uid-vde' });
    const r = await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-vde', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    expect(r.ok).toBe(true);
  });

  it('VDE con 1 doc ajeno → permission-denied', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-vde', 'vendedor');
    seedWL(db, 'wl-t', { assignedVendorUid: 'uid-vde' });
    seedWL(db, 'wl-a', { assignedVendorUid: 'uid-otro' });
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-vde', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['wl-a'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'permission-denied' });
  });

  it('ownerUid del target PRESERVADO post-unify (inmutable)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { ownerUid: 'uid-original-owner' });
    seedWL(db, 'wl-a', { ownerUid: 'uid-otro' });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.ownerUid).toBe('uid-original-owner');
  });

  it('target no existe → not-found', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-a');
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'no-existe',
          absorbedWaitlistIds: ['wl-a'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'not-found' });
  });

  it('absorbed no existe → not-found', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t');
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['no-existe'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'not-found' });
  });

  it('absorbedWaitlistIds vacío → invalid-argument', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        { auth: { uid: 'uid-admin', token: {} }, targetWaitlistId: 'wl-t', absorbedWaitlistIds: [] }
      )
    ).rejects.toMatchObject({ _errorCode: 'invalid-argument' });
  });

  it('target en absorbed array → invalid-argument', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['wl-t'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'invalid-argument' });
  });

  it('dedup absorbedWaitlistIds funciona (string duplicada)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t');
    seedWL(db, 'wl-a');
    const r = await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a', 'wl-a'],
      }
    );
    expect(r.absorbedCount).toBe(1);
  });

  it('operations_log escrito con type correcto', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t');
    seedWL(db, 'wl-a');
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    await new Promise((r) => setTimeout(r, 10));
    const logs = Array.from(db._store.entries())
      .filter(([k]) => k.startsWith('operations_log/'))
      .map(([, v]) => v);
    expect(logs.length).toBe(1);
    expect(logs[0].type).toBe('waitlists_unified');
  });

  it('cliente intenta modificar ownerUid via payload → ignorado (server construye)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { ownerUid: 'original' });
    seedWL(db, 'wl-a');
    // No existe parámetro en firma para ownerUid — el cliente NO puede enviarlo.
    // Pero por si en el futuro se agrega, el test documenta que es inmutable.
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.ownerUid).toBe('original');
  });

  it('assignedVendorUid y assignedVendorEmail del target PRESERVADOS', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { assignedVendorUid: 'vde-orig', assignedVendorEmail: 'vde-orig@x.com' });
    seedWL(db, 'wl-a', { assignedVendorUid: 'vde-otro', assignedVendorEmail: 'otro@x.com' });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.assignedVendorUid).toBe('vde-orig');
    expect(target.assignedVendorEmail).toBe('vde-orig@x.com');
  });
});

describe('unifyWaitlistsCore — §56 merge por SKU', () => {
  it('§56-U1: mismo SKU en target y absorbed → 1 fila sumada', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { items: [{ code: 'SKU-X', qty: 2, qtyOpen: 2, precio: 100 }] });
    seedWL(db, 'wl-a', { items: [{ code: 'SKU-X', qty: 3, qtyOpen: 3, precio: 100 }] });
    const r = await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    expect(r.ok).toBe(true);
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.items.length).toBe(1);
    expect(target.items[0].code).toBe('SKU-X');
    expect(target.items[0].qty).toBe(5);
    expect(target.items[0].qtyOpen).toBe(5);
    expect(r.unifiedItemsCount).toBe(1);
  });

  it('§56-U2: SKU case-insensitive (sku-x vs SKU-X) se fusionan', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { items: [{ code: 'sku-x', qty: 1, qtyOpen: 1, precio: 50 }] });
    seedWL(db, 'wl-a', { items: [{ code: 'SKU-X', qty: 2, qtyOpen: 2, precio: 50 }] });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.items.length).toBe(1);
    expect(target.items[0].qty).toBe(3);
  });

  it('§56-U3: precios distintos → mantiene precio de la base (target)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { items: [{ code: 'SKU-X', qty: 1, qtyOpen: 1, precio: 100 }] });
    seedWL(db, 'wl-a', { items: [{ code: 'SKU-X', qty: 1, qtyOpen: 1, precio: 999 }] });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.items.length).toBe(1);
    expect(target.items[0].precio).toBe(100);
  });

  it('§56-U4: 3 waitlists → merge por SKU en cadena, items únicos', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { items: [{ code: 'A', qty: 1, qtyOpen: 1 }] });
    seedWL(db, 'wl-a1', {
      items: [
        { code: 'A', qty: 2, qtyOpen: 2 },
        { code: 'B', qty: 5, qtyOpen: 5 },
      ],
    });
    seedWL(db, 'wl-a2', {
      items: [
        { code: 'A', qty: 1, qtyOpen: 1 },
        { code: 'C', qty: 3, qtyOpen: 3 },
      ],
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a1', 'wl-a2'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.items.length).toBe(3);
    const byCode = {};
    for (const it of target.items) byCode[it.code] = it.qty;
    expect(byCode.A).toBe(4); // 1 + 2 + 1
    expect(byCode.B).toBe(5);
    expect(byCode.C).toBe(3);
  });
});

describe('unifyWaitlistsCore — §40.5 preservación asigRefs/origen', () => {
  it('§40.5-U1: incoming con asigRefs y target sin → asigRefs del incoming propagadas', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { items: [{ code: 'A', qty: 1, qtyOpen: 1, precio: 10 }] });
    seedWL(db, 'wl-a', {
      items: [
        {
          code: 'B',
          qty: 2,
          qtyOpen: 2,
          precio: 20,
          origen: 'stock-asignado',
          asigRefs: [{ pedidoId: 'P1', lineIndex: 0, qtyAsignada: 2 }],
        },
      ],
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    const b = target.items.find((i) => i.code === 'B');
    expect(b).toBeTruthy();
    expect(b.origen).toBe('stock-asignado');
    expect(b.asigRefs.length).toBe(1);
    expect(b.asigRefs[0].pedidoId).toBe('P1');
  });

  it('§40.5-U2: ambos tienen asigRefs del mismo SKU → union dedupe por (pedidoId, lineIndex)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', {
      items: [
        {
          code: 'X',
          qty: 1,
          qtyOpen: 1,
          precio: 50,
          origen: 'stock-asignado',
          asigRefs: [
            { pedidoId: 'P1', lineIndex: 0, qtyAsignada: 1 },
            { pedidoId: 'P2', lineIndex: 3, qtyAsignada: 2 },
          ],
        },
      ],
    });
    seedWL(db, 'wl-a', {
      items: [
        {
          code: 'X',
          qty: 2,
          qtyOpen: 2,
          precio: 50,
          origen: 'stock-asignado',
          asigRefs: [
            { pedidoId: 'P1', lineIndex: 0, qtyAsignada: 1 }, // dup
            { pedidoId: 'P3', lineIndex: 7, qtyAsignada: 2 },
          ],
        },
      ],
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.items.length).toBe(1);
    expect(target.items[0].qty).toBe(3);
    const keys = target.items[0].asigRefs.map((r) => r.pedidoId + '|' + r.lineIndex).sort();
    expect(keys).toEqual(['P1|0', 'P2|3', 'P3|7']);
  });

  it('§40.5-U3: origen=stock-asignado heredado si alguno lo tenía', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { items: [{ code: 'A', qty: 1, qtyOpen: 1, precio: 10 }] }); // sin origen
    seedWL(db, 'wl-a', {
      items: [{ code: 'A', qty: 2, qtyOpen: 2, precio: 10, origen: 'stock-asignado' }],
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.items.length).toBe(1);
    expect(target.items[0].origen).toBe('stock-asignado');
  });

  it('§40.5-U4: dedupe pedidosOrigenes por (pedidoId, lineIndex)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', {
      pedidosOrigenes: [{ pedidoId: 'P1', lineIndex: 0, sku: 'A', qtyAsignada: 1 }],
    });
    seedWL(db, 'wl-a', {
      pedidosOrigenes: [
        { pedidoId: 'P1', lineIndex: 0, sku: 'A', qtyAsignada: 1 }, // dup
        { pedidoId: 'P2', lineIndex: 4, sku: 'B', qtyAsignada: 2 },
      ],
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.pedidosOrigenes.length).toBe(2);
    const keys = target.pedidosOrigenes.map((o) => o.pedidoId + '|' + o.lineIndex).sort();
    expect(keys).toEqual(['P1|0', 'P2|4']);
  });

  it('§42 v1404: source=stock-asignado-batch heredado si absorbed lo tenía y target no', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { source: undefined, items: [{ code: 'A', qty: 1 }] });
    seedWL(db, 'wl-a', {
      source: 'stock-asignado-batch',
      items: [{ code: 'B', qty: 1 }],
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.source).toBe('stock-asignado-batch');
  });
});

describe('unifyWaitlistsCore — Fase 1 (lock + H11/H12)', () => {
  it('H11 shape: unifiedFrom = array de objetos con source/waitlistId/orderNumber/mergedAt/mergedBy/lineCount', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { orderNumber: 'ORD-100' });
    seedWL(db, 'wl-a', { orderNumber: 'ORD-200', items: [{ code: 'X', qty: 3 }] });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1700000000000 },
      {
        auth: { uid: 'uid-admin', token: { email: 'admin@shimano.com.ar' } },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(Array.isArray(target.unifiedFrom)).toBe(true);
    expect(target.unifiedFrom.length).toBe(1);
    const entry = target.unifiedFrom[0];
    expect(entry.source).toBe('unify_waitlists_cf');
    expect(entry.waitlistId).toBe('wl-a');
    expect(entry.mergedBy).toBe('admin@shimano.com.ar');
    expect(typeof entry.mergedAt).toBe('string');
    expect(entry.mergedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(typeof entry.lineCount).toBe('number');
    expect(entry.lineCount).toBe(1);
  });

  it('H12: target con closedAt pero stage=active → failed-precondition', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { closedAt: '2026-11-16T10:00:00Z', stage: 'active' });
    seedWL(db, 'wl-a');
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['wl-a'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
  });

  it('H12: absorbed con closedAt pero stage=active → failed-precondition', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t');
    seedWL(db, 'wl-a', { closedAt: '2026-11-16T11:00:00Z', stage: 'active' });
    await expect(
      unifyWaitlistsCore(
        { fbDb: db, now: () => 1000000 },
        {
          auth: { uid: 'uid-admin', token: {} },
          targetWaitlistId: 'wl-t',
          absorbedWaitlistIds: ['wl-a'],
        }
      )
    ).rejects.toMatchObject({ _errorCode: 'failed-precondition' });
  });

  it('Lock atómico: tras unify se escribe revision_waitlist_locks/{cardCode} con waitlistId=target', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { clientCardCode: 'C777' });
    seedWL(db, 'wl-a', { clientCardCode: 'C777' });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1700000000000 },
      {
        auth: { uid: 'uid-admin', token: { email: 'admin@shimano.com.ar' } },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const lock = db._store.get('revision_waitlist_locks/C777');
    expect(lock).toBeTruthy();
    expect(lock.cardCode).toBe('C777');
    expect(lock.waitlistId).toBe('wl-t');
    expect(lock.updatedBy).toBe('uid-admin');
    expect(lock.lastOperation).toBe('unify');
    expect(lock._version).toBe(1);
    expect(typeof lock.updatedAt).toBe('string');
  });

  it('Lock existente apuntando a absorbed → se re-apunta al target', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', { clientCardCode: 'C777' });
    seedWL(db, 'wl-a', { clientCardCode: 'C777' });
    // Lock preexistente apuntando al absorbido (anomalía que el unify corrige).
    db._store.set('revision_waitlist_locks/C777', {
      cardCode: 'C777',
      waitlistId: 'wl-a',
      updatedAt: '2026-11-01T00:00:00Z',
      updatedBy: 'uid-anterior',
      lastOperation: 'create',
      _version: 1,
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1700000000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const lock = db._store.get('revision_waitlist_locks/C777');
    expect(lock.waitlistId).toBe('wl-t');
    expect(lock.lastOperation).toBe('unify');
    expect(lock.updatedBy).toBe('uid-admin');
  });

  it('§56 merge via pure helper: items fusionados con shape pure (mergedFrom + qtyOpen=qty)', async () => {
    const db = makeMockDb();
    seedRole(db, 'uid-admin', 'admin');
    seedWL(db, 'wl-t', {
      orderNumber: 100,
      items: [{ code: 'X', qty: 2, precio: 100 }],
    });
    seedWL(db, 'wl-a', {
      orderNumber: 200,
      items: [{ code: 'X', qty: 3, precio: 100 }],
    });
    await unifyWaitlistsCore(
      { fbDb: db, now: () => 1700000000000 },
      {
        auth: { uid: 'uid-admin', token: {} },
        targetWaitlistId: 'wl-t',
        absorbedWaitlistIds: ['wl-a'],
      }
    );
    const target = db._store.get('revision_waitlist/wl-t');
    expect(target.items.length).toBe(1);
    const line = target.items[0];
    // Pure helper SUMA qty por diseño (regla §56 UPDATE v1457 "MÁS NUEVA" vive
    // en bo_entry_logic.js downstream del modal review del cliente).
    expect(line.qty).toBe(5);
    expect(line.qtyOpen).toBe(5);
  });
});

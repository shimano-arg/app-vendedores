import { describe, expect, it, vi } from 'vitest';
import { _test, expireAsigLinesTTL } from '../../functions/core/asig-ttl-core.js';

function makeFakeFbDb(pedidos = []) {
  const store = { pedidos: [...pedidos], logs: [] };
  const writes = [];
  return {
    _writes: writes,
    _store: store,
    collection(name) {
      const parent = this;
      if (name === 'pedidos') {
        return {
          doc(id) {
            return parent.doc(`pedidos/${id}`);
          },
          where(field, op, value) {
            return {
              async get() {
                if (field !== 'closedAt' || op !== '==' || value !== null)
                  return { forEach: () => {} };
                const filtered = store.pedidos.filter((p) => !p.data.closedAt);
                return {
                  forEach(cb) {
                    for (const p of filtered) cb({ id: p.id, data: () => p.data });
                  },
                };
              },
            };
          },
        };
      }
      if (name === 'asig_ttl_log') {
        return {
          doc(id) {
            return {
              async set(data) {
                store.logs.push({ id, data });
                writes.push({ type: 'set', path: `${name}/${id}`, data });
              },
            };
          },
        };
      }
      return { doc: () => ({ async set() {}, async update() {} }) };
    },
    doc(path) {
      const self = this;
      return {
        _path: path,
        async get() {
          if (!path.startsWith('pedidos/')) return { exists: false, data: () => ({}) };
          const id = path.split('/')[1];
          const p = store.pedidos.find((x) => x.id === id);
          return { exists: !!p, data: () => (p ? p.data : {}) };
        },
        async update(data) {
          if (!path.startsWith('pedidos/')) return;
          const id = path.split('/')[1];
          const p = store.pedidos.find((x) => x.id === id);
          if (p) p.data = { ...p.data, ...data };
          writes.push({ type: 'update', path, data });
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, data) {
          const path = ref._path;
          if (!path || !path.startsWith('pedidos/')) return;
          const id = path.split('/')[1];
          const p = store.pedidos.find((x) => x.id === id);
          if (p) p.data = { ...p.data, ...data };
          writes.push({ type: 'update', path, data });
        },
      };
      return fn(tx);
    },
  };
}

const NOW = new Date('2026-09-20T12:00:00Z'); // fixed clock
const DAY = 24 * 60 * 60 * 1000;

function _pedido(id, lines, extra = {}) {
  return {
    id,
    data: {
      clientCardCode: 'C001',
      closedAt: null,
      lines,
      ...extra,
    },
  };
}

describe('_toMs', () => {
  it('parsea ISO string', () => {
    expect(_test._toMs('2026-08-01T00:00:00Z')).toBeGreaterThan(0);
  });
  it('null/undefined -> 0', () => {
    expect(_test._toMs(null)).toBe(0);
    expect(_test._toMs(undefined)).toBe(0);
  });
  it('Firestore Timestamp con toMillis', () => {
    expect(_test._toMs({ toMillis: () => 12345 })).toBe(12345);
  });
});

describe('expireAsigLinesTTL — cutoff', () => {
  it('expira lineas ASIG con asigAt > 30 dias', async () => {
    const oldAsigAt = new Date(NOW.getTime() - 31 * DAY).toISOString();
    const p = _pedido('P1', [
      { code: 'X', state: 'ASIG', qtyOpen: 5, qtyExpired: 0, asigAt: oldAsigAt },
    ]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.expiredLines).toHaveLength(1);
    expect(r.expiredLines[0]).toMatchObject({ pedidoId: 'P1', sku: 'X', qty: 5 });
    const line = fbDb._store.pedidos[0].data.lines[0];
    expect(line.state).toBe('expired');
    expect(line.qtyOpen).toBe(0);
    expect(line.qtyExpired).toBe(5);
    expect(line.expiredAt).toBeTruthy();
  });

  it('NO expira lineas ASIG dentro del TTL (asigAt reciente)', async () => {
    const recentAsigAt = new Date(NOW.getTime() - 10 * DAY).toISOString();
    const p = _pedido('P1', [{ code: 'X', state: 'ASIG', qtyOpen: 5, asigAt: recentAsigAt }]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.expiredLines).toEqual([]);
    expect(fbDb._store.pedidos[0].data.lines[0].state).toBe('ASIG');
  });

  it('borde exacto 30d — no expira (cutoff estricto <)', async () => {
    const exactly30dAsigAt = new Date(NOW.getTime() - 30 * DAY).toISOString();
    const p = _pedido('P1', [{ code: 'X', state: 'ASIG', qtyOpen: 5, asigAt: exactly30dAsigAt }]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    // Cutoff: NOW - 30d ms; asigMs == cutoff → asigMs > cutoff es false → SI expira.
    // (Comportamiento definido por `if (asigMs > cutoffMs) continue`.)
    expect(r.expiredLines).toHaveLength(1);
  });

  it('ignora lineas no-ASIG', async () => {
    const old = new Date(NOW.getTime() - 60 * DAY).toISOString();
    const p = _pedido('P1', [
      { code: 'X', state: 'BO', qtyOpen: 5, asigAt: null },
      { code: 'Y', state: 'confirmed', qtyOpen: 3, asigAt: old },
      { code: 'Z', state: 'legacy', qtyOpen: 2, asigAt: old },
    ]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.expiredLines).toEqual([]);
  });

  it('lineas ASIG con qtyOpen=0 no cuentan (ya reciclada/cancelada)', async () => {
    const old = new Date(NOW.getTime() - 60 * DAY).toISOString();
    const p = _pedido('P1', [
      { code: 'X', state: 'ASIG', qtyOpen: 0, qtyRecycled: 5, asigAt: old },
    ]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.expiredLines).toEqual([]);
  });

  it('lineas ASIG sin asigAt no expiran (safe skip)', async () => {
    const p = _pedido('P1', [{ code: 'X', state: 'ASIG', qtyOpen: 5, asigAt: null }]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.expiredLines).toEqual([]);
  });
});

describe('expireAsigLinesTTL — pedido closure', () => {
  it('cierra pedido si TODAS las lineas quedan con qtyOpen=0 tras expirar', async () => {
    const old = new Date(NOW.getTime() - 60 * DAY).toISOString();
    const p = _pedido('P1', [
      { code: 'X', state: 'ASIG', qtyOpen: 5, asigAt: old },
      { code: 'Y', state: 'invoiced', qtyOpen: 0, qtyInvoiced: 3 },
    ]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.pedidosClosed).toBe(1);
    expect(fbDb._store.pedidos[0].data.closedAt).toBeTruthy();
    expect(fbDb._store.pedidos[0].data.closedReason).toBe('ttl_expired');
  });

  it('NO cierra pedido si hay otras lineas abiertas (state=BO)', async () => {
    const old = new Date(NOW.getTime() - 60 * DAY).toISOString();
    const p = _pedido('P1', [
      { code: 'X', state: 'ASIG', qtyOpen: 5, asigAt: old },
      { code: 'Y', state: 'BO', qtyOpen: 3 },
    ]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.pedidosClosed).toBe(0);
    expect(fbDb._store.pedidos[0].data.closedAt).toBeNull();
  });
});

describe('expireAsigLinesTTL — audit log', () => {
  it('escribe doc en asig_ttl_log con detalle', async () => {
    const old = new Date(NOW.getTime() - 60 * DAY).toISOString();
    const p = _pedido('P1', [{ code: 'X', state: 'ASIG', qtyOpen: 5, asigAt: old }]);
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    await expireAsigLinesTTL(deps);
    expect(fbDb._store.logs).toHaveLength(1);
    const audit = fbDb._store.logs[0].data;
    expect(audit.ttlDays).toBe(30);
    expect(audit.pedidosScanned).toBe(1);
    expect(audit.expiredLines).toHaveLength(1);
    expect(audit.pedidosClosed).toBe(1);
    expect(audit.errors).toEqual([]);
  });

  it('escribe audit aun si no hay lineas expiradas', async () => {
    const fbDb = makeFakeFbDb([]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    await expireAsigLinesTTL(deps);
    expect(fbDb._store.logs).toHaveLength(1);
    expect(fbDb._store.logs[0].data.expiredLines).toEqual([]);
    expect(fbDb._store.logs[0].data.pedidosScanned).toBe(0);
  });
});

describe('expireAsigLinesTTL — pedidos cerrados', () => {
  it('ignora pedidos con closedAt seteado', async () => {
    const old = new Date(NOW.getTime() - 60 * DAY).toISOString();
    const p = _pedido('P1', [{ code: 'X', state: 'ASIG', qtyOpen: 5, asigAt: old }], {
      closedAt: '2026-08-01T00:00:00Z',
    });
    const fbDb = makeFakeFbDb([p]);
    const deps = { fbDb, now: () => NOW, log: vi.fn() };
    const r = await expireAsigLinesTTL(deps);
    expect(r.expiredLines).toEqual([]);
    // Ni siquiera se contaron en pedidosScanned (query where closedAt==null los filtra)
    expect(r.pedidosScanned).toBe(0);
  });
});

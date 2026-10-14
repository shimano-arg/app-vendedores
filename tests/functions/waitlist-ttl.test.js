import { describe, expect, it, vi } from 'vitest';
import { expireStockAsignadoWaitlists } from '../../functions/core/waitlist-ttl-core.js';

const NOW = new Date('2026-10-14T18:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS).toISOString();
const isoDaysFromNow = (n) => new Date(NOW.getTime() + n * DAY_MS).toISOString();

function makeFakeFbDb(initial = {}) {
  const store = {
    waitlists: initial.waitlists || [], // [{id, data}]
    pedidos: initial.pedidos || [], // [{id, data}]
    logs: [],
    deletes: [],
  };
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    collection(name) {
      return {
        where() {
          const q = {
            _name: name,
            where() {
              return this;
            },
            async get() {
              if (this._name === 'revision_waitlist') {
                return {
                  forEach(cb) {
                    for (const w of store.waitlists) {
                      cb({ id: w.id, data: () => w.data });
                    }
                  },
                };
              }
              return { forEach: () => {} };
            },
          };
          return q;
        },
        doc(id) {
          return {
            async get() {
              if (name === 'pedidos') {
                const p = store.pedidos.find((pp) => pp.id === id);
                return { exists: !!p, data: () => (p ? p.data : {}) };
              }
              return { exists: false, data: () => ({}) };
            },
            async update(patch) {
              writes.push({ type: 'update', name, id, patch });
              if (name === 'pedidos') {
                const p = store.pedidos.find((pp) => pp.id === id);
                if (p) p.data = Object.assign({}, p.data, patch);
              }
            },
            async delete() {
              writes.push({ type: 'delete', name, id });
              store.deletes.push({ name, id });
              if (name === 'revision_waitlist') {
                store.waitlists = store.waitlists.filter((w) => w.id !== id);
              }
            },
          };
        },
        async add(data) {
          writes.push({ type: 'add', name, data });
          const id = 'auto_' + Math.random().toString(36).slice(2, 10);
          if (name === 'waitlist_expire_log') store.logs.push({ id, data });
          return { id };
        },
      };
    },
  };
}

describe('expireStockAsignadoWaitlists', () => {
  it('elimina waitlists con expiresAt < now + source stock-asignado-batch', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysAgo(1),
            clientName: 'CLIENTE A',
          },
        },
        {
          id: 'w2',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysFromNow(5),
            clientName: 'CLIENTE B',
          },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.scanned).toBe(2);
    expect(r.expired).toHaveLength(1);
    expect(r.expired[0].id).toBe('w1');
    expect(r.errors).toEqual([]);
    expect(fbDb._store.deletes).toHaveLength(1);
    expect(fbDb._store.deletes[0].id).toBe('w1');
    // w2 sigue vivo.
    expect(fbDb._store.waitlists.find((w) => w.id === 'w2')).toBeTruthy();
  });

  it('NO elimina waitlists con stage=consumed (ya se consumio en pedido)', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysAgo(10),
            stage: 'consumed',
          },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.expired).toEqual([]);
    expect(fbDb._store.deletes).toEqual([]);
  });

  it('NO elimina waitlists sin expiresAt (legacy pre-v1280)', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            // no expiresAt — doc legacy
          },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.expired).toEqual([]);
    expect(fbDb._store.deletes).toEqual([]);
  });

  it('acepta expiresAt como Firestore Timestamp (toMillis)', async () => {
    const expiredMs = NOW.getTime() - 1 * DAY_MS;
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: { toMillis: () => expiredMs },
          },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.expired).toHaveLength(1);
  });

  it('escribe audit log por corrida con expirados', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysAgo(1),
          },
        },
      ],
    });
    await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(fbDb._store.logs).toHaveLength(1);
    const audit = fbDb._store.logs[0].data;
    expect(audit.scanned).toBe(1);
    expect(audit.expiredCount).toBe(1);
    expect(audit.expired[0].id).toBe('w1');
  });

  it('idempotente: segunda corrida con 0 vigentes expira nada', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysFromNow(5),
          },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.expired).toEqual([]);
    expect(r.scanned).toBe(1);
  });

  it('v1281: cancela ASIG originales por pedidosOrigenes[] antes de delete waitlist (qty entera)', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysAgo(1),
            pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0, sku: 'FXC', qtyAsignada: 10 }],
          },
        },
      ],
      pedidos: [
        {
          id: 'p1',
          data: {
            lines: [{ code: 'FXC', state: 'ASIG', qtyOpen: 10, qty: 10, asigReserva: true }],
          },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.expired).toHaveLength(1);
    const p1 = fbDb._store.pedidos.find((p) => p.id === 'p1').data;
    expect(p1.lines[0].state).toBe('cancelled');
    expect(p1.lines[0].qtyOpen).toBe(0);
    expect(p1.lines[0].qtyCancelled).toBe(10);
    expect(p1.lines[0].cancelledFrom).toBe('waitlist-expired');
    expect(p1.lines[0].expiredWaitlistId).toBe('w1');
    expect(fbDb._store.waitlists.find((w) => w.id === 'w1')).toBeUndefined();
  });

  it('v1281: split parcial si qtyAsignada < qtyOpen (resto queda ASIG)', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysAgo(1),
            pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0, sku: 'FXC', qtyAsignada: 7 }],
          },
        },
      ],
      pedidos: [
        {
          id: 'p1',
          data: { lines: [{ code: 'FXC', state: 'ASIG', qtyOpen: 10, qty: 10 }] },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.errors).toEqual([]);
    const p1 = fbDb._store.pedidos.find((p) => p.id === 'p1').data;
    expect(p1.lines[0].state).toBe('ASIG'); // sigue ASIG
    expect(p1.lines[0].qtyOpen).toBe(3); // 10 - 7
    expect(p1.lines[0].qtyCancelled).toBe(7);
    expect(p1.lines[0].partialCancelFrom).toBe('waitlist-expired');
    expect(p1.lines[0].expiredWaitlistId).toBe('w1');
  });

  it('v1281: no pisa linea si ya cambio state (recycled/cancelled por otro flow)', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysAgo(1),
            pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0, sku: 'FXC', qtyAsignada: 10 }],
          },
        },
      ],
      pedidos: [
        {
          id: 'p1',
          data: { lines: [{ code: 'FXC', state: 'recycled', qtyOpen: 0 }] },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.expired).toHaveLength(1); // waitlist igual se borra
    expect(r.errors.some((e) => e.includes('skip'))).toBe(true);
    const p1 = fbDb._store.pedidos.find((p) => p.id === 'p1').data;
    expect(p1.lines[0].state).toBe('recycled'); // intacto
  });

  it('v1281: waitlist sin pedidosOrigenes (legacy pre-v1280 ya con expiresAt) solo se borra', async () => {
    const fbDb = makeFakeFbDb({
      waitlists: [
        {
          id: 'w1',
          data: {
            source: 'stock-asignado-batch',
            expiresAt: isoDaysAgo(1),
            // sin pedidosOrigenes
          },
        },
      ],
    });
    const r = await expireStockAsignadoWaitlists({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.expired).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });
});

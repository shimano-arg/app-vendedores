import { describe, expect, it, vi } from 'vitest';
import { migrateAsigToBOAndCreateReparto } from '../../functions/core/reparto-migration-core.js';

const NOW = new Date('2026-10-14T16:00:00Z');
const nowIso = NOW.toISOString();

const _pedidoDoc = (id, data) => ({ id, data: () => data });

function makeFakeFbDb(initial = {}) {
  const store = {
    pedidos: initial.pedidos || [],
    stockSnap: initial.stockSnap || null,
    ingresos_reparto: {},
    logs: [],
  };
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    doc(path) {
      return {
        async get() {
          if (path === 'app_config/stock_snapshot') {
            return { exists: !!store.stockSnap, data: () => store.stockSnap || {} };
          }
          return { exists: false, data: () => ({}) };
        },
      };
    },
    collection(name) {
      return {
        where() {
          const q = {
            _name: name,
            where() {
              return this;
            },
            limit() {
              return this;
            },
            async get() {
              if (this._name === 'pedidos') {
                return {
                  empty: store.pedidos.length === 0,
                  forEach(cb) {
                    for (const p of store.pedidos) cb(p);
                  },
                };
              }
              return { empty: true, forEach: () => {} };
            },
          };
          return q;
        },
        doc(id) {
          return {
            async get() {
              const p = store.pedidos.find((pp) => pp.id === id);
              return { exists: !!p, data: () => (p ? p.data() : {}) };
            },
          };
        },
        async add(data) {
          writes.push({ type: 'add', name, data });
          const id = 'auto_' + Math.random().toString(36).slice(2, 10);
          if (name === 'ingresos_reparto') store.ingresos_reparto[id] = data;
          if (name === 'asig_migration_log_v1278') store.logs.push({ id, data });
          return { id };
        },
      };
    },
    async runTransaction(fn) {
      // Permitir mutar el pedido via tx.update para que post-revert refleje
      // en pedidos store.
      const tx = {
        async get(ref) {
          return await ref.get();
        },
        update(ref, patch) {
          const id = ref._id || ref.id;
          const p = store.pedidos.find((pp) => pp.id === id);
          if (p) {
            const data = p.data();
            p.data = () => Object.assign({}, data, patch);
          }
          writes.push({ type: 'txUpdate', id, patch });
        },
      };
      // Alias: nuestra fn del core usa fbDb.collection('pedidos').doc(id).
      // En runTransaction del core, usa deps.fbDb.collection('pedidos').doc(doc.id).
      // Para que tx.get(ref) + tx.update(ref) funcionen, el ref debe tener id.
      return await fn(tx);
    },
  };
}

// Patcheamos collection('pedidos').doc(id) para que devuelva un ref que
// nuestro fake runTransaction pueda identificar. Como el refactor es grande,
// usamos un wrapper en makeFakeFbDb que inyecta _id en el ref.
const makeFakeFbDbEnhanced = (initial = {}) => {
  const fbDb = makeFakeFbDb(initial);
  const origCollection = fbDb.collection.bind(fbDb);
  fbDb.collection = (name) => {
    const col = origCollection(name);
    const origDoc = col.doc ? col.doc.bind(col) : null;
    if (origDoc) {
      col.doc = (id) => {
        const ref = origDoc(id);
        ref._id = id;
        return ref;
      };
    }
    return col;
  };
  return fbDb;
};

describe('migrateAsigToBOAndCreateReparto', () => {
  it('revierte lineas ASIG + crea ingresos_reparto para SKUs con dep11>0 + clientes BO', async () => {
    const fbDb = makeFakeFbDbEnhanced({
      pedidos: [
        _pedidoDoc('p1', {
          clientName: 'A',
          clientCardCode: 'C-A',
          createdAt: '2026-09-01T10:00:00Z',
          lines: [{ code: 'FXC', state: 'ASIG', qtyOpen: 10, asigAt: nowIso, asigReserva: false }],
        }),
        _pedidoDoc('p2', {
          clientName: 'B',
          clientCardCode: 'C-B',
          createdAt: '2026-08-15T10:00:00Z',
          lines: [{ code: 'FXC', state: 'BO', qtyOpen: 5 }],
        }),
      ],
      stockSnap: {
        warehouseBreakdown: JSON.stringify({ FXC: { 11: 20, 12: 0 } }),
      },
    });
    const r = await migrateAsigToBOAndCreateReparto({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.pedidosScanned).toBe(2);
    expect(r.revertedLines).toHaveLength(1);
    expect(r.revertedLines[0]).toMatchObject({ pedidoId: 'p1', sku: 'FXC', qty: 10 });
    expect(r.skusAffected).toEqual(['FXC']);
    expect(r.ingresosCreated).toHaveLength(1);
    expect(r.errors).toEqual([]);
    // Verificar linea revertida ahora es BO.
    const p1 = fbDb._store.pedidos.find((p) => p.id === 'p1').data();
    expect(p1.lines[0].state).toBe('BO');
    expect(p1.lines[0].revertedFromAsigReason).toBe('migration-v1278');
    // Ingreso creado tiene ambos clientes (A revertido + B original).
    const ing = Object.values(fbDb._store.ingresos_reparto)[0];
    expect(ing.sku).toBe('FXC');
    expect(ing.qtyIngresada).toBe(15); // min(dep11=20, backorderTotal=10+5=15)
    expect(ing.clientesCount).toBe(2);
    expect(ing.source).toBe('migration-v1278');
    expect(ing.dedupeKey).toBe('FXC|migration-v1278');
    expect(ing.status).toBe('pending');
  });

  it('NO crea ingreso para SKU con dep11=0', async () => {
    const fbDb = makeFakeFbDbEnhanced({
      pedidos: [
        _pedidoDoc('p1', {
          clientName: 'A',
          lines: [{ code: 'FXC', state: 'ASIG', qtyOpen: 10 }],
        }),
      ],
      stockSnap: { warehouseBreakdown: JSON.stringify({ FXC: { 11: 0, 12: 100 } }) },
    });
    const r = await migrateAsigToBOAndCreateReparto({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.revertedLines).toHaveLength(1);
    expect(r.ingresosCreated).toHaveLength(0);
    expect(r.ingresosSkipped).toHaveLength(1);
    expect(r.ingresosSkipped[0]).toMatchObject({
      sku: 'FXC',
      reason: 'dep11=0 (sin stock fisico)',
    });
  });

  it('NO toca lineas confirmed/cancelled/invoiced', async () => {
    const fbDb = makeFakeFbDbEnhanced({
      pedidos: [
        _pedidoDoc('p1', {
          clientName: 'A',
          lines: [
            { code: 'FXC', state: 'ASIG', qtyOpen: 10 },
            { code: 'STM', state: 'confirmed', qtyOpen: 5 },
            { code: 'LDM', state: 'cancelled', qtyOpen: 0 },
            { code: 'CUD', state: 'invoiced', qtyOpen: 0 },
          ],
        }),
      ],
      stockSnap: { warehouseBreakdown: JSON.stringify({ FXC: { 11: 10 } }) },
    });
    const r = await migrateAsigToBOAndCreateReparto({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.revertedLines).toHaveLength(1);
    expect(r.revertedLines[0].sku).toBe('FXC');
    const p1 = fbDb._store.pedidos.find((p) => p.id === 'p1').data();
    expect(p1.lines[0].state).toBe('BO'); // ASIG → BO
    expect(p1.lines[1].state).toBe('confirmed'); // intacto
    expect(p1.lines[2].state).toBe('cancelled');
    expect(p1.lines[3].state).toBe('invoiced');
  });

  it('idempotente: segunda corrida tiene 0 ASIG para revertir', async () => {
    const fbDb = makeFakeFbDbEnhanced({
      pedidos: [
        _pedidoDoc('p1', {
          clientName: 'A',
          lines: [{ code: 'FXC', state: 'BO', qtyOpen: 10 }], // ya revertido
        }),
      ],
      stockSnap: { warehouseBreakdown: JSON.stringify({ FXC: { 11: 20 } }) },
    });
    const r = await migrateAsigToBOAndCreateReparto({ fbDb, log: vi.fn(), now: () => NOW });
    expect(r.revertedLines).toEqual([]);
    expect(r.skusAffected).toEqual([]);
    expect(r.ingresosCreated).toEqual([]);
  });

  it('escribe audit log con detalle', async () => {
    const fbDb = makeFakeFbDbEnhanced({
      pedidos: [
        _pedidoDoc('p1', {
          clientName: 'A',
          lines: [{ code: 'FXC', state: 'ASIG', qtyOpen: 10 }],
        }),
      ],
      stockSnap: { warehouseBreakdown: JSON.stringify({ FXC: { 11: 10 } }) },
    });
    await migrateAsigToBOAndCreateReparto({ fbDb, log: vi.fn(), now: () => NOW });
    expect(fbDb._store.logs).toHaveLength(1);
    const audit = fbDb._store.logs[0].data;
    expect(audit.pedidosScanned).toBe(1);
    expect(audit.revertedLinesCount).toBe(1);
    expect(audit.ingresosCreatedCount).toBe(1);
    expect(audit.skusAffected).toEqual(['FXC']);
  });
});

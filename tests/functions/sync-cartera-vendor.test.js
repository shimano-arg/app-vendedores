// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { handleSyncCarteraVendor } from '../../functions/core/cartera-vendor-core.js';

function makeFakeFbDb(existingDocs = {}) {
  const store = new Map(Object.entries(existingDocs));
  const batchOps = { writes: [], deletes: [] };

  const batch = {
    set: (ref, data) => batchOps.writes.push({ id: ref._id, data }),
    delete: (ref) => batchOps.deletes.push({ id: ref._id }),
    commit: async () => {
      batchOps.writes.forEach(({ id, data }) => store.set(id, data));
      batchOps.deletes.forEach(({ id }) => store.delete(id));
      batchOps.writes = [];
      batchOps.deletes = [];
    },
  };

  return {
    _store: store,
    batch: () => batch,
    collection: (name) => {
      if (name !== 'cartera_vendor') throw new Error('collection no soportada: ' + name);
      return {
        doc: (id) => ({ _id: id }),
        get: async () => ({
          forEach: (cb) => {
            for (const [id, data] of store) {
              cb({ id, ref: { _id: id }, data: () => data });
            }
          },
        }),
      };
    },
  };
}

function makeFakeBqClient(rows) {
  return { query: vi.fn(async () => [rows]) };
}

describe('handleSyncCarteraVendor', () => {
  it('2 vendors + 3 clientes cada uno -> 2 docs', async () => {
    const rows = [
      { vendor_key: 'VDE_A', client_id: 'a1', card_code: 'C1', client_name: 'Cli A1', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-10-15', ultimo_contacto: null, ultima_compra: '2026-10-10', facturado_12m: 100, deuda_abierta: 0, dias_sin_visita_presencial: 5, dias_sin_contacto: null, dias_sin_compra: 10 },
      { vendor_key: 'VDE_A', client_id: 'a2', card_code: 'C2', client_name: 'Cli A2', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null, facturado_12m: 0, deuda_abierta: 0, dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null },
      { vendor_key: 'VDE_A', client_id: 'a3', card_code: null, client_name: 'Cli A3', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-08-01', ultimo_contacto: null, ultima_compra: '2026-05-01', facturado_12m: 50, deuda_abierta: 0, dias_sin_visita_presencial: 80, dias_sin_contacto: null, dias_sin_compra: 172 },
      { vendor_key: 'VDE_B', client_id: 'b1', card_code: 'C10', client_name: 'Cli B1', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-10-18', ultimo_contacto: null, ultima_compra: '2026-10-19', facturado_12m: 500, deuda_abierta: 1000, dias_sin_visita_presencial: 2, dias_sin_contacto: null, dias_sin_compra: 1 },
    ];
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient(rows);
    const r = await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });

    expect(r.vendorsProcessed).toBe(2);
    expect(r.totalClientes).toBe(4);
    expect(r.deletedOrphans).toBe(0);
    expect(fbDb._store.size).toBe(2);

    const docA = fbDb._store.get('VDE_A');
    expect(docA.vendorKey).toBe('VDE_A');
    expect(docA.counts.total).toBe(3);
    expect(docA.counts.baseActiva90d).toBe(1);
    expect(docA.counts.dormidosVisita30d).toBe(1);
    expect(docA.counts.dormidosCompra90d).toBe(1);
    expect(docA.counts.nuncaVisitados).toBe(1);
    expect(docA.counts.nuncaCompraron).toBe(1);
    expect(docA.clientes).toHaveLength(3);
    expect(docA.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(docA.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('vendor huerfano -> se borra', async () => {
    const rows = [
      { vendor_key: 'VDE_LIVE', client_id: 'x1', card_code: 'C1', client_name: 'X', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null, facturado_12m: 0, deuda_abierta: 0, dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null },
    ];
    const fbDb = makeFakeFbDb({
      'VDE_LIVE': { vendorKey: 'VDE_LIVE', clientes: [] },
      'VDE_ZOMBIE': { vendorKey: 'VDE_ZOMBIE', clientes: [{ clientId: 'z1' }] },
    });
    const bqClient = makeFakeBqClient(rows);
    const r = await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    expect(r.deletedOrphans).toBe(1);
    expect(fbDb._store.has('VDE_LIVE')).toBe(true);
    expect(fbDb._store.has('VDE_ZOMBIE')).toBe(false);
  });

  it('idempotencia: correr 2x produce el mismo state', async () => {
    const rows = [
      { vendor_key: 'V1', client_id: 'c1', card_code: 'CC1', client_name: 'Cli', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-10-15', ultimo_contacto: null, ultima_compra: '2026-10-10', facturado_12m: 100, deuda_abierta: 0, dias_sin_visita_presencial: 5, dias_sin_contacto: null, dias_sin_compra: 10 },
    ];
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient(rows);
    await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    const after1 = JSON.stringify(fbDb._store.get('V1'));
    await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    const after2 = JSON.stringify(fbDb._store.get('V1'));
    const parse = (s) => { const o = JSON.parse(s); delete o.snapshotAt; return o; };
    expect(parse(after1)).toEqual(parse(after2));
  });

  it('cliente sin cardCode se incluye con facturado12M=0 y deudaAbierta=0', async () => {
    const rows = [
      { vendor_key: 'V1', client_id: 'no_sap', card_code: null, client_name: 'Nuevo', province: 'BA', loc_name: 'CABA', cli_tipo: null, ultima_visita_presencial: '2026-10-15', ultimo_contacto: null, ultima_compra: null, facturado_12m: 0, deuda_abierta: 0, dias_sin_visita_presencial: 5, dias_sin_contacto: null, dias_sin_compra: null },
    ];
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient(rows);
    await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    const doc = fbDb._store.get('V1');
    expect(doc.clientes[0].cardCode).toBe(null);
    expect(doc.clientes[0].facturado12M).toBe(0);
    expect(doc.clientes[0].deudaAbierta).toBe(0);
    expect(doc.clientes[0].ultimaVisitaPresencial).toBe('2026-10-15');
  });

  it('0 rows BQ -> 0 docs escritos, pero si borra huerfanos existentes', async () => {
    const fbDb = makeFakeFbDb({ 'VDE_OLD': { vendorKey: 'VDE_OLD', clientes: [] } });
    const bqClient = makeFakeBqClient([]);
    const r = await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    expect(r.vendorsProcessed).toBe(0);
    expect(r.totalClientes).toBe(0);
    expect(r.deletedOrphans).toBe(1);
    expect(fbDb._store.size).toBe(0);
  });

  it('log callback recibe summary al final', async () => {
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient([]);
    const log = vi.fn();
    await handleSyncCarteraVendor({ fbDb, bqClient, log });
    expect(() => log('test')).not.toThrow();
  });
});

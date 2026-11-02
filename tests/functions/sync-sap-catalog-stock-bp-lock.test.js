// @ts-check
/**
 * v1535 (APP-02) — la corrida programada (syncSapCatalogStockCF) toma el mismo
 * lock que el boton manual antes de sincronizar clientes. Si el lock esta
 * tomado, saltea SOLO la parte de clientes ese ciclo y lo deja anotado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../functions/core/sync-bp-pesca-core.js', () => ({
  syncBpPesca: vi.fn(async () => ({
    ok: true,
    stats: { created: 0, updated_prov_to_conf: 0, updated_existing: 0 },
    slRequests: 2,
    bpSyncByCFFlag: false,
    dryRun: true,
  })),
}));

import { BP_SYNC_LOCK_PATH } from '../../functions/core/bp-sync-lock.js';
import { _resetPool } from '../../functions/core/sap-sl-session.js';
import { syncBpPesca } from '../../functions/core/sync-bp-pesca-core.js';
import { syncSapCatalogStockCore } from '../../functions/core/sync-sap-catalog-stock-core.js';
import { makeStrictLockDb } from '../fixtures/strict-lock-db.js';

beforeEach(() => {
  _resetPool();
  /** @type {any} */ (syncBpPesca).mockClear();
});

/** @param {any} [lockInitial] */
function makeDb(lockInitial) {
  const db = /** @type {any} */ (makeStrictLockDb(lockInitial));
  /** @type {any[]} */
  const opsLog = [];
  const docStub = () => ({
    async get() {
      return { exists: false, data: () => null };
    },
    async set() {},
    async update() {},
    async delete() {},
  });
  db.collection = (/** @type {string} */ name) => ({
    doc: docStub,
    async add(/** @type {any} */ d) {
      if (name === 'operations_log') opsLog.push(d);
      return { id: 'x' };
    },
    async get() {
      return { forEach: () => {} };
    },
  });
  const lockDoc = db.doc;
  db.doc = (/** @type {string} */ p) => (p === BP_SYNC_LOCK_PATH ? lockDoc(p) : docStub());
  return { db, opsLog };
}

const fetchFn = vi.fn(async (/** @type {string} */ url) => {
  const u = String(url);
  if (u.endsWith('/Login')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'B1SESSION=C; path=/' },
    };
  }
  if (u.includes('/ItemGroups?')) {
    return { ok: true, status: 200, json: async () => ({ value: [{ Number: 1 }] }) };
  }
  if (u.includes('/Items?')) {
    return { ok: true, status: 200, json: async () => ({ value: [] }) };
  }
  return { ok: true, status: 200, json: async () => ({ value: [] }), headers: { get: () => null } };
});

const SAP_CFG = {
  url: 'https://sap.test',
  companyDB: 'D',
  userName: 'u',
  password: 'p',
  fetch: fetchFn,
};

describe('v1535 APP-02 — corrida programada respeta el lock de clientes', () => {
  it('S1 lock libre → corre el sync de clientes y libera el lock', async () => {
    const { db, opsLog } = makeDb(null);
    await syncSapCatalogStockCore({ fbDb: db, sapConfig: SAP_CFG, log: () => {} });
    expect(syncBpPesca).toHaveBeenCalledTimes(1);
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
    const run = opsLog.find((d) => d.type === 'stock_sync_run');
    expect(run.bpSync.skipped).toBe(null);
  });

  it('S2 lock tomado por el boton manual → saltea clientes ese ciclo y lo anota', async () => {
    const { db, opsLog } = makeDb({
      holder: 'manual',
      owner: 'manual:u1',
      expiresAt: Date.now() + 60_000,
    });
    const r = await syncSapCatalogStockCore({ fbDb: db, sapConfig: SAP_CFG, log: () => {} });
    expect(syncBpPesca).not.toHaveBeenCalled();
    expect(r.ok).toBe(true); // el resto del sync sigue normal
    expect(db._state[BP_SYNC_LOCK_PATH].holder).toBe('manual');
    const run = opsLog.find((d) => d.type === 'stock_sync_run');
    expect(run.bpSync.skipped).toBe('lock_held');
  });

  it('S3 syncBpPesca tira → el lock igual se libera', async () => {
    /** @type {any} */ (syncBpPesca).mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const { db } = makeDb(null);
    await syncSapCatalogStockCore({ fbDb: db, sapConfig: SAP_CFG, log: () => {} });
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
  });
});

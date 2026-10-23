// @ts-check
/**
 * Tests para la validación `SNAPSHOT_TOO_OLD` en `commitPedidoCore`.
 *
 * Contexto 2026-10-23 (post bloqueo prod 13:41 ART):
 *   El workflow `sync-sap-catalog-stock.yml` tiene cron cada 5 min pero
 *   GHA scheduler saltea; los runs efectivos son cada 2-5 h. Threshold
 *   anterior de 45 min hacía que toda confirmación post-primer sync del
 *   día cayera en `SNAPSHOT_TOO_OLD`. Subido a 8 h.
 *
 * Qué validan estos tests:
 *   T1  snapshot con 30 min → sin error.
 *   T2  snapshot con 2 h → sin error (bajo 8 h).
 *   T3  snapshot con 5 h → sin error (realista hoy).
 *   T4  snapshot con 7 h 59 min → sin error (frontera inferior).
 *   T5  snapshot con 8 h 1 min → `SNAPSHOT_TOO_OLD` con mensaje nuevo
 *       (incluye hora último sync + minutos de edad).
 *   T6  snapshot con 24 h → `SNAPSHOT_TOO_OLD` + escribe log en
 *       `operations_log` con `errorCode='SNAPSHOT_TOO_OLD'` +
 *       `snapshotOrigin='server:app_config/stock_snapshot'`.
 */

import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock minimal — solo lo necesario para que llegue al snapshot age check.
 * No necesita strict (el check es pre-tx-set).
 */
function makeMockDb(updatedAtMs, operationsLogSink) {
  const stockConfig = {
    exists: true,
    data: () => ({
      updatedAt: { toMillis: () => updatedAtMs },
      stock: {},
      quantities: { CSKU1: 10 },
      warehouseBreakdown: { CSKU1: { 11: 10 } },
    }),
  };
  const roleDoc = { exists: true, data: () => ({ role: 'vendedor' }) };
  const bpDoc = {
    exists: true,
    data: () => ({ cardCode: 'C123', clientName: 'Test', vendorKey: 'K' }),
  };

  // Registry por path para que tx.get() consulte el mismo doc que el collection().
  const docRegistry = new Map();
  docRegistry.set('app_config/stock_snapshot', stockConfig);
  docRegistry.set('roles/U1', roleDoc);
  docRegistry.set('sap_bp_raw/C123', bpDoc);

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      _path: key,
      get: () => Promise.resolve(docRegistry.get(key) || { exists: false, data: () => null }),
    };
  };

  const collection = (name) => ({
    doc: (id) => makeDocRef(name, id),
    add: (payload) => {
      if (name === 'operations_log' && operationsLogSink) {
        operationsLogSink.push(payload);
      }
      return Promise.resolve({ id: 'logged' });
    },
    where: () => ({
      where: function () {
        return this;
      },
      limit: function () {
        return this;
      },
      get: () => Promise.resolve({ empty: true, forEach: () => {}, docs: [] }),
    }),
  });

  return {
    collection,
    runTransaction: async (fn) => {
      const tx = {
        get: (ref) => {
          if (ref && ref._path) {
            return Promise.resolve(
              docRegistry.get(ref._path) || { exists: false, data: () => null }
            );
          }
          return Promise.resolve({ exists: false });
        },
        set: () => {},
        update: () => {},
      };
      return fn(tx);
    },
  };
}

function makeDeps(updatedAtMs, nowMs) {
  const operationsLogSink = [];
  const fbDb = makeMockDb(updatedAtMs, operationsLogSink);
  return {
    deps: {
      fbDb,
      now: () => new Date(nowMs),
      log: vi.fn(),
      reportError: vi.fn(),
      FieldValue: { serverTimestamp: () => new Date(nowMs) },
    },
    operationsLogSink,
  };
}

const basePayload = {
  draftId: 'D1',
  cardCode: 'C123',
  clientName: 'TEST SA',
  origen: 'manual',
  lines: [{ sku: 'CSKU1', cantidad: 1 }],
  clientVersion: 'v1439',
  ownerUid: 'U1',
  ownerEmail: 'u1@test.com',
};

const auth = { uid: 'U1', token: { email: 'u1@test.com' } };

describe('SNAPSHOT_TOO_OLD threshold (post 2026-10-23 fix)', () => {
  it('T1 — 30 min: OK, sin error', async () => {
    const now = Date.now();
    const { deps } = makeDeps(now - 30 * 60 * 1000, now);
    const r = await commitPedidoCore(deps, basePayload, auth);
    expect(r.ok || r.errorCode !== 'SNAPSHOT_TOO_OLD').toBe(true);
  });

  it('T2 — 2 h: OK, sin error', async () => {
    const now = Date.now();
    const { deps } = makeDeps(now - 2 * 60 * 60 * 1000, now);
    const r = await commitPedidoCore(deps, basePayload, auth);
    expect(r.errorCode === 'SNAPSHOT_TOO_OLD').toBe(false);
  });

  it('T3 — 5 h: OK, sin error', async () => {
    const now = Date.now();
    const { deps } = makeDeps(now - 5 * 60 * 60 * 1000, now);
    const r = await commitPedidoCore(deps, basePayload, auth);
    expect(r.errorCode === 'SNAPSHOT_TOO_OLD').toBe(false);
  });

  it('T4 — 7 h 59 min: OK, sin error (frontera inferior)', async () => {
    const now = Date.now();
    const { deps } = makeDeps(now - (7 * 60 + 59) * 60 * 1000, now);
    const r = await commitPedidoCore(deps, basePayload, auth);
    expect(r.errorCode === 'SNAPSHOT_TOO_OLD').toBe(false);
  });

  it('T5 — 8 h 1 min: SNAPSHOT_TOO_OLD con mensaje nuevo', async () => {
    const now = Date.now();
    const { deps } = makeDeps(now - (8 * 60 + 1) * 60 * 1000, now);
    const r = await commitPedidoCore(deps, basePayload, auth);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('SNAPSHOT_TOO_OLD');
    expect(r.message).toMatch(/Último sync de stock/);
    expect(r.message).toMatch(/queda en espera/);
    expect(r.message).not.toMatch(/45 minutos/);
    expect(r.message).not.toMatch(/Esperá unos minutos y reintentá/);
    expect(r.data.snapshotAgeMinutes).toBeGreaterThanOrEqual(481);
    expect(r.data.snapshotUpdatedAt).toBeTruthy();
    expect(r.data.snapshotOrigin).toBe('server');
    expect(r.data.canRefresh).toBe(false);
  });

  it('T6 — 24 h: SNAPSHOT_TOO_OLD + log en operations_log', async () => {
    const now = Date.now();
    const { deps, operationsLogSink } = makeDeps(now - 24 * 60 * 60 * 1000, now);
    const r = await commitPedidoCore(deps, basePayload, auth);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('SNAPSHOT_TOO_OLD');
    // Fire-and-forget: puede estar async. Esperamos un tick.
    await new Promise((res) => setTimeout(res, 10));
    expect(operationsLogSink.length).toBeGreaterThan(0);
    const entry = operationsLogSink[0];
    expect(entry.type).toBe('commit_pedido_rejected');
    expect(entry.errorCode).toBe('SNAPSHOT_TOO_OLD');
    expect(entry.snapshotOrigin).toBe('server:app_config/stock_snapshot');
    expect(entry.userId).toBe('U1');
    expect(entry.cardCode).toBe('C123');
    expect(entry.draftId).toBe('D1');
    expect(entry.snapshotAgeMinutes).toBeGreaterThanOrEqual(1440);
  });
});

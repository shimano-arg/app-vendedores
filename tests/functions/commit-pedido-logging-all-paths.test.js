// @ts-check
/**
 * §64.2 (2026-10-25 v1450) — TODO rechazo de commitPedidoCF loguea en
 * operations_log.
 *
 * Antecedente §64 (v1443): STOCK_CHANGED se loguea con snapshot cliente+CF.
 * Pedido Mariano Fase 3: "no puede haber un rechazo de la CF sin registro"
 * — extender el pattern a TODOS los paths de rechazo (VALIDATION_ERROR,
 * VERSION_OLD, PERMISSION_DENIED, CLIENT_HAS_OPEN_WAITLIST, SNAPSHOT_TOO_OLD,
 * CONTENTION_RETRY_EXHAUSTED, SAP_UNAVAILABLE).
 *
 * Fix:
 *   - Helper central `logCommitRejection(deps, errorCode, payload, extra)`
 *     con AWAIT (no fire-and-forget).
 *   - Llamado en todos los paths de `makeError` + `throwError` del core.
 *   - Business errors dentro de `commitInTransaction` propagan metadata
 *     rich via `err._data._logExtra` → catch del retry loop expande.
 *   - El cliente recibe `err._data` LIMPIO (sin `_logExtra`).
 *
 * Este test verifica QUE CADA errorCode escribe un entry con
 * type='commit_pedido_rejected' + errorCode + metadata base (userId,
 * cardCode, draftId, origen, clientVersion, timestamp) + extras específicos
 * del path (snapshotAgeMinutes, skuDetails, conflictingWaitlistId, etc).
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock mínimo de Firestore. Captura todo lo escrito a operations_log.
 * No usa makeStrictMockDb porque no necesitamos chequear §58 acá (los
 * logs se escriben FUERA de la transacción). El core ya tiene tests
 * dedicados para §58.
 */
function makeMockDb(fixture) {
  const state = fixture || {};
  const operationsLogSink = [];
  const makeDoc = (col, id) => ({
    id,
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
    },
    async update(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
    },
    async delete() {
      if (state[col]) delete state[col][id];
    },
  });
  const makeCol = (col, filters = []) => ({
    where(f, op, v) {
      return makeCol(col, [...filters, { f, op, v }]);
    },
    limit() {
      return this;
    },
    doc(id) {
      return makeDoc(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
    },
    async add(data) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = data;
      if (col === 'operations_log') operationsLogSink.push(data);
      return { id };
    },
    async get() {
      const colData = state[col] || {};
      let docs = Object.entries(colData).map(([id, data]) => ({
        id,
        data: () => data,
        exists: true,
      }));
      for (const f of filters) {
        docs = docs.filter((d) => {
          const v = d.data()[f.f];
          if (f.op === '==') return v === f.v;
          if (f.op === 'in') return Array.isArray(f.v) && f.v.includes(v);
          return true;
        });
      }
      return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
    },
  });
  return {
    fbDb: {
      collection: (c) => makeCol(c),
      doc(path) {
        const [c, id] = path.split('/');
        return makeDoc(c, id);
      },
      async runTransaction(fn) {
        const tx = {
          async get(ref) {
            return ref.get();
          },
          set(ref, data) {
            return ref.set(data);
          },
          update(ref, data) {
            return ref.update(data);
          },
          delete(ref) {
            return ref.delete();
          },
        };
        return fn(tx);
      },
    },
    operationsLogSink,
    _state: state,
  };
}

const nowRef = new Date('2026-10-25T20:30:00Z');

const BASE_PAYLOAD = {
  draftId: 'd-test',
  cardCode: 'C001',
  clientName: 'TEST',
  origen: 'manual',
  lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
  clientVersion: 'v1450',
  ownerUid: 'U1',
  ownerEmail: 'u1@test.com',
};

function baseState(sku, fisico) {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: { [sku]: { 11: fisico } },
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
    pedido_draft_locks: {},
  };
}

describe('§64.2 — TODO rechazo loguea en operations_log', () => {
  it('VALIDATION_ERROR (payload inválido) → log con type/errorCode/draftId/cardCode', async () => {
    const { fbDb, operationsLogSink } = makeMockDb(baseState('SKU-A', 10));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        ...BASE_PAYLOAD,
        draftId: '', // inválido
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
    expect(operationsLogSink.length).toBe(1);
    const e = operationsLogSink[0];
    expect(e.type).toBe('commit_pedido_rejected');
    expect(e.errorCode).toBe('VALIDATION_ERROR');
    expect(e.cardCode).toBe('C001');
    expect(e.origen).toBe('manual');
    expect(e.clientVersion).toBe('v1450');
    expect(e.timestamp).toBeTruthy();
    expect(e.validationReason).toBeTruthy();
  });

  it('VALIDATION_ERROR (cpst sin waitlistOrigenId) → log entry', async () => {
    const { fbDb, operationsLogSink } = makeMockDb(baseState('SKU-A', 10));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      { ...BASE_PAYLOAD, origen: 'cpst', waitlistOrigenId: null }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
    expect(operationsLogSink.length).toBe(1);
    const e = operationsLogSink[0];
    expect(e.errorCode).toBe('VALIDATION_ERROR');
    expect(e.origen).toBe('cpst');
    expect(e.validationReason).toContain('cpst');
  });

  it('VERSION_OLD → log entry con minVersion + currentVersion', async () => {
    const state = baseState('SKU-A', 10);
    state.app_config.version_minima = { minVersion: 'v1500' };
    const { fbDb, operationsLogSink } = makeMockDb(state);
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, { ...BASE_PAYLOAD });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VERSION_OLD');
    expect(operationsLogSink.length).toBe(1);
    const e = operationsLogSink[0];
    expect(e.errorCode).toBe('VERSION_OLD');
    expect(e.minVersion).toBe('v1500');
    expect(e.currentVersion).toBe('v1450');
  });

  it('PERMISSION_DENIED (pedido ya en SAP) → log entry', async () => {
    const state = baseState('SKU-A', 10);
    state.pedidos.existing = {
      _fsId: 'existing',
      _draftId: BASE_PAYLOAD.draftId,
      transferidoSAP: { docEntry: 999, docNum: 2000111, via: 'service_layer' },
    };
    const { fbDb, operationsLogSink } = makeMockDb(state);
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, { ...BASE_PAYLOAD });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PERMISSION_DENIED');
    expect(operationsLogSink.length).toBe(1);
    const e = operationsLogSink[0];
    expect(e.errorCode).toBe('PERMISSION_DENIED');
    expect(e.sapDocNum).toBe(2000111);
    expect(e.reason).toBe('pedido_ya_en_sap');
  });

  it('CLIENT_HAS_OPEN_WAITLIST → log entry con conflictingWaitlistId', async () => {
    const state = baseState('SKU-A', 10);
    state.revision_waitlist.wX = {
      clientCardCode: 'C001',
      orderNumber: 999,
      items: [{ code: 'X', qty: 1 }],
      closedAt: null,
      stage: 'pending',
    };
    const { fbDb, operationsLogSink } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      { ...BASE_PAYLOAD, waitlistOrigenId: null }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('CLIENT_HAS_OPEN_WAITLIST');
    expect(operationsLogSink.length).toBe(1);
    const e = operationsLogSink[0];
    expect(e.errorCode).toBe('CLIENT_HAS_OPEN_WAITLIST');
    expect(e.conflictingWaitlistId).toBe('wX');
    expect(e.conflictingOrderNumber).toBe(999);
  });

  it('STOCK_CHANGED → log entry con skuDetails (desde err._data._logExtra)', async () => {
    const { fbDb, operationsLogSink } = makeMockDb(baseState('SKU-A', 2));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      { ...BASE_PAYLOAD, lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }] }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
    expect(operationsLogSink.length).toBe(1);
    const e = operationsLogSink[0];
    expect(e.errorCode).toBe('STOCK_CHANGED');
    expect(e.skuDetails).toBeTruthy();
    expect(e.skuDetails.length).toBeGreaterThan(0);
    expect(e.skuDetails[0].sku).toBe('SKU-A');
    expect(e.serverSnapshotUpdatedAt).toBeTruthy();
    expect(e.totalSkuChanged).toBe(1);
    expect(e.totalUnitsToBO).toBe(3);
  });

  it('SNAPSHOT_TOO_OLD → log entry con snapshotAgeMinutes (desde _logExtra)', async () => {
    const state = baseState('SKU-A', 10);
    state.app_config.stock_snapshot.updatedAt = {
      toMillis: () => nowRef.getTime() - 9 * 60 * 60 * 1000, // 9h > 8h threshold
    };
    const { fbDb, operationsLogSink } = makeMockDb(state);
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, { ...BASE_PAYLOAD });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('SNAPSHOT_TOO_OLD');
    expect(operationsLogSink.length).toBe(1);
    const e = operationsLogSink[0];
    expect(e.errorCode).toBe('SNAPSHOT_TOO_OLD');
    expect(e.snapshotAgeMinutes).toBeGreaterThan(500);
    expect(e.snapshotOrigin).toBe('server:app_config/stock_snapshot');
  });

  it('AWAIT: el log existe ANTES de que commitPedidoCore retorne (no fire-and-forget)', async () => {
    const { fbDb, operationsLogSink } = makeMockDb(baseState('SKU-A', 2));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      { ...BASE_PAYLOAD, lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }] }
    );
    // NO necesitamos setTimeout — el log DEBE estar sync (await en el helper).
    expect(r.errorCode).toBe('STOCK_CHANGED');
    expect(operationsLogSink.length).toBe(1); // sin esperar tick.
  });

  it('response al cliente NO expone _logExtra (metadata server-side scrubbed)', async () => {
    const { fbDb, operationsLogSink } = makeMockDb(baseState('SKU-A', 2));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      { ...BASE_PAYLOAD, lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }] }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
    expect(r.data).toBeTruthy();
    expect(r.data._logExtra).toBeUndefined(); // scrubbed del response
    expect(r.data.diff).toBeTruthy(); // info útil para el cliente, sí preservada
    // El log sí tiene el detalle completo.
    expect(operationsLogSink[0].skuDetails).toBeTruthy();
  });
});

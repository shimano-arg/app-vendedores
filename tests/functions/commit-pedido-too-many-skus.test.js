// @ts-check
/**
 * SEC-H4 iter2 (HARDENING5 BATCH 1, 2026-11-19) — tests para propagación de
 * TOO_MANY_SKUS desde `fetch-stock-live-core` hasta `commitPedidoCore`.
 *
 * Problema iter1 (hallazgo del Adversarial Reviewer): el bloque live SL en
 * `commitPedidoCore` trataba cualquier `snapshotFallback` como "SL caído,
 * seguí con snapshot". Cuando `fetchStockLive` devuelve
 *   { ok:false, errorCode:'TOO_MANY_SKUS', snapshotFallback:true }
 * (ver fetch-stock-live-core.js), el pedido continuaba usando snapshot
 * stale — habilitando el abuso que el cap de 250 SKUs buscaba bloquear.
 *
 * Fix: `commitPedidoCore` detecta `result.errorCode === 'TOO_MANY_SKUS'` y
 * llama `throwError('TOO_MANY_SKUS', ...)`. El `runTransaction` catch
 * externo lo captura, pasa por `logCommitRejection` (§64.2), y devuelve
 * `makeError('TOO_MANY_SKUS', ...)` al cliente.
 */
import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeMockDb(fixture) {
  const state = fixture || {};
  const makeDoc = (col, id) => ({
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
    add(d) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = d;
      return Promise.resolve({ id });
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
    _state: state,
  };
}

const nowRef = new Date('2026-11-19T20:00:00Z');

function baseStateWithStock(sku, fisicoSnapshot) {
  return {
    app_config: {
      stock_snapshot: {
        // snapshot fresco para que si el test deja pasar el fallback (bug),
        // el pedido se confirme con snapshot y el test pueda detectarlo.
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: { [sku]: { 11: fisicoSnapshot } },
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('SEC-H4 iter2 — commitPedidoCore propaga TOO_MANY_SKUS', () => {
  it('T1 — fetchStockLive devuelve TOO_MANY_SKUS → commitPedidoCore rechaza (NO silent fallback)', async () => {
    const state = baseStateWithStock('SKU-A', 100);
    const { fbDb } = makeMockDb(state);
    // Simula el shape que devuelve fetch-stock-live-core cuando se excede el cap.
    const fetchStockLive = vi.fn(async () => ({
      ok: false,
      errorCode: 'TOO_MANY_SKUS',
      snapshotFallback: true, // el core lo pone en true también, pero el guard de errorCode gana.
      partial: false,
      fisicoDep11: {},
      skusLive: [],
      skusSnapshot: [],
      reason: 'cap_exceeded',
      durationMs: 0,
      slRequests: 0,
      error: 'cap SKUs excedido: 300 > 250',
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'dTooMany1',
        cardCode: 'C001',
        origen: 'manual',
        lines: [
          { sku: 'SKU-A', cantidad: 1, precio: 100 },
          // Nota: en el test unitario, con 1 sólo SKU el core normalmente no
          // dispararía TOO_MANY_SKUS. Pero estamos mockeando fetchStockLive
          // para probar que commitPedidoCore RESPETA el errorCode — no que
          // el cap se dispare acá. El cap lo chequea el core de live SL.
        ],
        clientVersion: 'v1446',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('TOO_MANY_SKUS');
    expect(r.data).toBeDefined();
    expect(r.data.requested).toBe(1); // skusUnicos.length del payload (1 SKU).
    expect(r.data.cap).toBe(250);
    expect(r.data.liveReason).toBe('cap_exceeded');
    expect(r.data.canRefresh).toBe(false);
    // Crítico: el bug iter1 hubiera devuelto ok:true (confirmando 1 con snapshot=100).
    // Si fuera así, este test fallaría con "expected false, received true".
  });

  it('T2 — mensaje de error contiene instrucción accionable para el vendedor', async () => {
    const state = baseStateWithStock('SKU-A', 100);
    const { fbDb } = makeMockDb(state);
    const fetchStockLive = vi.fn(async () => ({
      ok: false,
      errorCode: 'TOO_MANY_SKUS',
      snapshotFallback: true,
      fisicoDep11: {},
      skusLive: [],
      skusSnapshot: [],
      reason: 'cap_exceeded',
      error: 'cap SKUs excedido',
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'dTooMany2',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1446',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('TOO_MANY_SKUS');
    expect(r.message).toMatch(/máximo de SKUs|más chicos|dividilo/i);
  });

  it('T3 — _logExtra queda scrubed del response al cliente (§64.2)', async () => {
    const state = baseStateWithStock('SKU-A', 100);
    const { fbDb } = makeMockDb(state);
    const fetchStockLive = vi.fn(async () => ({
      ok: false,
      errorCode: 'TOO_MANY_SKUS',
      snapshotFallback: true,
      fisicoDep11: {},
      skusLive: [],
      skusSnapshot: [],
      reason: 'cap_exceeded',
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'dTooMany3',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1446',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('TOO_MANY_SKUS');
    // §64.2: `_logExtra` es metadata server-side que NO debe ir al cliente.
    expect(r.data._logExtra).toBeUndefined();
  });

  it('T4 — fetchStockLive OK (ok:true, sin errorCode) sigue path normal', async () => {
    // Anti-regresión: el nuevo guard de TOO_MANY_SKUS NO debe interferir con el flow OK.
    const state = baseStateWithStock('SKU-A', 10);
    const { fbDb } = makeMockDb(state);
    const fetchStockLive = vi.fn(async () => ({
      ok: true,
      snapshotFallback: false,
      partial: false,
      fisicoDep11: { 'SKU-A': 10 },
      skusLive: ['SKU-A'],
      skusSnapshot: [],
      reason: 'ok',
      durationMs: 50,
      slRequests: 1,
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'dOk1',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 5, precio: 100 }],
        clientVersion: 'v1446',
      }
    );
    if (!r.ok) console.log('T4 unexpected:', JSON.stringify(r, null, 2));
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(fetchStockLive).toHaveBeenCalledOnce();
  });

  it('T5 — operations_log recibe un entry con errorCode TOO_MANY_SKUS (§64.2)', async () => {
    const state = baseStateWithStock('SKU-A', 100);
    const { fbDb, _state } = makeMockDb(state);
    const fetchStockLive = vi.fn(async () => ({
      ok: false,
      errorCode: 'TOO_MANY_SKUS',
      snapshotFallback: true,
      fisicoDep11: {},
      skusLive: [],
      skusSnapshot: [],
      reason: 'cap_exceeded',
    }));
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef, fetchStockLive },
      {
        draftId: 'dLog1',
        cardCode: 'C001',
        origen: 'manual',
        ownerUid: 'uid-mariano',
        ownerEmail: 'mariano@shimano.com.ar',
        lines: [{ sku: 'SKU-A', cantidad: 1, precio: 100 }],
        clientVersion: 'v1446',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('TOO_MANY_SKUS');
    // El catch de runTransaction invoca logCommitRejection → operations_log.add.
    const logCol = _state.operations_log || {};
    const entries = Object.values(logCol);
    const rejected = entries.filter(
      (/** @type {any} */ e) =>
        e.type === 'commit_pedido_rejected' && e.errorCode === 'TOO_MANY_SKUS'
    );
    expect(rejected.length).toBe(1);
    /** @type {any} */
    const entry = rejected[0];
    expect(entry.userId).toBe('uid-mariano');
    expect(entry.userEmail).toBe('mariano@shimano.com.ar');
    expect(entry.cardCode).toBe('C001');
    expect(entry.draftId).toBe('dLog1');
    // _logExtra agregado por el throwError propaga al log.
    expect(entry.requested).toBe(1);
    expect(entry.cap).toBe(250);
    expect(entry.liveReason).toBe('cap_exceeded');
  });
});

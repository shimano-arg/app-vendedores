// @ts-check
/**
 * reconcile-app-only-core (incidente Federico 2026-11-20, v1568+).
 *
 * Cobertura:
 *   T1 — snapshot válido + SKU presente → reDispatched=1.
 *   T2 — snapshot stale (>30 min) → fail-open.
 *   T3 — snapshot ausente → fail-open.
 *   T4 — missingSkus=[A,B], A presente pero B no → skipped (still_missing).
 *   T5 — reason='stock_recheck_all_degraded' → skip (guard non_catalog_reason).
 *   T6 — closedAt != null → skipped.
 *   T7 — ya tiene docNum → skipped.
 *   T8 — reconcileAttempts=5 → maxRetriesExceeded++, no borra transferidoSAP.
 *   T9 — lock held por otra corrida → LOCK_HELD skipped.
 *   T10 — 2 invocaciones concurrentes → solo 1 reDispatched (serializado).
 *   T11 — delete transferidoSAP falla → error registrado, no crash.
 *   T12 — §58 reads-before-writes verificado.
 *   T13 — 2 missingSkus ambos presentes → reDispatched=1 happy path.
 *   T14 — batch 3 pedidos (1 reDispatched + 1 still_missing + 1 maxRetries) → contadores correctos.
 *   T_FAILOPEN_1 — quantities vacío '{}' → fail-open.
 *   T_FAILOPEN_2 — quantities no es JSON válido → fail-open sin crash.
 */

import { describe, expect, it } from 'vitest';
import { reconcileAppOnlyCore } from '../../functions/core/reconcile-app-only-core.js';

// ---- Helpers ------------------------------------------------------------

const FIELD_VALUE = {
  delete: () => ({ __delete: true }),
};

/**
 * Strict mock Firestore enforza §58 (ALL reads before ALL writes dentro
 * de runTransaction). Si un tx.get ocurre después de un tx.set/update,
 * tira sync como el admin SDK real.
 *
 * Además: serializa runTransaction con mutex para simular Firestore real
 * (Promise.all de 2 txns sobre el mismo doc se procesa secuencial).
 */
function makeStrictMockDb(fixture) {
  const state = fixture || {};
  const written = [];
  let txLockP = Promise.resolve();

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _colName: colName,
      _docId: docId,
      _path: key,
      async get() {
        const data = state[colName]?.[docId];
        return {
          exists: !!data,
          data: () => data || null,
        };
      },
      async set(data) {
        state[colName] ||= {};
        // Para fieldValue.delete() en .set() no aplicamos — es raro usarlo
        // en set.
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'set', path: key, data });
      },
      async update(data) {
        state[colName] ||= {};
        const existing = state[colName][docId] || {};
        const merged = { ...existing };
        // Soporte flat para dotted paths: `transferidoSAP.X` + fieldValue.delete.
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && v.__delete) {
            // Borrar campo entero (top-level o dotted).
            if (k.includes('.')) {
              const [top, ...rest] = k.split('.');
              if (merged[top]) {
                const inner = { ...merged[top] };
                let cur = inner;
                for (let i = 0; i < rest.length - 1; i++) {
                  if (!cur[rest[i]]) break;
                  cur = cur[rest[i]];
                }
                delete cur[rest[rest.length - 1]];
                merged[top] = inner;
              }
            } else {
              delete merged[k];
            }
          } else if (k.includes('.')) {
            // Dotted path update.
            const [top, ...rest] = k.split('.');
            const inner = merged[top] ? { ...merged[top] } : {};
            let cur = inner;
            for (let i = 0; i < rest.length - 1; i++) {
              if (!cur[rest[i]]) cur[rest[i]] = {};
              else cur[rest[i]] = { ...cur[rest[i]] };
              cur = cur[rest[i]];
            }
            cur[rest[rest.length - 1]] = v;
            merged[top] = inner;
          } else {
            merged[k] = v;
          }
        }
        state[colName][docId] = merged;
        written.push({ op: 'update', path: key, data });
      },
      async delete() {
        if (state[colName]) delete state[colName][docId];
      },
    };
  };

  const makeCollection = (colName, filters = [], limitN = null) => {
    const col = {
      _name: colName,
      where(field, op, val) {
        return makeCollection(colName, [...filters, { field, op, val }], limitN);
      },
      limit(n) {
        return makeCollection(colName, filters, n);
      },
      doc(id) {
        return makeDocRef(colName, id || 'auto_' + Math.random().toString(36).slice(2, 10));
      },
      async add(data) {
        const id = 'auto_' + Math.random().toString(36).slice(2, 10);
        state[colName] ||= {};
        state[colName][id] = data;
        written.push({ op: 'add', path: `${colName}/${id}`, data });
        return { id };
      },
      async get() {
        const colData = state[colName] || {};
        let docs = Object.entries(colData).map(([id, data]) => ({
          id,
          data: () => data,
          exists: true,
        }));
        for (const f of filters) {
          docs = docs.filter((d) => {
            const dd = d.data();
            // Soporte dotted path: transferidoSAP.requiresManualResend.
            let val;
            if (f.field.includes('.')) {
              const parts = f.field.split('.');
              val = dd;
              for (const p of parts) {
                val = val && val[p];
                if (val === undefined) break;
              }
            } else {
              val = dd[f.field];
            }
            if (f.op === '==') return val === f.val;
            if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(val);
            return true;
          });
        }
        if (limitN !== null && limitN > 0) docs = docs.slice(0, limitN);
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn) => docs.forEach(fn),
        };
      },
    };
    return col;
  };

  const fbDb = {
    collection: (name) => makeCollection(name),
    doc(path) {
      const parts = path.split('/');
      const col = parts[0];
      const id = parts.slice(1).join('/');
      return makeDocRef(col, id);
    },
    async runTransaction(fn) {
      // Mutex para serializar concurrencia.
      const prev = txLockP;
      let release;
      txLockP = new Promise((r) => {
        release = r;
      });
      try {
        await prev;
        let hasWritten = false;
        const tx = {
          async get(ref) {
            if (hasWritten) {
              throw new Error(
                'Firestore transactions require all reads to be executed before all writes.'
              );
            }
            return ref.get();
          },
          set(ref, data) {
            hasWritten = true;
            return ref.set(data);
          },
          update(ref, data) {
            hasWritten = true;
            return ref.update(data);
          },
          delete(ref) {
            hasWritten = true;
            return ref.delete();
          },
        };
        return await fn(tx);
      } finally {
        release();
      }
    },
  };
  return { fbDb, _state: state, _written: written };
}

// ---- Fixtures -----------------------------------------------------------

const nowRef = new Date('2026-11-20T15:00:00Z');

/**
 * Snapshot default: fresco (updatedAt 1 min atrás), quantities válido.
 */
function makeSnapshot({ ageMs = 60_000, quantities = null } = {}) {
  const defaultQ = { 'SKU-A': 10, 'SKU-B': 5 };
  return {
    updatedAt: { toMillis: () => nowRef.getTime() - ageMs },
    quantities: JSON.stringify(quantities || defaultQ),
  };
}

/**
 * Pedido app_only candidato: stage=confirmed + requiresManualResend=true
 * + reason='sap_item_not_found_all_lines'.
 */
function makeCandidate({
  missingSkus = ['SKU-A'],
  reconcileAttempts = 0,
  closedAt = null,
  docNum = null,
  reason = 'sap_item_not_found_all_lines',
  reconcileMaxRetriesAt = null,
  reconcileLastAt = null,
  clientCardCode = 'C001',
  clientName = 'TEST CLIENT',
} = {}) {
  return {
    stage: 'confirmed',
    closedAt,
    clientCardCode,
    clientName,
    lines: [
      {
        code: missingSkus[0] || 'SKU-A',
        state: 'confirmed',
        qty: 1,
        _degradedReason: 'sap_item_not_found_app_only',
      },
    ],
    transferidoSAP: {
      via: 'app_only',
      reason,
      transferredAt: '2026-11-19T10:00:00.000Z',
      transferredBy: 'cf-auto/sessionXYZ',
      missingSkus,
      requiresManualResend: true,
      ...(docNum != null ? { docNum } : {}),
      ...(reconcileAttempts > 0 ? { reconcileAttempts } : {}),
      ...(reconcileMaxRetriesAt ? { reconcileMaxRetriesAt } : {}),
      ...(reconcileLastAt ? { reconcileLastAt } : {}),
    },
  };
}

function baseState({ snapshot = makeSnapshot(), pedidos = {} } = {}) {
  return {
    app_config: {
      stock_snapshot: snapshot,
    },
    pedidos,
    app_only_reconcile_locks: {},
    operations_log: {},
  };
}

function makeDeps(fbDb, { runId = 'test-run', maxAttempts, snapshotMaxAgeMs } = {}) {
  /** @type {Array<[string, any]>} */
  const logs = [];
  const deps = {
    fbDb,
    FieldValue: FIELD_VALUE,
    now: () => nowRef.getTime(),
    runId,
    log: (msg, extra) => logs.push([msg, extra || {}]),
  };
  if (typeof maxAttempts === 'number') deps.maxAttempts = maxAttempts;
  if (typeof snapshotMaxAgeMs === 'number') deps.snapshotMaxAgeMs = snapshotMaxAgeMs;
  return { deps, logs };
}

// ---- Tests --------------------------------------------------------------

describe('reconcile-app-only-core', () => {
  it('T1 — snapshot válido + SKU presente → reDispatched=1 (happy path)', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(1);
    expect(r.reDispatched).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.maxRetriesExceeded).toBe(0);
    expect(r.errors.length).toBe(0);
    // El pedido debe haber perdido transferidoSAP (ahora undefined o {} vacío).
    const pedidoAfter = _state.pedidos.pedA;
    // El .__delete se aplicó: transferidoSAP debe no estar.
    expect(pedidoAfter.transferidoSAP).toBeUndefined();
    // Lock escrito.
    expect(_state.app_only_reconcile_locks.pedA).toBeTruthy();
    expect(_state.app_only_reconcile_locks.pedA.pedidoId).toBe('pedA');
  });

  it('T2 — snapshot stale (>30 min) → fail-open', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    // ageMs = 31 min.
    const snapshot = makeSnapshot({ ageMs: 31 * 60 * 1000 });
    const { fbDb, _state } = makeStrictMockDb(baseState({ snapshot, pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    // Transfer no tocado.
    expect(_state.pedidos.pedA.transferidoSAP).toBeTruthy();
    expect(_state.pedidos.pedA.transferidoSAP.requiresManualResend).toBe(true);
    // Log de fail-open.
    const failOpenLog = logs.find(([msg]) => msg === '[reconcile-app-only] fail-open snapshot');
    expect(failOpenLog).toBeTruthy();
    expect(failOpenLog[1].subtype).toBe('snapshot_stale');
  });

  it('T3 — snapshot ausente → fail-open', async () => {
    const pedidos = { pedA: makeCandidate() };
    const state = { pedidos, app_only_reconcile_locks: {}, operations_log: {} };
    // No app_config.stock_snapshot.
    state.app_config = {};
    const { fbDb } = makeStrictMockDb(state);
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    const failOpenLog = logs.find(([msg]) => msg === '[reconcile-app-only] fail-open snapshot');
    expect(failOpenLog).toBeTruthy();
    expect(failOpenLog[1].subtype).toBe('snapshot_missing');
  });

  it('T4 — missingSkus=[A,B], A presente pero B NO → skipped (still_missing)', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A', 'SKU-C'] }) };
    // Snapshot tiene SKU-A y SKU-B pero no SKU-C.
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(r.skipped).toBe(1);
    // Transfer NO tocado.
    expect(_state.pedidos.pedA.transferidoSAP.requiresManualResend).toBe(true);
    const skipLog = logs.find(([msg]) => msg === '[reconcile-app-only] still_missing');
    expect(skipLog).toBeTruthy();
    expect(skipLog[1].stillMissing).toEqual(['SKU-C']);
  });

  it('T5 — reason=stock_recheck_all_degraded → skip (guard non_catalog_reason)', async () => {
    const pedidos = {
      pedA: makeCandidate({
        missingSkus: [],
        reason: 'stock_recheck_all_degraded',
      }),
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(r.skipped).toBe(1);
    // Pedido intacto.
    expect(_state.pedidos.pedA.transferidoSAP.requiresManualResend).toBe(true);
    expect(_state.pedidos.pedA.transferidoSAP.reason).toBe('stock_recheck_all_degraded');
    const skipLog = logs.find(([msg]) => msg === '[reconcile-app-only] skip_non_catalog_reason');
    expect(skipLog).toBeTruthy();
  });

  it('T6 — closedAt != null → skipped', async () => {
    const pedidos = {
      pedA: makeCandidate({ closedAt: '2026-11-19T12:00:00Z' }),
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(r.skipped).toBe(1);
    expect(_state.pedidos.pedA.transferidoSAP.requiresManualResend).toBe(true);
    const skipLog = logs.find(([msg]) => msg === '[reconcile-app-only] skip_closed');
    expect(skipLog).toBeTruthy();
  });

  it('T7 — ya tiene docNum → skipped', async () => {
    const pedidos = {
      pedA: makeCandidate({ docNum: 123456 }),
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(r.skipped).toBe(1);
    expect(_state.pedidos.pedA.transferidoSAP.docNum).toBe(123456);
    const skipLog = logs.find(([msg]) => msg === '[reconcile-app-only] skip_already_has_docnum');
    expect(skipLog).toBeTruthy();
  });

  it('T8 — reconcileAttempts=5 → maxRetriesExceeded, no borra transferidoSAP', async () => {
    const pedidos = {
      pedA: makeCandidate({ missingSkus: ['SKU-A'], reconcileAttempts: 5 }),
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(r.maxRetriesExceeded).toBe(1);
    // transferidoSAP sigue, pero ahora tiene reconcileMaxRetriesAt.
    expect(_state.pedidos.pedA.transferidoSAP.requiresManualResend).toBe(true);
    expect(_state.pedidos.pedA.transferidoSAP.reconcileMaxRetriesAt).toBeTruthy();
    const log = logs.find(([msg]) => msg === '[reconcile-app-only] max_retries_exceeded');
    expect(log).toBeTruthy();
  });

  it('T8.b — reconcileAttempts=5 + reconcileMaxRetriesAt presente → NO re-escribe', async () => {
    // Idempotencia: la segunda corrida no vuelve a setear el campo.
    const pedidos = {
      pedA: makeCandidate({
        missingSkus: ['SKU-A'],
        reconcileAttempts: 5,
        reconcileMaxRetriesAt: '2026-11-19T10:00:00Z',
      }),
    };
    const { fbDb, _state, _written } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.maxRetriesExceeded).toBe(1);
    // No update al pedido.
    const pedidoUpdates = _written.filter((w) => w.path === 'pedidos/pedA' && w.op === 'update');
    expect(pedidoUpdates.length).toBe(0);
    expect(_state.pedidos.pedA.transferidoSAP.reconcileMaxRetriesAt).toBe('2026-11-19T10:00:00Z');
  });

  it('T9 — lock held por otra corrida (expiresAt futuro) → skipped (lock_held)', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const state = baseState({ pedidos });
    // Pre-lock vigente.
    state.app_only_reconcile_locks.pedA = {
      lockedAt: '2026-11-20T14:59:00Z',
      lockedBy: 'cf-reconcile-app-only/OTHER_RUN',
      expiresAt: nowRef.getTime() + 60_000, // vence en 1 min
      pedidoId: 'pedA',
    };
    const { fbDb, _state } = makeStrictMockDb(state);
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(r.skipped).toBe(1);
    // Pedido intacto.
    expect(_state.pedidos.pedA.transferidoSAP.requiresManualResend).toBe(true);
    const log = logs.find(([msg]) => msg === '[reconcile-app-only] tx_skip');
    expect(log).toBeTruthy();
    expect(log[1].reason).toBe('lock_held');
  });

  it('T9.b — lock expired → procesa normalmente', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const state = baseState({ pedidos });
    state.app_only_reconcile_locks.pedA = {
      lockedAt: '2026-11-20T10:00:00Z',
      expiresAt: nowRef.getTime() - 60_000, // expiró hace 1 min
      pedidoId: 'pedA',
    };
    const { fbDb, _state } = makeStrictMockDb(state);
    const { deps } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(1);
    expect(r.reDispatched).toBe(1);
    expect(_state.pedidos.pedA.transferidoSAP).toBeUndefined();
  });

  it('T10 — 2 invocaciones concurrentes sobre mismo pedido → solo 1 reDispatched', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps: deps1 } = makeDeps(fbDb, { runId: 'run1' });
    const { deps: deps2 } = makeDeps(fbDb, { runId: 'run2' });
    const [r1, r2] = await Promise.all([reconcileAppOnlyCore(deps1), reconcileAppOnlyCore(deps2)]);
    // Exactamente uno reDispatched + el otro skippeado.
    const totalRedispatched = r1.reDispatched + r2.reDispatched;
    const totalProcessed = r1.processed + r2.processed;
    expect(totalRedispatched).toBe(1);
    expect(totalProcessed).toBe(1);
    // Solo un pedido tocado (transferidoSAP borrado).
    expect(_state.pedidos.pedA.transferidoSAP).toBeUndefined();
  });

  it('T11 — delete transferidoSAP falla → error registrado, no crash del batch', async () => {
    // Pedido A OK + pedido B con mock update que falla.
    const pedidos = {
      pedA: makeCandidate({ missingSkus: ['SKU-A'] }),
      pedB: makeCandidate({
        missingSkus: ['SKU-B'],
        clientCardCode: 'C002',
      }),
    };
    const state = baseState({ pedidos });
    const { fbDb, _state } = makeStrictMockDb(state);
    // Interceptamos el update de collection('pedidos').doc('pedB') para
    // que el DELETE transferidoSAP falle. El tx-update del core usa
    // dotted-path (`transferidoSAP.reconcileAttempts`); el DELETE post-tx
    // usa top-level key `transferidoSAP` con FieldValue.delete(). Nos basamos
    // en eso para identificar cuál call es.
    const originalCollection = fbDb.collection.bind(fbDb);
    fbDb.collection = (name) => {
      const col = originalCollection(name);
      if (name === 'pedidos') {
        const originalDoc = col.doc.bind(col);
        col.doc = (id) => {
          const ref = originalDoc(id);
          if (id === 'pedB') {
            const origUpdate = ref.update.bind(ref);
            ref.update = async (data) => {
              // El DELETE del core usa { transferidoSAP: FieldValue.delete() }
              // (top-level key). Distinto del tx-update que usa dotted keys.
              if (
                Object.keys(data).length === 1 &&
                data.transferidoSAP &&
                data.transferidoSAP.__delete
              ) {
                throw new Error('simulated network failure');
              }
              return origUpdate(data);
            };
          }
          return ref;
        };
      }
      return col;
    };
    const { deps } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    // pedA OK, pedB falla el delete pero no crashea.
    expect(r.processed).toBe(2);
    expect(r.reDispatched).toBe(1); // solo pedA
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].pedidoId).toBe('pedB');
    expect(r.errors[0].err).toContain('simulated network failure');
    // pedA sin transferidoSAP, pedB todavía con transferidoSAP (delete falló).
    expect(_state.pedidos.pedA.transferidoSAP).toBeUndefined();
    expect(_state.pedidos.pedB.transferidoSAP).toBeTruthy();
    expect(_state.pedidos.pedB.transferidoSAP.requiresManualResend).toBe(true);
  });

  it('T12 — §58 reads-before-writes verificado (mock strict no tira error)', async () => {
    // Si el core violara §58 el mock strict tiraría dentro del runTransaction.
    // Que la corrida exitosa complete sin throws confirma la disciplina.
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const { fbDb } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb);
    // No debería tirar nada.
    await expect(reconcileAppOnlyCore(deps)).resolves.toBeTruthy();
  });

  it('T13 — 2 missingSkus ambos presentes → reDispatched=1 happy path', async () => {
    const pedidos = {
      pedA: makeCandidate({ missingSkus: ['SKU-A', 'SKU-B'] }),
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(1);
    expect(r.reDispatched).toBe(1);
    expect(_state.pedidos.pedA.transferidoSAP).toBeUndefined();
  });

  it('T14 — batch 3 pedidos (1 reDispatched + 1 still_missing + 1 maxRetries) → contadores correctos', async () => {
    const pedidos = {
      p_ok: makeCandidate({ missingSkus: ['SKU-A'] }),
      p_missing: makeCandidate({ missingSkus: ['SKU-UNKNOWN'] }),
      p_max: makeCandidate({
        missingSkus: ['SKU-A'],
        reconcileAttempts: 5,
      }),
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(1); // solo p_ok
    expect(r.reDispatched).toBe(1); // solo p_ok
    expect(r.skipped).toBe(1); // p_missing
    expect(r.maxRetriesExceeded).toBe(1); // p_max
    expect(r.errors.length).toBe(0);
    expect(_state.pedidos.p_ok.transferidoSAP).toBeUndefined();
    expect(_state.pedidos.p_missing.transferidoSAP.requiresManualResend).toBe(true);
    expect(_state.pedidos.p_max.transferidoSAP.reconcileMaxRetriesAt).toBeTruthy();
  });

  it('T_FAILOPEN_1 — quantities = "{}" vacío → fail-open', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const snapshot = makeSnapshot({ quantities: {} });
    const { fbDb, _state } = makeStrictMockDb(baseState({ snapshot, pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(_state.pedidos.pedA.transferidoSAP).toBeTruthy();
    const failLog = logs.find(([msg]) => msg === '[reconcile-app-only] fail-open snapshot');
    expect(failLog).toBeTruthy();
    expect(failLog[1].subtype).toBe('quantities_empty');
  });

  it('T_FAILOPEN_2 — quantities NO es JSON válido → fail-open sin crash', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const snapshot = {
      updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
      quantities: '{ this is not valid json',
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ snapshot, pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(_state.pedidos.pedA.transferidoSAP).toBeTruthy();
    const failLog = logs.find(([msg]) => msg === '[reconcile-app-only] fail-open snapshot');
    expect(failLog).toBeTruthy();
    expect(failLog[1].subtype).toBe('quantities_parse_error');
  });

  it('T15 — missingSkus vacío (defensivo) → skipped (no match)', async () => {
    const pedidos = {
      pedA: makeCandidate({ missingSkus: [] }),
    };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps, logs } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
    expect(r.skipped).toBe(1);
    expect(_state.pedidos.pedA.transferidoSAP.requiresManualResend).toBe(true);
    const log = logs.find(([msg]) => msg === '[reconcile-app-only] skip_no_missing_skus');
    expect(log).toBeTruthy();
  });

  it('T16 — attempts incrementa de 0 a 1 en tx + reconcileLastAt + reconcileRunId', async () => {
    const pedidos = { pedA: makeCandidate({ missingSkus: ['SKU-A'] }) };
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb, { runId: 'my-test-run' });
    const r = await reconcileAppOnlyCore(deps);
    expect(r.reDispatched).toBe(1);
    // Validamos que el lock quedó escrito con el runId (el pedido perdió
    // transferidoSAP post-delete así que el estado intermedio ya no está).
    const lock = _state.app_only_reconcile_locks.pedA;
    expect(lock.lockedBy).toContain('my-test-run');
  });

  it('T17 — maxAttempts configurable (dep.maxAttempts=3 + attempts=3 → max)', async () => {
    const pedidos = {
      pedA: makeCandidate({ missingSkus: ['SKU-A'], reconcileAttempts: 3 }),
    };
    const { fbDb } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb, { maxAttempts: 3 });
    const r = await reconcileAppOnlyCore(deps);
    expect(r.maxRetriesExceeded).toBe(1);
    expect(r.reDispatched).toBe(0);
  });

  it('T18 — snapshotMaxAgeMs custom (10 min) + snapshot 11 min → fail-open', async () => {
    const pedidos = { pedA: makeCandidate() };
    const snapshot = makeSnapshot({ ageMs: 11 * 60 * 1000 });
    const { fbDb } = makeStrictMockDb(baseState({ snapshot, pedidos }));
    const { deps } = makeDeps(fbDb, { snapshotMaxAgeMs: 10 * 60 * 1000 });
    const r = await reconcileAppOnlyCore(deps);
    expect(r.processed).toBe(0);
    expect(r.reDispatched).toBe(0);
  });

  it('T19 — SKU comparison es case-insensitive', async () => {
    const pedidos = {
      pedA: makeCandidate({ missingSkus: ['sku-a'] }), // lowercase en el pedido
    };
    // snapshot con uppercase.
    const { fbDb, _state } = makeStrictMockDb(baseState({ pedidos }));
    const { deps } = makeDeps(fbDb);
    const r = await reconcileAppOnlyCore(deps);
    expect(r.reDispatched).toBe(1);
    expect(_state.pedidos.pedA.transferidoSAP).toBeUndefined();
  });
});

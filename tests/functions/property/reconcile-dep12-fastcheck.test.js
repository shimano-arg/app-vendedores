// @ts-check
import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { createIngresosRepartoFromDelta } from '../../../functions/core/reparto-core.js';
import { scanCancelledTransito } from '../../../functions/core/reparto-transito-core.js';

/**
 * v8 §E2 follow-up (2026-11-17, FIX follow-up):
 * Property-based × 300 runs (CLAUDE.md §54) para 2 invariantes críticas:
 *
 *  P1 (reconcile dep12 dedup):
 *    createIngresosRepartoFromDelta corrido 2× seguidas con el MISMO snapshot
 *    después NUNCA crea 2 ingresos `source='dep12'` en estado open para el
 *    mismo SKU. El dedupe es la red de seguridad entre scans del CF trigger.
 *
 *  P2 (scanCancelledTransito cap):
 *    scanCancelledTransito NUNCA revierte más unidades por SKU que la
 *    cancelación efectiva en dep 12 (`dep12Bajo - dep11Subio`). Nunca negativo.
 */

/**
 * Mock Firestore STRICT (patrón §58 + feature flag ON).
 */
function makeStrictMockDb(initialDocs) {
  const docsByPath = new Map();
  for (const [path, data] of Object.entries(initialDocs || {})) {
    docsByPath.set(path, JSON.parse(JSON.stringify(data)));
  }
  const opsLog = [];
  let autoIdSeq = 0;

  function makeDocRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      async get() {
        const data = docsByPath.get(path);
        return {
          exists: !!data,
          data: () => (data ? JSON.parse(JSON.stringify(data)) : null),
        };
      },
      async update(patch) {
        const cur = docsByPath.get(path) || {};
        docsByPath.set(path, Object.assign({}, cur, patch));
      },
      async set(data, opts) {
        if (opts && opts.merge) {
          const cur = docsByPath.get(path) || {};
          docsByPath.set(path, Object.assign({}, cur, data));
        } else {
          docsByPath.set(path, JSON.parse(JSON.stringify(data)));
        }
      },
    };
  }
  function makeQuery(collectionName, filters) {
    return {
      where(field, op, val) {
        return makeQuery(collectionName, filters.concat([{ field, op, val }]));
      },
      limit() {
        return this;
      },
      async get() {
        const out = [];
        for (const [path, data] of docsByPath) {
          if (!path.startsWith(collectionName + '/')) continue;
          let ok = true;
          for (const f of filters) {
            if (f.op === '==' && data[f.field] !== f.val) {
              ok = false;
              break;
            }
            if (f.op === 'in' && !f.val.includes(data[f.field])) {
              ok = false;
              break;
            }
          }
          if (ok) {
            out.push({
              id: path.split('/').pop(),
              data: () => JSON.parse(JSON.stringify(data)),
            });
          }
        }
        return {
          empty: out.length === 0,
          docs: out,
          forEach(fn) {
            out.forEach(fn);
          },
          size: out.length,
        };
      },
    };
  }
  function makeCollection(name) {
    return {
      doc(id) {
        return makeDocRef(name + '/' + id);
      },
      where(field, op, val) {
        return makeQuery(name, [{ field, op, val }]);
      },
      async get() {
        return makeQuery(name, []).get();
      },
      async add(data) {
        const id = 'auto-' + ++autoIdSeq;
        const path = name + '/' + id;
        docsByPath.set(path, JSON.parse(JSON.stringify(data)));
        if (name === 'operations_log') opsLog.push(data);
        return makeDocRef(path);
      },
    };
  }
  const db = {
    collection: makeCollection,
    doc(path) {
      return makeDocRef(path);
    },
    async runTransaction(fn) {
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
        update(ref, patch) {
          hasWritten = true;
          ref.update(patch);
        },
        set(ref, data, opts) {
          hasWritten = true;
          ref.set(data, opts);
        },
        delete(ref) {
          hasWritten = true;
          docsByPath.delete(ref.path);
        },
      };
      return fn(tx);
    },
    _opsLog: opsLog,
    _docsByPath: docsByPath,
  };
  return db;
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const skuArb = fc
  .string({ minLength: 3, maxLength: 8 })
  .filter((s) => /^[A-Z0-9]+$/.test(s))
  .map((s) => s.toUpperCase());

const qtyArb = fc.integer({ min: 0, max: 50 });

/** Delta dep12: before < after (incremento) */
const dep12IncreaseEntry = fc.record({
  sku: skuArb,
  before: fc.integer({ min: 0, max: 30 }),
  delta: fc.integer({ min: 1, max: 20 }), // sube de before → before+delta
});

/** Cancelación dep12: before > after, con dep11 subiendo 0..before */
const dep12CancelEntry = fc.record({
  sku: skuArb,
  beforeDep12: fc.integer({ min: 1, max: 20 }),
  cancelled: fc.integer({ min: 1, max: 20 }), // dep12 baja esta cantidad
  dep11Rise: fc.integer({ min: 0, max: 15 }), // dep11 sube esta cantidad
});

// ─── P1: reconcile dep12 dedup ──────────────────────────────────────────────

describe('v8 §E2 property P1 — createIngresosRepartoFromDelta dedup dep12 (300 runs)', () => {
  it('NUNCA crea 2 ingresos source=dep12 open para el mismo SKU al correr 2× con mismo after', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(dep12IncreaseEntry, { minLength: 1, maxLength: 5 }),
        async (entries) => {
          // Dedupe por SKU dentro del array (fc puede repetir keys).
          const bySku = new Map();
          for (const e of entries) {
            if (!bySku.has(e.sku)) bySku.set(e.sku, e);
          }
          const before = { warehouseBreakdown: {} };
          const after = { warehouseBreakdown: {} };
          const pedidos = {};
          let pIdx = 0;
          for (const [sku, e] of bySku) {
            before.warehouseBreakdown[sku] = { 11: 0, 12: e.before };
            after.warehouseBreakdown[sku] = { 11: 0, 12: e.before + e.delta };
            // Pedido BO con 1 unidad del SKU para que haya demanda.
            pedidos['pedidos/P' + ++pIdx] = {
              closedAt: null,
              clientCardCode: 'C001',
              clientName: 'CLIENTE X',
              lines: [{ code: sku, state: 'BO', qty: 1, qtyOpen: 1 }],
            };
          }
          before.warehouseBreakdown = JSON.stringify(before.warehouseBreakdown);
          after.warehouseBreakdown = JSON.stringify(after.warehouseBreakdown);

          const db = makeStrictMockDb({
            ...pedidos,
            'app_config/feature_flags': { dep12_reparto_enabled: true },
          });

          // Correr 2× (mismo delta, para simular re-dispatch del trigger).
          await createIngresosRepartoFromDelta({ fbDb: db }, before, after);
          await createIngresosRepartoFromDelta({ fbDb: db }, before, after);

          // Contar ingresos source=dep12 open por SKU.
          const bySkuCount = new Map();
          for (const [path, data] of db._docsByPath) {
            if (!path.startsWith('ingresos_reparto/')) continue;
            if (data.source !== 'dep12') continue;
            if (data.status !== 'pending' && data.status !== 'in_progress') continue;
            const n = (bySkuCount.get(data.sku) || 0) + 1;
            bySkuCount.set(data.sku, n);
          }
          for (const n of bySkuCount.values()) {
            if (n > 1) return false; // DUPLICADO → falla la property
          }
          return true;
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ─── P2: scanCancelledTransito cap ──────────────────────────────────────────

describe('v8 §E2 property P2 — scanCancelledTransito nunca revierte > cancelacion dep12 (300 runs)', () => {
  it('sum(revertidas por SKU) ≤ dep12Bajo - dep11Subio', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(dep12CancelEntry, { minLength: 1, maxLength: 4 }),
        async (entries) => {
          const bySku = new Map();
          for (const e of entries) {
            if (!bySku.has(e.sku)) bySku.set(e.sku, e);
          }
          const before = { warehouseBreakdown: {} };
          const after = { warehouseBreakdown: {} };
          const pedidos = {};
          let pIdx = 0;
          for (const [sku, e] of bySku) {
            before.warehouseBreakdown[sku] = { 11: 0, 12: e.beforeDep12 };
            after.warehouseBreakdown[sku] = {
              11: e.dep11Rise,
              12: Math.max(0, e.beforeDep12 - e.cancelled),
            };
            // Pedidos ASIG enTransito con exceso de capacidad para ser revertibles.
            pedidos['pedidos/PX' + ++pIdx] = {
              closedAt: null,
              clientCardCode: 'C002',
              clientName: 'CLIENTE Y',
              lines: [
                {
                  code: sku,
                  state: 'ASIG',
                  qty: e.beforeDep12,
                  qtyOpen: e.beforeDep12,
                  enTransito: true,
                  asigAtTransito: '2026-11-10T10:00:00Z',
                },
              ],
            };
          }
          before.warehouseBreakdown = JSON.stringify(before.warehouseBreakdown);
          after.warehouseBreakdown = JSON.stringify(after.warehouseBreakdown);

          const db = makeStrictMockDb(pedidos);
          const r = await scanCancelledTransito({ fbDb: db }, before, after);

          // Sumar revertidas por SKU.
          const revertPorSku = new Map();
          for (const rev of r.revertidas) {
            revertPorSku.set(rev.sku, (revertPorSku.get(rev.sku) || 0) + rev.qtyRevertida);
            if (rev.qtyRevertida <= 0) return false; // nunca 0/negativo
          }
          // Verificar cap por SKU.
          for (const [sku, e] of bySku) {
            const bajada = Math.max(0, e.beforeDep12 - Math.max(0, e.beforeDep12 - e.cancelled));
            const subida = e.dep11Rise;
            const capExpected = Math.max(0, bajada - subida);
            const reverted = revertPorSku.get(sku) || 0;
            if (reverted > capExpected) return false;
          }
          return true;
        }
      ),
      { numRuns: 300 }
    );
  });
});

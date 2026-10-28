// @ts-check
/**
 * v1516 §TBD — createIngresosRepartoFromDelta debe consolidar en vez de
 * duplicar cuando ya existe un doc pending/in_progress del mismo SKU.
 *
 * Casos cubiertos:
 *   T1a: no existe doc pending del SKU → crea nuevo como antes (comportamiento intacto).
 *   T1b: existe doc pending del mismo SKU → suma qtyIngresada + refresh clientesBO
 *        + audit mergedFromDeltas; NO crea nuevo.
 *   T1c: existe doc in_progress del mismo SKU → consolida igual (no cambia status).
 *   T1d: existen 2 docs del mismo SKU (data corrupta pre-fix) → consolida contra
 *        el primero que trae el query (ok, no revienta).
 */
import { describe, expect, it } from 'vitest';
import { createIngresosRepartoFromDelta } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const nowIso = NOW.toISOString();

const _snap = (whs) => ({ warehouseBreakdown: JSON.stringify(whs) });

const pedidoDoc = (id, data) => ({ id, data: () => data });

/**
 * Mock Firestore que soporta:
 *   - collection('pedidos').where('closedAt','==',null).get() → forEach pedidos
 *   - collection('ingresos_reparto').where('sku','==',X).where('status','in',[...]).limit(1).get()
 *     → devuelve docs del store filtrados.
 *   - collection('ingresos_reparto').where('dedupeKey','==',X).where('status','==','pending').limit(1).get()
 *     → safety-net secundaria.
 *   - collection('ingresos_reparto').doc(id).update(patch) → aplica patch al store.
 *   - collection('ingresos_reparto').add(data) → crea con auto-id.
 */
function makeFakeFbDb({ pedidos = [], ingresos_reparto = {} } = {}) {
  const store = { pedidos, ingresos_reparto };
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    collection(name) {
      /** @type {any} */
      const chainState = { name, filters: [] };
      const chain = {
        _state: chainState,
        where(field, op, value) {
          chainState.filters.push({ field, op, value });
          return chain;
        },
        limit() {
          return chain;
        },
        async get() {
          if (chainState.name === 'pedidos') {
            return {
              empty: store.pedidos.length === 0,
              forEach(cb) {
                for (const p of store.pedidos) cb(p);
              },
            };
          }
          if (chainState.name === 'ingresos_reparto') {
            // Apply filters.
            const filters = chainState.filters;
            const skuFilter = filters.find((f) => f.field === 'sku' && f.op === '==');
            const statusInFilter = filters.find((f) => f.field === 'status' && f.op === 'in');
            const statusEqFilter = filters.find((f) => f.field === 'status' && f.op === '==');
            const dedupeKeyFilter = filters.find((f) => f.field === 'dedupeKey' && f.op === '==');
            /** @type {Array<{id: string, data: any}>} */
            const matched = [];
            for (const [id, data] of Object.entries(store.ingresos_reparto)) {
              if (skuFilter && data.sku !== skuFilter.value) continue;
              if (statusInFilter && !statusInFilter.value.includes(data.status)) continue;
              if (statusEqFilter && data.status !== statusEqFilter.value) continue;
              if (dedupeKeyFilter && data.dedupeKey !== dedupeKeyFilter.value) continue;
              matched.push({
                id,
                data: () => data,
              });
            }
            return {
              empty: matched.length === 0,
              docs: matched,
              forEach(cb) {
                for (const m of matched) cb(m);
              },
            };
          }
          return { empty: true, docs: [], forEach: () => {} };
        },
        async add(data) {
          writes.push({ type: 'add', name: chainState.name, data });
          const id = 'auto_' + Math.random().toString(36).slice(2, 10);
          if (chainState.name === 'ingresos_reparto') {
            store.ingresos_reparto[id] = Object.assign({}, data);
          }
          return { id };
        },
        doc(id) {
          return {
            id,
            async update(patch) {
              writes.push({ type: 'update', name: chainState.name, id, patch });
              if (chainState.name === 'ingresos_reparto' && store.ingresos_reparto[id]) {
                store.ingresos_reparto[id] = Object.assign({}, store.ingresos_reparto[id], patch);
              }
            },
          };
        },
      };
      return chain;
    },
  };
}

const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });

const makePedidoBO = (id, cardCode, sku, qty, createdAt) =>
  pedidoDoc(id, {
    clientCardCode: cardCode,
    clientName: 'CLIENTE_' + cardCode,
    province: 'BA',
    locName: 'CABA',
    createdAt: createdAt || nowIso,
    closedAt: null,
    lines: [{ code: sku, state: 'BO', qtyOpen: qty }],
  });

describe('createIngresosRepartoFromDelta — v1516 consolidate', () => {
  it('T1a: no existe doc pending del SKU → crea nuevo (comportamiento intacto)', async () => {
    const before = _snap({ FXS70MHC2: { 11: 10 } });
    const after = _snap({ FXS70MHC2: { 11: 13 } });
    const fbDb = makeFakeFbDb({
      pedidos: [makePedidoBO('p1', 'C1', 'FXS70MHC2', 5)],
    });
    const r = await createIngresosRepartoFromDelta(deps(fbDb), before, after);
    expect(r.errors).toEqual([]);
    expect(r.created).toHaveLength(1);
    expect(r.skipped).toEqual([]);
    const createdDoc = Object.values(fbDb._store.ingresos_reparto)[0];
    expect(createdDoc.sku).toBe('FXS70MHC2');
    expect(createdDoc.qtyIngresada).toBe(3);
    expect(createdDoc.status).toBe('pending');
  });

  it('T1b: existe doc pending del mismo SKU → suma qtyIngresada + refresh clientesBO + audit mergedFromDeltas; NO crea nuevo', async () => {
    const existingId = 'existing_1';
    const before = _snap({ FXS70MHC2: { 11: 13 } });
    const after = _snap({ FXS70MHC2: { 11: 20 } });
    const fbDb = makeFakeFbDb({
      pedidos: [
        makePedidoBO('p1', 'C1', 'FXS70MHC2', 5),
        makePedidoBO('p2', 'C2', 'FXS70MHC2', 10),
        makePedidoBO('p3', 'C3', 'FXS70MHC2', 4),
      ],
      ingresos_reparto: {
        [existingId]: {
          sku: 'FXS70MHC2',
          qtyIngresada: 3,
          status: 'pending',
          clientesBO: [{ pedidoId: 'p1', lineIndex: 0, clientCardCode: 'C1', qtyBackorder: 5 }],
          qtyBackorderTotal: 5,
          clientesCount: 1,
          detectedAt: '2026-10-28T11:00:00Z',
          dedupeKey: 'FXS70MHC2|13',
        },
      },
    });
    const r = await createIngresosRepartoFromDelta(deps(fbDb), before, after);
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/consolidated_into/);
    expect(r.skipped[0].reason).toContain(existingId);
    // Verificar que el doc existente fue actualizado.
    const updated = fbDb._store.ingresos_reparto[existingId];
    expect(updated.qtyIngresada).toBe(10); // 3 + 7 delta
    // clientesBO refrescado con todos los clientes BO vigentes.
    expect(updated.clientesCount).toBe(3);
    expect(updated.clientesBO.length).toBe(3);
    expect(updated.qtyBackorderTotal).toBe(19);
    // Audit entry agregada.
    expect(Array.isArray(updated.mergedFromDeltas)).toBe(true);
    expect(updated.mergedFromDeltas).toHaveLength(1);
    expect(updated.mergedFromDeltas[0].delta).toBe(7);
    expect(updated.mergedFromDeltas[0].afterDep11).toBe(20);
    expect(updated.mergedFromDeltas[0].source).toBe('createIngresosRepartoFromDelta');
    expect(updated.mergedFromDeltas[0].reason).toBe('consolidate_pending_sku');
    expect(updated._lastConsolidatedAt).toBe(nowIso);
    // Status NO cambia (sigue pending).
    expect(updated.status).toBe('pending');
    // NO se crearon docs nuevos — solo 1 doc en el store.
    expect(Object.keys(fbDb._store.ingresos_reparto)).toHaveLength(1);
  });

  it('T1c: existe doc in_progress del mismo SKU → consolida igual (no cambia status)', async () => {
    const existingId = 'existing_in_progress';
    const before = _snap({ SLX151XGA: { 11: 5 } });
    const after = _snap({ SLX151XGA: { 11: 11 } });
    const fbDb = makeFakeFbDb({
      pedidos: [makePedidoBO('p1', 'C1', 'SLX151XGA', 20)],
      ingresos_reparto: {
        [existingId]: {
          sku: 'SLX151XGA',
          qtyIngresada: 5,
          status: 'in_progress',
          lockedAt: '2026-10-28T10:00:00Z',
          clientesBO: [],
          qtyBackorderTotal: 0,
          clientesCount: 0,
          detectedAt: '2026-10-28T09:00:00Z',
          dedupeKey: 'SLX151XGA|5',
        },
      },
    });
    const r = await createIngresosRepartoFromDelta(deps(fbDb), before, after);
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/consolidated_into/);
    const updated = fbDb._store.ingresos_reparto[existingId];
    expect(updated.qtyIngresada).toBe(11); // 5 + 6 delta
    // Status NO cambia (sigue in_progress).
    expect(updated.status).toBe('in_progress');
    expect(updated.lockedAt).toBe('2026-10-28T10:00:00Z'); // preserved
    expect(updated.mergedFromDeltas).toHaveLength(1);
  });

  it('T1d: existen 2 docs del mismo SKU (data corrupta pre-fix) → consolida contra el primero (ok, no revienta)', async () => {
    const before = _snap({ SUC60MH2APY: { 11: 10 } });
    const after = _snap({ SUC60MH2APY: { 11: 15 } });
    const fbDb = makeFakeFbDb({
      pedidos: [makePedidoBO('p1', 'C1', 'SUC60MH2APY', 7)],
      ingresos_reparto: {
        corrupt_a: {
          sku: 'SUC60MH2APY',
          qtyIngresada: 3,
          status: 'pending',
          clientesBO: [],
          qtyBackorderTotal: 0,
          clientesCount: 0,
          detectedAt: '2026-10-28T10:00:00Z',
          dedupeKey: 'SUC60MH2APY|3',
        },
        corrupt_b: {
          sku: 'SUC60MH2APY',
          qtyIngresada: 9,
          status: 'pending',
          clientesBO: [],
          qtyBackorderTotal: 0,
          clientesCount: 0,
          detectedAt: '2026-10-28T11:00:00Z',
          dedupeKey: 'SUC60MH2APY|9',
        },
      },
    });
    const r = await createIngresosRepartoFromDelta(deps(fbDb), before, after);
    // No revienta — consolida contra alguno de los dos (el que trae .limit(1) first).
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/consolidated_into/);
    // Alguno de los dos quedó actualizado (sumó el delta 5).
    const docs = Object.values(fbDb._store.ingresos_reparto);
    const updatedCount = docs.filter((d) => Array.isArray(d.mergedFromDeltas)).length;
    expect(updatedCount).toBe(1);
    // Total de docs sigue siendo 2 (no se eliminó ni creó).
    expect(docs).toHaveLength(2);
  });

  it('consolidate preserva campos no tocados del doc existente', async () => {
    const existingId = 'existing_preserve';
    const before = _snap({ X: { 11: 10 } });
    const after = _snap({ X: { 11: 12 } });
    const fbDb = makeFakeFbDb({
      pedidos: [makePedidoBO('p1', 'C1', 'X', 5)],
      ingresos_reparto: {
        [existingId]: {
          sku: 'X',
          qtyIngresada: 3,
          status: 'pending',
          clientesBO: [],
          qtyBackorderTotal: 0,
          clientesCount: 0,
          detectedAt: '2026-10-28T10:00:00Z',
          appliedAt: null,
          appliedBy: null,
          assignments: null,
          dedupeKey: 'X|10',
          source: 'reconciliation',
        },
      },
    });
    await createIngresosRepartoFromDelta(deps(fbDb), before, after);
    const updated = fbDb._store.ingresos_reparto[existingId];
    expect(updated.detectedAt).toBe('2026-10-28T10:00:00Z'); // preserved
    expect(updated.source).toBe('reconciliation'); // preserved
    expect(updated.dedupeKey).toBe('X|10'); // preserved (safety net sigue válido)
    expect(updated.appliedAt).toBe(null);
    expect(updated.appliedBy).toBe(null);
  });

  it('consolidate con error de update → sigue, loguea error, NO revienta loop', async () => {
    const existingId = 'existing_fail_update';
    const before = _snap({ Y: { 11: 10 } });
    const after = _snap({ Y: { 11: 15 } });
    const fbDb = makeFakeFbDb({
      pedidos: [makePedidoBO('p1', 'C1', 'Y', 5)],
      ingresos_reparto: {
        [existingId]: {
          sku: 'Y',
          qtyIngresada: 3,
          status: 'pending',
          clientesBO: [],
          qtyBackorderTotal: 0,
          clientesCount: 0,
          dedupeKey: 'Y|10',
        },
      },
    });
    // Monkey-patch update para que falle.
    const origCollection = fbDb.collection.bind(fbDb);
    fbDb.collection = (n) => {
      const c = origCollection(n);
      if (n === 'ingresos_reparto') {
        const origDoc = c.doc.bind(c);
        c.doc = (id) => {
          const d = origDoc(id);
          d.update = async () => {
            throw new Error('simulated update failure');
          };
          return d;
        };
      }
      return c;
    };
    const r = await createIngresosRepartoFromDelta(deps(fbDb), before, after);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/consolidation failed/);
    expect(r.created).toEqual([]);
  });
});

// @ts-check
/**
 * §105 — Property T-13: invariante "UN tx.update por pedido origen afectado".
 *
 * Propiedad: dado cualquier payload CPST con N asigRefs distribuidos entre
 * K pedidos origen únicos (1 <= K <= 5), tras commitPedidoCore debe haber
 * EXACTAMENTE K tx.update sobre `pedidos/<id>` (uno por pedido).
 *
 * Esta invariante garantiza que el fix §105 (consolidación via pendingPedidoWrites
 * Map) no degrada a N tx.update individuales (comportamiento pre-fix que
 * generaba el bug "último write gana").
 *
 * Property-based con fast-check, ≥50 runs (más que suficiente — el núcleo del
 * fix es combinatoria sobre M=K pedidos únicos, no sobre valores numéricos).
 */
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../../functions/core/commit-pedido-core.js';

const nowRef = new Date('2026-11-13T16:00:00Z');

function makeMockDb(fixture) {
  const state = fixture || {};
  const _opsLog = [];
  const makeDoc = (col, id) => ({
    id,
    _path: `${col}/${id}`,
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : null) };
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
      state[col][id] = { ...data };
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
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
        forEach: (fn) => docs.forEach(fn),
      };
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
        const snap = JSON.parse(JSON.stringify(state));
        const opsBefore = _opsLog.length;
        try {
          const tx = {
            async get(ref) {
              return ref.get();
            },
            set(ref, data) {
              _opsLog.push({ type: 'set', path: ref._path, data });
              return ref.set(data);
            },
            update(ref, data) {
              _opsLog.push({ type: 'update', path: ref._path, data });
              return ref.update(data);
            },
            delete(ref) {
              _opsLog.push({ type: 'delete', path: ref._path });
              return ref.delete();
            },
          };
          return await fn(tx);
        } catch (e) {
          for (const k of Object.keys(state)) delete state[k];
          for (const [k, v] of Object.entries(snap)) state[k] = v;
          for (let i = opsBefore; i < _opsLog.length; i++) _opsLog[i].rolledBack = true;
          throw e;
        }
      },
    },
    _state: state,
    _opsLog,
  };
}

describe('§105 property — UN tx.update por pedido origen', () => {
  it('K pedidos origen distintos → exactamente K tx.update', async () => {
    await fc.assert(
      fc.asyncProperty(
        // K entre 1 y 5 pedidos origen distintos.
        fc.integer({ min: 1, max: 5 }),
        // numLinesPerOrigen entre 1 y 3 ASIG por pedido origen.
        fc.integer({ min: 1, max: 3 }),
        async (K, linesPerOrigen) => {
          // Fixture: K pedidos origen, cada uno con `linesPerOrigen` líneas ASIG
          // del mismo cliente.
          const pedidos = {};
          const asigRefs = [];
          const warehouseBreakdown = {};
          for (let p = 0; p < K; p++) {
            const pedidoId = `origen_${p}`;
            const lines = [];
            for (let i = 0; i < linesPerOrigen; i++) {
              const sku = `SKU_${p}_${i}`;
              lines.push({
                code: sku,
                state: 'ASIG',
                qty: 2,
                qtyOpen: 2,
                qtyCancelled: 0,
                asigAt: '2026-11-10T02:00:00.000Z',
                asigReserva: true,
              });
              asigRefs.push({ pedidoId, lineIndex: i, sku, qtyAsignada: 2 });
              warehouseBreakdown[sku] = { 11: 10 };
            }
            pedidos[pedidoId] = {
              clientCardCode: 'C001',
              clientName: 'TEST',
              closedAt: null,
              createdAt: '2026-10-15T00:00:00.000Z',
              stage: 'confirmed',
              lines,
              _backfill: {},
            };
          }

          const fixture = {
            app_config: {
              stock_snapshot: {
                updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
                warehouseBreakdown: JSON.stringify(warehouseBreakdown),
              },
            },
            pedidos,
            pedido_draft_locks: {},
            ingresos_reparto: {},
            revision_waitlist: {
              wl: {
                clientCardCode: 'C001',
                stage: 'pending',
                closedAt: null,
                source: 'stock-asignado-batch',
              },
            },
          };

          const { fbDb, _opsLog } = makeMockDb(fixture);

          const payload = {
            draftId: `DRAFT-PROP-${K}-${linesPerOrigen}`,
            cardCode: 'C001',
            clientName: 'TEST',
            origen: 'cpst',
            lines: [
              {
                sku: 'CPST_LINE',
                cantidad: 1,
                precio: 100,
                origenLinea: 'stock-asignado',
                asigRefs,
              },
            ],
            clientVersion: 'v1600',
            ownerUid: 'U1',
            ownerEmail: 'u1@test.com',
            waitlistOrigenId: 'wl',
            source: 'stock-asignado-batch',
            autoAcceptStockChange: true,
          };

          const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
          if (!r.ok) return false; // propiedad trivialmente falla si no se creó el pedido.

          // Property: exactamente K tx.update sobre pedidos/origen_*
          // (uno por cada pedido origen con refs).
          const updatesCount = _opsLog.filter(
            (o) => o.type === 'update' && /^pedidos\/origen_\d+$/.test(o.path)
          ).length;

          return updatesCount === K;
        }
      ),
      { numRuns: 50 }
    );
  });
});

// @ts-check
/**
 * E4 §stock-servidor-atomico — test de integración del flow CPST → waitlist
 * → doConfirmPedido → commitPedidoCF.
 *
 * Insight E4: `_cpstConfirmar` NO consume stock directamente (crea un
 * `revision_waitlist` draft). El consumo real sucede cuando el VDE
 * confirma el waitlist → `doConfirmPedido` → `commitPedidoCF` (E3).
 *
 * Este test valida:
 * 1. El helper `_tryCommitPedidoCF` mapea `source=stock-asignado-batch`
 *    → `origen=cpst` correctamente.
 * 2. Las líneas con `origen='stock-asignado'` + `asigRefs` se transmiten
 *    al CF para que cancele ASIG originales atómicamente.
 * 3. commitPedidoCore ejecuta el bloque CPST (cancel ASIG) server-side
 *    dentro de runTransaction (CLAUDE.md §33/§35).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../../functions/core/commit-pedido-core.js';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('E4 — CPST end-to-end flow con commitPedidoCF', () => {
  describe('cliente: mapping payload CPST', () => {
    it('_tryCommitPedidoCF mapea source=stock-asignado-batch → origen=cpst', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      // §67 (v1454): rango subido a 5500 porque el body del helper creció con
      // el mapping extendido source → origen (manual_backorder) + nuevos
      // campos linesPrebuilt/skipSap/routing.
      const code = INDEX_HTML.slice(start, start + 5500);
      expect(code).toMatch(/stock-asignado-batch[\s\S]*?cpst/);
    });

    it('_tryCommitPedidoCF propaga asigRefs de cada línea al payload', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      const code = INDEX_HTML.slice(start, start + 5500);
      expect(code).toMatch(/asigRefs:/);
      expect(code).toMatch(/l\.asigRefs/);
    });

    it('_tryCommitPedidoCF propaga origen por línea (origenLinea)', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      const code = INDEX_HTML.slice(start, start + 5500);
      expect(code).toMatch(/origenLinea:/);
    });
  });

  describe('servidor: commitPedidoCore cpst variant', () => {
    const nowRef = new Date('2026-10-23T12:00:00Z');

    function makeMinimalDb(initialState) {
      const state = initialState;
      const written = [];
      const makeDocRef = (col, id) => ({
        id,
        async get() {
          const d = state[col]?.[id];
          return { exists: !!d, data: () => d || null };
        },
        async set(data) {
          state[col] ||= {};
          state[col][id] = { ...(state[col][id] || {}), ...data };
          written.push({ op: 'set', path: `${col}/${id}`, data });
        },
        async update(data) {
          state[col] ||= {};
          state[col][id] = { ...(state[col][id] || {}), ...data };
          written.push({ op: 'update', path: `${col}/${id}`, data });
        },
      });
      const makeCollection = (col, filters = []) => {
        const api = {
          where(f, op, v) {
            return makeCollection(col, [...filters, { f, op, v }]);
          },
          limit() {
            return api;
          },
          doc(id) {
            return makeDocRef(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
          },
          async get() {
            let docs = Object.entries(state[col] || {}).map(([id, data]) => ({
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
        };
        return api;
      };
      return {
        fbDb: {
          collection: (c) => makeCollection(c),
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
            };
            return fn(tx);
          },
        },
        _state: state,
        _written: written,
      };
    }

    it('CPST con asigRefs cancela ASIG original en la MISMA txn', async () => {
      const state = {
        app_config: {
          stock_snapshot: {
            updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
            warehouseBreakdown: { 'SKU-A': { 11: 5 } },
          },
        },
        pedidos: {
          ped_origen: {
            _fsId: 'ped_origen',
            closedAt: null,
            clientCardCode: 'C001',
            clientName: 'CLI',
            createdAt: '2026-10-20T10:00:00Z',
            transferidoSAP: { docEntry: 999 },
            lines: [
              { code: 'SKU-A', state: 'ASIG', qty: 3, qtyOpen: 3, asigAt: '2026-10-22T10:00:00Z' },
            ],
          },
        },
        stock_snapshot: {
          'SKU-A': {
            sku: 'SKU-A',
            asignadas: { total: 3, byClient: { C001: 3 } },
            backorderApp: { total: 0, byClient: {} },
          },
        },
        ingresos_reparto: {},
        // §57 (2026-10-23): waitlist origen presente para que CPST pase el
        // validation gate `waitlistOrigenId` requerido.
        revision_waitlist: {
          wl_cpst_e2e_1: {
            clientCardCode: 'C001',
            orderNumber: 600,
            items: [{ code: 'SKU-A', qty: 3 }],
            closedAt: null,
            stage: 'pending',
          },
        },
      };
      const { fbDb, _written } = makeMinimalDb(state);

      // Flow CPST: VDE confirma waitlist que tenía ASIG asignada.
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'cpst_e2e_1',
          cardCode: 'C001',
          clientName: 'CLI',
          origen: 'cpst',
          lines: [
            {
              sku: 'SKU-A',
              cantidad: 3,
              precio: 100,
              origenLinea: 'stock-asignado',
              asigRefs: [{ pedidoId: 'ped_origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
            },
          ],
          clientVersion: 'v1430',
          waitlistOrigenId: 'wl_cpst_e2e_1',
        }
      );

      expect(r.ok).toBe(true);
      expect(r.lines[0].qtyConfirmed).toBe(3);
      expect(r.lines[0].qtyBO).toBe(0);
      // ASIG original cancelada en la misma txn
      const origenUpdate = _written.find(
        (w) => w.path === 'pedidos/ped_origen' && w.op === 'update'
      );
      expect(origenUpdate, 'ASIG original debe ser cancelada en la misma txn').toBeTruthy();
      expect(origenUpdate.data.lines[0].state).toBe('cancelled');
      expect(origenUpdate.data.lines[0].closedReason).toBe('waitlist-confirm');
      expect(origenUpdate.data.lines[0].cancelledIntoPedidoId).toBe(r.pedidoId);
    });

    it('CPST con 2 asigRefs del mismo pedido origen cancela ambas líneas', async () => {
      const state = {
        app_config: {
          stock_snapshot: {
            updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
            warehouseBreakdown: { 'SKU-X': { 11: 10 } },
          },
        },
        pedidos: {
          ped_origen: {
            closedAt: null,
            clientCardCode: 'C001',
            createdAt: '2026-10-20T10:00:00Z',
            transferidoSAP: { docEntry: 100 },
            lines: [
              { code: 'SKU-X', state: 'ASIG', qty: 2, qtyOpen: 2, asigAt: '2026-10-22T10:00:00Z' },
              { code: 'SKU-X', state: 'ASIG', qty: 1, qtyOpen: 1, asigAt: '2026-10-22T10:00:00Z' },
            ],
          },
        },
        stock_snapshot: {
          'SKU-X': {
            sku: 'SKU-X',
            asignadas: { total: 3, byClient: { C001: 3 } },
            backorderApp: { total: 0, byClient: {} },
          },
        },
        ingresos_reparto: {},
        // §57 (2026-10-23): waitlist origen requerida para CPST.
        revision_waitlist: {
          wl_cpst_multi: {
            clientCardCode: 'C001',
            orderNumber: 601,
            items: [{ code: 'SKU-X', qty: 3 }],
            closedAt: null,
            stage: 'pending',
          },
        },
      };
      const { fbDb, _written } = makeMinimalDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'cpst_multi',
          cardCode: 'C001',
          origen: 'cpst',
          lines: [
            {
              sku: 'SKU-X',
              cantidad: 3,
              precio: 100,
              origenLinea: 'stock-asignado',
              asigRefs: [
                { pedidoId: 'ped_origen', lineIndex: 0, qtyAsignada: 2, sku: 'SKU-X' },
                { pedidoId: 'ped_origen', lineIndex: 1, qtyAsignada: 1, sku: 'SKU-X' },
              ],
            },
          ],
          clientVersion: 'v1430',
          waitlistOrigenId: 'wl_cpst_multi',
        }
      );
      expect(r.ok).toBe(true);
      const update = _written.find((w) => w.path === 'pedidos/ped_origen' && w.op === 'update');
      expect(update).toBeTruthy();
      // Ambas líneas canceladas.
      expect(update.data.lines[0].state).toBe('cancelled');
      expect(update.data.lines[1].state).toBe('cancelled');
    });

    it('CPST con origen != cpst NO cancela ASIG (prevención accidental)', async () => {
      const state = {
        app_config: {
          stock_snapshot: {
            updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
            warehouseBreakdown: { 'SKU-Y': { 11: 10 } },
          },
        },
        pedidos: {
          ped_origen: {
            closedAt: null,
            clientCardCode: 'C001',
            createdAt: '2026-10-20T10:00:00Z',
            transferidoSAP: { docEntry: 101 },
            lines: [
              { code: 'SKU-Y', state: 'ASIG', qty: 2, qtyOpen: 2, asigAt: '2026-10-22T10:00:00Z' },
            ],
          },
        },
        stock_snapshot: {
          'SKU-Y': {
            sku: 'SKU-Y',
            asignadas: { total: 2, byClient: { C001: 2 } },
            backorderApp: { total: 0, byClient: {} },
          },
        },
        ingresos_reparto: {},
        revision_waitlist: {},
      };
      const { fbDb, _written } = makeMinimalDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'manual_wrong_refs',
          cardCode: 'C001',
          origen: 'manual',
          lines: [
            {
              sku: 'SKU-Y',
              cantidad: 2,
              precio: 100,
              // No origenLinea → formula GLOBAL.
              // asigRefs provistos pero origen=manual → CF los ignora para cancel.
              asigRefs: [{ pedidoId: 'ped_origen', lineIndex: 0, qtyAsignada: 2, sku: 'SKU-Y' }],
            },
          ],
          clientVersion: 'v1430',
        }
      );
      expect(r.ok).toBe(true);
      // NO debe haber update al pedido origen (origen != cpst)
      const origenUpdate = _written.find(
        (w) => w.path === 'pedidos/ped_origen' && w.op === 'update'
      );
      expect(origenUpdate, 'origen=manual NO debe cancelar ASIG').toBeFalsy();
    });
  });
});

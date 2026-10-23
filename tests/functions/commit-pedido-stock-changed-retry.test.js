// @ts-check
/**
 * §58 — fix retry post STOCK_CHANGED (2026-10-23)
 *
 * Reproduce bug prod 2026-10-23: Gonzalo De La Rosa, cliente BROBRO/DEVOTO.
 *
 * 1. CF devuelve STOCK_CHANGED (stock cambió entre vista y confirm).
 * 2. Vendedor acepta (modal "Confirmar con back order?").
 * 3. Cliente reintenta con `autoAcceptStockChange=true`.
 * 4. CF intenta commitInTransaction, hace `tx.set(pedidoRef)` ANTES de
 *    `tx.get(wlRef)` del waitlist origen (y de `tx.get(refDoc)` de las
 *    ASIG en cpst).
 * 5. Firestore tira "transactions require all reads before all writes".
 * 6. Core reintenta 5× (misma falla) → CONTENTION_RETRY_EXHAUSTED
 *    "Reintenta en 10 segundos".
 *
 * Gcloud log del incidente real:
 *   2026-10-23T15:53:53Z commitPedidoCore retry {
 *     draftId: 'C|BUENOS AIRES|ESCOBAR|EDUARDO SATO|538',
 *     attempts: 5,
 *     err: 'Firestore transactions require all reads to be executed before all writes.'
 *   }
 *
 * Hypothesis Mariano original: "el reintento no refresca el breakdown".
 * Hallazgo real: la CF SÍ recomputa breakdown (lo hace dentro de la tx),
 * pero rompe la invariante read-before-write ANTES de tener oportunidad
 * de persistir el pedido.
 *
 * Fix: hoist todos los tx.get() antes del primer tx.set/update.
 */

import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock Firestore STRICT con enforce de "all reads before all writes".
 * El mock existente en commit-pedido-core.test.js NO enforza eso, por eso
 * los tests pasaban mientras prod fallaba.
 *
 * Cada tx.get() post-write registra una violation. Si el flow genera
 * violations, el runTransaction hace THROW igual que Firestore real.
 */
function makeStrictMockDb(fixture) {
  const state = fixture || {};
  const written = [];

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
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'set', path: key, data });
      },
      async update(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        written.push({ op: 'update', path: key, data });
      },
    };
  };

  const makeCollection = (colName, filters = []) => {
    const col = {
      _name: colName,
      where(field, op, val) {
        return makeCollection(colName, [...filters, { field, op, val }]);
      },
      limit() {
        return col;
      },
      doc(id) {
        return makeDocRef(colName, id || 'auto_' + Math.random().toString(36).slice(2, 10));
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
            const val = d.data()[f.field];
            if (f.op === '==') return val === f.val;
            if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(val);
            return true;
          });
        }
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
      const [col, id] = path.split('/');
      return makeDocRef(col, id);
    },
    async runTransaction(fn) {
      let hasWritten = false;
      const violations = [];
      const tx = {
        async get(ref) {
          if (hasWritten) {
            // Simular comportamiento REAL de Firestore (admin SDK) que
            // tira sync al reach `tx.get` después de un write.
            violations.push(`tx.get(${ref._path}) after write`);
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
      };
      return fn(tx);
    },
  };
  return { fbDb, _state: state, _written: written };
}

const nowRef = new Date('2026-10-23T12:00:00Z');

function baseStateWithStock(sku, fisico, pedidos = []) {
  const pedidosMap = {};
  for (const p of pedidos) pedidosMap[p._fsId || p.id || 'p1'] = p;
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60000 },
        warehouseBreakdown: { [sku]: { 11: fisico } },
      },
    },
    pedidos: pedidosMap,
    stock_snapshot: {
      [sku]: {
        sku,
        asignadas: { total: 0, byClient: {} },
        backorderApp: { total: 0, byClient: {} },
      },
    },
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('§58 commitPedidoCore — retry post STOCK_CHANGED NO rompe reads-before-writes', () => {
  describe('Repro bug Gonzalo 2026-10-23 11:37-15:53', () => {
    it('retry con autoAcceptStockChange=true + waitlistOrigenId persiste pedido sin error', async () => {
      const state = baseStateWithStock('SKU-A', 2, []);
      state.revision_waitlist['wl-origen-123'] = {
        _id: 'wl-origen-123',
        clientCardCode: 'C001',
        stage: 'draft',
        closedAt: null,
        items: [{ code: 'SKU-A', qty: 5 }],
      };
      const { fbDb, _written } = makeStrictMockDb(state);

      // El cliente envía autoAcceptStockChange=true (post modal ¿Confirmar con BO?)
      // + waitlistOrigenId (porque viene desde "Pasar a Pendientes" en la lista).
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd-brobro-538',
          cardCode: 'C001',
          clientName: 'BROBRO SRL',
          origen: 'manual',
          lines: [{ sku: 'SKU-A', cantidad: 5, precio: 1000 }],
          clientVersion: 'v1435',
          autoAcceptStockChange: true,
          waitlistOrigenId: 'wl-origen-123',
        }
      );

      // Esperado: pedido creado con 2 confirmed + 3 BO, waitlist marcada
      // consumed. SIN "Firestore transactions require all reads before writes".
      expect(r.ok).toBe(true);
      expect(r.pedidoId).toBeTruthy();
      expect(r.lines[0].qtyConfirmed).toBe(2);
      expect(r.lines[0].qtyBO).toBe(3);
      expect(r.diffVsClient).toBeTruthy();

      // Pedido persistido.
      const pedidoWrite = _written.find((w) => w.path.startsWith('pedidos/'));
      expect(pedidoWrite).toBeTruthy();
      expect(pedidoWrite.data.stage).toBe('confirmed');

      // Waitlist origen marcada consumed dentro de la MISMA transacción.
      const wlUpdate = _written.find((w) => w.path === 'revision_waitlist/wl-origen-123');
      expect(wlUpdate).toBeTruthy();
      expect(wlUpdate.data.stage).toBe('consumed');
      expect(wlUpdate.data.closedReason).toBe('consumed_by_commitPedidoCF');
    });

    it('retry CPST (origen=cpst) con asigRefs persiste pedido + cancela ASIG sin error', async () => {
      // Caso: VDE confirma un pedido CPST desde Stock Asignado. Hay ASIG
      // originales que deben cancelarse en la misma transacción. El retry
      // (post STOCK_CHANGED acepta) manda autoAcceptStockChange=true.
      const state = baseStateWithStock('SKU-B', 3, [
        {
          _fsId: 'ped-origen-A',
          _id: 'ped-origen-A',
          clientCardCode: 'C002',
          closedAt: null,
          stage: 'confirmed',
          lines: [
            {
              code: 'SKU-B',
              qty: 5,
              qtyOpen: 5,
              state: 'ASIG',
              asigAt: new Date('2026-10-22T10:00:00Z').toISOString(),
            },
          ],
        },
      ]);
      state.revision_waitlist['wl-cpst-999'] = {
        _id: 'wl-cpst-999',
        clientCardCode: 'C002',
        source: 'stock-asignado-batch',
        stage: 'draft',
        closedAt: null,
      };

      const { fbDb, _written } = makeStrictMockDb(state);
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd-cpst-999',
          cardCode: 'C002',
          clientName: 'DEVOTO CAMPING',
          origen: 'cpst',
          lines: [
            {
              sku: 'SKU-B',
              cantidad: 5,
              precio: 500,
              origenLinea: 'stock-asignado',
              asigRefs: [{ pedidoId: 'ped-origen-A', lineIndex: 0, qtyAsignada: 5, sku: 'SKU-B' }],
            },
          ],
          clientVersion: 'v1435',
          autoAcceptStockChange: true,
          waitlistOrigenId: 'wl-cpst-999',
        }
      );

      expect(r.ok).toBe(true);
      expect(r.pedidoId).toBeTruthy();

      // Pedido nuevo persistido.
      const pedidoWrite = _written.find(
        (w) => w.path.startsWith('pedidos/') && w.path !== 'pedidos/ped-origen-A'
      );
      expect(pedidoWrite).toBeTruthy();

      // ASIG origen cancelada en la misma transacción.
      const asigCancel = _written.find((w) => w.path === 'pedidos/ped-origen-A');
      expect(asigCancel).toBeTruthy();
      expect(Array.isArray(asigCancel.data.lines)).toBe(true);
      expect(asigCancel.data.lines[0].state).toBe('cancelled');
      expect(asigCancel.data.lines[0].closedReason).toBe('waitlist-confirm');

      // Waitlist origen marcada consumed.
      const wlUpdate = _written.find((w) => w.path === 'revision_waitlist/wl-cpst-999');
      expect(wlUpdate).toBeTruthy();
      expect(wlUpdate.data.stage).toBe('consumed');
    });

    it('error "all reads before all writes" NO aparece en el log de retries', async () => {
      // Captura logs en vez de output real: si el bug está activo, el log
      // emitiría `commitPedidoCore retry` 5 veces con el error de Firestore.
      // Post-fix: no debe haber ningún retry por este motivo.
      const state = baseStateWithStock('SKU-C', 1, []);
      state.revision_waitlist['wl-x'] = {
        _id: 'wl-x',
        clientCardCode: 'C003',
        stage: 'draft',
        closedAt: null,
      };
      const { fbDb } = makeStrictMockDb(state);
      const logs = [];

      const r = await commitPedidoCore(
        {
          fbDb,
          now: () => nowRef,
          log: (msg, data) => logs.push({ msg, data }),
        },
        {
          draftId: 'd-no-retry',
          cardCode: 'C003',
          origen: 'manual',
          lines: [{ sku: 'SKU-C', cantidad: 3, precio: 100 }],
          clientVersion: 'v1435',
          autoAcceptStockChange: true,
          waitlistOrigenId: 'wl-x',
        }
      );

      expect(r.ok).toBe(true);
      const readsBeforeWritesRetries = logs.filter(
        (l) =>
          l.msg === 'commitPedidoCore retry' &&
          l.data &&
          /reads to be executed before all writes/i.test(l.data.err || '')
      );
      expect(readsBeforeWritesRetries).toHaveLength(0);
    });

    it('STOCK_CHANGED en PRIMER intento sigue tirando correctamente (no persiste)', async () => {
      // Regresión: el fix NO debe romper el throw STOCK_CHANGED. En el
      // primer intento (sin autoAcceptStockChange), el CF debe rechazar
      // SIN persistir nada.
      const state = baseStateWithStock('SKU-D', 2, []);
      state.revision_waitlist['wl-y'] = {
        _id: 'wl-y',
        clientCardCode: 'C004',
        stage: 'draft',
        closedAt: null,
      };
      const { fbDb, _written } = makeStrictMockDb(state);

      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef },
        {
          draftId: 'd-first',
          cardCode: 'C004',
          origen: 'manual',
          lines: [{ sku: 'SKU-D', cantidad: 5, precio: 100 }],
          clientVersion: 'v1435',
          autoAcceptStockChange: false,
          waitlistOrigenId: 'wl-y',
        }
      );

      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('STOCK_CHANGED');

      // Nada persistido.
      expect(_written).toHaveLength(0);
    });
  });

  describe('operations_log registra ambos intentos (gate de observabilidad)', () => {
    it('log recibe entry por cada attempt del core (OK path)', async () => {
      const state = baseStateWithStock('SKU-E', 10, []);
      state.revision_waitlist['wl-ok'] = {
        _id: 'wl-ok',
        clientCardCode: 'C005',
        stage: 'draft',
        closedAt: null,
      };
      const { fbDb } = makeStrictMockDb(state);
      const logs = [];
      const r = await commitPedidoCore(
        { fbDb, now: () => nowRef, log: (msg, data) => logs.push({ msg, data }) },
        {
          draftId: 'd-ok',
          cardCode: 'C005',
          origen: 'manual',
          lines: [{ sku: 'SKU-E', cantidad: 3, precio: 100 }],
          clientVersion: 'v1435',
          autoAcceptStockChange: true,
          waitlistOrigenId: 'wl-ok',
        }
      );
      expect(r.ok).toBe(true);
      const okLog = logs.find((l) => l.msg === 'commitPedidoCore OK');
      expect(okLog).toBeTruthy();
      expect(okLog.data.pedidoId).toBe(r.pedidoId);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  AUTO_CONFIRM_RESULT,
  autoConfirmPendingPedidos,
} from '../../functions/core/auto-confirm-pending-core.js';

// v921 (2026-09-14): tests del auto-confirm de pedidos estancados en pending.
// El core no depende de admin SDK real — mockeamos fbDb + FieldValue con un
// stub minimal que replica el subset usado (collection/doc/get/update/add,
// where/orderBy/limit + forEach).

const NOW_MS = new Date('2026-09-14T14:00:00.000Z').getTime();
const nowFn = () => NOW_MS;

function makeFbDbStub({
  pedidos = [],
  config = null,
  stockSnapshot = null,
  updateHooks = {},
} = {}) {
  const store = {
    pedidos: pedidos.map((p) => ({ ...p, data: { ...p.data } })),
    notifications: [],
    updatesLog: [],
    stockSnapshot,
  };
  // Mutex serial para runTransaction (ver fake de invoice-sync.test.js).
  let txChain = Promise.resolve();
  const applyUpdate = async (id, patch) => {
    const hook = updateHooks[id];
    if (hook) await hook();
    const idx = store.pedidos.findIndex((p) => p.id === id);
    if (idx >= 0) {
      store.pedidos[idx].data = { ...store.pedidos[idx].data, ...patch };
    }
    store.updatesLog.push({ id, patch });
  };
  const db = {
    _store: store,
    doc(path) {
      if (path === 'app_config/auto_confirm') {
        return {
          _path: path,
          async get() {
            return {
              exists: !!config,
              data: () => config || {},
            };
          },
        };
      }
      if (path === 'app_config/stock_snapshot') {
        return {
          _path: path,
          async get() {
            return {
              exists: !!store.stockSnapshot,
              data: () => store.stockSnapshot || {},
            };
          },
        };
      }
      // pedidos/{id} directo (usado por runTransaction)
      if (path.startsWith('pedidos/')) {
        const id = path.split('/')[1];
        return {
          _path: path,
          async get() {
            const p = store.pedidos.find((x) => x.id === id);
            return { exists: !!p, data: () => (p ? p.data : {}) };
          },
          async update(patch) {
            await applyUpdate(id, patch);
          },
        };
      }
      return { _path: path, async get() {}, async update() {}, async set() {} };
    },
    collection(name) {
      if (name === 'pedidos') {
        const parent = this;
        return {
          doc(id) {
            return parent.doc(`pedidos/${id}`);
          },
          where(field, op, value) {
            // Soportamos stage=='pending' y closedAt==null
            const chain = {
              _filters: [{ field, op, value }],
              _orderBy: null,
              _limit: null,
              orderBy(f, dir) {
                chain._orderBy = { field: f, dir };
                return chain;
              },
              limit(n) {
                chain._limit = n;
                return chain;
              },
              async get() {
                let arr = store.pedidos.filter((p) => {
                  for (const f of chain._filters) {
                    if (f.op === '==') {
                      const v = p.data[f.field];
                      if (f.value === null) {
                        if (v !== null && v !== undefined) return false;
                      } else {
                        if (v !== f.value) return false;
                      }
                    }
                  }
                  return true;
                });
                if (chain._orderBy) {
                  const dir = chain._orderBy.dir === 'desc' ? -1 : 1;
                  arr = arr
                    .slice()
                    .sort(
                      (a, b) =>
                        String(a.data[chain._orderBy.field] || '').localeCompare(
                          String(b.data[chain._orderBy.field] || '')
                        ) * dir
                    );
                }
                if (chain._limit != null) arr = arr.slice(0, chain._limit);
                return {
                  size: arr.length,
                  forEach(cb) {
                    for (const p of arr) cb({ id: p.id, data: () => p.data });
                  },
                };
              },
            };
            return chain;
          },
        };
      }
      if (name === 'notifications') {
        return {
          async add(data) {
            store.notifications.push({ ...data });
            return { id: 'n_' + store.notifications.length };
          },
        };
      }
      return { doc: () => ({ async set() {}, async update() {} }) };
    },
    async runTransaction(fn) {
      const prev = txChain;
      let release;
      txChain = new Promise((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        /** @type {Array<{id:string, patch:any}>} */
        const pendingWrites = [];
        const tx = {
          async get(ref) {
            return ref.get();
          },
          update(ref, patch) {
            const p = ref._path;
            if (!p || !p.startsWith('pedidos/')) return;
            const id = p.split('/')[1];
            // Diferimos la escritura al commit (post-fn) para pasar por el
            // mismo applyUpdate (que respeta updateHooks para forzar errores).
            pendingWrites.push({ id, patch });
          },
          set(ref, data) {
            if (ref && ref._path === 'app_config/stock_snapshot') {
              store.stockSnapshot = { ...(store.stockSnapshot || {}), ...data };
            }
          },
        };
        const r = await fn(tx);
        // Commit — ejecuta los hooks (que pueden tirar error) y aplica.
        for (const w of pendingWrites) {
          await applyUpdate(w.id, w.patch);
        }
        return r;
      } finally {
        release();
      }
    },
  };
  return db;
}

const FieldValue = { serverTimestamp: () => 'FV.serverTimestamp()' };

function isoMinutesAgo(min) {
  return new Date(NOW_MS - min * 60 * 1000).toISOString();
}

function pedidoDoc(overrides = {}) {
  return {
    id: overrides.id || 'ped_' + Math.random().toString(36).slice(2, 8),
    data: {
      stage: 'pending',
      confirmedAt: isoMinutesAgo(15),
      lines: [{ code: 'X', qty: 1, state: 'confirmed' }],
      clientName: 'Cliente Test',
      ownerUid: 'uid_vde_1',
      month: 'sep-26',
      ...overrides.data,
    },
  };
}

describe('autoConfirmPendingPedidos', () => {
  it('SKIP_DISABLED cuando app_config/auto_confirm.enabled=false', async () => {
    const fbDb = makeFbDbStub({ config: { enabled: false } });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.result).toBe(AUTO_CONFIRM_RESULT.SKIP_DISABLED);
    expect(r.processed).toBe(0);
    expect(fbDb._store.updatesLog).toHaveLength(0);
  });

  it('NO_PEDIDOS cuando no hay pedidos que cumplan el timeout', async () => {
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({ id: 'reciente', data: { confirmedAt: isoMinutesAgo(3) } }),
        pedidoDoc({ id: 'reciente_2', data: { confirmedAt: isoMinutesAgo(8) } }),
      ],
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.result).toBe(AUTO_CONFIRM_RESULT.NO_PEDIDOS);
    expect(r.processed).toBe(0);
  });

  it('procesa un pedido con > 10 min en pending y lo pasa a confirmed', async () => {
    const fbDb = makeFbDbStub({
      pedidos: [pedidoDoc({ id: 'viejo_1', data: { confirmedAt: isoMinutesAgo(15) } })],
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.result).toBe(AUTO_CONFIRM_RESULT.PROCESSED);
    expect(r.processed).toBe(1);
    const updated = fbDb._store.pedidos.find((p) => p.id === 'viejo_1');
    expect(updated.data.stage).toBe('confirmed');
    expect(updated.data.finalizedAt).toBeTruthy();
    expect(updated.data.finalizedBy).toBe('auto/10min-timeout');
    expect(updated.data.autoConfirmed.reason).toBe('pending_timeout');
    expect(updated.data.autoConfirmed.minutesInPending).toBe(15);
  });

  it('escribe una notificación para el ownerUid del pedido', async () => {
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({
          id: 'viejo_2',
          data: { confirmedAt: isoMinutesAgo(12), ownerUid: 'uid_pachi', clientName: 'CANESTRARI' },
        }),
      ],
    });
    await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(fbDb._store.notifications).toHaveLength(1);
    expect(fbDb._store.notifications[0]).toMatchObject({
      type: 'auto_confirm_timeout',
      targetUid: 'uid_pachi',
      pedidoId: 'viejo_2',
      clientName: 'CANESTRARI',
      minutesInPending: 12,
      read: false,
    });
  });

  it('NO procesa pedidos con lines vacías (defensivo)', async () => {
    const fbDb = makeFbDbStub({
      pedidos: [pedidoDoc({ id: 'corrupto', data: { confirmedAt: isoMinutesAgo(20), lines: [] } })],
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.result).toBe(AUTO_CONFIRM_RESULT.NO_PEDIDOS);
    expect(r.processed).toBe(0);
  });

  it('NO procesa pedidos que ya tienen finalizedAt (evita doble-tick)', async () => {
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({
          id: 'ya_finalizado',
          data: { confirmedAt: isoMinutesAgo(30), finalizedAt: isoMinutesAgo(5) },
        }),
      ],
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.result).toBe(AUTO_CONFIRM_RESULT.NO_PEDIDOS);
  });

  it('NO procesa pedidos que ya tienen transferidoSAP.docNum', async () => {
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({
          id: 'ya_en_sap',
          data: {
            confirmedAt: isoMinutesAgo(30),
            transferidoSAP: { docNum: 12345, docEntry: 999 },
          },
        }),
      ],
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.result).toBe(AUTO_CONFIRM_RESULT.NO_PEDIDOS);
  });

  it('respeta el minutesTimeout custom del app_config', async () => {
    const fbDb = makeFbDbStub({
      config: { enabled: true, minutesTimeout: 30 },
      pedidos: [
        pedidoDoc({ id: 'quince', data: { confirmedAt: isoMinutesAgo(15) } }),
        pedidoDoc({ id: 'cuarenta', data: { confirmedAt: isoMinutesAgo(40) } }),
      ],
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.processed).toBe(1);
    expect(r.processedIds[0].id).toBe('cuarenta');
    // El de 15 min sigue en pending
    const quince = fbDb._store.pedidos.find((p) => p.id === 'quince');
    expect(quince.data.stage).toBe('pending');
  });

  it('procesa varios pedidos elegibles en la misma corrida y captura errores por pedido', async () => {
    // Fuerza error en el update del pedido 'b' via updateHooks del stub.
    // El tx.update(ref, patch) del fake difiere el write al commit, que
    // llama applyUpdate(id, patch); ahi applyUpdate corre el updateHooks[id]
    // y tira si esta seteado.
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({ id: 'a', data: { confirmedAt: isoMinutesAgo(20) } }),
        pedidoDoc({ id: 'b', data: { confirmedAt: isoMinutesAgo(11) } }),
      ],
      updateHooks: {
        b: async () => {
          throw new Error('boom');
        },
      },
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.processed).toBe(1);
    expect(r.processedIds[0].id).toBe('a');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].id).toBe('b');
  });

  it('STOCK: pedido con confirmed line y stock suficiente -> auto-confirm procede', async () => {
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({
          id: 'ok_stock',
          data: {
            clientCardCode: 'C001',
            confirmedAt: isoMinutesAgo(15),
            lines: [{ code: 'SKU-X', qty: 10, qtyOpen: 10, state: 'confirmed' }],
          },
        }),
      ],
      stockSnapshot: {
        warehouseBreakdown: JSON.stringify({ 'SKU-X': { 11: 10, 12: 0 } }),
      },
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.result).toBe(AUTO_CONFIRM_RESULT.PROCESSED);
    expect(r.processed).toBe(1);
    const updated = fbDb._store.pedidos.find((p) => p.id === 'ok_stock');
    expect(updated.data.stage).toBe('confirmed');
    expect(r.skippedForStock).toEqual([]);
  });

  it('STOCK: pedido con confirmed line y stock insuficiente -> AUTO-SPLIT (v1170)', async () => {
    // Pedido quiere 10, snapshot muestra solo 5 whs 11.
    // v1170 (2026-10-07): antes skippeaba; ahora auto-splittea (5 confirmed + 5 BO)
    // y confirma el pedido igual. Pedido Mariano.
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({
          id: 'short_stock',
          data: {
            clientCardCode: 'C001',
            confirmedAt: isoMinutesAgo(20),
            lines: [{ code: 'SKU-Y', qty: 10, qtyOpen: 10, state: 'confirmed', precio: 100 }],
          },
        }),
      ],
      stockSnapshot: {
        warehouseBreakdown: JSON.stringify({ 'SKU-Y': { 11: 5 } }),
      },
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.processed).toBe(1);
    // El pedido quedó confirmed con lines splitteadas.
    const promoted = fbDb._store.pedidos.find((p) => p.id === 'short_stock');
    expect(promoted.data.stage).toBe('confirmed');
    expect(promoted.data.autoSplitByStock).toBeTruthy();
    expect(promoted.data.autoSplitByStock.degradedCount).toBe(1);
    expect(promoted.data.autoSplitByStock.lostArs).toBe(500); // 5u * $100 = $500
    // Las lines deben ser: 1 confirmed(5) + 1 BO(5)
    const confirmed = promoted.data.lines.filter((l) => l.state === 'confirmed');
    const bo = promoted.data.lines.filter((l) => l.state === 'BO');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].qty).toBe(5);
    expect(bo).toHaveLength(1);
    expect(bo[0].qty).toBe(5);
    expect(bo[0].autoSplitFromConfirmed).toBe(true);
    // Y el array autoSplitProcessed del return debe tener info.
    expect(r.autoSplitProcessed).toHaveLength(1);
    expect(r.autoSplitProcessed[0]).toMatchObject({ id: 'short_stock', lostArs: 500 });
  });

  it('STOCK: stock whs 11 consumido por reservas de OTRO pedido confirmed -> AUTO-SPLIT (v1170)', async () => {
    // 10 fisicos, otro pedido reserva 7 (confirmed abierto). Nuevo quiere 5 ->
    // disponible neto = 10 - 7 = 3 < 5. v1170: auto-split 3 confirmed + 2 BO.
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({
          id: 'nuevo',
          data: {
            clientCardCode: 'C001',
            confirmedAt: isoMinutesAgo(15),
            lines: [{ code: 'SKU-Z', qty: 5, qtyOpen: 5, state: 'confirmed', precio: 1000 }],
          },
        }),
        {
          id: 'otro',
          data: {
            stage: 'confirmed',
            closedAt: null,
            clientCardCode: 'C002',
            confirmedAt: isoMinutesAgo(60),
            lines: [{ code: 'SKU-Z', qty: 7, qtyOpen: 7, state: 'confirmed' }],
          },
        },
      ],
      stockSnapshot: {
        warehouseBreakdown: JSON.stringify({ 'SKU-Z': { 11: 10 } }),
      },
    });
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.processed).toBe(1);
    expect(r.autoSplitProcessed).toHaveLength(1);
    expect(r.autoSplitProcessed[0].shortfalls[0]).toMatchObject({
      sku: 'SKU-Z',
      wanted: 5,
      available: 3,
    });
    const promoted = fbDb._store.pedidos.find((p) => p.id === 'nuevo');
    expect(promoted.data.stage).toBe('confirmed');
    const confirmed = promoted.data.lines.filter((l) => l.state === 'confirmed');
    const bo = promoted.data.lines.filter((l) => l.state === 'BO');
    expect(confirmed[0].qty).toBe(3);
    expect(bo[0].qty).toBe(2);
    expect(promoted.data.autoSplitByStock.lostArs).toBe(2000); // 2u * $1000
  });

  it('CONCURRENCIA: dos llamadas Promise.all con mismo pedido elegible -> solo UNO promueve stage', async () => {
    // Regression del race: dos ticks del scheduler coinciden, ambos filtran
    // el mismo pedido como eligible. Con runTransaction + check stage==='pending'
    // dentro del critical section, solo el primero gana.
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({
          id: 'conc_1',
          data: {
            clientCardCode: 'C001',
            confirmedAt: isoMinutesAgo(15),
            lines: [{ code: 'SKU-A', qty: 3, qtyOpen: 3, state: 'confirmed' }],
          },
        }),
      ],
      stockSnapshot: {
        warehouseBreakdown: JSON.stringify({ 'SKU-A': { 11: 100 } }),
      },
    });
    const [r1, r2] = await Promise.all([
      autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn }),
      autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn }),
    ]);
    // Solo uno promueve (el otro ve stage!='pending' en el tx y skippea).
    const totalProcessed = r1.processed + r2.processed;
    expect(totalProcessed).toBe(1);
    const final = fbDb._store.pedidos.find((p) => p.id === 'conc_1');
    expect(final.data.stage).toBe('confirmed');
    // El finalizedBy no se escribio dos veces (confirmable por un unico
    // update con stage='confirmed' en el log).
    const confirmUpdates = fbDb._store.updatesLog.filter(
      (u) => u.id === 'conc_1' && u.patch.stage === 'confirmed'
    );
    expect(confirmUpdates).toHaveLength(1);
  });
});

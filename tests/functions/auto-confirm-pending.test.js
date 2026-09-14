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

function makeFbDbStub({ pedidos = [], config = null } = {}) {
  const store = {
    pedidos: pedidos.map((p) => ({ ...p })),
    notifications: [],
    updatesLog: [],
  };
  return {
    _store: store,
    doc(path) {
      if (path === 'app_config/auto_confirm') {
        return {
          async get() {
            return {
              exists: !!config,
              data: () => config || {},
            };
          },
        };
      }
      // pedidos/{id} handled via collection().doc().update()
      return { async get() {}, async update() {}, async set() {} };
    },
    collection(name) {
      if (name === 'pedidos') {
        return {
          doc(id) {
            return {
              async update(patch) {
                const idx = store.pedidos.findIndex((p) => p.id === id);
                if (idx >= 0) {
                  store.pedidos[idx].data = { ...store.pedidos[idx].data, ...patch };
                }
                store.updatesLog.push({ id, patch });
              },
            };
          },
          where(field, op, value) {
            // Solo soportamos stage=='pending'
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
                    if (f.op === '==' && p.data[f.field] !== f.value) return false;
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
  };
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
    const fbDb = makeFbDbStub({
      pedidos: [
        pedidoDoc({ id: 'a', data: { confirmedAt: isoMinutesAgo(20) } }),
        pedidoDoc({ id: 'b', data: { confirmedAt: isoMinutesAgo(11) } }),
      ],
    });
    // Forzar error en el update del pedido 'b' para verificar que 'a' sigue
    // procesándose y el error queda registrado en r.errors.
    const origUpdate = fbDb.collection('pedidos').doc('b').update;
    fbDb.collection = ((orig) =>
      function collection(name) {
        const c = orig.call(this, name);
        if (name !== 'pedidos') return c;
        const origDoc = c.doc.bind(c);
        return {
          ...c,
          doc(id) {
            const d = origDoc(id);
            if (id === 'b') {
              return {
                ...d,
                async update() {
                  throw new Error('boom');
                },
              };
            }
            return d;
          },
        };
      })(fbDb.collection);
    const r = await autoConfirmPendingPedidos({ fbDb, FieldValue, now: nowFn });
    expect(r.processed).toBe(1);
    expect(r.processedIds[0].id).toBe('a');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].id).toBe('b');
  });
});

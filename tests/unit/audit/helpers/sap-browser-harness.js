/**
 * Arnés para ejecutar los caminos REALES de envío a SAP del navegador
 * (listener de auto-envío y envío manual) en Node:
 *  - Firestore en memoria (compat API) que emite un `modified` por CADA
 *    escritura al pedido (como onSnapshot sin includeMetadataChanges) y un
 *    `added` por pedido en el snapshot inicial; transacciones que releen.
 *  - Módulos reales: sap-service-layer (buildQuotationPayload), sap-admin-panel
 *    (enviarPedidosASAPViaServiceLayer) y sap-auto-send-listener.
 *  - Solo se simulan la red (createQuotation / findQuotationByNumAtCard /
 *    preCheckStockWhs11) y confirm().
 * No es el emulador de Firebase: la semántica de onSnapshot está modelada.
 */
export const DELETE = { __delete: true };
export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export const H = {
  store: new Map(),
  subs: [],
  createCalls: [],
  confirmCalls: [],
  confirmAnswer: true,
  createResult: () => ({ ok: true, status: 201, body: { DocNum: 900001, DocEntry: 1 } }),
  config: { commit_pedido: undefined },
};

function applyPatch(id, patch) {
  const cur = { ...(H.store.get(id) || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete cur[k];
    else if (v && typeof v === 'object' && Array.isArray(v.__arrayUnion)) {
      const arr = Array.isArray(cur[k]) ? cur[k].slice() : [];
      for (const x of v.__arrayUnion) arr.push(clone(x));
      cur[k] = arr;
    } else cur[k] = clone(v);
  }
  H.store.set(id, cur);
}
export function emit(id, type) {
  const data = H.store.get(id);
  if (!data || data.stage !== 'confirmed') return;
  const snap = { id, data: () => clone(data) };
  for (const cb of H.subs) cb({ docChanges: () => [{ type, doc: snap }] });
}
export function write(id, patch) {
  applyPatch(id, patch);
  queueMicrotask(() => emit(id, 'modified'));
  return new Promise((r) => setTimeout(r, 0));
}
export const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

export async function setupBrowserHarness() {
  const g = /** @type {any} */ (globalThis);
  g.window = g;
  g.userRole = 'admin';
  g.currentUser = { uid: 'admin1', email: 'admin@shimano.com.ar' };
  g.sapConfigCache = { autoSendSL: true, serviceLayer: {} };
  g.sapGetProductCode = (c) => c;
  g.sapGetSlpCodeForVendor = () => '';
  g.getVendorForKey = () => '';
  g.showSyncTag = () => {};
  g.alert = () => {};
  g.confirm = (msg) => {
    H.confirmCalls.push(msg);
    return H.confirmAnswer;
  };
  g.firebase = {
    firestore: {
      FieldValue: {
        delete: () => DELETE,
        arrayUnion: (...xs) => ({ __arrayUnion: xs }),
        serverTimestamp: () => 'ts',
      },
    },
  };
  const docRef = (path) => ({
    id: path.split('/').pop(),
    path,
    update: (patch) => write(path.split('/').pop(), patch),
    get: async () => {
      const key = path.split('/').pop();
      if (path.startsWith('app_config/')) {
        const v = H.config[key];
        if (v === 'throw') throw new Error('permission-denied');
        return { exists: v !== undefined, data: () => clone(v) };
      }
      return { exists: H.store.has(key), data: () => clone(H.store.get(key)) };
    },
  });
  g.fbDb = {
    doc: (path) => docRef(path),
    collection: (col) => ({
      doc: (id) => docRef(col + '/' + id),
      where: () => ({
        onSnapshot: (cb) => {
          H.subs.push(cb);
          queueMicrotask(() => {
            for (const id of H.store.keys()) {
              const d = H.store.get(id);
              if (d.stage === 'confirmed')
                cb({ docChanges: () => [{ type: 'added', doc: { id, data: () => clone(d) } }] });
            }
          });
          return () => {
            H.subs = H.subs.filter((s) => s !== cb);
          };
        },
      }),
    }),
    runTransaction: async (fn) => {
      const pending = [];
      const tx = {
        get: async (r) => ({
          exists: H.store.has(r.id),
          data: () => clone(H.store.get(r.id) || {}),
        }),
        update: (r, patch) => pending.push([r.id, patch]),
      };
      const out = await fn(tx);
      for (const [id, patch] of pending) {
        applyPatch(id, patch);
        queueMicrotask(() => emit(id, 'modified'));
      }
      return out;
    },
  };
  await import('../../../../src/domains/sap-service-layer.js');
  await import('../../../../src/domains/sap-admin-panel.js');
  // sap-admin-panel define su propio sapGetClienteCode (mapa); fijamos uno.
  g.sapGetClienteCode = () => 'C0001';
  const sl = g.sapSL;
  sl.isEnabled = () => true;
  sl.findQuotationByNumAtCard = async () => ({ ok: false });
  sl.preCheckStockWhs11 = async () => ({ ok: false });
  sl.createQuotation = async (payload) => {
    H.createCalls.push(clone(payload));
    return H.createResult(payload);
  };
  await import('../../../../src/domains/sap-auto-send-listener.js');
}

export function startListener() {
  /** @type {any} */ (globalThis).ensureSapAutoSendListener();
}
export function stopListener() {
  const g = /** @type {any} */ (globalThis);
  if (g._unsubAutoSendPedidos) g._unsubAutoSendPedidos();
  g._unsubAutoSendPedidos = null;
}
export function resetHarness() {
  stopListener();
  H.store.clear();
  H.subs = [];
  H.createCalls = [];
  H.confirmCalls = [];
  H.confirmAnswer = true;
  H.config = { commit_pedido: undefined };
  H.createResult = () => ({ ok: true, status: 201, body: { DocNum: 900001, DocEntry: 1 } });
}

export function pedido(over = {}) {
  return {
    stage: 'confirmed',
    clientName: 'CLIENTE X',
    orderNumber: 777,
    month: 'Noviembre',
    ownerEmail: 'v@shimano.com.ar',
    confirmedAt: '2026-11-03T12:00:00.000Z',
    discountPct: 17,
    lines: [{ code: 'SKU1', qty: 2, precio: 1000, state: 'confirmed' }],
    ...over,
  };
}

/** Escritura exacta del patch 4xx en la CF (rama 4xx). */
export const cfReject = (
  id,
  { status = 400, sapCode = '10000724', discountRejected = true, msg } = {}
) =>
  write(id, {
    sendingSapLock: DELETE,
    transferError: {
      message: msg || 'Value in Discount field is greater than permitted',
      at: '2026-11-03T12:00:05.000Z',
      via: 'cf_auto',
      status,
      sapCode,
      discountRejected,
      discountPercentSent: discountRejected ? 17 : 0,
    },
  });

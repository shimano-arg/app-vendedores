// @ts-check
/**
 * §64.3 (2026-10-25) — draft lock atómico previene duplicados por
 * doble-click concurrente.
 *
 * ANTECEDENTE (SATO 2026-10-23)
 * Dos commits con mismo _draftId separados por 2 segundos crearon dos
 * pedidos. `findExistingByDraftId` pre-tx tiene race: el query del segundo
 * commit no ve al primero porque todavía no se commiteó. Resultado:
 * qlB4FpI3R9Rhu5sLZvbf (duplicado) + 6LhigQdzUmEcOHcRUEjl (original).
 *
 * FIX
 * Colección `pedido_draft_locks/{draftId}`. En `commitInTransaction`:
 *   1. tx.get(lockRef) al inicio (parte de los READS).
 *   2. Si lock existe → return idempotentHit con pedidoId del lock.
 *   3. Si no → continuar flow + tx.set(lockRef, {pedidoId}) atómico con el
 *      tx.set(pedidoRef).
 *
 * Firestore serializa 2 txns en el mismo doc. La segunda tx ve el lock de
 * la primera (o es ABORTED + retry que ve el lock). Garantiza unicidad.
 *
 * TESTS
 *   T1 — commit único: pedido creado + lock escrito.
 *   T2 — 2 commits mismo draftId SECUENCIALES: 2do idempotent hit por lock.
 *   T3 — 2 commits mismo draftId CONCURRENTES: solo 1 pedido creado.
 *   T4 — findExistingByDraftId pre-tx sigue funcionando (fast path).
 *   T5 — lock se escribe atómicamente con el pedido (no en races).
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/** Mock Firestore con simulación de concurrencia a nivel de txn.
 *
 * runTransaction en el mock se serializa con un mutex (una tx a la vez), igual
 * que Firestore real sobre docs en conflicto. Sin serialización, Promise.all
 * de 2 txns correría ambas en paralelo y crearía 2 pedidos — el mock no
 * reflejaría la semántica real. §58 (ALL reads before ALL writes) también
 * requiere que los `tx.set/update` no visibles cross-tx hasta `commit`.
 */
function makeMockDb(fixture) {
  const state = fixture || {};
  const txWriteLog = [];
  // Mutex para serializar runTransaction (match Firestore real behavior).
  let txLockP = Promise.resolve();
  const makeDoc = (col, id) => ({
    id,
    _path: `${col}/${id}`,
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
    async add(data) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = data;
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
        // Serializa concurrent runTransaction para match Firestore real:
        // sobre un lock de doc, Firestore procesa 1 tx a la vez. La segunda
        // tx ve los writes de la primera después del commit.
        const prev = txLockP;
        let release;
        txLockP = new Promise((r) => {
          release = r;
        });
        try {
          await prev;
          const tx = {
            async get(ref) {
              return ref.get();
            },
            set(ref, data) {
              txWriteLog.push({ path: ref._path, data });
              return ref.set(data);
            },
            update(ref, data) {
              return ref.update(data);
            },
            delete(ref) {
              return ref.delete();
            },
          };
          return await fn(tx);
        } finally {
          release();
        }
      },
    },
    _state: state,
    _txWriteLog: txWriteLog,
  };
}

const nowRef = new Date('2026-10-25T20:00:00Z');

function baseState() {
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: JSON.stringify({ 'SKU-A': { 11: 10 } }),
      },
    },
    pedidos: {},
    pedido_draft_locks: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

const BASE_PAYLOAD = {
  draftId: 'C|BUENOS AIRES|ESCOBAR|TEST CLIENT|999',
  cardCode: 'C001',
  clientName: 'TEST',
  origen: 'manual',
  lines: [{ sku: 'SKU-A', cantidad: 2, precio: 100 }],
  clientVersion: 'v1449',
  ownerUid: 'U1',
  ownerEmail: 'u1@test.com',
};

describe('§64.3 draft lock atómico — prevención de doble-click concurrente', () => {
  it('T1 — commit único: pedido + lock creados', async () => {
    const { fbDb, _state } = makeMockDb(baseState());
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, BASE_PAYLOAD);
    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBeTruthy();
    // Lock creado con pedidoId.
    const lock = _state.pedido_draft_locks[BASE_PAYLOAD.draftId];
    expect(lock).toBeTruthy();
    expect(lock.pedidoId).toBe(r.pedidoId);
    expect(lock.draftId).toBe(BASE_PAYLOAD.draftId);
    expect(lock.cardCode).toBe('C001');
  });

  it('T2 — 2 commits mismo draftId SECUENCIALES: 2do idempotent via lock', async () => {
    const mock = makeMockDb(baseState());
    const r1 = await commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, BASE_PAYLOAD);
    expect(r1.ok).toBe(true);
    const firstPedidoId = r1.pedidoId;
    // 2do commit con mismo draftId.
    const r2 = await commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, BASE_PAYLOAD);
    expect(r2.ok).toBe(true);
    expect(r2.pedidoId).toBe(firstPedidoId); // mismo pedido
    expect(r2.idempotentHit).toBe(true);
    // Solo 1 pedido en el estado.
    expect(Object.keys(mock._state.pedidos).length).toBe(1);
    // 1 solo lock.
    expect(Object.keys(mock._state.pedido_draft_locks).length).toBe(1);
  });

  it('T3 — 2 commits mismo draftId CONCURRENTES: 1 solo pedido', async () => {
    const mock = makeMockDb(baseState());
    // Promise.all simula concurrencia (en orden de arranque, no de completion).
    const [r1, r2] = await Promise.all([
      commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, BASE_PAYLOAD),
      commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, BASE_PAYLOAD),
    ]);
    // Ambos retornan ok (uno es creación, el otro es idempotent hit).
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Deben compartir pedidoId.
    expect(r1.pedidoId).toBe(r2.pedidoId);
    // Solo 1 pedido creado.
    const pedidos = Object.values(mock._state.pedidos);
    expect(pedidos.length).toBe(1);
    // 1 solo lock.
    expect(Object.keys(mock._state.pedido_draft_locks).length).toBe(1);
  });

  it('T4 — findExistingByDraftId pre-tx (fast path) sigue andando', async () => {
    const state = baseState();
    // Pre-poblar pedido con _draftId (simulando flow legacy pedidos.add previo).
    state.pedidos['legacyPedido'] = {
      _draftId: BASE_PAYLOAD.draftId,
      clientCardCode: 'C001',
      lines: [{ code: 'SKU-A', qty: 2, state: 'confirmed' }],
      stage: 'confirmed',
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, BASE_PAYLOAD);
    expect(r.ok).toBe(true);
    expect(r.idempotentHit).toBe(true);
    expect(r.pedidoId).toBe('legacyPedido');
  });

  it('T5 — lock se escribe DENTRO del tx (atomic con pedido)', async () => {
    const mock = makeMockDb(baseState());
    const r = await commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, BASE_PAYLOAD);
    expect(r.ok).toBe(true);
    // El writeLog debe tener tx.set tanto para el pedido como para el lock.
    const writes = mock._txWriteLog;
    const pedidoWrite = writes.find(
      (w) => w.path.startsWith('pedidos/') && w.data.clientCardCode === 'C001'
    );
    const lockWrite = writes.find((w) => w.path === `pedido_draft_locks/${BASE_PAYLOAD.draftId}`);
    expect(pedidoWrite).toBeTruthy();
    expect(lockWrite).toBeTruthy();
    expect(lockWrite.data.pedidoId).toBe(pedidoWrite.path.split('/')[1]);
  });

  it('T12 (§105) — doble-click CPST concurrente NO cancela ASIG dos veces', async () => {
    // Fixture CPST: pedido origen con 1 ASIG qtyOpen=3; 2 commits CONCURRENTES
    // con mismo draftId y mismo waitlistOrigenId intentan crear el pedido derivado.
    // Invariante: draft lock (§64.3) garantiza 1 pedido creado; §105 garantiza
    // que la ASIG se cancela EXACTAMENTE una vez (qtyCancelled=3, no 6).
    const state = baseState();
    state.app_config.stock_snapshot.warehouseBreakdown = JSON.stringify({
      'SKU-ASIG': { 11: 10 },
    });
    state.pedidos.origen_pid = {
      clientCardCode: 'C001',
      clientName: 'TEST',
      closedAt: null,
      createdAt: '2026-10-15T00:00:00.000Z',
      stage: 'confirmed',
      lines: [
        {
          code: 'SKU-ASIG',
          state: 'ASIG',
          qty: 3,
          qtyOpen: 3,
          qtyCancelled: 0,
          asigAt: '2026-10-20T00:00:00.000Z',
          asigReserva: true,
        },
      ],
      _backfill: {},
    };
    state.revision_waitlist.wl = {
      clientCardCode: 'C001',
      stage: 'pending',
      closedAt: null,
      source: 'stock-asignado-batch',
    };
    const mock = makeMockDb(state);
    const payload = {
      draftId: 'C|AR|CABA|TEST|540',
      cardCode: 'C001',
      clientName: 'TEST',
      origen: 'cpst',
      lines: [
        {
          sku: 'CPST_LINE',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 0, sku: 'SKU-ASIG', qtyAsignada: 3 }],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      waitlistOrigenId: 'wl',
      source: 'stock-asignado-batch',
      autoAcceptStockChange: true,
    };

    const [r1, r2] = await Promise.all([
      commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, payload),
      commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, payload),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Exactamente 1 pedido derivado creado (draft lock §64.3).
    const derivados = Object.keys(mock._state.pedidos).filter((k) => k !== 'origen_pid');
    expect(derivados.length).toBe(1);
    expect(r1.pedidoId).toBe(r2.pedidoId);
    // La ASIG se canceló EXACTAMENTE una vez. qtyCancelled=3 (no 6 = doble).
    const origenLine = mock._state.pedidos.origen_pid.lines[0];
    expect(origenLine.state).toBe('cancelled');
    expect(origenLine.qtyOpen).toBe(0);
    expect(origenLine.qtyCancelled).toBe(3);
  });

  it('T6 — lock existe pero pedido NO (edge: rollback parcial) → crea nuevo pedido', async () => {
    const state = baseState();
    // Lock huérfano: pedidoId apunta a un pedido inexistente (edge borde raro).
    // Comportamiento vigente desde v1469 (5f4c3d88, 2026-10-26, "T6 lock
    // huérfano: pedidoSnap.exists check + fall-through"): implementa la
    // "mejoría futura" que documentaba CLAUDE.md §64.3. Si el pedido del lock
    // NO existe, el lock se trata como huérfano, se sigue el flow normal y el
    // tx.set final sobre-escribe el lock con el pedidoId nuevo. Antes de v1469
    // devolvía idempotentHit=true con lines=[] (y los retries morían contra un
    // lock dejado por una tx que crasheó mid-write).
    state.pedido_draft_locks[BASE_PAYLOAD.draftId] = {
      pedidoId: 'ghostPedido',
      draftId: BASE_PAYLOAD.draftId,
    };
    const mock = makeMockDb(state);
    const r = await commitPedidoCore({ fbDb: mock.fbDb, now: () => nowRef }, BASE_PAYLOAD);
    expect(r.ok).toBe(true);
    expect(r.idempotentHit).toBeFalsy();
    expect(r.pedidoId).toBeTruthy();
    expect(r.pedidoId).not.toBe('ghostPedido');
    // Se creó un pedido nuevo y el lock ahora apunta a él.
    expect(mock._state.pedidos[r.pedidoId]).toBeTruthy();
    expect(mock._state.pedido_draft_locks[BASE_PAYLOAD.draftId].pedidoId).toBe(r.pedidoId);
  });
});

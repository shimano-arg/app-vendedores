// @ts-check
/**
 * §105 (fix doble tx.update, informes 029/030/031/032/033) — tests de
 * regresión del bug "doble tx.update sobre el mismo pedido origen con
 * snapshots independientes → el 2do update sobrescribía al 1ro".
 *
 * CAUSA RAIZ (confirmada en informes 029/030):
 *   - `cancelAsigRefsFromPrefetched` emitía tx.update(snap.ref, {lines:cancel})
 *   - El bloque §J v1455 emitía tx.update(snap.ref, {lines:absorb, _backfill})
 *   - Ambos partían de snap.data.lines pre-write SIN coordinarse.
 *   - Firestore last-write-wins para el campo `lines` → el 2do pisaba al 1ro.
 *   - Resultado: 122 ASIG huérfanas en prod entre 2026-10-26 y 2026-11-05.
 *
 * FIX:
 *   - `pendingPedidoWrites` Map local a `commitInTransaction` acumula mutaciones.
 *   - Cancel ASIG y absorb BO del mismo pedido origen comparten el mismo
 *     entry del map; applyAbsorb opera sobre el array ya mutado por cancel.
 *   - `flushPendingPedidoWrites` emite UN solo tx.update por pedido origen.
 *   - Validaciones semánticas abortan la tx completa ante refs inválidas.
 *
 * MATRIZ DE TESTS (informe 032 §6):
 *   T-01 — Regresión principal: 15 ASIG + 2 BO mismo pedido origen → CONFIRM
 *          con las 15 ASIG canceladas + 2 BO absorbidas + 1 solo tx.update.
 *   T-02 — SKU mismatch                   → ABORT ASIG_REF_INVALID/SKU_MISMATCH
 *   T-03 — lineIndex fuera de rango       → ABORT ASIG_REF_INVALID/LINE_INDEX_INVALID
 *   T-04 — state != ASIG (ni cancelled)   → ABORT ASIG_REF_INVALID/STATE_MISMATCH
 *   T-05 — qtyAsignada > qtyOpen          → ABORT ASIG_REF_INVALID/QTY_INSUFFICIENT
 *   T-06 — Refs duplicadas con suma > qtyOpen → ABORT ASIG_REF_INVALID/QTY_INSUFFICIENT
 *   T-06b— Refs duplicadas con suma == qtyOpen → CONFIRM (dedup + cancel único)
 *   T-06c— Refs duplicadas con SKUs distintos  → ABORT ASIG_REF_INVALID/SKU_CONFLICT_IN_DUPES
 *   T-07 — Línea ya cancelled (idempotencia)   → CONFIRM con skip (no incrementa qtyCancelled)
 *   T-08 — ASIG + BO mismo pedido (variante) → CONFIRM con 1 tx.update
 *   T-11 — Composición cancel→absorb (R11 reformulado) → CONFIRM; absorb opera sobre pending.newLines.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock Firestore con semántica fiel al SDK:
 *   - Cada tx.update se aplica inmediatamente a `state` con spread merge.
 *   - Si dos tx.update tocan el mismo campo del mismo doc, el 2do reemplaza
 *     el campo (equivalente a Firestore last-write-wins). Esto se verifica
 *     directamente leyendo `state[col][id].lines` al final.
 *   - Snapshots via tx.get() son copias defensivas del estado al momento
 *     de la lectura (snap.data() devuelve clon por valor).
 *   - `_opsLog` registra cada op para inspección.
 */
function makeMockDb(fixture) {
  const state = fixture || {};
  const _opsLog = [];

  const makeDoc = (col, id) => ({
    id,
    _path: `${col}/${id}`,
    async get() {
      const d = state[col]?.[id];
      // Copia defensiva: snap.data() no debe reflejar mutaciones posteriores.
      const cloned = d ? JSON.parse(JSON.stringify(d)) : null;
      return { exists: !!d, data: () => cloned };
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
        // Firestore semantics: si la updateFunction tira, TODA la tx rolea.
        // Capturamos el estado ANTES y restauramos si hay excepción.
        // (Conservamos _opsLog para inspección pero marcamos las ops como
        // rolled back si hubo error.)
        const snapshotState = JSON.parse(JSON.stringify(state));
        const opsBefore = _opsLog.length;
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
        try {
          return await fn(tx);
        } catch (e) {
          // Rollback: restaurar estado al snapshot previo.
          for (const k of Object.keys(state)) delete state[k];
          for (const [k, v] of Object.entries(snapshotState)) {
            state[k] = v;
          }
          // Marcar ops post-snapshot como rolled-back (observable en _opsLog).
          for (let i = opsBefore; i < _opsLog.length; i++) {
            _opsLog[i].rolledBack = true;
          }
          throw e;
        }
      },
    },
    _state: state,
    _opsLog,
  };
}

const nowRef = new Date('2026-11-13T15:00:00Z');

/** Fixture base con N ASIG + M BO del mismo cliente en el pedido origen. */
function makePedidoOrigen({ asigCount = 15, boCount = 2, cliente = 'C001' } = {}) {
  const lines = [];
  for (let i = 0; i < asigCount; i++) {
    lines.push({
      code: 'ASIG_SKU_' + i,
      state: 'ASIG',
      qty: 3,
      qtyOpen: 3,
      qtyInvoiced: 0,
      qtyCancelled: 0,
      asigAt: '2026-11-10T02:00:00.000Z',
      asigReserva: true,
    });
  }
  for (let i = 0; i < boCount; i++) {
    lines.push({
      code: 'BO_SKU_' + i,
      state: 'BO',
      qty: 2,
      qtyOpen: 2,
      qtyInvoiced: 0,
      qtyCancelled: 0,
    });
  }
  return {
    clientCardCode: cliente,
    clientName: 'TEST CLIENT',
    closedAt: null,
    lines,
    _backfill: {},
    createdAt: '2026-11-01T00:00:00.000Z',
    stage: 'confirmed',
  };
}

function baseState({ asigCount = 15, boCount = 2, backfill = {} } = {}) {
  const pedOrigen = makePedidoOrigen({ asigCount, boCount });
  pedOrigen._backfill = backfill;
  // Warehouse breakdown para los SKUs de BO y ASIG (gate STOCK_CHANGED).
  const wh = {};
  for (let i = 0; i < Math.max(asigCount, 20); i++) wh['ASIG_SKU_' + i] = { 11: 10 };
  for (let i = 0; i < Math.max(boCount, 20); i++) wh['BO_SKU_' + i] = { 11: 10 };
  wh['ASIG_SKU_CPST'] = { 11: 10 };
  wh['SKU_CPST'] = { 11: 10 };
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown: JSON.stringify(wh),
      },
    },
    pedidos: {
      origen_pid: pedOrigen,
    },
    pedido_draft_locks: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {
      waitlist_pid: {
        clientCardCode: 'C001',
        clientName: 'TEST CLIENT',
        stage: 'pending',
        closedAt: null,
        source: 'stock-asignado-batch',
        createdAt: '2026-11-13T14:00:00.000Z',
        items: [],
      },
    },
  };
}

/** Payload base: CPST con N asigRefs sobre ASIG + M lines confirmed que absorben BO. */
function makePayload({ asigCount = 15, boCount = 2, cliente = 'C001' } = {}) {
  const asigRefs = [];
  for (let i = 0; i < asigCount; i++) {
    asigRefs.push({
      pedidoId: 'origen_pid',
      lineIndex: i,
      sku: 'ASIG_SKU_' + i,
      qtyAsignada: 3,
    });
  }
  // Lines del payload: una línea CPST con todos los asigRefs + M lines "confirmed"
  // de BO SKUs que el absorb §J puede capturar.
  const lines = [
    { sku: 'ASIG_SKU_CPST', cantidad: 1, precio: 100, origenLinea: 'stock-asignado', asigRefs },
  ];
  for (let i = 0; i < boCount; i++) {
    lines.push({ sku: 'BO_SKU_' + i, cantidad: 2, precio: 100 });
  }
  return {
    draftId: 'C|TEST|TEST|TEST|T01-' + Math.random().toString(36).slice(2, 6),
    cardCode: cliente,
    clientName: 'TEST CLIENT',
    origen: 'cpst',
    lines,
    clientVersion: 'v1600',
    ownerUid: 'U1',
    ownerEmail: 'u1@test.com',
    waitlistOrigenId: 'waitlist_pid',
    source: 'stock-asignado-batch',
  };
}

describe('§105 fix doble tx.update — regresión del bug de las 122 ASIG huérfanas', () => {
  it('T-01 — Regresión principal: 15 ASIG + 2 BO mismo pedido origen → 1 solo tx.update, 15 cancelled, 2 absorbidas', async () => {
    const { fbDb, _state, _opsLog } = makeMockDb(baseState({ asigCount: 15, boCount: 2 }));
    const payload = makePayload({ asigCount: 15, boCount: 2 });

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);

    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBeTruthy();

    // Estado final del pedido origen.
    const origen = _state.pedidos.origen_pid;
    expect(origen).toBeTruthy();

    // 15 ASIG → canceladas con qtyOpen=0.
    for (let i = 0; i < 15; i++) {
      const line = origen.lines[i];
      expect(line.state, `ASIG_SKU_${i} should be cancelled`).toBe('cancelled');
      expect(line.qtyOpen, `ASIG_SKU_${i}.qtyOpen should be 0`).toBe(0);
      // qtyCancelled += qtyOpen (3) — línea tenía qty=3 qtyOpen=3.
      expect(line.qtyCancelled, `ASIG_SKU_${i}.qtyCancelled should be 3`).toBe(3);
      expect(line.closedReason, `ASIG_SKU_${i}.closedReason`).toBe('waitlist-confirm');
    }

    // 2 BO → absorbidas con qtyOpen=0.
    for (let i = 15; i < 17; i++) {
      const line = origen.lines[i];
      expect(line.qtyOpen, `BO line ${i} should have qtyOpen=0 (absorbed)`).toBe(0);
    }

    // _backfill contiene J_bo_absorbed_*.
    expect(origen._backfill).toBeTruthy();
    const bkKeys = Object.keys(origen._backfill);
    const jbo = bkKeys.filter((k) => k.startsWith('J_bo_absorbed_'));
    expect(jbo.length, 'should have one J_bo_absorbed_* key').toBeGreaterThanOrEqual(1);

    // VERIFICACIÓN CORE: exactamente 1 tx.update sobre pedidos/origen_pid.
    const updatesOrigen = _opsLog.filter(
      (o) => o.path === 'pedidos/origen_pid' && o.type === 'update'
    );
    expect(updatesOrigen.length, 'exactly 1 tx.update over pedido origen').toBe(1);
  });

  it('T-02 — SKU mismatch: payload asigRef sku="SKU_Y" apuntando a line con code="SKU_X" → ABORT SKU_MISMATCH', async () => {
    const { fbDb, _state } = makeMockDb(baseState({ asigCount: 1, boCount: 0 }));
    _state.pedidos.origen_pid.lines[0].code = 'SKU_X';

    const payload = {
      draftId: 'DRAFT-T02',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 0, sku: 'SKU_Y', qtyAsignada: 3 }],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data?.reason).toBe('SKU_MISMATCH');
    expect(r.data?.expectedSku).toBe('SKU_Y');
    expect(r.data?.actualSku).toBe('SKU_X');

    // Verificar que el pedido derivado NO se creó.
    const pedidosKeys = Object.keys(_state.pedidos).filter((k) => k !== 'origen_pid');
    expect(pedidosKeys.length).toBe(0);

    // Línea origen intacta.
    expect(_state.pedidos.origen_pid.lines[0].state).toBe('ASIG');
    expect(_state.pedidos.origen_pid.lines[0].qtyOpen).toBe(3);
  });

  it('T-03 — lineIndex fuera de rango (lineIndex=50 en array de 10) → ABORT LINE_INDEX_INVALID', async () => {
    const { fbDb, _state } = makeMockDb(baseState({ asigCount: 10, boCount: 0 }));
    const payload = {
      draftId: 'DRAFT-T03',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 50, sku: 'ASIG_SKU_5', qtyAsignada: 1 }],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data?.reason).toBe('LINE_INDEX_INVALID');
    expect(r.data?.arrayLength).toBe(10);
  });

  it('T-04 — Línea con state="invoiced" (no ASIG ni cancelled) → ABORT STATE_MISMATCH', async () => {
    const { fbDb, _state } = makeMockDb(baseState({ asigCount: 1, boCount: 0 }));
    _state.pedidos.origen_pid.lines[0] = {
      code: 'ASIG_SKU_0',
      state: 'invoiced',
      qty: 3,
      qtyOpen: 0,
      qtyInvoiced: 3,
      qtyCancelled: 0,
    };

    const payload = {
      draftId: 'DRAFT-T04',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 0, sku: 'ASIG_SKU_0', qtyAsignada: 2 }],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data?.reason).toBe('STATE_MISMATCH');
    expect(r.data?.actualState).toBe('invoiced');
  });

  it('T-05 — qtyAsignada > qtyOpen → ABORT QTY_INSUFFICIENT', async () => {
    const { fbDb, _state } = makeMockDb(baseState({ asigCount: 1, boCount: 0 }));
    _state.pedidos.origen_pid.lines[0].qtyOpen = 2;

    const payload = {
      draftId: 'DRAFT-T05',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 0, sku: 'ASIG_SKU_0', qtyAsignada: 5 }],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data?.reason).toBe('QTY_INSUFFICIENT');
    expect(r.data?.qtyOpen).toBe(2);
    expect(r.data?.qtyAsignada).toBe(5);
  });

  it('T-06 — Refs duplicadas con suma > qtyOpen → ABORT QTY_INSUFFICIENT', async () => {
    const { fbDb, _state } = makeMockDb(baseState({ asigCount: 1, boCount: 0 }));
    _state.pedidos.origen_pid.lines[0].qtyOpen = 3; // sólo 3 u disponibles

    const payload = {
      draftId: 'DRAFT-T06',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [
            { pedidoId: 'origen_pid', lineIndex: 0, sku: 'ASIG_SKU_0', qtyAsignada: 3 },
            { pedidoId: 'origen_pid', lineIndex: 0, sku: 'ASIG_SKU_0', qtyAsignada: 3 },
          ],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data?.reason).toBe('QTY_INSUFFICIENT');
    expect(r.data?.qtyOpen).toBe(3);
    expect(r.data?.qtyAsignada).toBe(6); // suma dedup
  });

  it('T-06b — Refs duplicadas con suma == qtyOpen → CONFIRM (dedup OK, cancel único)', async () => {
    const { fbDb, _state, _opsLog } = makeMockDb(baseState({ asigCount: 1, boCount: 0 }));
    _state.pedidos.origen_pid.lines[0].qty = 6;
    _state.pedidos.origen_pid.lines[0].qtyOpen = 6;

    const payload = {
      draftId: 'DRAFT-T06b',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [
            { pedidoId: 'origen_pid', lineIndex: 0, sku: 'ASIG_SKU_0', qtyAsignada: 3 },
            { pedidoId: 'origen_pid', lineIndex: 0, sku: 'ASIG_SKU_0', qtyAsignada: 3 },
          ],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);
    const line = _state.pedidos.origen_pid.lines[0];
    expect(line.state).toBe('cancelled');
    expect(line.qtyOpen).toBe(0);
    // qtyCancelled += qtyOpen pre-mutación (6), una sola vez.
    expect(line.qtyCancelled).toBe(6);
  });

  it('T-06c — Refs duplicadas con SKUs distintos al mismo lineIndex → ABORT SKU_CONFLICT_IN_DUPES', async () => {
    const { fbDb, _state } = makeMockDb(baseState({ asigCount: 1, boCount: 0 }));
    _state.pedidos.origen_pid.lines[0].code = 'SKU_REAL';
    _state.pedidos.origen_pid.lines[0].qtyOpen = 5;

    const payload = {
      draftId: 'DRAFT-T06c',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [
            { pedidoId: 'origen_pid', lineIndex: 0, sku: 'SKU_A', qtyAsignada: 2 },
            { pedidoId: 'origen_pid', lineIndex: 0, sku: 'SKU_B', qtyAsignada: 2 },
          ],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data?.reason).toBe('SKU_CONFLICT_IN_DUPES');
    expect(r.data?.conflictingSkus).toContain('SKU_A');
    expect(r.data?.conflictingSkus).toContain('SKU_B');
  });

  it('T-07 — Línea ya cancelled: SKIP idempotente, no incrementa qtyCancelled', async () => {
    const { fbDb, _state } = makeMockDb(baseState({ asigCount: 1, boCount: 0 }));
    _state.pedidos.origen_pid.lines[0] = {
      code: 'ASIG_SKU_0',
      state: 'cancelled',
      qty: 3,
      qtyOpen: 0,
      qtyCancelled: 3,
      closedReason: 'waitlist-confirm',
      cancelledAt: '2026-11-10T00:00:00Z',
    };

    const payload = {
      draftId: 'DRAFT-T07',
      cardCode: 'C001',
      clientName: 'T',
      origen: 'cpst',
      lines: [
        {
          sku: 'SKU_CPST',
          cantidad: 1,
          precio: 100,
          origenLinea: 'stock-asignado',
          asigRefs: [{ pedidoId: 'origen_pid', lineIndex: 0, sku: 'ASIG_SKU_0', qtyAsignada: 3 }],
        },
      ],
      clientVersion: 'v1600',
      ownerUid: 'U1',
      ownerEmail: 'u1@test.com',
      source: 'stock-asignado-batch',
      waitlistOrigenId: 'waitlist_pid',
    };

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);

    const line = _state.pedidos.origen_pid.lines[0];
    expect(line.state).toBe('cancelled');
    expect(line.qtyOpen).toBe(0);
    // CRITICAL: qtyCancelled NO fue incrementado (sigue en 3).
    expect(line.qtyCancelled).toBe(3);
  });

  it('T-08 — Variante T-01 con 3 ASIG + 2 BO: 1 solo tx.update, todas mutadas', async () => {
    const { fbDb, _state, _opsLog } = makeMockDb(baseState({ asigCount: 3, boCount: 2 }));
    const payload = makePayload({ asigCount: 3, boCount: 2 });

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);

    const origen = _state.pedidos.origen_pid;
    for (let i = 0; i < 3; i++) {
      expect(origen.lines[i].state, `ASIG line ${i} cancelled`).toBe('cancelled');
    }
    for (let i = 3; i < 5; i++) {
      expect(origen.lines[i].qtyOpen, `BO line ${i} absorbed`).toBe(0);
    }
    const updates = _opsLog.filter((o) => o.path === 'pedidos/origen_pid' && o.type === 'update');
    expect(updates.length, 'exactly 1 tx.update').toBe(1);
  });

  it('T-11 — Composición cancel→absorb: absorb opera sobre pending.newLines ya mutado por cancel (R11 reformulado)', async () => {
    // Fixture: pedido origen con 1 ASIG (idx 0) y 1 BO (idx 1).
    // Verificamos que post-fix el array final tiene AMBAS mutaciones
    // (lo que demuestra que absorb no re-leyó data.lines sino pending.newLines).
    const { fbDb, _state, _opsLog } = makeMockDb(baseState({ asigCount: 1, boCount: 1 }));
    const payload = makePayload({ asigCount: 1, boCount: 1 });

    const r = await commitPedidoCore({ fbDb, now: () => nowRef }, payload);
    expect(r.ok).toBe(true);

    const origen = _state.pedidos.origen_pid;

    // ASIG mutada por cancel.
    expect(origen.lines[0].state).toBe('cancelled');
    expect(origen.lines[0].closedReason).toBe('waitlist-confirm');

    // BO mutada por absorb (en el MISMO tx.update, no en uno separado).
    expect(origen.lines[1].qtyOpen).toBe(0);

    // Verificar que SOLO hubo 1 op update sobre el pedido origen.
    const updatesOrigen = _opsLog.filter(
      (o) => o.path === 'pedidos/origen_pid' && o.type === 'update'
    );
    expect(updatesOrigen.length).toBe(1);

    // Verificar que ese update incluye AMBAS mutaciones en el payload del update.
    const u = updatesOrigen[0];
    expect(u.data.lines[0].state).toBe('cancelled');
    expect(u.data.lines[1].qtyOpen).toBe(0);
    expect(u.data._backfill).toBeTruthy();
  });
});

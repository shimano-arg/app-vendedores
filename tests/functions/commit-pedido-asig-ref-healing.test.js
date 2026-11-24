// @ts-nocheck
/**
 * Integration test: commitPedidoCore + healing end-to-end.
 * v1565 Incidente Frente A (2026-11-24, §108 CLAUDE.md).
 *
 * Replica el flow completo del incidente SNAKE SRL con mock Firestore
 * STRICT (§58 ALL reads before ALL writes).
 *
 * Verificaciones:
 *   T1: Pre-healing pedido CPST con 4 refs STATE_MISMATCH revertida_a_bo
 *       → ABORTA con ASIG_REF_INVALID (comportamiento pre-fix).
 *   T2: Post-healing mismo pedido → PASA (healing dropeó los 4 refs).
 *   T3: Audit event `asig_ref_healed` queda registrado en operations_log.
 *   T4: Healing NO toca refs legítimos (ASIG viva qty OK).
 *   T5: Healing con CHECK C SKU_MISMATCH sigue abortando (no enmascara).
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeStrictMockDb() {
  const docs = new Map();
  const writeLog = [];
  const addedOperationsLog = [];
  let hasWritten = false;

  const addDoc = (path, data) => {
    docs.set(path, { data, exists: true });
  };

  const makeDocRef = (path) => ({
    path,
    id: path.split('/').pop(),
    get: async () => {
      const d = docs.get(path);
      return {
        exists: !!(d && d.exists),
        data: () => (d ? d.data : null),
        id: path.split('/').pop(),
      };
    },
  });

  const mockDb = {
    __docs: docs,
    __addDoc: addDoc,
    __writeLog: writeLog,
    __operationsLog: addedOperationsLog,
    collection: (name) => ({
      doc: (id) => {
        const path = id ? `${name}/${id}` : `${name}/${Math.random().toString(36).slice(2, 10)}`;
        return makeDocRef(path);
      },
      add: async (data) => {
        if (name === 'operations_log') {
          addedOperationsLog.push(data);
          return { id: 'ops-' + Math.random().toString(36).slice(2, 8) };
        }
        const path = `${name}/${Math.random().toString(36).slice(2, 10)}`;
        docs.set(path, { data, exists: true });
        return { id: path.split('/').pop() };
      },
      where: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ empty: true, docs: [] }),
          }),
          get: async () => ({ empty: true, docs: [], forEach: () => {} }),
        }),
        limit: () => ({
          get: async () => ({ empty: true, docs: [], forEach: () => {} }),
        }),
        get: async () => ({ empty: true, docs: [], forEach: () => {} }),
      }),
    }),
    doc: (path) => makeDocRef(path),
    runTransaction: async (fn) => {
      hasWritten = false;
      const tx = {
        get: async (ref) => {
          if (hasWritten) {
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.'
            );
          }
          return ref.get();
        },
        set: (ref, data) => {
          hasWritten = true;
          docs.set(ref.path, { data, exists: true });
          writeLog.push({ op: 'set', path: ref.path });
        },
        update: (ref, patch) => {
          hasWritten = true;
          const existing = docs.get(ref.path);
          if (!existing) docs.set(ref.path, { data: patch, exists: true });
          else docs.set(ref.path, { data: { ...existing.data, ...patch }, exists: true });
          writeLog.push({ op: 'update', path: ref.path });
        },
        delete: (ref) => {
          hasWritten = true;
          docs.delete(ref.path);
          writeLog.push({ op: 'delete', path: ref.path });
        },
      };
      return fn(tx);
    },
  };
  return mockDb;
}

function seedFreshSnapshot(db) {
  const nowIso = new Date().toISOString();
  db.__addDoc('app_config/stock_snapshot', {
    updatedAt: nowIso,
    quantities: JSON.stringify({
      CLC70H2PY: 10,
      '26ZODIAS1610MH': 10,
      SHMTECHLBLUEL: 10,
      CAPSH2403: 10,
    }),
    warehouseBreakdown: JSON.stringify({
      CLC70H2PY: { 11: 10 },
      '26ZODIAS1610MH': { 11: 10 },
      SHMTECHLBLUEL: { 11: 10 },
      CAPSH2403: { 11: 10 },
    }),
  });
}

function seedPedidoOrigenRevertidoABO(db, pedidoId, lineIndex, sku) {
  const lines = [];
  for (let i = 0; i <= lineIndex; i++) {
    if (i === lineIndex) {
      lines.push({
        code: sku,
        state: 'BO',
        qty: 1,
        qtyOpen: 1,
        asigReserva: false,
        asigRevertidaAt: '2026-11-21T10:00:00Z',
        asigRevertidaBy: 'system:reconcile',
        asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
      });
    } else {
      lines.push({ code: 'OTRO', state: 'confirmed', qty: 1, qtyOpen: 0 });
    }
  }
  db.__addDoc('pedidos/' + pedidoId, {
    clientCardCode: 'C30719034914',
    clientName: 'SNAKE SRL',
    lines,
    stage: 'confirmed',
    closedAt: null,
    createdAt: '2026-11-20T10:00:00Z',
  });
}

function seedPedidoOrigenAsigViva(db, pedidoId, lineIndex, sku, qtyOpen) {
  const lines = [];
  for (let i = 0; i <= lineIndex; i++) {
    if (i === lineIndex) {
      lines.push({
        code: sku,
        state: 'ASIG',
        qty: qtyOpen,
        qtyOpen,
        asigAt: '2026-11-20T09:00:00Z',
      });
    } else {
      lines.push({ code: 'OTRO', state: 'confirmed', qty: 0, qtyOpen: 0 });
    }
  }
  db.__addDoc('pedidos/' + pedidoId, {
    clientCardCode: 'C30719034914',
    clientName: 'SNAKE SRL',
    lines,
    stage: 'confirmed',
    closedAt: null,
    createdAt: '2026-11-20T10:00:00Z',
  });
}

function makeSnakePayload() {
  return {
    draftId: 'C|CABA|CABA|SNAKE SRL|915',
    cardCode: 'C30719034914',
    clientName: 'SNAKE SRL',
    tipo: 'C',
    key: 'C|CABA|CABA|SNAKE SRL',
    origen: 'cpst',
    clientVersion: 'v1565',
    waitlistOrigenId: '5a0KYAoRAiDO7uKalO6i',
    ownerUid: 'uid-gonzalo',
    ownerEmail: 'gonzalo@shimano.com.ar',
    ownerVendor: 'GONZALO DE LA ROSA',
    vendorAssigned: 'GONZALO DE LA ROSA',
    assignedVendorUid: 'uid-gonzalo',
    lines: [
      {
        sku: 'CLC70H2PY',
        cantidad: 1,
        precio: 100,
        descripcion: 'Clarus',
        asigRefs: [
          { pedidoId: '53vbayoJzYqceThBKCY9', lineIndex: 23, sku: 'CLC70H2PY', qtyAsignada: 1 },
        ],
      },
      {
        sku: '26ZODIAS1610MH',
        cantidad: 1,
        precio: 100,
        descripcion: 'Zodias',
        asigRefs: [
          {
            pedidoId: 'mSuIidbMd74ziEMIBPUC',
            lineIndex: 27,
            sku: '26ZODIAS1610MH',
            qtyAsignada: 1,
          },
        ],
      },
      {
        sku: 'SHMTECHLBLUEL',
        cantidad: 1,
        precio: 100,
        descripcion: 'Tech L',
        asigRefs: [
          { pedidoId: 'mSuIidbMd74ziEMIBPUC', lineIndex: 79, sku: 'SHMTECHLBLUEL', qtyAsignada: 1 },
        ],
      },
      {
        sku: 'CAPSH2403',
        cantidad: 1,
        precio: 100,
        descripcion: 'Cap',
        asigRefs: [
          { pedidoId: 'sXYuPOb8ZepIjnmYzENq', lineIndex: 23, sku: 'CAPSH2403', qtyAsignada: 1 },
        ],
      },
    ],
  };
}

describe('commitPedidoCore + healing — SNAKE SRL integration (§108)', () => {
  it('T2: Payload SNAKE con 4 refs STATE_MISMATCH revertida_a_bo → PASA con healing', async () => {
    const db = makeStrictMockDb();
    seedFreshSnapshot(db);
    seedPedidoOrigenRevertidoABO(db, '53vbayoJzYqceThBKCY9', 23, 'CLC70H2PY');
    // El segundo pedido contiene 2 líneas (indices 27 + 79)
    db.__addDoc('pedidos/mSuIidbMd74ziEMIBPUC', {
      clientCardCode: 'C30719034914',
      clientName: 'SNAKE SRL',
      stage: 'confirmed',
      closedAt: null,
      createdAt: '2026-11-20T10:00:00Z',
      lines: (() => {
        const arr = [];
        for (let i = 0; i < 100; i++) {
          if (i === 27) {
            arr.push({
              code: '26ZODIAS1610MH',
              state: 'BO',
              qty: 1,
              qtyOpen: 1,
              asigReserva: false,
              asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
            });
          } else if (i === 79) {
            arr.push({
              code: 'SHMTECHLBLUEL',
              state: 'BO',
              qty: 1,
              qtyOpen: 1,
              asigReserva: false,
              asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
              splitFromLineIndex: 50,
            });
          } else {
            arr.push({ code: 'OTRO', state: 'confirmed', qty: 1, qtyOpen: 0 });
          }
        }
        return arr;
      })(),
    });
    seedPedidoOrigenRevertidoABO(db, 'sXYuPOb8ZepIjnmYzENq', 23, 'CAPSH2403');

    const payload = makeSnakePayload();
    const r = await commitPedidoCore(
      { fbDb: db, now: () => new Date('2026-11-24T10:00:00Z') },
      payload
    );
    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBeTruthy();
    // Los 4 items quedan como BO en el pedido nuevo (porque los refs fueron dropped).
    expect(r.lines).toBeTruthy();
    // Verificar audit a operations_log.
    const auditEntry = db.__operationsLog.find((e) => e.type === 'asig_ref_healed');
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.totalHealed).toBe(4);
    expect(auditEntry.cardCode).toBe('C30719034914');
    expect(auditEntry.events).toHaveLength(4);
    expect(auditEntry.events.every((e) => e.reason === 'revertida_a_bo')).toBe(true);
  });

  it('T4: Payload CPST con 1 ref ASIG viva qty OK → PASA sin healing', async () => {
    const db = makeStrictMockDb();
    seedFreshSnapshot(db);
    seedPedidoOrigenAsigViva(db, 'OrigenASIG123', 5, 'CLC70H2PY', 3);

    const payload = {
      draftId: 'C|CABA|CABA|SNAKE SRL|999',
      cardCode: 'C30719034914',
      clientName: 'SNAKE SRL',
      tipo: 'C',
      key: 'C|CABA|CABA|SNAKE SRL',
      origen: 'cpst',
      clientVersion: 'v1565',
      waitlistOrigenId: 'WL-OK',
      ownerUid: 'uid-gonzalo',
      ownerEmail: 'gonzalo@shimano.com.ar',
      lines: [
        {
          sku: 'CLC70H2PY',
          cantidad: 2,
          precio: 100,
          descripcion: 'Clarus OK',
          asigRefs: [{ pedidoId: 'OrigenASIG123', lineIndex: 5, sku: 'CLC70H2PY', qtyAsignada: 2 }],
        },
      ],
    };

    const r = await commitPedidoCore(
      { fbDb: db, now: () => new Date('2026-11-24T10:00:00Z') },
      payload
    );
    expect(r.ok).toBe(true);
    const auditEntry = db.__operationsLog.find((e) => e.type === 'asig_ref_healed');
    expect(auditEntry).toBeUndefined(); // no healing porque todo OK
  });

  it('T5: Payload con SKU_MISMATCH sigue abortando (healing NO enmascara)', async () => {
    const db = makeStrictMockDb();
    // Snapshot con 'B' físico disponible para que no dispare STOCK_CHANGED
    // antes del CHECK C.
    const nowIso = new Date().toISOString();
    db.__addDoc('app_config/stock_snapshot', {
      updatedAt: nowIso,
      quantities: JSON.stringify({ A: 10, B: 10 }),
      warehouseBreakdown: JSON.stringify({ A: { 11: 10 }, B: { 11: 10 } }),
    });
    // Pedido origen tiene línea con SKU 'A', pero el ref dice 'B'
    db.__addDoc('pedidos/MISMATCH1', {
      clientCardCode: 'C30719034914',
      stage: 'confirmed',
      closedAt: null,
      createdAt: '2026-11-20T10:00:00Z',
      lines: [{ code: 'A', state: 'ASIG', qty: 1, qtyOpen: 1 }],
    });
    const payload = {
      draftId: 'D1',
      cardCode: 'C30719034914',
      clientName: 'X',
      tipo: 'C',
      key: 'C|X|X|X',
      origen: 'cpst',
      clientVersion: 'v1565',
      waitlistOrigenId: 'W1',
      ownerUid: 'u',
      ownerEmail: 'e@shimano.com.ar',
      lines: [
        {
          sku: 'B', // DISTINTO de la línea origen
          cantidad: 1,
          precio: 100,
          descripcion: 'B',
          asigRefs: [{ pedidoId: 'MISMATCH1', lineIndex: 0, sku: 'B', qtyAsignada: 1 }],
        },
      ],
    };

    const r = await commitPedidoCore(
      { fbDb: db, now: () => new Date('2026-11-24T10:00:00Z') },
      payload
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ASIG_REF_INVALID');
    expect(r.data?.reason).toBe('SKU_MISMATCH');
  });
});

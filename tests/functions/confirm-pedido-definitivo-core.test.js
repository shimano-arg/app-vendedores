/**
 * BATCH B.2b SEC-H2 (2026-11-19) — tests del core confirmPedidoDefinitivoCore.
 *
 * Verifica:
 * - Permisos por rol (admin/gerente/interno blanket + VDE ownerUid/assignedVendorUid).
 * - Transición válida (solo pending → confirmed).
 * - Guard pedido ya en SAP.
 * - Idempotencia (segunda invocación no re-escribe).
 * - Escritura del marker _commitVersion='confirmDefinitivo_v1'.
 * - Audit trail (finalizedAt + finalizedBy).
 * - Pattern §58 reads-before-writes dentro del runTransaction.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_DEFINITIVO_RESULT,
  canConfirmPedido,
  confirmPedidoDefinitivoCore,
} from '../../functions/core/confirm-pedido-definitivo-core.js';

function makeFbDbStub(initialPedidos = {}) {
  const store = new Map(Object.entries(initialPedidos));
  const updateLog = [];
  return {
    _dump: () => Object.fromEntries(store),
    _updateLog: () => updateLog,
    collection(name) {
      if (name === 'pedidos') {
        return {
          doc(id) {
            const path = `pedidos/${id}`;
            return {
              _path: path,
              get: () =>
                Promise.resolve({
                  exists: store.has(path),
                  data: () => store.get(path) || null,
                }),
              update: (patch) => {
                const existing = store.get(path) || {};
                store.set(path, { ...existing, ...patch });
                updateLog.push({ path, patch });
                return Promise.resolve();
              },
            };
          },
        };
      }
      return {};
    },
    async runTransaction(fn) {
      const reads = [];
      const writes = [];
      const tx = {
        get: async (ref) => {
          reads.push({ when: writes.length, path: ref._path });
          const snap = await ref.get();
          return snap;
        },
        update: (ref, patch) => {
          writes.push({ path: ref._path, patch });
          const existing = store.get(ref._path) || {};
          store.set(ref._path, { ...existing, ...patch });
          updateLog.push({ path: ref._path, patch });
        },
      };
      const result = await fn(tx);
      // Verificación §58: todos los reads antes de todos los writes.
      if (writes.length > 0 && reads.some((r) => r.when > 0)) {
        throw new Error('§58 violation: read after write');
      }
      return result;
    },
  };
}

describe('canConfirmPedido', () => {
  const basePedido = { ownerUid: 'u1', assignedVendorUid: 'u2' };

  it('admin blanket', () => {
    expect(
      canConfirmPedido({ callerRole: 'admin', callerUid: 'any', pedidoData: basePedido })
    ).toBe(true);
  });
  it('gerente blanket', () => {
    expect(
      canConfirmPedido({ callerRole: 'gerente', callerUid: 'any', pedidoData: basePedido })
    ).toBe(true);
  });
  it('interno blanket', () => {
    expect(
      canConfirmPedido({ callerRole: 'interno', callerUid: 'any', pedidoData: basePedido })
    ).toBe(true);
  });
  it('vendedor con ownerUid propio OK', () => {
    expect(
      canConfirmPedido({ callerRole: 'vendedor', callerUid: 'u1', pedidoData: basePedido })
    ).toBe(true);
  });
  it('vendedor con assignedVendorUid propio OK', () => {
    expect(
      canConfirmPedido({ callerRole: 'vendedor', callerUid: 'u2', pedidoData: basePedido })
    ).toBe(true);
  });
  it('vendedor con ninguno propio deniega', () => {
    expect(
      canConfirmPedido({ callerRole: 'vendedor', callerUid: 'u3', pedidoData: basePedido })
    ).toBe(false);
  });
  it('role unassigned/viewer deniega', () => {
    expect(
      canConfirmPedido({ callerRole: 'viewer', callerUid: 'u1', pedidoData: basePedido })
    ).toBe(false);
    expect(
      canConfirmPedido({ callerRole: 'unassigned', callerUid: 'u1', pedidoData: basePedido })
    ).toBe(false);
  });
  it('sin callerUid deniega', () => {
    expect(canConfirmPedido({ callerRole: 'admin', callerUid: '', pedidoData: basePedido })).toBe(
      false
    );
  });
});

describe('confirmPedidoDefinitivoCore', () => {
  const NOW = new Date('2026-11-19T15:00:00.000Z').getTime();
  const nowFn = () => NOW;

  it('T1: pedido pending → confirmed OK con marker + audit', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p1': { stage: 'pending', ownerUid: 'u1', clientCardCode: 'C001' },
    });
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: 'p1', callerUid: 'u1', callerEmail: 'v@shimano.com.ar', callerRole: 'vendedor' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.OK);
    const updated = fbDb._dump()['pedidos/p1'];
    expect(updated.stage).toBe('confirmed');
    expect(updated.finalizedAt).toBe('2026-11-19T15:00:00.000Z');
    expect(updated.finalizedBy).toBe('v@shimano.com.ar');
    expect(updated._commitVersion).toBe('confirmDefinitivo_v1');
  });

  it('T2: admin puede confirmar pedido ajeno', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p2': { stage: 'pending', ownerUid: 'other-uid' },
    });
    const r = await confirmPedidoDefinitivoCore(
      {
        pedidoId: 'p2',
        callerUid: 'admin-uid',
        callerEmail: 'a@shimano.com.ar',
        callerRole: 'admin',
      },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.OK);
  });

  it('T3: VDE NO puede confirmar pedido ajeno (ni ownerUid ni assignedVendorUid propio)', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p3': { stage: 'pending', ownerUid: 'u1', assignedVendorUid: 'u2' },
    });
    const r = await confirmPedidoDefinitivoCore(
      {
        pedidoId: 'p3',
        callerUid: 'u3',
        callerEmail: 'other@shimano.com.ar',
        callerRole: 'vendedor',
      },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.PERMISSION_DENIED);
    // NO writes.
    expect(fbDb._updateLog()).toHaveLength(0);
  });

  it('T4: VDE PUEDE confirmar pedido como assignedVendorUid aunque ownerUid sea otro (§44)', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p4': { stage: 'pending', ownerUid: 'pablo-admin-uid', assignedVendorUid: 'vde-uid' },
    });
    const r = await confirmPedidoDefinitivoCore(
      {
        pedidoId: 'p4',
        callerUid: 'vde-uid',
        callerEmail: 'vde@shimano.com.ar',
        callerRole: 'vendedor',
      },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.OK);
  });

  it('T5: pedido inexistente → NOT_FOUND', async () => {
    const fbDb = makeFbDbStub({});
    const r = await confirmPedidoDefinitivoCore(
      {
        pedidoId: 'p-missing',
        callerUid: 'u1',
        callerEmail: 'v@shimano.com.ar',
        callerRole: 'admin',
      },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.NOT_FOUND);
  });

  it('T6: pedido ya confirmed con nuestro marker → OK_IDEMPOTENT (no re-escribe)', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p6': {
        stage: 'confirmed',
        _commitVersion: 'confirmDefinitivo_v1',
        ownerUid: 'u1',
      },
    });
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: 'p6', callerUid: 'u1', callerEmail: 'v@shimano.com.ar', callerRole: 'vendedor' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.OK_IDEMPOTENT);
    expect(r.idempotentHit).toBe(true);
    expect(fbDb._updateLog()).toHaveLength(0);
  });

  it('T7: pedido confirmed con marker distinto (legacy) → INVALID_STAGE', async () => {
    // Pedido confirmed por commitPedidoCF (commitPedidoCore_v1). No re-confirmamos.
    const fbDb = makeFbDbStub({
      'pedidos/p7': {
        stage: 'confirmed',
        _commitVersion: 'commitPedidoCore_v1',
        ownerUid: 'u1',
      },
    });
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: 'p7', callerUid: 'u1', callerEmail: 'v@shimano.com.ar', callerRole: 'admin' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.INVALID_STAGE);
    expect(r.reason).toContain('confirmed');
  });

  it('T8: pedido en SAP (transferidoSAP.docNum) → ALREADY_IN_SAP', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p8': {
        stage: 'pending',
        transferidoSAP: { docNum: 2000100, via: 'cf_auto' },
        ownerUid: 'u1',
      },
    });
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: 'p8', callerUid: 'u1', callerEmail: 'v@shimano.com.ar', callerRole: 'admin' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.ALREADY_IN_SAP);
  });

  it('T9: payload inválido (pedidoId vacío) → ERROR', async () => {
    const fbDb = makeFbDbStub({});
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: '', callerUid: 'u1', callerEmail: 'v@shimano.com.ar', callerRole: 'admin' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.ERROR);
  });

  it('T10: sin callerUid → PERMISSION_DENIED', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p10': { stage: 'pending', ownerUid: 'u1' },
    });
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: 'p10', callerUid: '', callerEmail: '', callerRole: 'admin' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.PERMISSION_DENIED);
  });

  it('T11: §58 reads-before-writes — no violation en el runTransaction', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p11': { stage: 'pending', ownerUid: 'u1' },
    });
    // El wrapper runTransaction del stub tira error si hay read post-write.
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: 'p11', callerUid: 'u1', callerEmail: 'v@shimano.com.ar', callerRole: 'vendedor' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.OK);
  });

  it('T12: stage waitlist → INVALID_STAGE (no cubierto en este flow)', async () => {
    const fbDb = makeFbDbStub({
      'pedidos/p12': { stage: 'waitlist', ownerUid: 'u1' },
    });
    const r = await confirmPedidoDefinitivoCore(
      { pedidoId: 'p12', callerUid: 'u1', callerEmail: 'v@shimano.com.ar', callerRole: 'admin' },
      { fbDb, now: nowFn }
    );
    expect(r.result).toBe(CONFIRM_DEFINITIVO_RESULT.INVALID_STAGE);
    expect(r.reason).toContain('waitlist');
  });
});

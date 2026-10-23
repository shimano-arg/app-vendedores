// @ts-check
/**
 * E10 §stock-servidor-atomico — updatePedidoLinesCore tests.
 *
 * CF para edits legítimos pre-cutover rules. Valida:
 * - Only owner (VDE) o admin/gerente/interno editan.
 * - Pedido en SAP (transferidoSAP.docEntry != null) → PERMISSION_DENIED.
 * - Whitelist strict: solo precio/qty/qtyOpen/notas.
 * - lineIndex válido.
 * - Payload malformado → VALIDATION_ERROR.
 */
import { describe, expect, it, vi } from 'vitest';
import { updatePedidoLinesCore } from '../../functions/core/update-pedido-lines-core.js';

function makeDeps(initialPedido) {
  const state = {
    pedidos: initialPedido ? { ped1: initialPedido } : {},
  };
  const writes = [];
  const makeDoc = (col, id) => ({
    id,
    async get() {
      const d = state[col] && state[col][id];
      return { exists: !!d, data: () => d || null };
    },
    async update(data) {
      state[col][id] = { ...(state[col][id] || {}), ...data };
      writes.push({ op: 'update', path: `${col}/${id}`, data });
    },
  });
  const fbDb = {
    collection(name) {
      return {
        doc(id) {
          return makeDoc(name, id);
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, data) {
          return ref.update(data);
        },
      };
      return fn(tx);
    },
  };
  return { fbDb, log: vi.fn(), _state: state, _writes: writes };
}

const authVde = { uid: 'vde1', email: 'vde1@shimano.com.ar', role: 'vendedor' };
const authAdmin = { uid: 'admin1', email: 'admin@shimano.com.ar', role: 'admin' };

describe('E10 updatePedidoLinesCore', () => {
  describe('validación payload', () => {
    it('rechaza payload sin pedidoId', async () => {
      const deps = makeDeps(null);
      const r = await updatePedidoLinesCore(deps, { lines: [] }, authVde);
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
    });

    it('rechaza sin auth', async () => {
      const deps = makeDeps(null);
      const r = await updatePedidoLinesCore(deps, { pedidoId: 'ped1', lines: [] }, null);
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('PERMISSION_DENIED');
    });
  });

  describe('autorización', () => {
    it('VDE solo puede editar su pedido', async () => {
      const deps = makeDeps({
        ownerUid: 'vde_otro',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 150 }] },
        authVde
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('PERMISSION_DENIED');
    });

    it('VDE edita su pedido con precio', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 150 }] },
        authVde
      );
      expect(r.ok).toBe(true);
      expect(r.applied[0].changes).toContain('precio');
      const updatedLine = deps._writes[0].data.lines[0];
      expect(updatedLine.precio).toBe(150);
    });

    it('admin edita cualquier pedido', async () => {
      const deps = makeDeps({
        ownerUid: 'vde_otro',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: 5 }] },
        authAdmin
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('guard pedido en SAP', () => {
    it('pedido con transferidoSAP.docEntry != null → PERMISSION_DENIED', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: { docEntry: 999, docNum: 2000425 },
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 100 }] },
        authVde
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('PERMISSION_DENIED');
      expect(r.message).toMatch(/SQ #2000425/);
    });

    it('transferidoSAP via=app_only NO bloquea', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: { docEntry: null, via: 'app_only' },
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 100 }] },
        authVde
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('whitelist strict', () => {
    it('rechaza intento de cambiar state', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1, state: 'BO' }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, state: 'confirmed' }] },
        authVde
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/campo no editable: state/);
    });

    it('rechaza code (SKU)', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, code: 'B' }] },
        authVde
      );
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/campo no editable: code/);
    });

    it('rechaza asigRefs', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, asigRefs: [{ pedidoId: 'X' }] }] },
        authVde
      );
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/campo no editable: asigRefs/);
    });

    it('permite edit múltiples whitelist en una línea', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        {
          pedidoId: 'ped1',
          lines: [{ lineIndex: 0, qty: 5, qtyOpen: 5, precio: 200, notas: 'edit' }],
        },
        authVde
      );
      expect(r.ok).toBe(true);
      const l = deps._writes[0].data.lines[0];
      expect(l.qty).toBe(5);
      expect(l.qtyOpen).toBe(5);
      expect(l.precio).toBe(200);
      expect(l.notas).toBe('edit');
      expect(l._editedBy).toBe('vde1@shimano.com.ar');
    });
  });

  describe('lineIndex inválido', () => {
    it('rechaza lineIndex fuera de rango', async () => {
      const deps = makeDeps({
        ownerUid: 'vde1',
        transferidoSAP: null,
        lines: [{ code: 'A' }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 5, precio: 100 }] },
        authVde
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/lineIndex inválido/);
    });
  });

  describe('pedido no existe', () => {
    it('devuelve NOT_FOUND', async () => {
      const deps = makeDeps(null);
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped_x', lines: [{ lineIndex: 0, precio: 100 }] },
        authVde
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('NOT_FOUND');
    });
  });
});

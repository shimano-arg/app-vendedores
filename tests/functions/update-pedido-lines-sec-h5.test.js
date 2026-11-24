// @ts-check
/**
 * SEC-H5 (HARDENING5 BATCH 1, 2026-11-19) — updatePedidoLinesCore hardening.
 *
 * Cubre los 4 fixes HIGH aplicados sobre updatePedidoLinesCore:
 *   1. Permission check §63: VDE puede editar si ownerUid O assignedVendorUid
 *      (reemplaza ownerUid-only — rompía caso Gonzalo-BROBRO cross-vendor).
 *   2. Vector V-N3 (Data Integrity): stage='confirmed' bloqueado — evita race
 *      con onPedidoConfirmedSendToSap (Firestore vs SAP divergen si edit ocurre
 *      entre arma-payload y POST).
 *   3. Validación de rangos: qty/qtyOpen [0..10000], precio [0..10_000_000].
 *      Rechaza NaN, negativos, strings no-numéricos, overflow.
 *   4. Invariante §54 R9: qtyOpen ≤ qty por línea post-edit.
 *
 * Los tests existentes (tests/functions/update-pedido-lines-core.test.js)
 * cubren los casos originales (ownership básico, whitelist strict, guard SAP,
 * lineIndex inválido). Este archivo cubre SOLO los paths nuevos de SEC-H5.
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

const authGonzalo = {
  uid: 'uid-gonzalo',
  email: 'gonzalo@shimano.com.ar',
  role: 'vendedor',
};
const authAjeno = {
  uid: 'uid-ajeno',
  email: 'otro@shimano.com.ar',
  role: 'vendedor',
};
const authAdmin = {
  uid: 'uid-admin',
  email: 'admin@shimano.com.ar',
  role: 'admin',
};

describe('SEC-H5 — updatePedidoLinesCore hardening (HARDENING5 B1)', () => {
  describe('permission check §63 (ownerUid OR assignedVendorUid)', () => {
    it('T1 — VDE que es assignedVendorUid pero NO ownerUid → edita OK (caso Gonzalo-BROBRO)', async () => {
      // Pablo (admin) cargó la orden; Gonzalo es VDE master del cliente.
      const deps = makeDeps({
        ownerUid: 'uid-pablo',
        assignedVendorUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'BROBRO-SKU', qty: 1, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 150 }] },
        authGonzalo
      );
      expect(r.ok).toBe(true);
      expect(r.applied[0].changes).toContain('precio');
    });

    it('T2 — VDE ajeno (ni owner ni assignedVendor) → PERMISSION_DENIED', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-pablo',
        assignedVendorUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 100 }] },
        authAjeno
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('PERMISSION_DENIED');
    });

    it('T3 — admin edita sin importar owner ni assignedVendor', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-x',
        assignedVendorUid: 'uid-y',
        stage: 'pending',
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

  describe('vector V-N3 — stage=confirmed bloqueado', () => {
    it('T4 — stage=confirmed → PERMISSION_DENIED aunque sea owner', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-gonzalo',
        stage: 'confirmed',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 100 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('PERMISSION_DENIED');
      expect(r.message).toMatch(/confirmed no es editable/);
    });

    it('T4b — stage=confirmed → PERMISSION_DENIED aunque sea admin', async () => {
      // El guard es sobre data integrity, no sobre privilegios.
      // Admin tampoco puede editar un confirmed vía esta CF (debe revertir a pending).
      const deps = makeDeps({
        ownerUid: 'uid-pablo',
        stage: 'confirmed',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 100 }] },
        authAdmin
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('PERMISSION_DENIED');
      expect(r.message).toMatch(/confirmed no es editable/);
    });

    it('T4c — stage=pending → NO bloquea', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 100 }] },
        authGonzalo
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('validación de rangos (qty/qtyOpen/precio)', () => {
    function pedidoBase() {
      return {
        ownerUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 1, qtyOpen: 1, precio: 100 }],
      };
    }

    it('T5 — qty negativo → VALIDATION_ERROR', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: -5 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/qty fuera de rango/);
    });

    it('T6 — qty > cap (10001) → VALIDATION_ERROR', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: 10001 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/qty fuera de rango/);
      expect(r.message).toMatch(/10001/);
    });

    it('T6b — qty en cap (10000) → OK', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: 10000, qtyOpen: 10000 }] },
        authGonzalo
      );
      expect(r.ok).toBe(true);
    });

    it('T7 — precio NaN (string no-numérico) → VALIDATION_ERROR', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 'foo' }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/precio fuera de rango/);
    });

    it('T7b — precio Infinity → VALIDATION_ERROR', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: Infinity }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/precio fuera de rango/);
    });

    it('T8 — precio > cap (10_000_001) → VALIDATION_ERROR', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 10_000_001 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/precio fuera de rango/);
    });

    it('T8b — precio en cap (10_000_000) → OK', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, precio: 10_000_000 }] },
        authGonzalo
      );
      expect(r.ok).toBe(true);
    });

    it('T9 — qty=null como change (campo ausente) → no dispara validación, no muta', async () => {
      // null-safe: null significa "no cambiar". El change puede traer solo
      // precio y dejar qty intacto.
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: null, precio: 200 }] },
        authGonzalo
      );
      expect(r.ok).toBe(true);
      const line = deps._writes[0].data.lines[0];
      expect(line.qty).toBe(1); // preservado del original
      expect(line.precio).toBe(200);
    });

    it('T9b — qtyOpen negativo → VALIDATION_ERROR', async () => {
      const deps = makeDeps(pedidoBase());
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qtyOpen: -1 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/qtyOpen fuera de rango/);
    });
  });

  describe('invariante §54 R9 — qtyOpen ≤ qty', () => {
    it('T10 — edit que setea qtyOpen=20 sobre línea con qty=10 (sin cambiar qty) → VALIDATION_ERROR', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 10, qtyOpen: 5, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qtyOpen: 20 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/R9/);
      expect(r.message).toMatch(/qtyOpen \(20\)/);
      expect(r.message).toMatch(/qty \(10\)/);
    });

    it('T11 — edit compuesto qty:20 + qtyOpen:15 → OK (ambos en el mismo change, consistente)', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 10, qtyOpen: 5, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: 20, qtyOpen: 15 }] },
        authGonzalo
      );
      expect(r.ok).toBe(true);
      const line = deps._writes[0].data.lines[0];
      expect(line.qty).toBe(20);
      expect(line.qtyOpen).toBe(15);
    });

    it('T11b — edit qty:10 + qtyOpen:15 → VALIDATION_ERROR (15 > 10)', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 5, qtyOpen: 5, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: 10, qtyOpen: 15 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/R9/);
    });

    it('T11c — reducir solo qty por debajo de qtyOpen existente → VALIDATION_ERROR', async () => {
      // Línea arranca qty=10 qtyOpen=8. Edit setea qty=5 sin tocar qtyOpen.
      // Post-merge: qty=5, qtyOpen=8 → R9 violado.
      const deps = makeDeps({
        ownerUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 10, qtyOpen: 8, precio: 100 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        { pedidoId: 'ped1', lines: [{ lineIndex: 0, qty: 5 }] },
        authGonzalo
      );
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('VALIDATION_ERROR');
      expect(r.message).toMatch(/R9/);
      expect(r.message).toMatch(/qtyOpen \(8\)/);
      expect(r.message).toMatch(/qty \(5\)/);
    });
  });

  describe('happy path integración', () => {
    it('T12 — VDE owner + stage pending + rangos válidos + R9 válido → OK', async () => {
      const deps = makeDeps({
        ownerUid: 'uid-gonzalo',
        assignedVendorUid: 'uid-gonzalo',
        stage: 'pending',
        transferidoSAP: null,
        lines: [{ code: 'A', qty: 5, qtyOpen: 5, precio: 1000 }],
      });
      const r = await updatePedidoLinesCore(
        deps,
        {
          pedidoId: 'ped1',
          lines: [
            {
              lineIndex: 0,
              qty: 8,
              qtyOpen: 6,
              precio: 1500,
              notas: 'ajuste pos-charla',
            },
          ],
        },
        authGonzalo
      );
      expect(r.ok).toBe(true);
      expect(r.applied).toEqual([
        {
          lineIndex: 0,
          changes: expect.arrayContaining(['qty', 'qtyOpen', 'precio', 'notas']),
        },
      ]);
      const line = deps._writes[0].data.lines[0];
      expect(line.qty).toBe(8);
      expect(line.qtyOpen).toBe(6);
      expect(line.precio).toBe(1500);
      expect(line.notas).toBe('ajuste pos-charla');
      expect(line._editedBy).toBe('gonzalo@shimano.com.ar');
    });
  });
});

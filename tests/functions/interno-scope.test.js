// @ts-check
// Auditoría de seguridad 2026-11-25: helper de alcance del interno (VDI).
import { describe, expect, it } from 'vitest';
import {
  evaluatePedidoScopeInterno,
  evaluateWaitlistScopeInterno,
  isPedidoEnScopeInterno,
  isWaitlistEnScopeInterno,
  makeGetRoleDoc,
} from '../../functions/core/interno-scope.js';

const ROLES = {
  'uid-vde-pareja': { role: 'vendedor', internalPartnerUid: 'uid-int' },
  'uid-vde-otro': { role: 'vendedor', internalPartnerUid: 'uid-int-otro' },
  'uid-int-otro': { role: 'interno' },
  'uid-ger': { role: 'gerente' },
};
const getRoleDoc = async (/** @type {string} */ uid) => ROLES[uid] || null;
const boom = async () => {
  throw new Error('lectura fallida');
};

describe('interno-scope — pedidos', () => {
  it('propio por ownerUid / createdByUid / cargadoPorUid', async () => {
    for (const f of ['ownerUid', 'createdByUid', 'cargadoPorUid']) {
      const r = await evaluatePedidoScopeInterno({
        callerUid: 'uid-int',
        pedido: { [f]: 'uid-int', assignedVendorUid: 'uid-vde-otro' },
        getRoleDoc,
      });
      expect(r).toEqual({ ok: true, via: 'propio', reason: '' });
    }
  });

  it('pareja por ownerUid', async () => {
    const r = await evaluatePedidoScopeInterno({
      callerUid: 'uid-int',
      pedido: { ownerUid: 'uid-vde-pareja' },
      getRoleDoc,
    });
    expect(r.ok).toBe(true);
    expect(r.via).toBe('pareja');
  });

  it('pareja por assignedVendorUid (pedido cargado por el gerente)', async () => {
    const ok = await isPedidoEnScopeInterno({
      callerUid: 'uid-int',
      pedido: { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-pareja' },
      getRoleDoc,
    });
    expect(ok).toBe(true);
  });

  it('otra pareja → fuera_de_pareja', async () => {
    const r = await evaluatePedidoScopeInterno({
      callerUid: 'uid-int',
      pedido: { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-otro' },
      getRoleDoc,
    });
    expect(r).toEqual({ ok: false, via: '', reason: 'fuera_de_pareja' });
  });

  it('candidato con internalPartnerUid correcto pero rol no vendedor → no concede', async () => {
    const r = await evaluatePedidoScopeInterno({
      callerUid: 'uid-int',
      pedido: { ownerUid: 'uid-x' },
      getRoleDoc: async () => ({ role: 'gerente', internalPartnerUid: 'uid-int' }),
    });
    expect(r.ok).toBe(false);
  });

  it('rol del VDE ilegible → denegado (falla cerrada)', async () => {
    const r = await evaluatePedidoScopeInterno({
      callerUid: 'uid-int',
      pedido: { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-pareja' },
      getRoleDoc: boom,
    });
    expect(r).toEqual({ ok: false, via: '', reason: 'rol_ilegible' });
  });

  it('sin getRoleDoc → denegado salvo propio', async () => {
    const r = await evaluatePedidoScopeInterno({
      callerUid: 'uid-int',
      pedido: { assignedVendorUid: 'uid-vde-pareja' },
      // @ts-expect-error falta a propósito
      getRoleDoc: undefined,
    });
    expect(r.ok).toBe(false);
  });

  it('sin caller o sin documento → denegado', async () => {
    expect((await evaluatePedidoScopeInterno({ callerUid: '', pedido: {}, getRoleDoc })).ok).toBe(
      false
    );
    expect(
      (await evaluatePedidoScopeInterno({ callerUid: 'uid-int', pedido: null, getRoleDoc })).ok
    ).toBe(false);
  });
});

describe('interno-scope — órdenes en espera', () => {
  it('propia por ownerUid o cargadoPorUid; createdByUid no cuenta', async () => {
    expect(
      await isWaitlistEnScopeInterno({
        callerUid: 'uid-int',
        waitlist: { cargadoPorUid: 'uid-int', assignedVendorUid: 'uid-vde-otro' },
        getRoleDoc,
      })
    ).toBe(true);
    const r = await evaluateWaitlistScopeInterno({
      callerUid: 'uid-int',
      waitlist: { createdByUid: 'uid-int', assignedVendorUid: 'uid-vde-otro' },
      getRoleDoc,
    });
    expect(r.ok).toBe(false);
  });

  it('pareja por assignedVendorUid', async () => {
    expect(
      await isWaitlistEnScopeInterno({
        callerUid: 'uid-int',
        waitlist: { ownerUid: 'uid-ger', assignedVendorUid: 'uid-vde-pareja' },
        getRoleDoc,
      })
    ).toBe(true);
  });
});

describe('makeGetRoleDoc', () => {
  it('lee roles/{uid}, devuelve null si no existe y cachea', async () => {
    let reads = 0;
    const fbDb = {
      collection: (/** @type {string} */ c) => ({
        doc: (/** @type {string} */ id) => ({
          async get() {
            reads += 1;
            expect(c).toBe('roles');
            return id === 'a'
              ? { exists: true, data: () => ({ role: 'vendedor' }) }
              : { exists: false, data: () => undefined };
          },
        }),
      }),
    };
    const g = makeGetRoleDoc(fbDb);
    expect(await g('a')).toEqual({ role: 'vendedor' });
    expect(await g('a')).toEqual({ role: 'vendedor' });
    expect(await g('b')).toBe(null);
    expect(reads).toBe(2);
  });
});

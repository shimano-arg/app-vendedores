// @ts-check
/**
 * v1404 §42 — una orden abierta por cliente en lista de espera.
 */
import { describe, expect, it } from 'vitest';
import {
  findOpenWaitlistsForClient,
  formatWaitlistForConfirm,
} from '../../src/pure/waitlist-unique-per-client.js';
import { isWaitlistCpst } from '../../src/pure/wl-sidebar-classes.js';

describe('v1404 §42 findOpenWaitlistsForClient', () => {
  it('cliente sin órdenes abiertas → []', () => {
    expect(findOpenWaitlistsForClient([], 'C1')).toEqual([]);
    expect(findOpenWaitlistsForClient([{ clientCardCode: 'C2', closedAt: null }], 'C1')).toEqual(
      []
    );
  });

  it('cliente con 1 orden abierta → array con 1', () => {
    const w = {
      _id: 'w1',
      clientCardCode: 'C1',
      closedAt: null,
      createdAt: '2026-10-20T10:00:00Z',
    };
    expect(findOpenWaitlistsForClient([w], 'C1')).toHaveLength(1);
  });

  it('filtra closedAt presente', () => {
    const w = { clientCardCode: 'C1', closedAt: '2026-10-19' };
    expect(findOpenWaitlistsForClient([w], 'C1')).toEqual([]);
  });

  it('filtra stage=consumed', () => {
    const w = { clientCardCode: 'C1', closedAt: null, stage: 'consumed' };
    expect(findOpenWaitlistsForClient([w], 'C1')).toEqual([]);
  });

  it('sort DESC por createdAt (más nueva primero)', () => {
    const wVieja = {
      _id: 'w_vieja',
      clientCardCode: 'C1',
      closedAt: null,
      createdAt: '2026-10-18T10:00:00Z',
      orderNumber: 100,
    };
    const wNueva = {
      _id: 'w_nueva',
      clientCardCode: 'C1',
      closedAt: null,
      createdAt: '2026-10-21T10:00:00Z',
      orderNumber: 200,
    };
    const r = findOpenWaitlistsForClient([wVieja, wNueva], 'C1');
    expect(r).toHaveLength(2);
    expect(r[0]._id).toBe('w_nueva');
    expect(r[1]._id).toBe('w_vieja');
  });

  it('cardCode vacío → []', () => {
    expect(findOpenWaitlistsForClient([{ clientCardCode: 'C1', closedAt: null }], '')).toEqual([]);
  });
});

describe('v1404 §42 formatWaitlistForConfirm', () => {
  it('formato con todos los campos', () => {
    const w = {
      orderNumber: 445,
      items: [{ qty: 3 }, { qty: 2 }, { qty: 7 }],
      createdAt: '2026-10-20T10:00:00Z',
      ownerEmail: 'juan@shimano.com.ar',
    };
    const s = formatWaitlistForConfirm(w);
    expect(s).toContain('ORDEN 445');
    expect(s).toContain('3 SKU');
    expect(s).toContain('12 unidades');
    expect(s).toContain('juan@shimano.com.ar');
  });

  it('null → "(sin datos)"', () => {
    expect(formatWaitlistForConfirm(null)).toBe('(sin datos)');
  });
});

describe('v1404 §42 isWaitlistCpst (ampliado por §42)', () => {
  it('source=stock-asignado-batch → true', () => {
    expect(isWaitlistCpst({ source: 'stock-asignado-batch' })).toBe(true);
  });

  it('pedidosOrigenes populated → true', () => {
    expect(isWaitlistCpst({ pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0 }] })).toBe(true);
  });

  it('§42 NEW: items[].origen=stock-asignado → true (orden manual que absorbió CPST)', () => {
    const w = {
      source: 'crear-manual',
      items: [
        { code: 'A', qty: 1 },
        { code: 'B', qty: 2, origen: 'stock-asignado' },
      ],
    };
    expect(isWaitlistCpst(w)).toBe(true);
  });

  it('sin ningún marcador → false', () => {
    expect(isWaitlistCpst({ items: [{ code: 'A', qty: 1 }] })).toBe(false);
    expect(isWaitlistCpst({})).toBe(false);
  });
});

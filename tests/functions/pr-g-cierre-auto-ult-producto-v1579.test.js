// @ts-check
/**
 * PR G v1579 §Decisiones-4-5 (2026-11-25) — cierre automático + aviso último producto.
 *
 * Decisión 4 (cierre auto): cuando `action='remove_item'` deja el pedido
 * origen sin líneas abiertas, se cierra en la misma tx con
 * closedReason='empty_after_asig_recycle_v1579' + operations_log entry.
 * Scope A (pregunta 1): solo remove_item. rechazo_cpst NO aplica.
 *
 * Decisión 5 (aviso): si remove_item quita el último item (itemsAfter.length=0),
 * el servidor exige flag confirmedLastItemRemoval=true. Si no viene, rebota
 * con errorCode LAST_ITEM_NEEDS_CONFIRM. Scope A: aplica a todos los roles
 * (VDE, interno, admin, gerente).
 */
import { describe, expect, it, vi } from 'vitest';
import { releaseAsigCore } from '../../functions/core/release-asig-core.js';

const NOW = Date.now();

const ROLES_FIXTURE = {
  'uid-vde': { role: 'vendedor', email: 'vde@shimano.com.ar', vendor: 'VDE TEST' },
  'uid-admin': { role: 'admin', email: 'admin@shimano.com.ar' },
};

function makeMockDb({ waitlist, pedidos = {}, roles = ROLES_FIXTURE }) {
  const state = {
    roles,
    revision_waitlist: waitlist ? { 'wl-origen': waitlist } : {},
    pedidos,
    operations_log: {},
  };
  const writes = [];
  const makeDocRef = (col, id) => ({
    id,
    async get() {
      const d = state[col] && state[col][id];
      return { exists: !!d, id, data: () => d };
    },
    async update(data) {
      state[col][id] = { ...(state[col][id] || {}), ...data };
      writes.push({ op: 'update', path: `${col}/${id}`, data });
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
      writes.push({ op: 'set', path: `${col}/${id}`, data });
    },
    async delete() {
      delete state[col][id];
      writes.push({ op: 'delete', path: `${col}/${id}` });
    },
  });
  return {
    _state: state,
    _writes: writes,
    collection(name) {
      return {
        doc(id) {
          return makeDocRef(name, id);
        },
        async add(data) {
          const id = 'auto_' + Math.random().toString(36).slice(2, 8);
          state[name] ||= {};
          state[name][id] = data;
          writes.push({ op: 'add', path: `${name}/${id}`, data });
          return { id };
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
        set(ref, data) {
          return ref.set(data);
        },
        delete(ref) {
          return ref.delete();
        },
      };
      return fn(tx);
    },
  };
}

const AUTH_VDE = {
  uid: 'uid-vde',
  token: { email: 'vde@shimano.com.ar' },
};

function makeWaitlist(items, origenPedidoId = 'ped-origen') {
  return {
    _id: 'wl-origen',
    clientName: 'CLIENTE TEST',
    clientCardCode: 'C001',
    orderNumber: 999,
    ownerUid: 'uid-vde',
    assignedVendorUid: 'uid-vde',
    items,
    pedidosOrigenes: [{ pedidoId: origenPedidoId, lineIndex: 0, sku: 'SKU-A', qtyAsignada: 3 }],
  };
}

function makePedidoOrigen(linesExtras = []) {
  // Pedido con la línea ASIG que será cancelada + líneas extras opcionales.
  return {
    clientCardCode: 'C001',
    clientName: 'CLIENTE TEST',
    ownerUid: 'uid-pablo',
    assignedVendorUid: 'uid-vde',
    closedAt: null,
    lines: [{ code: 'SKU-A', state: 'ASIG', qty: 3, qtyOpen: 3 }, ...linesExtras],
  };
}

describe('PR G v1579 §Decisión-5 — flag confirmedLastItemRemoval requerido para último item', () => {
  it('T21 remove_item del último sin flag → REBOTA con LAST_ITEM_NEEDS_CONFIRM', async () => {
    const wl = makeWaitlist([
      {
        code: 'SKU-A',
        qty: 3,
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
      },
    ]);
    const fbDb = makeMockDb({
      waitlist: wl,
      pedidos: { 'ped-origen': makePedidoOrigen() },
    });
    await expect(
      releaseAsigCore(
        { fbDb, log: vi.fn(), now: () => NOW },
        { auth: AUTH_VDE, action: 'remove_item', waitlistId: 'wl-origen', itemIndex: 0 }
      )
    ).rejects.toMatchObject({
      _errorCode: 'failed-precondition',
      _errorDetails: { errorCode: 'LAST_ITEM_NEEDS_CONFIRM' },
    });
  });

  it('T22 remove_item del último CON flag=true → procede', async () => {
    const wl = makeWaitlist([
      {
        code: 'SKU-A',
        qty: 3,
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
      },
    ]);
    const fbDb = makeMockDb({
      waitlist: wl,
      pedidos: { 'ped-origen': makePedidoOrigen() },
    });
    const r = await releaseAsigCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        auth: AUTH_VDE,
        action: 'remove_item',
        waitlistId: 'wl-origen',
        itemIndex: 0,
        confirmedLastItemRemoval: true,
      }
    );
    expect(r.ok).toBe(true);
  });

  it('T23 remove_item NO del último (quedan items) → NO pide flag, procede', async () => {
    const wl = makeWaitlist([
      {
        code: 'SKU-A',
        qty: 3,
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
      },
      { code: 'SKU-B', qty: 2 },
    ]);
    const fbDb = makeMockDb({
      waitlist: wl,
      pedidos: { 'ped-origen': makePedidoOrigen() },
    });
    const r = await releaseAsigCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      { auth: AUTH_VDE, action: 'remove_item', waitlistId: 'wl-origen', itemIndex: 0 }
    );
    // Sin flag, pero no es el último → pasa.
    expect(r.ok).toBe(true);
  });

  it('T24 rechazo_cpst NO requiere flag (solo remove_item)', async () => {
    const wl = makeWaitlist([
      {
        code: 'SKU-A',
        qty: 3,
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
      },
    ]);
    const fbDb = makeMockDb({
      waitlist: wl,
      pedidos: { 'ped-origen': makePedidoOrigen() },
    });
    const r = await releaseAsigCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      { auth: AUTH_VDE, action: 'rechazo_cpst', waitlistId: 'wl-origen' }
    );
    expect(r.ok).toBe(true);
  });
});

describe('PR G v1579 §Decisión-4 — cierre automático del pedido origen vacío tras remove_item', () => {
  it('T25 remove_item del último → pedido origen queda cerrado con closedReason v1579', async () => {
    const wl = makeWaitlist([
      {
        code: 'SKU-A',
        qty: 3,
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
      },
    ]);
    const fbDb = makeMockDb({
      waitlist: wl,
      pedidos: { 'ped-origen': makePedidoOrigen() }, // única línea = ASIG SKU-A
    });
    const r = await releaseAsigCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        auth: AUTH_VDE,
        action: 'remove_item',
        waitlistId: 'wl-origen',
        itemIndex: 0,
        confirmedLastItemRemoval: true,
      }
    );
    expect(r.ok).toBe(true);
    expect(r.pedidosCerradosPorVacio).toEqual(['ped-origen']);
    // Verificar que el pedido efectivamente quedó con closedAt + closedReason.
    const ped = fbDb._state.pedidos['ped-origen'];
    expect(ped.closedAt).toBeTruthy();
    expect(ped.closedReason).toBe('empty_after_asig_recycle_v1579');
    expect(ped.closedBy).toBe('uid-vde');
  });

  it('T26 remove_item PERO el pedido origen tiene otras líneas abiertas → NO cierra', async () => {
    const wl = makeWaitlist([
      {
        code: 'SKU-A',
        qty: 3,
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
      },
    ]);
    const fbDb = makeMockDb({
      waitlist: wl,
      pedidos: {
        'ped-origen': makePedidoOrigen([
          { code: 'SKU-B', state: 'ASIG', qty: 1, qtyOpen: 1 }, // otra línea abierta
        ]),
      },
    });
    const r = await releaseAsigCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        auth: AUTH_VDE,
        action: 'remove_item',
        waitlistId: 'wl-origen',
        itemIndex: 0,
        confirmedLastItemRemoval: true,
      }
    );
    expect(r.ok).toBe(true);
    expect(r.pedidosCerradosPorVacio).toEqual([]);
    const ped = fbDb._state.pedidos['ped-origen'];
    expect(ped.closedAt).toBeFalsy();
  });

  it('T27 rechazo_cpst NO dispara cierre auto (scope A: solo remove_item)', async () => {
    const wl = makeWaitlist([
      {
        code: 'SKU-A',
        qty: 3,
        asigRefs: [{ pedidoId: 'ped-origen', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-A' }],
      },
    ]);
    const fbDb = makeMockDb({
      waitlist: wl,
      pedidos: { 'ped-origen': makePedidoOrigen() },
    });
    const r = await releaseAsigCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      { auth: AUTH_VDE, action: 'rechazo_cpst', waitlistId: 'wl-origen' }
    );
    expect(r.ok).toBe(true);
    // Scope A pregunta 1: solo remove_item cierra; rechazo_cpst no.
    expect(r.pedidosCerradosPorVacio).toEqual([]);
  });
});

describe('PR G v1579 §mensajes — LAST_ITEM_NEEDS_CONFIRM', () => {
  it('T28 entry presente en MENSAJES_VENDEDOR con confirmLabel', async () => {
    const { MENSAJES_VENDEDOR } = await import('../../src/pure/mensajes-vendedor.js');
    expect(MENSAJES_VENDEDOR.LAST_ITEM_NEEDS_CONFIRM).toBeTruthy();
    expect(MENSAJES_VENDEDOR.LAST_ITEM_NEEDS_CONFIRM.texto).toMatch(/vac[ií]a/i);
    expect(MENSAJES_VENDEDOR.LAST_ITEM_NEEDS_CONFIRM.confirmLabel).toBeTruthy();
  });

  it('T29 fallback bundle stale incluye el código', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('index.html', 'utf8');
    const idx = src.indexOf('_SERVER_ERROR_FALLBACK_TEXTS = {');
    const slice = src.slice(idx, idx + 3000);
    expect(slice).toMatch(/LAST_ITEM_NEEDS_CONFIRM:\s*['"]/);
  });
});

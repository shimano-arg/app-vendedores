// @ts-check
/**
 * §Decisión-1 v<N> P0-B (2026-11-25) — gate INTERNO_CLIENTE_FUERA_DE_PAREJA
 * usa shape canónico VDE→interno (query inversa).
 *
 * El gate v1577 original leía `roles/<internoUid>.internalPartnerUid`
 * single-value, asumiendo shape invertido que no existe en prod. Shape canónico
 * es `roles/<uidVDE>.internalPartnerUid = <uidInterno>` (varios VDEs → 1 interno).
 *
 * T1-T11 cubren los escenarios pedidos en el stack relaunch:
 * - T1-T2: Ioannis + Gonzalo ✓ / Ioannis + Federico ✓.
 * - T3-T4: Ioannis + Pachi ✗ / Ioannis + Mauricio ✗ → INTERNO_CLIENTE_FUERA_DE_PAREJA.
 * - T5-T6: Santiago + Pachi ✓ / Santiago + Mauricio ✓.
 * - T7-T8: Santiago + Gonzalo ✗ / Santiago + Federico ✗.
 * - T9: Interno sin ningún VDE pareja → reason='interno_sin_pareja'.
 * - T10: Vendedor sin rol de interno → gate NO aplica.
 * - T11: Firestore query falla → fail-close (reason='pareja_query_failed').
 */
import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../../functions/core/commit-pedido-core.js';

const NOW = new Date('2026-11-25T14:00:00Z');

// === Fixture: dos internos × dos parejas VDE ===
// Shape canónico prod: `roles/<uidVDE>.internalPartnerUid = <uidInterno>`.
// Ioannis (interno) tiene como pareja a Gonzalo + Federico.
// Santiago (interno) tiene como pareja a Pachi + Mauricio.

const INTERNO_IOANNIS_UID = 'uid-interno-ioannis';
const INTERNO_SANTIAGO_UID = 'uid-interno-santiago';

const VDE_GONZALO_UID = 'uid-vde-gonzalo';
const VDE_FEDERICO_UID = 'uid-vde-federico';
const VDE_PACHI_UID = 'uid-vde-pachi';
const VDE_MAURICIO_UID = 'uid-vde-mauricio';

const ROLES_FIXTURE = {
  [INTERNO_IOANNIS_UID]: {
    role: 'interno',
    email: 'ioannis@shimano.com.ar',
  },
  [INTERNO_SANTIAGO_UID]: {
    role: 'interno',
    email: 'santiago@shimano.com.ar',
  },
  [VDE_GONZALO_UID]: {
    role: 'vendedor',
    email: 'gonzalo@shimano.com.ar',
    vendor: 'GONZALO DE LA ROSA',
    internalPartnerUid: INTERNO_IOANNIS_UID,
  },
  [VDE_FEDERICO_UID]: {
    role: 'vendedor',
    email: 'federico@shimano.com.ar',
    vendor: 'FEDERICO CASTELANELLI',
    internalPartnerUid: INTERNO_IOANNIS_UID,
  },
  [VDE_PACHI_UID]: {
    role: 'vendedor',
    email: 'pachi@shimano.com.ar',
    vendor: 'PACHI',
    internalPartnerUid: INTERNO_SANTIAGO_UID,
  },
  [VDE_MAURICIO_UID]: {
    role: 'vendedor',
    email: 'mauricio@shimano.com.ar',
    vendor: 'MAURICIO GIL',
    internalPartnerUid: INTERNO_SANTIAGO_UID,
  },
};

// Approved altas: un cliente por VDE.
const ALTAS = [
  {
    cardCodeSap: 'C-GONZALO',
    comercio: 'CLIENTE GONZALO',
    fantasia: 'CLIENTE GONZALO',
    assignedVendor: 'GONZALO DE LA ROSA',
    status: 'approved',
  },
  {
    cardCodeSap: 'C-FEDERICO',
    comercio: 'CLIENTE FEDERICO',
    fantasia: 'CLIENTE FEDERICO',
    assignedVendor: 'FEDERICO CASTELANELLI',
    status: 'approved',
  },
  {
    cardCodeSap: 'C-PACHI',
    comercio: 'CLIENTE PACHI',
    fantasia: 'CLIENTE PACHI',
    assignedVendor: 'PACHI',
    status: 'approved',
  },
  {
    cardCodeSap: 'C-MAURICIO',
    comercio: 'CLIENTE MAURICIO',
    fantasia: 'CLIENTE MAURICIO',
    assignedVendor: 'MAURICIO GIL',
    status: 'approved',
  },
];

function makeMockDb({ roles = ROLES_FIXTURE, approvedAltas = ALTAS, queryThrows = false } = {}) {
  const state = {
    roles,
    client_applications: approvedAltas.map((a, i) => ({
      id: 'alta_' + i,
      data: () => Object.assign({ status: 'approved' }, a),
    })),
    app_config: {
      stock_snapshot: {
        updatedAt: new Date(NOW.getTime() - 1000),
        warehouseBreakdown: JSON.stringify({}),
        quantities: JSON.stringify({}),
      },
    },
    pedidos: {},
    revision_waitlist: {},
    operations_log: {},
    pedido_draft_locks: {},
  };
  const makeColRef = (name) => ({
    doc(id) {
      return {
        async get() {
          const d = state[name] && state[name][id];
          return {
            exists: !!d,
            id,
            data: () => d,
            ref: this,
          };
        },
        async set() {
          return;
        },
        async update() {
          return;
        },
      };
    },
    async add() {
      return { id: 'auto_' + Math.random().toString(36).slice(2, 10) };
    },
    where(field, op, val) {
      const chainable = {
        limit() {
          return chainable;
        },
        async get() {
          // T11: simular throw cuando la query es contra roles.internalPartnerUid.
          if (queryThrows && name === 'roles' && field === 'internalPartnerUid') {
            throw new Error('Firestore unavailable');
          }
          let docs = [];
          if (name === 'client_applications') {
            docs = state.client_applications.filter((d) => d.data()[field] === val);
          } else if (name === 'roles') {
            docs = Object.entries(state.roles)
              .filter(([_, d]) => d && d[field] === val)
              .map(([id, d]) => ({ id, data: () => d }));
          } else {
            docs = [];
          }
          return {
            empty: docs.length === 0,
            size: docs.length,
            forEach: (cb) => docs.forEach(cb),
            docs,
          };
        },
      };
      return chainable;
    },
  });
  return {
    collection: makeColRef,
    doc(path) {
      const [col, id] = path.split('/');
      return makeColRef(col).doc(id);
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set() {},
        update() {},
      };
      return fn(tx);
    },
  };
}

function makePayload(overrides) {
  return Object.assign(
    {
      ownerUid: INTERNO_IOANNIS_UID,
      ownerEmail: 'ioannis@shimano.com.ar',
      vendorAssigned: '',
      assignedVendorUid: '',
      assignedVendorEmail: '',
      clientName: 'CLIENTE TEST',
      cardCode: 'C-TEST',
      lines: [{ sku: 'TEST-SKU', cantidad: 1, state: 'confirmed', precio: 100 }],
      draftId: 'C-TEST|' + Math.random().toString(36).slice(2, 10),
      orderNumber: 100,
      clientProvince: 'BUENOS AIRES',
      clientLocality: 'CABA',
      key: 'C|BUENOS AIRES|CABA|CLIENTE TEST|100',
      origen: 'manual',
      minVersion: 'v1577',
      clientVersion: 'v1577',
    },
    overrides
  );
}

function makeDeps({ callerRole = 'interno', queryThrows = false } = {}) {
  const fbDb = makeMockDb({ queryThrows });
  return {
    fbDb,
    callerRole,
    log: vi.fn(),
    now: () => NOW,
  };
}

describe('§Decisión-1 P0-B — gate interno shape canónico VDE→interno', () => {
  // === Ioannis (interno) → Gonzalo + Federico (sus VDEs) ===

  it('T1 Ioannis + cliente de Gonzalo → gate pasa', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_IOANNIS_UID,
      cardCode: 'C-GONZALO',
      clientName: 'CLIENTE GONZALO',
      vendorAssigned: 'GONZALO DE LA ROSA',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  it('T2 Ioannis + cliente de Federico → gate pasa', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_IOANNIS_UID,
      cardCode: 'C-FEDERICO',
      clientName: 'CLIENTE FEDERICO',
      vendorAssigned: 'FEDERICO CASTELANELLI',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  // === Ioannis + clientes de la OTRA pareja (Santiago) → REBOTA ===

  it('T3 Ioannis + cliente de Pachi (otra pareja) → REBOTA', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_IOANNIS_UID,
      cardCode: 'C-PACHI',
      clientName: 'CLIENTE PACHI',
      vendorAssigned: 'PACHI',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    expect(r.data && r.data.reason).toBe('cliente_de_otra_pareja');
    expect(r.message).toMatch(/PACHI/);
  });

  it('T4 Ioannis + cliente de Mauricio (otra pareja) → REBOTA', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_IOANNIS_UID,
      cardCode: 'C-MAURICIO',
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    expect(r.data && r.data.reason).toBe('cliente_de_otra_pareja');
    expect(r.message).toMatch(/MAURICIO GIL/);
  });

  // === Santiago (interno) → Pachi + Mauricio (sus VDEs) ===

  it('T5 Santiago + cliente de Pachi → gate pasa', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_SANTIAGO_UID,
      ownerEmail: 'santiago@shimano.com.ar',
      cardCode: 'C-PACHI',
      clientName: 'CLIENTE PACHI',
      vendorAssigned: 'PACHI',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  it('T6 Santiago + cliente de Mauricio → gate pasa', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_SANTIAGO_UID,
      ownerEmail: 'santiago@shimano.com.ar',
      cardCode: 'C-MAURICIO',
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  // === Santiago + clientes de la OTRA pareja (Ioannis) → REBOTA ===

  it('T7 Santiago + cliente de Gonzalo (otra pareja) → REBOTA', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_SANTIAGO_UID,
      ownerEmail: 'santiago@shimano.com.ar',
      cardCode: 'C-GONZALO',
      clientName: 'CLIENTE GONZALO',
      vendorAssigned: 'GONZALO DE LA ROSA',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    expect(r.data && r.data.reason).toBe('cliente_de_otra_pareja');
  });

  it('T8 Santiago + cliente de Federico (otra pareja) → REBOTA', async () => {
    const deps = makeDeps({ callerRole: 'interno' });
    const payload = makePayload({
      ownerUid: INTERNO_SANTIAGO_UID,
      ownerEmail: 'santiago@shimano.com.ar',
      cardCode: 'C-FEDERICO',
      clientName: 'CLIENTE FEDERICO',
      vendorAssigned: 'FEDERICO CASTELANELLI',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    expect(r.data && r.data.reason).toBe('cliente_de_otra_pareja');
  });

  // === Edge cases ===

  it('T9 interno sin ningún VDE pareja → REBOTA con reason=interno_sin_pareja', async () => {
    // Fixture: interno sin ningún VDE que apunte a él.
    const rolesSinVde = {
      'uid-interno-huerfano': {
        role: 'interno',
        email: 'huerfano@shimano.com.ar',
      },
      [VDE_MAURICIO_UID]: {
        role: 'vendedor',
        vendor: 'MAURICIO GIL',
        // sin internalPartnerUid apuntando al huerfano
      },
    };
    const fbDb = makeMockDb({ roles: rolesSinVde });
    const deps = { fbDb, callerRole: 'interno', log: vi.fn(), now: () => NOW };
    const payload = makePayload({
      ownerUid: 'uid-interno-huerfano',
      cardCode: 'C-MAURICIO',
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    expect(r.data && r.data.reason).toBe('interno_sin_pareja');
  });

  it('T10 vendedor (no interno) crea para cliente propio → gate NO aplica', async () => {
    const deps = makeDeps({ callerRole: 'vendedor' });
    const payload = makePayload({
      ownerUid: VDE_MAURICIO_UID,
      ownerEmail: 'mauricio@shimano.com.ar',
      cardCode: 'C-MAURICIO',
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    // callerRole === 'vendedor' → no entra al gate interno.
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  it('T11 Firestore query falla → fail-close con reason=pareja_query_failed', async () => {
    const deps = makeDeps({ callerRole: 'interno', queryThrows: true });
    const payload = makePayload({
      ownerUid: INTERNO_IOANNIS_UID,
      cardCode: 'C-GONZALO',
      clientName: 'CLIENTE GONZALO',
      vendorAssigned: 'GONZALO DE LA ROSA',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    expect(r.data && r.data.reason).toBe('pareja_query_failed');
  });
});

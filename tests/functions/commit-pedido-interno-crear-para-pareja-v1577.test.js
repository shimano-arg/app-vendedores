// @ts-check
/**
 * PR E v1577 §Decisión-1 (2026-11-25) — Interno solo crea pedidos para
 * clientes de su VDE pareja.
 *
 * Decisión B pregunta 1 (permisivo cliente sin vendor master): si el
 * cliente no resuelve a NINGÚN vendedor, permitir.
 * Decisión B pregunta 2: mensaje con nombre del vendor propietario.
 * Decisión A pregunta 3: recompute SIEMPRE (todos los roles, servidor es
 * autoridad única).
 *
 * Tests:
 * - T1 admin crea → OK (gate interno NO aplica).
 * - T2 VDE crea para cliente propio → OK.
 * - T3 interno crea para cliente de su pareja → OK.
 * - T4 interno crea para cliente SIN vendor master → OK (decisión B).
 * - T5 interno crea para cliente de OTRA pareja → REBOTA
 *   con INTERNO_CLIENTE_FUERA_DE_PAREJA + mensaje con nombre vendor.
 * - T6 interno sin internalPartnerUid → REBOTA (fail-closed).
 * - T7 recompute siempre: payload mentiroso del cliente es sobreescrito.
 */
import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

const NOW = new Date('2026-11-25T14:00:00Z');

function makeMockDb({ roles = {}, approvedAltas = [] } = {}) {
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
          let docs = [];
          if (name === 'client_applications') {
            docs = state.client_applications.filter((d) => d.data()[field] === val);
          } else if (name === 'roles') {
            // Simular where('role','==',X).
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
      ownerUid: 'interno-uid',
      ownerEmail: 'interno@shimano.com.ar',
      vendorAssigned: '',
      assignedVendorUid: '',
      assignedVendorEmail: '',
      clientName: 'CLIENTE TEST',
      cardCode: 'C001',
      // Línea mínima válida para pasar validatePayload. El gate interno v1577
      // dispara pre-tx; no interesa que el tx succeed — el test verifica que
      // el errorCode retornado sea el del gate (o pase el gate si corresponde).
      lines: [{ sku: 'TEST-SKU', cantidad: 1, state: 'confirmed', precio: 100 }],
      draftId: 'C001|TEST|' + Math.random().toString(36).slice(2, 8),
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

const VDE_FEDERICO_UID = 'vde-federico-uid';
const VDE_MAURICIO_UID = 'vde-mauricio-uid';
const INTERNO_UID = 'int-samer-uid';

/** Roles fixture: Samer interno con pareja Federico. */
const ROLES_FIXTURE = {
  [INTERNO_UID]: {
    role: 'interno',
    email: 'samer@shimano.com.ar',
    internalPartnerUid: VDE_FEDERICO_UID,
  },
  [VDE_FEDERICO_UID]: {
    role: 'vendedor',
    email: 'federico@shimano.com.ar',
    vendor: 'FEDERICO CASTELANELLI',
    internalPartnerUid: INTERNO_UID,
  },
  [VDE_MAURICIO_UID]: {
    role: 'vendedor',
    email: 'mauricio@shimano.com.ar',
    vendor: 'MAURICIO GIL',
  },
};

function makeDeps({ callerRole, callerUid = INTERNO_UID, approvedAltas = [] } = {}) {
  const fbDb = makeMockDb({ roles: ROLES_FIXTURE, approvedAltas });
  return {
    fbDb,
    callerRole,
    log: vi.fn(),
    now: () => NOW,
  };
}

// Caso usado en varios tests: alta cliente asignada a FEDERICO (pareja de SAMER).
const ALTA_FEDERICO = {
  cardCodeSap: 'C001',
  comercio: 'CLIENTE TEST',
  fantasia: 'CLIENTE TEST',
  assignedVendor: 'FEDERICO CASTELANELLI',
  status: 'approved',
};

// Caso: alta cliente asignada a MAURICIO (otra pareja).
const ALTA_MAURICIO = {
  cardCodeSap: 'C002',
  comercio: 'CLIENTE MAURICIO',
  fantasia: 'CLIENTE MAURICIO',
  assignedVendor: 'MAURICIO GIL',
  status: 'approved',
};

describe('PR E v1577 §Decisión-1 — Interno crea pedidos solo para clientes pareja', () => {
  it('T1 admin crea pedido para cualquier cliente → gate interno NO aplica', async () => {
    const deps = makeDeps({
      callerRole: 'admin',
      approvedAltas: [ALTA_FEDERICO, ALTA_MAURICIO],
    });
    const payload = makePayload({
      ownerUid: 'admin-uid',
      cardCode: 'C002', // cliente de Mauricio
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    // No debe rechazar por INTERNO_CLIENTE_FUERA_DE_PAREJA.
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  it('T2 VDE crea pedido para cliente propio → gate interno NO aplica', async () => {
    const deps = makeDeps({
      callerRole: 'vendedor',
      approvedAltas: [ALTA_MAURICIO],
    });
    const payload = makePayload({
      ownerUid: VDE_MAURICIO_UID,
      cardCode: 'C002',
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  it('T3 interno crea pedido para cliente de SU pareja → gate pasa', async () => {
    const deps = makeDeps({
      callerRole: 'interno',
      approvedAltas: [ALTA_FEDERICO],
    });
    const payload = makePayload({
      ownerUid: INTERNO_UID,
      cardCode: 'C001', // cliente de Federico (pareja de Samer)
      clientName: 'CLIENTE TEST',
      vendorAssigned: 'FEDERICO CASTELANELLI',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  it('T4 interno crea pedido para cliente SIN vendor master → gate pasa (decisión B)', async () => {
    const deps = makeDeps({
      callerRole: 'interno',
      approvedAltas: [], // ningún alta aprobada para C001
    });
    const payload = makePayload({
      ownerUid: INTERNO_UID,
      cardCode: 'C999-NUEVO',
      clientName: 'CLIENTE PROSPECTO SIN ZONA',
      vendorAssigned: '', // cliente no está en master
    });
    const r = await commitPedidoCore(deps, payload);
    // Decisión B: cliente sin vendor master → permitir al interno.
    expect(r.errorCode === 'INTERNO_CLIENTE_FUERA_DE_PAREJA').toBe(false);
  });

  it('T5 interno crea pedido para cliente de OTRA pareja → REBOTA con nombre', async () => {
    const deps = makeDeps({
      callerRole: 'interno',
      approvedAltas: [ALTA_MAURICIO], // cliente asignado a MAURICIO, no FEDERICO
    });
    const payload = makePayload({
      ownerUid: INTERNO_UID,
      cardCode: 'C002', // cliente de Mauricio (otra pareja)
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    // El mensaje debe mencionar el nombre del vendor propietario.
    expect(r.message).toMatch(/MAURICIO GIL/);
    expect(r.data && r.data.reason).toBe('cliente_de_otra_pareja');
  });

  it('T6 interno SIN internalPartnerUid → REBOTA fail-closed', async () => {
    const rolesSinPareja = {
      [INTERNO_UID]: {
        role: 'interno',
        email: 'samer@shimano.com.ar',
        // sin internalPartnerUid
      },
      [VDE_MAURICIO_UID]: {
        role: 'vendedor',
        vendor: 'MAURICIO GIL',
      },
    };
    const fbDb = makeMockDb({ roles: rolesSinPareja, approvedAltas: [ALTA_MAURICIO] });
    const deps = {
      fbDb,
      callerRole: 'interno',
      log: vi.fn(),
      now: () => NOW,
    };
    const payload = makePayload({
      ownerUid: INTERNO_UID,
      cardCode: 'C002',
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    expect(r.data && r.data.reason).toBe('interno_sin_pareja');
  });

  it('T8 F1 adversarial — fail-closed pattern presente en el source (resolve throw → interno rebota con master_unreadable)', async () => {
    // El helper resolveClientVendorServerSide es tolerante internamente
    // (try/catch por colección). Probar "throw real" requiere mockear el
    // helper entero, que no es inyectable hoy. En su lugar validamos el
    // contrato en el source: existe `_resolveThrewException` flag y se usa
    // para gatillar fail-close con reason='master_unreadable' cuando el
    // caller es interno. F1 adversarial PR E v1577.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'functions/core/commit-pedido-core.js'),
      'utf8'
    );
    // 1. Variable flag definida.
    expect(src).toMatch(/let _resolveThrewException = false/);
    // 2. Flag se setea a true en el catch del resolve.
    expect(src).toMatch(/_resolveThrewException = true/);
    // 3. Gate interno checkea el flag ANTES de la rama permisiva.
    expect(src).toMatch(/if \(_resolveThrewException\)/);
    // 4. Fail-close con reason master_unreadable.
    expect(src).toMatch(/reason: 'master_unreadable'/);
    // 5. Retorna INTERNO_CLIENTE_FUERA_DE_PAREJA en ese path.
    const idxThrow = src.indexOf('if (_resolveThrewException)');
    expect(idxThrow).toBeGreaterThan(0);
    const sliceAfter = src.slice(idxThrow, idxThrow + 1500);
    expect(sliceAfter).toMatch(/INTERNO_CLIENTE_FUERA_DE_PAREJA/);
  });

  it('T9 Punto-3 adversarial — interno + cliente con reason=vendor_sin_uid → REBOTA (no permisivo)', async () => {
    // Cliente en master con vendorKey='MAURICIO GIL' pero sin user en roles.
    // No puede caer en rama permisiva — es indistinguible de "otra pareja".
    const rolesSinMauricio = {
      [INTERNO_UID]: {
        role: 'interno',
        email: 'samer@shimano.com.ar',
        internalPartnerUid: VDE_FEDERICO_UID,
      },
      [VDE_FEDERICO_UID]: {
        role: 'vendedor',
        vendor: 'FEDERICO CASTELANELLI',
        internalPartnerUid: INTERNO_UID,
      },
      // Nota: sin VDE_MAURICIO_UID — alta apunta a 'MAURICIO GIL' sin user.
    };
    const fbDb = makeMockDb({ roles: rolesSinMauricio, approvedAltas: [ALTA_MAURICIO] });
    const deps = { fbDb, callerRole: 'interno', log: vi.fn(), now: () => NOW };
    const payload = makePayload({
      ownerUid: INTERNO_UID,
      cardCode: 'C002',
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'MAURICIO GIL',
    });
    const r = await commitPedidoCore(deps, payload);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INTERNO_CLIENTE_FUERA_DE_PAREJA');
    // reason debe ser master_incompleto (vendor_sin_uid o zona_sin_vendedor).
    expect(r.data && r.data.reason).toBe('master_incompleto');
  });

  it('T7 recompute siempre (decisión A): payload mentiroso del cliente es sobreescrito', async () => {
    // El VDE Mauricio (otra pareja) envía payload con vendorAssigned='FEDERICO'
    // para intentar que el interno de Federico lo pueda editar. El servidor
    // debe recomputar y encontrar MAURICIO.
    const deps = makeDeps({
      callerRole: 'admin', // admin para que no bloquee el gate interno
      approvedAltas: [ALTA_MAURICIO],
    });
    const payload = makePayload({
      ownerUid: 'admin-uid',
      cardCode: 'C002', // en el master es de MAURICIO
      clientName: 'CLIENTE MAURICIO',
      vendorAssigned: 'FEDERICO CASTELANELLI', // ¡mentira!
      assignedVendorUid: VDE_FEDERICO_UID, // ¡mentira!
    });
    const r = await commitPedidoCore(deps, payload);
    // No bloqueado por gate interno (es admin), pero el payload debe
    // haber sido sobreescrito con MAURICIO (recompute siempre).
    // Si el commit siguió al tx y persistió algo, el pedido tendría
    // vendorAssigned='MAURICIO GIL' no 'FEDERICO'.
    // (verificamos via el helper _assignedVendorResolvedServerSide flag).
    expect(/** @type {any} */ (payload)._assignedVendorResolvedServerSide).toBe(true);
    expect(payload.vendorAssigned).toBe('MAURICIO GIL');
    expect(payload.assignedVendorUid).toBe(VDE_MAURICIO_UID);
  });
});

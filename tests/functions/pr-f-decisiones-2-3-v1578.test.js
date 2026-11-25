// @ts-check
/**
 * PR F v1578 §Decisiones-2-3 (2026-11-25) — VDE/interno confirman pedidos
 * cargados por otros + interno mueve a lista de espera pedidos de pareja.
 *
 * Decisión 2A (waitlist → pedido): VDE solo consume waitlist si él es
 * assignedVendorUid o ownerUid de la waitlist. Si no, rebota con
 * VENDEDOR_WAITLIST_FUERA_CLIENTE.
 *
 * Decisión 3 (interno mueve a lista de espera): pedidos propios O de la
 * pareja. Antes bloqueaba via='pareja' con INTERNO_SOLO_PEDIDO_PROPIO; ahora
 * acepta ambos. ownerUid del waitlist resultante preserva el pedido original
 * (líneas 961 del core, ya existente).
 */
import { describe, expect, it } from 'vitest';

describe('PR F v1578 §Decisión-2A — gate VDE waitlist origen en commit-pedido-core', () => {
  it('T10 el bloque gate VDE existe en el source (contrato)', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('functions/core/commit-pedido-core.js', 'utf8');
    // Constante y mensaje nuevos exportados implícitamente al module.
    expect(src).toMatch(
      /VENDEDOR_WAITLIST_FUERA_CLIENTE\s*=\s*['"]VENDEDOR_WAITLIST_FUERA_CLIENTE['"]/
    );
    expect(src).toMatch(/VENDEDOR_WAITLIST_FUERA_CLIENTE_MESSAGE/);
    // Gate dispara con throwError.
    const idxGate = src.lastIndexOf('§Decisión-2A');
    expect(idxGate).toBeGreaterThan(0);
    const slice = src.slice(idxGate, idxGate + 2500);
    expect(slice).toMatch(/callerRole === 'vendedor'/);
    expect(slice).toMatch(/waitlistOrigenSnap/);
    expect(slice).toMatch(/wlAssignedVendorUid/);
    expect(slice).toMatch(/wlOwnerUid/);
    expect(slice).toMatch(/throwError\(VENDEDOR_WAITLIST_FUERA_CLIENTE/);
  });

  it('T11 el gate acepta match por assignedVendorUid O ownerUid de la waitlist', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('functions/core/commit-pedido-core.js', 'utf8');
    const idxGate = src.lastIndexOf('§Decisión-2A');
    const slice = src.slice(idxGate, idxGate + 2500);
    // Dos condiciones de match.
    expect(slice).toMatch(/matchAssigned\s*=/);
    expect(slice).toMatch(/matchOwner\s*=/);
    // Rechazo solo si NINGUNA matchea.
    expect(slice).toMatch(/!matchAssigned && !matchOwner/);
  });
});

describe('PR F v1578 §Decisión-3 — interno mueve a espera pedidos de pareja', () => {
  it('T12 el gate interno ya NO exige via="propio" (acepta propio o pareja)', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('functions/core/move-pedido-to-waitlist-core.js', 'utf8');
    // Antes había 2 ocurrencias de `scope.ok && scope.via === 'propio'`.
    // Ahora cada una se reemplazó por `scope.ok` (acepta propio o pareja).
    // Verificamos que las 2 líneas CLAVE no tengan el restrictivo.
    expect(src).toMatch(/PR F v1578 §Decisión-3/);
    // La función debe aceptar via='pareja' — no debe haber `!(scope.ok && scope.via === 'propio')`
    // en el flow principal (líneas 417 y 616 del core).
    const occurrencesStrict = (src.match(/!\(scope\.ok && scope\.via === 'propio'\)/g) || [])
      .length;
    expect(occurrencesStrict).toBe(0);
    const occurrencesStrictFresh = (
      src.match(/!\(freshScope\.ok && freshScope\.via === 'propio'\)/g) || []
    ).length;
    expect(occurrencesStrictFresh).toBe(0);
  });

  it('T13 el ownerUid del waitlist resultante preserva el del pedido original (ya existente)', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('functions/core/move-pedido-to-waitlist-core.js', 'utf8');
    // Línea 961 del core: ownerUid: fresh_data.ownerUid || auth.uid.
    expect(src).toMatch(/ownerUid:\s*fresh_data\.ownerUid\s*\|\|\s*auth\.uid/);
  });

  it('T14 el gate mkInternoScopeErr diferencia "SOLO_PROPIO" vs "FUERA_DE_PAREJA"', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('functions/core/move-pedido-to-waitlist-core.js', 'utf8');
    // mkInternoScopeErr sigue existiendo, pero la rama via='pareja' ahora
    // no se dispara en los call-sites del flow principal (porque con
    // scope.ok=true + via='pareja' se acepta antes). El errorCode queda
    // disponible para edge cases (ej. ownership delete que sigue denegado).
    expect(src).toMatch(/INTERNO_SOLO_PEDIDO_PROPIO/);
    expect(src).toMatch(/INTERNO_FUERA_DE_PAREJA/);
  });
});

describe('PR F v1578 §Decisión-2A — tests behavioral runtime (F2 adversarial)', () => {
  // Fixtures mínimas para probar el gate VDE sobre waitlist origen.
  const VDE_PROPIO = 'uid-vde-propio';
  const VDE_OTRO = 'uid-vde-otro';

  function makeMockDb({ waitlist }) {
    const state = {
      roles: {
        [VDE_PROPIO]: { role: 'vendedor', vendor: 'VDE PROPIO' },
        [VDE_OTRO]: { role: 'vendedor', vendor: 'VDE OTRO' },
      },
      revision_waitlist: { 'wl-origen': waitlist },
      app_config: {
        stock_snapshot: {
          updatedAt: new Date('2026-11-25T14:00:00Z'),
          warehouseBreakdown: JSON.stringify({ 'TEST-SKU': { 11: 100, 12: 0 } }),
          quantities: JSON.stringify({ 'TEST-SKU': 100 }),
        },
      },
      pedidos: {},
      operations_log: {},
      pedido_draft_locks: {},
    };
    const makeColRef = (name) => ({
      doc(id) {
        return {
          async get() {
            const d = state[name] && state[name][id];
            return { exists: !!d, id, data: () => d };
          },
          async set() {},
          async update() {},
        };
      },
      async add() {
        return { id: 'auto_' + Math.random().toString(36).slice(2, 8) };
      },
      where() {
        const chainable = {
          limit() {
            return chainable;
          },
          async get() {
            return {
              empty: true,
              size: 0,
              forEach: () => {},
              docs: [],
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
        return fn({
          async get(ref) {
            return ref.get();
          },
          set() {},
          update() {},
        });
      },
    };
  }

  function makePayload(ownerUid) {
    return {
      ownerUid,
      ownerEmail: 'vde@shimano.com.ar',
      vendorAssigned: '',
      assignedVendorUid: '',
      clientName: 'CLIENTE TEST',
      cardCode: 'C001',
      lines: [{ sku: 'TEST-SKU', cantidad: 1, state: 'confirmed', precio: 100 }],
      draftId: 'C001|TEST|' + Math.random().toString(36).slice(2, 8),
      orderNumber: 1,
      origen: 'cpst',
      waitlistOrigenId: 'wl-origen',
      clientProvince: 'BA',
      clientLocality: 'CABA',
      key: 'C|BA|CABA|CLIENTE TEST|1',
      clientVersion: 'v1578',
      minVersion: 'v1578',
    };
  }

  it('T17 VDE sobre waitlist de su cliente (assignedVendorUid match) → gate pasa', async () => {
    const { commitPedidoCore } = await import('../../functions/core/commit-pedido-core.js');
    const fbDb = makeMockDb({
      waitlist: {
        clientCardCode: 'C001',
        clientName: 'CLIENTE TEST',
        assignedVendorUid: VDE_PROPIO, // ← match
        ownerUid: 'uid-pablo', // cargada por Pablo, no por VDE
      },
    });
    const r = await commitPedidoCore(
      { fbDb, callerRole: 'vendedor', log: () => {} },
      makePayload(VDE_PROPIO)
    );
    // El gate PR F §Decisión-2A debe pasar (assignedVendorUid === VDE_PROPIO).
    expect(r.errorCode === 'VENDEDOR_WAITLIST_FUERA_CLIENTE').toBe(false);
  });

  it('T18 VDE que cargó la waitlist (ownerUid match) → gate pasa', async () => {
    const { commitPedidoCore } = await import('../../functions/core/commit-pedido-core.js');
    const fbDb = makeMockDb({
      waitlist: {
        clientCardCode: 'C001',
        clientName: 'CLIENTE TEST',
        assignedVendorUid: VDE_OTRO, // ← no match aquí
        ownerUid: VDE_PROPIO, // ← pero sí match aquí
      },
    });
    const r = await commitPedidoCore(
      { fbDb, callerRole: 'vendedor', log: () => {} },
      makePayload(VDE_PROPIO)
    );
    expect(r.errorCode === 'VENDEDOR_WAITLIST_FUERA_CLIENTE').toBe(false);
  });

  it('T19 VDE sobre waitlist ajena (ni owner ni assignedVendor) → REBOTA con VENDEDOR_WAITLIST_FUERA_CLIENTE', async () => {
    const { commitPedidoCore } = await import('../../functions/core/commit-pedido-core.js');
    const fbDb = makeMockDb({
      waitlist: {
        clientCardCode: 'C001',
        clientName: 'CLIENTE TEST',
        assignedVendorUid: VDE_OTRO,
        ownerUid: 'uid-pablo',
      },
    });
    const r = await commitPedidoCore(
      { fbDb, callerRole: 'vendedor', log: () => {} },
      makePayload(VDE_PROPIO)
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('VENDEDOR_WAITLIST_FUERA_CLIENTE');
  });

  it('T20 VDE sobre waitlist legacy sin assignedVendorUid → fallback a ownerUid (OK si él cargó)', async () => {
    const { commitPedidoCore } = await import('../../functions/core/commit-pedido-core.js');
    const fbDb = makeMockDb({
      waitlist: {
        clientCardCode: 'C001',
        clientName: 'CLIENTE TEST',
        // sin assignedVendorUid (legacy pre-§44)
        ownerUid: VDE_PROPIO,
      },
    });
    const r = await commitPedidoCore(
      { fbDb, callerRole: 'vendedor', log: () => {} },
      makePayload(VDE_PROPIO)
    );
    expect(r.errorCode === 'VENDEDOR_WAITLIST_FUERA_CLIENTE').toBe(false);
  });
});

describe('PR F v1578 §mensajes — nuevos errorCodes en pure + fallback bundle', () => {
  it('T15 VENDEDOR_WAITLIST_FUERA_CLIENTE está en MENSAJES_VENDEDOR', async () => {
    const { MENSAJES_VENDEDOR } = await import('../../src/pure/mensajes-vendedor.js');
    expect(MENSAJES_VENDEDOR.VENDEDOR_WAITLIST_FUERA_CLIENTE).toBeTruthy();
    expect(MENSAJES_VENDEDOR.VENDEDOR_WAITLIST_FUERA_CLIENTE.texto).toMatch(/orden en espera/i);
    expect(MENSAJES_VENDEDOR.VENDEDOR_WAITLIST_FUERA_CLIENTE.texto).toMatch(
      /no es de tus clientes/i
    );
  });

  it('T16 VENDEDOR_WAITLIST_FUERA_CLIENTE está en _SERVER_ERROR_FALLBACK_TEXTS (bundle stale)', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('index.html', 'utf8');
    // Buscar dentro del objeto _SERVER_ERROR_FALLBACK_TEXTS.
    const idx = src.indexOf('_SERVER_ERROR_FALLBACK_TEXTS = {');
    expect(idx).toBeGreaterThan(0);
    const slice = src.slice(idx, idx + 2500);
    expect(slice).toMatch(/VENDEDOR_WAITLIST_FUERA_CLIENTE:\s*['"]/);
  });
});

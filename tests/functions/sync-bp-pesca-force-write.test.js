// @ts-check
/**
 * v1535 (APP-02) — syncBpPesca({forceWrite}) para el boton "Sincronizar con SAP".
 *
 * forceWrite=true saltea SOLO el gate del flag bpSyncByCF (dry-run). El
 * comportamiento default (sin forceWrite) queda igual: flag false → dry-run.
 * forceDryRun=true sigue ganando sobre forceWrite (tests / herramientas).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncBpPesca } from '../../functions/core/sync-bp-pesca-core.js';

const FieldValue = { serverTimestamp: () => '__TS__' };

/** BP pesca nuevo (no matchea nada existente). */
const BP_NUEVO = {
  CardCode: 'C30999999999',
  CardName: 'PESCA NUEVA SRL',
  FederalTaxID: '30-99999999-9',
  CardType: 'cCustomer',
  Valid: 'tYES',
  Frozen: 'tNO',
  U_DIVISION: 'PESCA',
  U_SH_PCIA: 'B',
  City: 'Escobar',
};

/** @param {boolean} flag */
function makeDb(flag) {
  /** @type {any[]} */
  const added = [];
  const db = {
    doc() {
      return {
        async get() {
          return { exists: true, data: () => ({ bpSyncByCF: flag }) };
        },
      };
    },
    collection(/** @type {string} */ name) {
      return {
        async get() {
          return { forEach: () => {}, size: 0 };
        },
        async add(/** @type {any} */ d) {
          added.push({ name, d });
          return { id: 'nuevo1' };
        },
        doc() {
          return { async set() {} };
        },
      };
    },
  };
  return { db, added };
}

function stubSlFetch(/** @type {{error?: boolean, statesError?: boolean}} */ opts = {}) {
  /** @type {string[]} */
  const cookies = [];
  const fn = vi.fn(async (/** @type {string} */ url, /** @type {any} */ init) => {
    cookies.push(init?.headers?.Cookie);
    if (String(url).includes('/States') && opts.statesError) {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    if (String(url).includes('/States')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: [{ Code: 'B', Name: 'Buenos Aires' }] }),
      };
    }
    if (opts.error) {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: { message: { value: 'Invalid session' } } }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ value: [BP_NUEVO] }) };
  });
  vi.stubGlobal('fetch', fn);
  return { fn, cookies };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('v1535 APP-02 — syncBpPesca forceWrite', () => {
  it('F1 flag false + forceWrite=true → escribe (dryRun=false)', async () => {
    stubSlFetch();
    const { db, added } = makeDb(false);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
      forceWrite: true,
    });
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(false);
    expect(res.bpSyncByCFFlag).toBe(false);
    expect(res.stats.created).toBe(1);
    expect(added.length).toBe(1);
    expect(added[0].name).toBe('client_applications');
    expect(added[0].d.status).toBe('approved');
    expect(added[0].d.cardCodeSap).toBe('C30999999999');
  });

  it('F2 flag false SIN forceWrite → sigue en dry-run (no escribe)', async () => {
    stubSlFetch();
    const { db, added } = makeDb(false);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
    });
    expect(res.dryRun).toBe(true);
    expect(res.stats.created).toBe(1); // contado pero no escrito
    expect(added.length).toBe(0);
  });

  it('F3 forceWrite distinto de true (truthy string) NO saltea el dry-run', async () => {
    stubSlFetch();
    const { db, added } = makeDb(false);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
      forceWrite: /** @type {any} */ ('true'),
    });
    expect(res.dryRun).toBe(true);
    expect(added.length).toBe(0);
  });

  it('F4 forceDryRun=true gana sobre forceWrite=true', async () => {
    stubSlFetch();
    const { db, added } = makeDb(true);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
      forceWrite: true,
      forceDryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(added.length).toBe(0);
  });

  it('F5 flag true sin forceWrite → escribe (comportamiento previo intacto)', async () => {
    stubSlFetch();
    const { db, added } = makeDb(true);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
    });
    expect(res.dryRun).toBe(false);
    expect(added.length).toBe(1);
  });

  it('F6 error al traer BPs de SAP → fetchError expuesto (para no mostrar exito falso)', async () => {
    stubSlFetch({ error: true });
    const { db, added } = makeDb(false);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
      forceWrite: true,
    });
    expect(added.length).toBe(0);
    expect(typeof res.fetchError).toBe('string');
    expect(res.fetchError).toContain('401');
  });

  it('F7 sin error de SAP → fetchError null', async () => {
    stubSlFetch();
    const { db } = makeDb(false);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
      forceWrite: true,
    });
    expect(res.fetchError).toBe(null);
  });
  it('F8 falla /States (provincias) → fetchError expuesto (no se informa exito)', async () => {
    stubSlFetch({ statesError: true });
    const { db } = makeDb(false);
    const res = await syncBpPesca({
      fbDb: db,
      FieldValue,
      sapConfig: { url: 'https://sl.test' },
      cookie: 'B1SESSION=abc',
      forceWrite: true,
    });
    expect(typeof res.fetchError).toBe('string');
    expect(res.fetchError).toContain('States');
  });
});

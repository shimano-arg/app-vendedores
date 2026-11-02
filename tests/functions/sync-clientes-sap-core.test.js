// @ts-check
/**
 * v1535 (APP-02) — core del callable `syncClientesSapCF` (boton "Sincronizar
 * con SAP" del Master de Clientes).
 */
import { describe, expect, it, vi } from 'vitest';
import { BP_SYNC_LOCK_PATH } from '../../functions/core/bp-sync-lock.js';
import { syncClientesSapCore } from '../../functions/core/sync-clientes-sap-core.js';
import { makeStrictLockDb } from '../fixtures/strict-lock-db.js';

const NOW = 1_800_000_000_000;
const SAP_CFG = { url: 'https://sl.test', companyDB: 'DB', userName: 'u', password: 'p' };

/** @param {any} [lockInitial] */
function makeDb(lockInitial) {
  const db = /** @type {any} */ (makeStrictLockDb(lockInitial));
  /** @type {any[]} */
  const logs = [];
  db.collection = (/** @type {string} */ name) => ({
    async add(/** @type {any} */ d) {
      logs.push({ name, d });
      return { id: 'log1' };
    },
  });
  return { db, logs };
}

const OK_RESULT = {
  ok: true,
  stats: {
    created: 3,
    updated_prov_to_conf: 1,
    updated_existing: 40,
    skipped_unknown_vendor: 0,
    skipped_not_pesca: 12,
  },
  slRequests: 5,
  bpSyncByCFFlag: false,
  dryRun: false,
  fetchError: null,
};

/** @param {any} db @param {any} [over] */
function makeDeps(db, over = {}) {
  const sess = { cookie: 'RAWCOOKIE', createdAt: NOW, inUse: true };
  return {
    fbDb: db,
    FieldValue: { serverTimestamp: () => '__TS__' },
    getUserRole: vi.fn(async () => ({ role: 'admin' })),
    loadSapConfig: vi.fn(async () => SAP_CFG),
    acquireSession: vi.fn(async () => sess),
    releaseSession: vi.fn(),
    syncBpPesca: vi.fn(async () => OK_RESULT),
    now: () => NOW,
    log: () => {},
    ...over,
  };
}

const REQ = { auth: { uid: 'u1', token: { email: 'mariano@shimano.com.ar' } } };

describe('v1535 APP-02 — syncClientesSapCore', () => {
  it('C1 sin auth → unauthenticated (no corre nada)', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db);
    await expect(syncClientesSapCore(deps, { auth: null })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(deps.syncBpPesca).not.toHaveBeenCalled();
  });

  it.each([['vendedor'], ['interno'], ['viewer'], [undefined]])(
    'C2 rol %s → permission-denied (rol leido del server, no del cliente)',
    async (role) => {
      const { db } = makeDb();
      const deps = makeDeps(db, { getUserRole: vi.fn(async () => ({ role })) });
      await expect(
        syncClientesSapCore(deps, { ...REQ, data: { role: 'admin' } })
      ).rejects.toMatchObject({ code: 'permission-denied' });
      expect(deps.getUserRole).toHaveBeenCalledWith('u1');
      expect(deps.syncBpPesca).not.toHaveBeenCalled();
      expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
    }
  );

  it.each([['admin'], ['gerente'], ['ADMIN']])('C3 rol %s → corre', async (role) => {
    const { db } = makeDb();
    const deps = makeDeps(db, { getUserRole: vi.fn(async () => ({ role })) });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r.ok).toBe(true);
  });

  it('C4 happy path: forceWrite=true, cookie con prefijo B1SESSION=, contadores mapeados', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db);
    const r = await syncClientesSapCore(deps, REQ);
    expect(deps.syncBpPesca).toHaveBeenCalledTimes(1);
    const params = deps.syncBpPesca.mock.calls[0][0];
    expect(params.forceWrite).toBe(true);
    expect(params.forceDryRun).toBeUndefined();
    expect(params.cookie).toBe('B1SESSION=RAWCOOKIE');
    expect(params.sapConfig).toEqual(SAP_CFG);
    expect(r).toEqual({
      ok: true,
      nuevos: 3,
      actualizados: 41,
      confirmados: 1,
      total: 44,
      durationMs: 0,
    });
    expect(deps.releaseSession).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('C5 lock tomado → EN_CURSO sin correr el sync', async () => {
    const { db, logs } = makeDb({ holder: 'x', owner: 'cf-scheduled', expiresAt: NOW + 60_000 });
    const deps = makeDeps(db);
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'EN_CURSO' });
    expect(deps.syncBpPesca).not.toHaveBeenCalled();
    expect(deps.acquireSession).not.toHaveBeenCalled();
    expect(db._state[BP_SYNC_LOCK_PATH].holder).toBe('x'); // no se pisa el lock ajeno
    expect(logs[0].d).toMatchObject({
      type: 'sync_clientes_sap_manual',
      ok: false,
      code: 'EN_CURSO',
    });
  });

  it('C6 lock vencido → corre igual', async () => {
    const { db } = makeDb({ holder: 'x', owner: 'cf-scheduled', expiresAt: NOW - 1 });
    const deps = makeDeps(db);
    const r = await syncClientesSapCore(deps, REQ);
    expect(r.ok).toBe(true);
  });

  it('C7 lock liberado al terminar OK', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db);
    await syncClientesSapCore(deps, REQ);
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
  });

  it('C8 syncBpPesca tira excepcion → ok:false SYNC_FALLO + lock liberado + sesion descartada si 401', async () => {
    const { db, logs } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => {
        throw new Error('HTTP 401 boom');
      }),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SYNC_FALLO' });
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
    expect(deps.releaseSession).toHaveBeenCalledWith(expect.anything(), false);
    expect(logs[0].d).toMatchObject({ ok: false, code: 'SYNC_FALLO' });
  });

  it('C9 syncBpPesca devuelve ok:false → SYNC_FALLO (nunca exito)', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => ({ ok: false, error: 'x', slRequests: 0 })),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SYNC_FALLO' });
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
  });

  it('C10 SAP corto la lista a mitad (fetchError) → SAP_INCOMPLETO, nunca exito', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => ({ ...OK_RESULT, fetchError: '[FATAL/BP] HTTP 401' })),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SAP_INCOMPLETO', nuevos: 3 });
  });

  it('C11 el sync corrio en dry-run por algun motivo → SYNC_FALLO (no se escribio nada)', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => ({ ...OK_RESULT, dryRun: true })),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SYNC_FALLO' });
  });

  it('C12 SAP sin configurar → SAP_NO_CONFIGURADO + lock liberado', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, { loadSapConfig: vi.fn(async () => null) });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SAP_NO_CONFIGURADO' });
    expect(deps.syncBpPesca).not.toHaveBeenCalled();
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
  });

  it('C13 login SAP falla → SYNC_FALLO + lock liberado', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      acquireSession: vi.fn(async () => {
        throw new Error('SL login failed HTTP 500');
      }),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SYNC_FALLO' });
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
  });

  it('C14 operations_log: quien, cuando, resultado', async () => {
    const { db, logs } = makeDb();
    const deps = makeDeps(db);
    await syncClientesSapCore(deps, REQ);
    const entries = logs.filter((l) => l.name === 'operations_log');
    expect(entries.length).toBe(1);
    expect(entries[0].d).toMatchObject({
      type: 'sync_clientes_sap_manual',
      userId: 'u1',
      userEmail: 'mariano@shimano.com.ar',
      role: 'admin',
      ok: true,
      nuevos: 3,
      actualizados: 41,
      total: 44,
    });
    expect(entries[0].d.timestamp).toBeInstanceOf(Date);
  });

  it('C15 operations_log falla → no rompe la respuesta', async () => {
    const { db } = makeDb();
    db.collection = () => ({
      async add() {
        throw new Error('rules');
      },
    });
    const deps = makeDeps(db);
    const r = await syncClientesSapCore(deps, REQ);
    expect(r.ok).toBe(true);
  });
  it('C16 fetchError (401 de SL sin excepcion) → la sesion se descarta del pool', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => ({ ...OK_RESULT, fetchError: '[FATAL/BP] HTTP 401 - x' })),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r.code).toBe('SAP_INCOMPLETO');
    expect(deps.releaseSession).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('C17 sin fetchError → la sesion vuelve al pool', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db);
    await syncClientesSapCore(deps, REQ);
    expect(deps.releaseSession).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('C18 SAP_INCOMPLETO informa lo que ya se incorporo (nuevos/confirmados)', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => ({ ...OK_RESULT, fetchError: 'HTTP 500' })),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SAP_INCOMPLETO', nuevos: 3, confirmados: 1 });
  });
});

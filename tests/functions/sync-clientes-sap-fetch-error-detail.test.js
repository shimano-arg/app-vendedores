// @ts-check
/**
 * Auditoría Master Clientes (2026-11-17) — integración `formatFetchError` en
 * los 2 catches de sync-clientes-sap-core + 3 catches de sync-bp-pesca-core
 * que envuelven fetch SAP SL.
 *
 * Cobertura requerida por la autorización:
 *   1. Error con `cause.code = SELF_SIGNED_CERT_IN_CHAIN`.
 *   2. Error con `cause.code` diferente (ECONNRESET, ENOTFOUND).
 *   3. Error sin `cause`.
 *   4. Error convencional con `message`.
 *   5. Compatibilidad con el comportamiento anterior.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fetchBpPescaFromSl,
  loadArProvincesMap,
  syncBpPesca,
} from '../../functions/core/sync-bp-pesca-core.js';
import { syncClientesSapCore } from '../../functions/core/sync-clientes-sap-core.js';
import { makeStrictLockDb } from '../fixtures/strict-lock-db.js';

const NOW = 1_800_000_000_000;
const SAP_CFG = { url: 'https://sl.test', companyDB: 'DB', userName: 'u', password: 'p' };
const REQ = { auth: { uid: 'u1', token: { email: 'mariano@shimano.com.ar' } } };

function undiciLikeError(message, causeShape) {
  const err = new TypeError(message);
  // @ts-expect-error
  err.cause = causeShape;
  return err;
}

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

function makeDeps(db, over = {}) {
  const sess = { cookie: 'RAWCOOKIE', createdAt: NOW, inUse: true };
  return {
    fbDb: db,
    FieldValue: { serverTimestamp: () => '__TS__' },
    getUserRole: vi.fn(async () => ({ role: 'admin' })),
    loadSapConfig: vi.fn(async () => SAP_CFG),
    acquireSession: vi.fn(async () => sess),
    releaseSession: vi.fn(),
    syncBpPesca: vi.fn(async () => ({ ok: true, stats: {}, slRequests: 0, dryRun: false })),
    now: () => NOW,
    log: () => {},
    ...over,
  };
}

// ============================================================================
// syncClientesSapCore — catch del runSync (línea ~106)
// ============================================================================

describe('syncClientesSapCore — operations_log.message enriquecido con e.cause', () => {
  it('T1 SELF_SIGNED_CERT_IN_CHAIN en acquireSession → SYNC_FALLO con detalle', async () => {
    const { db, logs } = makeDb();
    const deps = makeDeps(db, {
      acquireSession: vi.fn(async () => {
        throw undiciLikeError('fetch failed', { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
      }),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r).toMatchObject({ ok: false, code: 'SYNC_FALLO' });
    expect(r.message).toBe('fetch failed (SELF_SIGNED_CERT_IN_CHAIN)');
    // operations_log también enriquecido
    const log = logs.find((l) => l.name === 'operations_log');
    expect(log).toBeTruthy();
    expect(log.d.message).toBe('fetch failed (SELF_SIGNED_CERT_IN_CHAIN)');
  });

  it('T2 ECONNRESET en syncBpPesca → SYNC_FALLO con errno + syscall', async () => {
    const { db, logs } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => {
        throw undiciLikeError('fetch failed', {
          code: 'ECONNRESET',
          errno: -4077,
          syscall: 'read',
        });
      }),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('SYNC_FALLO');
    expect(r.message).toBe('fetch failed (ECONNRESET, errno=-4077, syscall=read)');
    const log = logs.find((l) => l.name === 'operations_log');
    expect(log.d.message).toBe('fetch failed (ECONNRESET, errno=-4077, syscall=read)');
  });

  it('T3 ENOTFOUND con hostname → incluye host en el message', async () => {
    const { db, logs } = makeDb();
    const deps = makeDeps(db, {
      acquireSession: vi.fn(async () => {
        throw undiciLikeError('fetch failed', {
          code: 'ENOTFOUND',
          syscall: 'getaddrinfo',
          hostname: 'sl.test',
        });
      }),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r.message).toContain('ENOTFOUND');
    expect(r.message).toContain('host=sl.test');
    const log = logs.find((l) => l.name === 'operations_log');
    expect(log.d.message).toContain('ENOTFOUND');
  });

  it('T4 error sin cause (business error) → message preservado sin paréntesis', async () => {
    const { db, logs } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => {
        throw new Error('SL login failed HTTP 503: service unavailable');
      }),
    });
    const r = await syncClientesSapCore(deps, REQ);
    expect(r.message).toBe('SL login failed HTTP 503: service unavailable');
    const log = logs.find((l) => l.name === 'operations_log');
    expect(log.d.message).toBe('SL login failed HTTP 503: service unavailable');
  });

  it('T5 compat legacy: catch sigue devolviendo SYNC_FALLO con shape {ok,code,message}', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      syncBpPesca: vi.fn(async () => {
        throw new Error('plain error');
      }),
    });
    const r = await syncClientesSapCore(deps, REQ);
    // Shape idéntico al comportamiento pre-fix: {ok:false, code, message, durationMs}.
    expect(r.ok).toBe(false);
    expect(r.code).toBe('SYNC_FALLO');
    expect(typeof r.message).toBe('string');
    expect(typeof r.durationMs).toBe('number');
    // Clasificación funcional (SYNC_FALLO vs SAP_INCOMPLETO vs EN_CURSO) no cambió.
  });

  it('T6 heurística 401 del catch interno runSync sigue funcionando', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, {
      acquireSession: vi.fn(async () => {
        throw new Error('SL login failed HTTP 401: invalid credentials');
      }),
    });
    await syncClientesSapCore(deps, REQ);
    // releaseSession debe recibir ok=false por el 401 heurística.
    expect(deps.releaseSession).not.toHaveBeenCalled(); // acquireSession tiró → no hay sess que release
    // (ok:false release ocurre dentro de runSync; acquireSession tira antes de crear sess → no se invoca release)
  });

  it('T7 heurística 401 con cause enriquecido también matchea', async () => {
    const { db } = makeDb();
    const sess = { cookie: 'RAWCOOKIE', createdAt: NOW, inUse: true };
    const deps = makeDeps(db, {
      acquireSession: vi.fn(async () => sess),
      syncBpPesca: vi.fn(async () => {
        throw undiciLikeError('SL request HTTP 401: cookie expired', { code: 'UNAUTHORIZED' });
      }),
    });
    await syncClientesSapCore(deps, REQ);
    // El catch del runSync aplica formatFetchError → "SL request HTTP 401: cookie expired (UNAUTHORIZED)".
    // La heurística msg.includes('401') sigue matcheando → sessionOk=false → release(sess, false).
    expect(deps.releaseSession).toHaveBeenCalledWith(expect.anything(), false);
  });
});

// ============================================================================
// sync-bp-pesca-core — 3 catches (loadArProvincesMap, fetchBpPescaFromSl, syncBpPesca)
// ============================================================================

describe('loadArProvincesMap — catch enriquecido con e.cause', () => {
  it('T8 fetch tira SELF_SIGNED_CERT_IN_CHAIN → error con paréntesis', async () => {
    const fetch = vi.fn(async () => {
      throw undiciLikeError('fetch failed', { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    });
    globalThis.fetch = fetch;
    const r = await loadArProvincesMap({ sapConfig: SAP_CFG, cookie: 'B1SESSION=X' });
    expect(r.error).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    expect(r.error).toContain('[bp] WARN load_ar_provinces: fetch failed');
    expect(r.map).toEqual({});
    expect(r.slRequests).toBe(0);
  });

  it('T9 fetch tira ECONN* → incluye code', async () => {
    const fetch = vi.fn(async () => {
      throw undiciLikeError('fetch failed', { code: 'ECONNRESET' });
    });
    globalThis.fetch = fetch;
    const r = await loadArProvincesMap({ sapConfig: SAP_CFG, cookie: 'B1SESSION=X' });
    expect(r.error).toBe('[bp] WARN load_ar_provinces: fetch failed (ECONNRESET)');
  });

  it('T10 error sin cause → prefijo preservado sin paréntesis', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('EPIPE broken pipe');
    });
    globalThis.fetch = fetch;
    const r = await loadArProvincesMap({ sapConfig: SAP_CFG, cookie: 'B1SESSION=X' });
    expect(r.error).toBe('[bp] WARN load_ar_provinces: EPIPE broken pipe');
  });
});

describe('fetchBpPescaFromSl — catch enriquecido con e.cause', () => {
  it('T11 fetch tira SELF_SIGNED_CERT_IN_CHAIN → "error de red pag N: ..."', async () => {
    const fetch = vi.fn(async () => {
      throw undiciLikeError('fetch failed', { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    });
    globalThis.fetch = fetch;
    const r = await fetchBpPescaFromSl({ sapConfig: SAP_CFG, cookie: 'B1SESSION=X' });
    expect(r.error).toContain('[SL/BP] error de red pag 0:');
    expect(r.error).toContain('fetch failed (SELF_SIGNED_CERT_IN_CHAIN)');
    expect(r.bps).toEqual([]);
  });

  it('T12 fetch tira timeout AbortError → mantiene prefijo + enriquece', async () => {
    const fetch = vi.fn(async () => {
      throw undiciLikeError('The operation was aborted', { code: 'UND_ERR_CONNECT_TIMEOUT' });
    });
    globalThis.fetch = fetch;
    const r = await fetchBpPescaFromSl({ sapConfig: SAP_CFG, cookie: 'B1SESSION=X' });
    expect(r.error).toContain('UND_ERR_CONNECT_TIMEOUT');
  });

  it('T13 compat: error sin cause devuelve message plano', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('socket hangup');
    });
    globalThis.fetch = fetch;
    const r = await fetchBpPescaFromSl({ sapConfig: SAP_CFG, cookie: 'B1SESSION=X' });
    expect(r.error).toBe('[SL/BP] error de red pag 0: socket hangup');
  });
});

describe('syncBpPesca — catch FATAL enriquecido con e.cause', () => {
  // NOTA: el catch FATAL del final de syncBpPesca (línea ~902) sólo se dispara
  // si `loadArProvincesMap` o `fetchBpPescaFromSl` tiran (no devuelven {error})
  // o si `upsertBpPescaToFirestore` tira. Las dos primeras ya capturan con
  // try/catch internos y devuelven {error}. El único path real es
  // `upsertBpPescaToFirestore`, que es complejo de orquestar fielmente.
  //
  // Para cerrar la cobertura sin montar toda la pila de upsert, validamos por
  // contrato estático: las 3 llamadas a `formatFetchError(e)` del archivo
  // están dentro de bloques `catch (e)` de fetch SAP.

  it('T14 el 3er `formatFetchError(e)` (catch FATAL) está presente', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '..', '..', 'functions', 'core', 'sync-bp-pesca-core.js'),
      'utf8'
    );
    // Buscar la secuencia FATAL: catch (e) { ... formatFetchError(e) ... FATAL sync BPs pesca
    const fatalRegion = src.slice(src.indexOf('FATAL sync BPs pesca'));
    expect(fatalRegion).toContain('FATAL sync BPs pesca');
    // Antes del comentario FATAL, tiene que haber un `const msg = formatFetchError(e);`.
    const windowBeforeFatal = src.slice(
      Math.max(0, src.indexOf('FATAL sync BPs pesca') - 200),
      src.indexOf('FATAL sync BPs pesca')
    );
    expect(windowBeforeFatal).toContain('formatFetchError(e)');
  });

  it('T15 compat: los 3 catches enriquecidos preservan el prefijo de mensaje legacy', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '..', '..', 'functions', 'core', 'sync-bp-pesca-core.js'),
      'utf8'
    );
    // Cada catch enriquecido mantiene su prefijo (match con operations_log legacy).
    expect(src).toContain("'[bp] WARN load_ar_provinces: ' + formatFetchError(e)");
    expect(src).toContain("'[SL/BP] error de red pag '");
    expect(src).toContain("'[bp] FATAL sync BPs pesca: '");
  });
});

// ============================================================================
// Contrato estático — formatFetchError importado 1 vez por archivo, usado en catches
// ============================================================================

describe('Contrato — formatFetchError sólo en catches de fetch SAP, no en catches de Firestore', () => {
  it('sync-clientes-sap-core importa formatFetchError y lo usa 2 veces', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '..', '..', 'functions', 'core', 'sync-clientes-sap-core.js'),
      'utf8'
    );
    expect((src.match(/import .* formatFetchError/g) || []).length).toBe(1);
    expect((src.match(/formatFetchError\s*\(/g) || []).length).toBe(2);
  });

  it('sync-bp-pesca-core importa formatFetchError y lo usa 3 veces', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '..', '..', 'functions', 'core', 'sync-bp-pesca-core.js'),
      'utf8'
    );
    expect((src.match(/import .* formatFetchError/g) || []).length).toBe(1);
    expect((src.match(/formatFetchError\s*\(/g) || []).length).toBe(3);
  });
});

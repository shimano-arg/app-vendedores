// @ts-check
/**
 * Incidente 2026-11-17 — integración: el catch del sync + el catch de
 * live-SL propagan el detalle de `e.cause` al `errors[]` del
 * operations_log / resultado.
 *
 * Verificado mediante inyección de fetch mock que tira el error con el
 * mismo shape que produce undici en una falla pre-response.
 */
import { describe, expect, it } from 'vitest';
import { fetchStockLiveCore } from '../../functions/core/fetch-stock-live-core.js';
import { _resetPool } from '../../functions/core/sap-sl-session.js';
import { syncSapCatalogStockCore } from '../../functions/core/sync-sap-catalog-stock-core.js';

function undiciLikeError(message, causeShape) {
  const err = new TypeError(message);
  // @ts-expect-error
  err.cause = causeShape;
  return err;
}

function makeFirestoreMock() {
  const writes = [];
  const store = new Map();
  let autoId = 0;
  function docRef(path) {
    return {
      _path: path,
      async get() {
        return { exists: store.has(path), data: () => store.get(path) };
      },
      async set(data, opts) {
        if (opts?.merge) store.set(path, Object.assign({}, store.get(path) || {}, data));
        else store.set(path, data);
        writes.push({ op: 'set', path, data });
      },
      async update(data) {
        store.set(path, Object.assign({}, store.get(path) || {}, data));
        writes.push({ op: 'update', path, data });
      },
    };
  }
  function collection(name) {
    return {
      doc(id) {
        if (id) return docRef(`${name}/${id}`);
        autoId++;
        return docRef(`${name}/auto-${autoId}`);
      },
      async get() {
        const docs = [];
        for (const [k, v] of store.entries()) {
          if (k.startsWith(`${name}/`)) docs.push({ id: k.split('/').pop(), data: () => v });
        }
        return {
          size: docs.length,
          forEach(cb) {
            for (const d of docs) cb(d);
          },
        };
      },
      async add(data) {
        autoId++;
        const id = `auto-${autoId}`;
        store.set(`${name}/${id}`, data);
        writes.push({ op: 'add', path: `${name}/${id}`, data });
        return { id };
      },
    };
  }
  return {
    fbDb: {
      collection,
      doc(path) {
        return docRef(path);
      },
    },
    _writes: writes,
    _store: store,
  };
}

describe('Incidente 2026-11-17 — sync-sap-catalog-stock-core catch enriquece errors[]', () => {
  it('ECONNRESET en Login → errors[0] incluye el code en el operations_log', async () => {
    _resetPool();
    const { fbDb, _store, _writes } = makeFirestoreMock();
    const sapConfig = {
      url: 'https://sl.fake',
      companyDB: 'DB',
      userName: 'u',
      password: 'p',
      fetch: async (/** @type {string} */ url) => {
        if (url.includes('/Login')) {
          throw undiciLikeError('fetch failed', {
            code: 'ECONNRESET',
            errno: -4077,
            syscall: 'read',
          });
        }
        throw new Error('no mock for ' + url);
      },
    };
    const r = await syncSapCatalogStockCore({ fbDb, sapConfig, log: () => {} });
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.errors)).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
    // Mensaje enriquecido con el errno de undici.
    expect(r.errors[0]).toContain('fetch failed');
    expect(r.errors[0]).toContain('ECONNRESET');
    expect(r.errors[0]).toContain('errno=-4077');
    expect(r.errors[0]).toContain('syscall=read');
    // operations_log recibió el entry con errors.
    const opsEntries = _writes.filter((w) => w.path.startsWith('operations_log/'));
    expect(opsEntries.length).toBe(1);
    expect(opsEntries[0].data.ok).toBe(false);
    expect(opsEntries[0].data.errors[0]).toContain('ECONNRESET');
  });

  it('UND_ERR_CONNECT_TIMEOUT en Login → preserva prefijo + agrega code undici', async () => {
    _resetPool();
    const { fbDb } = makeFirestoreMock();
    const sapConfig = {
      url: 'https://sl.fake',
      companyDB: 'DB',
      userName: 'u',
      password: 'p',
      fetch: async () => {
        throw undiciLikeError('fetch failed', { code: 'UND_ERR_CONNECT_TIMEOUT' });
      },
    };
    const r = await syncSapCatalogStockCore({ fbDb, sapConfig, log: () => {} });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toBe('fetch failed (UND_ERR_CONNECT_TIMEOUT)');
  });

  it('ENOTFOUND con hostname → el detalle incluye host en el audit', async () => {
    _resetPool();
    const { fbDb } = makeFirestoreMock();
    const sapConfig = {
      url: 'https://sl.fake',
      companyDB: 'DB',
      userName: 'u',
      password: 'p',
      fetch: async () => {
        throw undiciLikeError('fetch failed', {
          code: 'ENOTFOUND',
          syscall: 'getaddrinfo',
          hostname: 'sl.fake',
        });
      },
    };
    const r = await syncSapCatalogStockCore({ fbDb, sapConfig, log: () => {} });
    expect(r.errors[0]).toContain('ENOTFOUND');
    expect(r.errors[0]).toContain('host=sl.fake');
  });

  it('error sin .cause (ej. error de negocio) → mensaje preservado sin paréntesis', async () => {
    _resetPool();
    const { fbDb } = makeFirestoreMock();
    const sapConfig = {
      url: 'https://sl.fake',
      companyDB: 'DB',
      userName: 'u',
      password: 'p',
      fetch: async () => {
        // sapLogin tira este formato cuando HTTP != 2xx del Login.
        throw new Error('SL login failed HTTP 503: service unavailable');
      },
    };
    const r = await syncSapCatalogStockCore({ fbDb, sapConfig, log: () => {} });
    expect(r.errors[0]).toBe('SL login failed HTTP 503: service unavailable');
  });
});

describe('Incidente 2026-11-17 — fetchStockLiveCore batch enriquece error', () => {
  it('ECONNRESET durante batch → error del batch tiene el detalle', async () => {
    _resetPool();
    const { fbDb } = makeFirestoreMock();
    const deps = {
      sapConfig: {
        url: 'https://sl.fake',
        companyDB: 'DB',
        userName: 'u',
        password: 'p',
        fetch: async () => {
          throw undiciLikeError('fetch failed', {
            code: 'ECONNRESET',
            errno: -4077,
            syscall: 'read',
          });
        },
      },
      fbDb,
      acquireSlCookie: async () => 'FAKECOOKIE',
      releaseSlCookie: () => {},
      log: () => {},
    };
    const r = await fetchStockLiveCore(deps, {
      skus: ['SKU-A', 'SKU-B'],
      libreSnapshot: { 'SKU-A': 10, 'SKU-B': 5 },
      qtyPedida: { 'SKU-A': 1, 'SKU-B': 1 },
    });
    // snapshotFallback debe haberse activado por el fallo del fetch.
    expect(r.ok).toBe(true);
    expect(r.snapshotFallback).toBe(true);
    // El campo .error (shape del core) conserva el detalle enriquecido.
    // El reason codificado es 'sl_error' o 'timeout'.
    expect(['sl_error', 'timeout']).toContain(r.reason);
    const err = String(r.error || '');
    expect(err).toContain('ECONNRESET');
    expect(err).toContain('errno=-4077');
    expect(err).toContain('syscall=read');
  });
});

describe('Incidente 2026-11-17 — recuperación: el catch es stateless entre corridas', () => {
  it('3 corridas con mismo deps: 2 que lanzan → 1 fallo distinto no acumula errors previos', async () => {
    _resetPool();
    const { fbDb } = makeFirestoreMock();
    let callCount = 0;
    const sapConfig = {
      url: 'https://sl.fake',
      companyDB: 'DB',
      userName: 'u',
      password: 'p',
      fetch: async () => {
        callCount++;
        if (callCount === 1) {
          throw undiciLikeError('fetch failed', { code: 'UND_ERR_CONNECT_TIMEOUT' });
        }
        if (callCount === 2) {
          throw undiciLikeError('fetch failed', { code: 'ECONNRESET' });
        }
        // 3ra corrida: otro fallo (ENOTFOUND) — demuestra que no hay estado
        // acumulado de las 2 anteriores. El `errors[]` es fresco cada corrida.
        throw undiciLikeError('fetch failed', { code: 'ENOTFOUND', hostname: 'sl.fake' });
      },
    };
    const r1 = await syncSapCatalogStockCore({ fbDb, sapConfig, log: () => {} });
    expect(r1.ok).toBe(false);
    expect(r1.errors[0]).toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(r1.errors.length).toBe(1);
    _resetPool();
    const r2 = await syncSapCatalogStockCore({ fbDb, sapConfig, log: () => {} });
    expect(r2.ok).toBe(false);
    expect(r2.errors[0]).toContain('ECONNRESET');
    expect(r2.errors[0]).not.toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(r2.errors.length).toBe(1);
    _resetPool();
    const r3 = await syncSapCatalogStockCore({ fbDb, sapConfig, log: () => {} });
    expect(r3.ok).toBe(false);
    expect(r3.errors[0]).toContain('ENOTFOUND');
    expect(r3.errors[0]).toContain('host=sl.fake');
    expect(r3.errors[0]).not.toContain('ECONNRESET');
  });
});

describe('Incidente 2026-11-17 — happy path: el helper NO se invoca cuando no hay excepción', () => {
  it('contrato: formatFetchError SOLO está referenciado dentro del catch del sync', async () => {
    // Validamos por inspección estática que la única referencia al helper
    // en sync-sap-catalog-stock-core.js está dentro del catch; no hay
    // llamadas adicionales que puedan afectar el happy path.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '..', '..', 'functions', 'core', 'sync-sap-catalog-stock-core.js'),
      'utf8'
    );
    // Debe haber: 1 import + 1 call. Puede haber también comentarios
    // JSDoc que mencionen el helper por nombre, pero el llamado efectivo
    // (`formatFetchError(e)`) debe aparecer exactamente UNA vez.
    expect((src.match(/import\s+\{[^}]*formatFetchError/g) || []).length).toBe(1);
    expect((src.match(/formatFetchError\s*\(/g) || []).length).toBe(1);
    // El call vive dentro de la rama catch.
    const catchRegion = src.slice(src.indexOf('} catch (e) {'));
    expect(catchRegion).toContain('formatFetchError(e)');
  });

  it('contrato: formatFetchError SOLO está referenciado dentro del catch de fetch-stock-live-core', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '..', '..', 'functions', 'core', 'fetch-stock-live-core.js'),
      'utf8'
    );
    expect((src.match(/import\s+\{[^}]*formatFetchError/g) || []).length).toBe(1);
    expect((src.match(/formatFetchError\s*\(/g) || []).length).toBe(1);
    const catchRegion = src.slice(src.indexOf('} catch (e) {'));
    expect(catchRegion).toContain('formatFetchError(e)');
  });
});

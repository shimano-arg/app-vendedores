// @ts-check
/**
 * SEC-H4 (HARDENING5 BATCH 1, 2026-11-19) — tests cap MAX_SKUS_PER_REQUEST.
 *
 * Previene amplificación DoS contra el pool Service Layer. El core rechaza
 * payloads > MAX_SKUS_PER_REQUEST (250) ANTES de armar batches, sin invocar
 * al SL ni gastar cookie del pool. El wrapper CF traduce el errorCode a
 * HttpsError('invalid-argument').
 *
 * Nota: el threshold existente LINEAS_EN_RIESGO_THRESHOLD=200 solo activa
 * modo "partial" si vienen libreSnapshot+qtyPedida; omitirlos permitía
 * bypass. El cap duro es independiente de esos params.
 */
import { describe, expect, it, vi } from 'vitest';
import { _INTERNAL, fetchStockLiveCore } from '../../functions/core/fetch-stock-live-core.js';

const SAP_CFG = {
  url: 'https://sap.test',
  companyDB: 'TEST',
  userName: 'U',
  password: 'P',
};

/**
 * Deps con fetch espía: cualquier llamada al SL se cuenta.
 * Si el cap funciona, fetch NO se invoca para N > cap.
 */
function makeDeps(fetchFn, overrides = {}) {
  return {
    sapConfig: { ...SAP_CFG, fetch: fetchFn },
    fbDb: {},
    acquireSlCookie: overrides.acquireSlCookie || (async () => 'COOKIE_X'),
    releaseSlCookie: overrides.releaseSlCookie || (() => {}),
    log: overrides.log || (() => {}),
    now: () => 1_700_000_000_000,
  };
}

/** Genera N SKUs únicos de prueba (K0001..KNNNN). */
function genSkus(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push('K' + String(i).padStart(4, '0'));
  }
  return out;
}

/** Fetch mock que devuelve InStock=1 para cada SKU del filter. */
function makeFetchMock() {
  return vi.fn(async (url) => {
    const matches = String(url).match(/ItemCode%20eq%20'([^']+)'/g) || [];
    const skus = matches.map((m) => m.replace(/.*'([^']+)'/, '$1'));
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          value: skus.map((s) => ({
            ItemCode: s,
            ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: 1, Committed: 0 }],
          })),
        };
      },
    };
  });
}

describe('SEC-H4 — fetchStockLiveCore cap MAX_SKUS_PER_REQUEST', () => {
  it('constante exportada en _INTERNAL vale 250', () => {
    expect(_INTERNAL.MAX_SKUS_PER_REQUEST).toBe(250);
  });

  it('T1 — skus.length === 250 (cap exacto) procesa normal', async () => {
    const fetchFn = makeFetchMock();
    const r = await fetchStockLiveCore(makeDeps(fetchFn), { skus: genSkus(250) });
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.reason).toBe('ok');
    expect(r.snapshotFallback).toBe(false);
    expect(r.slRequests).toBe(5); // 250 / 50 = 5 batches
    // 5 batches = 5 fetch calls.
    expect(fetchFn).toHaveBeenCalledTimes(5);
    // Todos los 250 SKUs vinieron del live.
    expect(r.skusLive.length).toBe(250);
    expect(r.skusSnapshot.length).toBe(0);
  });

  it('T2 — skus.length === 251 (cap + 1) rechaza con TOO_MANY_SKUS, NO invoca SL', async () => {
    const fetchFn = makeFetchMock();
    const acquireSpy = vi.fn(async () => 'COOKIE_X');
    const r = await fetchStockLiveCore(makeDeps(fetchFn, { acquireSlCookie: acquireSpy }), {
      skus: genSkus(251),
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('TOO_MANY_SKUS');
    expect(r.reason).toBe('cap_exceeded');
    expect(r.snapshotFallback).toBe(true);
    expect(r.fisicoDep11).toEqual({});
    expect(r.slRequests).toBe(0);
    expect(r.error).toMatch(/cap SKUs excedido: 251 > 250/);
    // Crítico: no se consumió cookie del pool ni se invocó al SL.
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('T3 — skus.length === 0 (empty) mantiene comportamiento histórico', async () => {
    const fetchFn = makeFetchMock();
    const acquireSpy = vi.fn(async () => 'COOKIE_X');
    const r = await fetchStockLiveCore(makeDeps(fetchFn, { acquireSlCookie: acquireSpy }), {
      skus: [],
    });
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.reason).toBe('ok');
    expect(r.snapshotFallback).toBe(false);
    expect(r.partial).toBe(false);
    expect(r.slRequests).toBe(0);
    // No invoca SL ni consume cookie para empty.
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('T4 (defensa en profundidad) — cap valida ANTES del threshold LINEAS_EN_RIESGO', async () => {
    // 10_000 SKUs con libreSnapshot+qtyPedida (bypass histórico: entraría
    // a modo "partial" aunque filtre a cero). El cap debe cortar igual.
    const fetchFn = makeFetchMock();
    const acquireSpy = vi.fn(async () => 'COOKIE_X');
    const skus = genSkus(10_000);
    const libreSnapshot = Object.fromEntries(skus.map((s) => [s, 1000]));
    const qtyPedida = Object.fromEntries(skus.map((s) => [s, 1]));
    const r = await fetchStockLiveCore(makeDeps(fetchFn, { acquireSlCookie: acquireSpy }), {
      skus,
      libreSnapshot,
      qtyPedida,
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('TOO_MANY_SKUS');
    expect(r.slRequests).toBe(0);
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('T5 — dedupe cuenta sobre SKUs únicos: 251 duplicados reales → 126 únicos → OK', async () => {
    // Si pasa 251 entradas pero son duplicados 2x de 126 únicos (<250), NO rechaza
    // porque dedupe ocurre ANTES del cap check (lógica del core existente).
    const fetchFn = makeFetchMock();
    const base = genSkus(126); // 126 únicos
    const dup = base.concat(base.slice(0, 125)); // 126 + 125 = 251 entradas, 126 únicos
    expect(dup.length).toBe(251);
    expect(new Set(dup).size).toBe(126);
    const r = await fetchStockLiveCore(makeDeps(fetchFn), { skus: dup });
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.skusLive.length).toBe(126);
  });
});

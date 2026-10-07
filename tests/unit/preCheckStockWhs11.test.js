// @ts-nocheck
/**
 * Regression test — preCheckStockWhs11 OData encoding (v1165, 2026-10-06).
 *
 * Precedente CLC66MH2PY: el pre-check devolvia 0 disponibles para TRX301HGB
 * pero SAP tenia 89 en whs 11. Root cause (v1165): `encodeURIComponent(filter)`
 * encodeaba los parentesis `(ItemCode eq 'X')` como `%28...%29` y SAP SL los
 * rechazaba silenciosamente — devolvia 200 con `value: []` en vez de los items.
 * Fix v1165: encodear solo los VALORES del filter, dejando parentesis/espacios/
 * operadores sin encodear (solo espacios → %20 para URL valida).
 *
 * Precedente v1173 (perf H3): paralelizar chunks con CONCURRENCY=4 cap para
 * batches grandes (lot send 200+ SKUs).
 *
 * Precedente v1174 (fallback individual): si el batch no devuelve algun SKU
 * (nombre no coincide exacto, filter OR parcial), hace fallback con 1 request
 * por faltante (max 10) con `GET /Items('CODE')`.
 *
 * Cases:
 * 1. Batch de 50 SKUs → 1 request paralelo → map con 50 entries.
 * 2. Batch de 150 SKUs → 3 chunks, concurrency cap=4 → map con 150.
 * 3. Chunk falla (no viene en respuesta) → fallback individual por los faltantes.
 * 4. SKU con comilla simple en el nombre → OData encoded ('') → anda.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Carga sap-service-layer.js en un VM sandbox con fakes de las deps globales
 * (window, firebase, fbDb, etc). Retorna el objeto `sapSL` listo para
 * monkey-patch de `fetchWithSession`.
 */
function loadSapSLModule() {
  const source = readFileSync(`${ROOT}/src/domains/sap-service-layer.js`, 'utf-8');
  // Fakes minimos para que el modulo cargue sin errores. preCheckStockWhs11
  // solo depende de `this.fetchWithSession`, pero el modulo tiene referencias
  // a `window`, `fbDb`, `firebase`, `currentUser`, etc al parse time.
  const sandbox = {
    window: {},
    firebase: {
      app: () => ({ functions: () => ({ httpsCallable: () => () => {} }) }),
      auth: () => ({ currentUser: null }),
    },
    fbDb: null,
    currentUser: null,
    escapeHtml: (s) => String(s),
    sapConfigCache: null,
    sapGetSlpCodeForVendor: null,
    sapGetClienteCode: null,
    sapGetMaterialCode: null,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  };
  const ctx = createContext(sandbox);
  runInContext(source, ctx, { filename: 'sap-service-layer.js' });
  return sandbox.window.sapSL;
}

/**
 * Fabrica una `fetchWithSession` mock. Para cada path llamado, construye la
 * respuesta a partir de `stockMap` (code → {inStock, committed}) y
 * respeta `missingCodes` (set de codes que NO vienen en el batch — simula el
 * caso donde SAP no reconoce el nombre y hay que fallback individual).
 *
 * Retorna el stub + el array de calls para asserts (ej: # requests paralelos).
 */
function makeFetchWithSessionMock({ stockMap = {}, missingFromBatch = new Set() } = {}) {
  const calls = [];
  const fetchWithSession = vi.fn(async (path) => {
    calls.push(path);
    // Match batch request: /Items?$filter=...&$select=...&$top=N
    if (/^\/b1s\/v1\/Items\?\$filter=/.test(path)) {
      // Extraer todos los ItemCodes del filter (puede venir encoded o no — el
      // fix v1165 deja solo espacios como %20, pero igual decoded funciona).
      // Soporte para OData escape '' (apostrofe duplicado dentro del valor).
      const decoded = decodeURIComponent(path);
      // Regex: `ItemCode eq '...'` donde `...` admite `''` (escaped single quote).
      const matches = Array.from(decoded.matchAll(/ItemCode eq '((?:[^']|'')*)'/g));
      const codes = matches.map((m) => m[1].replace(/''/g, "'")); // undo OData escape
      const value = codes
        .filter((c) => !missingFromBatch.has(c))
        .map((code) => ({
          ItemCode: code,
          ItemWarehouseInfoCollection: [
            {
              WarehouseCode: '11',
              InStock: stockMap[code]?.inStock ?? 0,
              Committed: stockMap[code]?.committed ?? 0,
              Ordered: 0,
            },
          ],
        }));
      return { ok: true, status: 200, body: { value } };
    }
    // Match single-item request del fallback: /Items('CODE')?$select=...
    const singleMatch = path.match(/^\/b1s\/v1\/Items\('([^']+)'\)/);
    if (singleMatch) {
      const code = decodeURIComponent(singleMatch[1]);
      const stk = stockMap[code];
      if (!stk) {
        return { ok: true, status: 200, body: { ItemCode: code, ItemWarehouseInfoCollection: [] } };
      }
      return {
        ok: true,
        status: 200,
        body: {
          ItemCode: code,
          ItemWarehouseInfoCollection: [
            {
              WarehouseCode: '11',
              InStock: stk.inStock,
              Committed: stk.committed,
              Ordered: 0,
            },
          ],
        },
      };
    }
    return { ok: false, status: 404, body: {} };
  });
  return { fetchWithSession, calls };
}

// ---------------------------------------------------------------------------
// Setup compartido: load sapSL una vez (modulo immutable).
// ---------------------------------------------------------------------------

let sapSL;
beforeEach(() => {
  sapSL = loadSapSLModule();
});

// ---------------------------------------------------------------------------
// Case 1: 50 SKUs en 1 chunk → 1 request paralelo
// ---------------------------------------------------------------------------
describe('preCheckStockWhs11 — case 1: batch chico (50 SKUs)', () => {
  it('50 SKUs → 1 request batch → map con 50 entries', async () => {
    const codes = Array.from({ length: 50 }, (_, i) => `SKU-${String(i + 1).padStart(3, '0')}`);
    const stockMap = Object.fromEntries(
      codes.map((c, i) => [c, { inStock: 100 + i, committed: 10 }])
    );
    const { fetchWithSession, calls } = makeFetchWithSessionMock({ stockMap });
    sapSL.fetchWithSession = fetchWithSession;
    const res = await sapSL.preCheckStockWhs11(codes);
    expect(res.ok).toBe(true);
    expect(res.availabilityMap.size).toBe(50);
    // 1 solo request batch (CHUNK_SIZE=50).
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^\/b1s\/v1\/Items\?\$filter=/);
    // Validar que el filter NO tiene parentesis encodeados (regression v1165).
    expect(calls[0]).toContain('(ItemCode%20eq%20');
    expect(calls[0]).not.toContain('%28');
    expect(calls[0]).not.toContain('%29');
    // Spot check: SKU-001 → available = 100 - 10 = 90.
    expect(res.availabilityMap.get('SKU-001')).toEqual({
      inStock: 100,
      committed: 10,
      available: 90,
    });
  });
});

// ---------------------------------------------------------------------------
// Case 2: 150 SKUs → 3 chunks paralelos (CONCURRENCY=4) → map con 150
// ---------------------------------------------------------------------------
describe('preCheckStockWhs11 — case 2: batch grande (150 SKUs, 3 chunks paralelos)', () => {
  it('150 SKUs → 3 chunks (50+50+50), 1 lote de concurrencia (3 ≤ 4) → map con 150', async () => {
    const codes = Array.from({ length: 150 }, (_, i) => `BULK-${String(i + 1).padStart(3, '0')}`);
    const stockMap = Object.fromEntries(
      codes.map((c, i) => [c, { inStock: 10 + (i % 5), committed: 0 }])
    );
    const { fetchWithSession, calls } = makeFetchWithSessionMock({ stockMap });
    sapSL.fetchWithSession = fetchWithSession;

    const res = await sapSL.preCheckStockWhs11(codes);
    expect(res.ok).toBe(true);
    expect(res.availabilityMap.size).toBe(150);
    // Expected: 3 batch requests (150 / 50 = 3). Como CONCURRENCY=4 y hay 3
    // chunks, se ejecutan todos paralelos en 1 lote de Promise.all.
    expect(calls.length).toBe(3);
    // Todos los requests deben matchear el pattern batch.
    for (const call of calls) {
      expect(call).toMatch(/^\/b1s\/v1\/Items\?\$filter=/);
      // Regression v1165: parentesis NO encoded.
      expect(call).not.toContain('%28');
      expect(call).not.toContain('%29');
    }
    expect(res.availabilityMap.get('BULK-001').available).toBe(10);
    expect(res.availabilityMap.get('BULK-150').available).toBe(10 + ((150 - 1) % 5));
  });
});

// ---------------------------------------------------------------------------
// Case 3: Chunk retorna parcial → fallback individual para los faltantes
// ---------------------------------------------------------------------------
describe('preCheckStockWhs11 — case 3: fallback individual (missing from batch)', () => {
  it('batch no devuelve 3 SKUs (missing) → fallback individual max 10 → los 3 appear en map', async () => {
    const codes = ['PRESENT-A', 'MISSING-X', 'PRESENT-B', 'MISSING-Y', 'MISSING-Z'];
    const stockMap = {
      'PRESENT-A': { inStock: 100, committed: 20 }, // avail 80
      'PRESENT-B': { inStock: 50, committed: 0 }, // avail 50
      'MISSING-X': { inStock: 30, committed: 5 }, // avail 25 (via fallback)
      'MISSING-Y': { inStock: 10, committed: 0 }, // avail 10 (via fallback)
      'MISSING-Z': { inStock: 5, committed: 2 }, // avail 3 (via fallback)
    };
    const { fetchWithSession, calls } = makeFetchWithSessionMock({
      stockMap,
      missingFromBatch: new Set(['MISSING-X', 'MISSING-Y', 'MISSING-Z']),
    });
    sapSL.fetchWithSession = fetchWithSession;

    const res = await sapSL.preCheckStockWhs11(codes);
    expect(res.ok).toBe(true);
    expect(res.availabilityMap.size).toBe(5);
    expect(res.availabilityMap.get('PRESENT-A').available).toBe(80);
    expect(res.availabilityMap.get('PRESENT-B').available).toBe(50);
    expect(res.availabilityMap.get('MISSING-X').available).toBe(25);
    expect(res.availabilityMap.get('MISSING-Y').available).toBe(10);
    expect(res.availabilityMap.get('MISSING-Z').available).toBe(3);

    // Calls esperados: 1 batch + 3 individual = 4 total.
    expect(calls.length).toBe(4);
    const batchCalls = calls.filter((c) => c.startsWith('/b1s/v1/Items?$filter='));
    const individualCalls = calls.filter((c) => /^\/b1s\/v1\/Items\('/.test(c));
    expect(batchCalls.length).toBe(1);
    expect(individualCalls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Case 4: SKU con comilla simple en el nombre → OData escape '' → anda
// ---------------------------------------------------------------------------
describe("preCheckStockWhs11 — case 4: SKU con apostrofe (regression v1165 encode)", () => {
  it("SKU TEST'SKU → OData encoded TEST''SKU → request OK, available correcto", async () => {
    const codes = ["TEST'SKU", 'NORMAL'];
    const stockMap = {
      "TEST'SKU": { inStock: 50, committed: 10 }, // avail 40
      NORMAL: { inStock: 20, committed: 0 }, // avail 20
    };
    const { fetchWithSession, calls } = makeFetchWithSessionMock({ stockMap });
    sapSL.fetchWithSession = fetchWithSession;

    const res = await sapSL.preCheckStockWhs11(codes);
    expect(res.ok).toBe(true);
    expect(res.availabilityMap.size).toBe(2);
    expect(res.availabilityMap.get("TEST'SKU").available).toBe(40);
    expect(res.availabilityMap.get('NORMAL').available).toBe(20);

    // El request debe contener el apostrofe escaped como '' (OData spec).
    expect(calls.length).toBe(1);
    const url = calls[0];
    // Decodeamos para verificar: debe aparecer `TEST''SKU` (OData escape).
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("ItemCode eq 'TEST''SKU'");
    // Regression v1165: parentesis NO encoded.
    expect(url).not.toContain('%28');
    expect(url).not.toContain('%29');
  });
});

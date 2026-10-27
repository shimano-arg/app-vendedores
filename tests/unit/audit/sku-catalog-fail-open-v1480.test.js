// @ts-check
/**
 * v1480 §77 (2026-10-27) — HOTFIX fail-open SKU_NOT_IN_SAP_CATALOG cuando
 * `sap_products` está vacío.
 *
 * Precedente: 2026-10-26 21:02 (v1475 PR 2 §72 shippeado) → la colección
 * `sap_products` en prod tenía **0 docs** porque §72 asumió que
 * `syncSapCatalogStockCF` la poblaba, pero ese CF sólo escribe
 * `app_config/stock_snapshot`. Resultado: TODOS los pedidos rechazados con
 * SKU_NOT_IN_SAP_CATALOG. Caso reportado: HUGO GIARDINO ORDEN 592
 * (TRX401B 1u, SKU existe en stock_snapshot.quantities y en SAP SL vivo).
 *
 * Fix: `checkSkusInSapCatalog` detecta catálogo vacío con `.limit(1)` LAZY
 * (solo si TODOS los SKUs figuran missing — señal del escenario sospechoso).
 * Devuelve `catalogEmpty=true` y el core loguea `catalog_check_skipped`.
 */
import { describe, expect, it } from 'vitest';
import { checkSkusInSapCatalog } from '../../../functions/core/sku-catalog-check-core.js';

/**
 * Mock Firestore que simula una colección sap_products con `existingSkus`.
 * Soporta `.limit(1).get()` → `{empty: existingSkus.length === 0, size: ...}`.
 * Si `probeThrows=true`, `.limit().get()` tira (simular permission-denied).
 */
function mockDbWithProbe(existingSkus, opts = {}) {
  const existing = new Set((existingSkus || []).map((s) => String(s).toUpperCase()));
  return {
    collection: (_name) => ({
      doc: (sku) => ({
        get: () => Promise.resolve({ exists: existing.has(String(sku).toUpperCase()) }),
      }),
      limit: (_n) => ({
        get: () => {
          if (opts.probeThrows) return Promise.reject(new Error('permission-denied simulated'));
          return Promise.resolve({ empty: existing.size === 0, size: existing.size });
        },
      }),
    }),
  };
}

describe('v1480 §77 — HOTFIX fail-open sap_products vacío', () => {
  it('T1 colección vacía + N SKUs → ok=true + catalogEmpty=true (fail-open)', async () => {
    const r = await checkSkusInSapCatalog(['TRX401B', 'OTRO_SKU'], {
      fbDb: mockDbWithProbe([]),
    });
    expect(r.ok).toBe(true);
    expect(r.catalogEmpty).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.checked).toBe(2);
  });

  it('T2 fixture REAL ORDEN 592 HUGO GIARDINO: TRX401B con sap_products vacío → ok=true', async () => {
    const r = await checkSkusInSapCatalog(['TRX401B'], {
      fbDb: mockDbWithProbe([]),
    });
    expect(r.ok).toBe(true);
    expect(r.catalogEmpty).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('T3 colección con datos + 1 SKU faltante → ok=false (comportamiento normal)', async () => {
    const r = await checkSkusInSapCatalog(['SKU_X', 'SKU_Y'], {
      fbDb: mockDbWithProbe(['SKU_X', 'OTRO']),
    });
    expect(r.ok).toBe(false);
    expect(r.catalogEmpty).toBeUndefined();
    expect(r.missing).toEqual(['SKU_Y']);
  });

  it('T4 colección con datos + TODOS los SKUs del pedido existen → ok=true, no catalogEmpty', async () => {
    const r = await checkSkusInSapCatalog(['SKU_X'], {
      fbDb: mockDbWithProbe(['SKU_X', 'OTRO_SKU']),
    });
    expect(r.ok).toBe(true);
    expect(r.catalogEmpty).toBeUndefined();
    expect(r.missing).toEqual([]);
  });

  it('T5 probe .limit(1) tira (permission/timeout) → fail-open defensivo', async () => {
    const r = await checkSkusInSapCatalog(['TRX401B'], {
      fbDb: mockDbWithProbe([], { probeThrows: true }),
    });
    // Mejor dejar pasar que bloquear 100% producción. Precedente §77.
    expect(r.ok).toBe(true);
    expect(r.catalogEmpty).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('T6 colección con datos pero NO los SKUs del pedido → ok=false (NO fail-open)', async () => {
    // Diferencia clave con T1: la colección NO está vacía, simplemente
    // esos SKUs puntuales no están. Sigue bloqueando (comportamiento §72).
    const r = await checkSkusInSapCatalog(['FOO', 'BAR'], {
      fbDb: mockDbWithProbe(['OTRO1', 'OTRO2', 'OTRO3']),
    });
    expect(r.ok).toBe(false);
    expect(r.catalogEmpty).toBeUndefined();
    expect(r.missing).toEqual(['FOO', 'BAR']);
  });

  it('T7 edge: 1 SKU en pedido + colección con otros 500 → bloquea bien (anti-regresión §72)', async () => {
    const otros = Array.from({ length: 500 }, (_, i) => `OTRO_${i}`);
    const r = await checkSkusInSapCatalog(['FALTA'], {
      fbDb: mockDbWithProbe(otros),
    });
    expect(r.ok).toBe(false);
    expect(r.catalogEmpty).toBeUndefined();
    expect(r.missing).toEqual(['FALTA']);
  });

  it('T8 input vacío + catálogo vacío → ok=true + checked=0 (no toca sap_products)', async () => {
    const r = await checkSkusInSapCatalog([], { fbDb: mockDbWithProbe([]) });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(0);
    expect(r.catalogEmpty).toBeUndefined(); // nunca sondea si no hay SKUs
  });
});

describe('v1480 §77 — contrato commit-pedido-core.js maneja catalogEmpty', () => {
  it('T20 grep: si catalogEmpty=true, log catalog_check_skipped + continuar', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // La rama fail-open debe estar presente.
    expect(core).toMatch(/if \(catalogCheck\.catalogEmpty\)/);
    // Log a operations_log con warningCode catalog_check_skipped.
    expect(core).toMatch(/warningCode: 'catalog_check_skipped'/);
    expect(core).toMatch(/type: 'commit_pedido_warning'/);
    // La rama normal `!catalogCheck.ok` sigue existiendo (else if).
    expect(core).toMatch(/else if \(!catalogCheck\.ok\)/);
    expect(core).toMatch(/'SKU_NOT_IN_SAP_CATALOG'/);
  });

  it('T21 fail-open va ANTES del else que rechaza (orden correcto)', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    const idxFailOpen = core.indexOf('if (catalogCheck.catalogEmpty)');
    const idxReject = core.indexOf('else if (!catalogCheck.ok)');
    expect(idxFailOpen).toBeGreaterThan(0);
    expect(idxReject).toBeGreaterThan(idxFailOpen);
  });
});

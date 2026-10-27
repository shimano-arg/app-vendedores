// @ts-check
/**
 * v1475 PR2 §72 (2026-10-26) — tests sku-catalog-check-core + capa (b)
 * commitPedidoCore gate SKU_NOT_IN_SAP_CATALOG.
 */
import { describe, expect, it, vi } from 'vitest';
import { checkSkusInSapCatalog } from '../../../functions/core/sku-catalog-check-core.js';

function mockDb(existingSkus) {
  const existing = new Set((existingSkus || []).map((s) => String(s).toUpperCase()));
  return {
    collection: (name) => ({
      doc: (sku) => ({
        get: () => Promise.resolve({ exists: existing.has(String(sku).toUpperCase()) }),
      }),
    }),
  };
}

describe('v1475 §72 — checkSkusInSapCatalog', () => {
  it('T1 todos existen → ok=true, missing=[]', async () => {
    const r = await checkSkusInSapCatalog(['SKU1', 'SKU2', 'SKU3'], {
      fbDb: mockDb(['SKU1', 'SKU2', 'SKU3']),
    });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.checked).toBe(3);
  });

  it('T2 uno falta → ok=false, missing=[sku]', async () => {
    const r = await checkSkusInSapCatalog(['SKU1', 'EXGTVC66M4AR', 'SKU3'], {
      fbDb: mockDb(['SKU1', 'SKU3']),
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['EXGTVC66M4AR']);
    expect(r.checked).toBe(3);
  });

  it('T3 todos faltan → ok=false, missing=[all]', async () => {
    const r = await checkSkusInSapCatalog(['A', 'B'], { fbDb: mockDb([]) });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['A', 'B']);
  });

  it('T4 input vacío → ok=true, missing=[]', async () => {
    const r = await checkSkusInSapCatalog([], { fbDb: mockDb([]) });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.checked).toBe(0);
  });

  it('T5 normaliza (uppercase + trim) y dedupe', async () => {
    const r = await checkSkusInSapCatalog(['sku1', 'SKU1', '  Sku1  ', 'sku2'], {
      fbDb: mockDb(['SKU1']),
    });
    expect(r.checked).toBe(2); // deduped a SKU1 y SKU2
    expect(r.missing).toEqual(['SKU2']);
  });

  it('T6 fixture REAL ORDEN 530: EXGTVC66M4AR missing', async () => {
    const r = await checkSkusInSapCatalog(['CUDC201HG', 'EXGTVC66M4AR', 'OTRO'], {
      fbDb: mockDb(['CUDC201HG', 'OTRO']),
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['EXGTVC66M4AR']);
  });

  it('T7 input null/undefined/no-array → ok=true, missing=[], checked=0', async () => {
    const r1 = await checkSkusInSapCatalog(null, { fbDb: mockDb([]) });
    expect(r1.ok).toBe(true);
    expect(r1.checked).toBe(0);
    const r2 = await checkSkusInSapCatalog(undefined, { fbDb: mockDb([]) });
    expect(r2.checked).toBe(0);
    const r3 = await checkSkusInSapCatalog('not-array', { fbDb: mockDb([]) });
    expect(r3.checked).toBe(0);
  });

  it('T8 deps.fbDb faltante → throw', async () => {
    await expect(checkSkusInSapCatalog(['A'], {})).rejects.toThrow('deps.fbDb requerido');
    await expect(checkSkusInSapCatalog(['A'], null)).rejects.toThrow();
  });
});

describe('v1475 §72 — contrato commit-pedido-core.js usa el gate', () => {
  it('T20 grep: import checkSkusInSapCatalog + llamada antes de runTransaction', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    expect(core).toMatch(
      /import \{\s*checkSkusInSapCatalog\s*\}\s*from '\.\/sku-catalog-check-core/
    );
    expect(core).toMatch(/const catalogCheck = await checkSkusInSapCatalog\(skusForCheck, deps\);/);
    expect(core).toMatch(/if \(!catalogCheck\.ok\)/);
    expect(core).toMatch(/'SKU_NOT_IN_SAP_CATALOG'/);
    expect(core).toMatch(/missingSkus: catalogCheck\.missing/);
    // Debe estar ANTES del runTransaction (preserva waitlist origen).
    const idxCheck = core.indexOf('const catalogCheck = await checkSkusInSapCatalog');
    const idxTx = core.indexOf('// 5. runTransaction atómica.');
    expect(idxCheck).toBeGreaterThan(0);
    expect(idxTx).toBeGreaterThan(idxCheck);
  });

  it('T21 mensaje SKU_NOT_IN_SAP_CATALOG en mensajes-vendedor cumple §68', async () => {
    const { MENSAJES_VENDEDOR } = await import('../../../src/pure/mensajes-vendedor.js');
    expect(MENSAJES_VENDEDOR.SKU_NOT_IN_SAP_CATALOG).toBeDefined();
    const texto = MENSAJES_VENDEDOR.SKU_NOT_IN_SAP_CATALOG.texto;
    // Chequea SOLO el campo texto (no el nombre de la key que tiene SKU).
    // Prohibidas §68: SKU (todo mayus), payload, Firestore, backend, undefined,
    // callable, snapshot, transacción/transaccion, concurrencia.
    const prohibidas = [
      'SKU',
      'payload',
      'Firestore',
      'backend',
      'undefined',
      'callable',
      'snapshot',
      'concurrencia',
      'transacción',
      'transaccion',
    ];
    for (const w of prohibidas) {
      expect(
        texto.includes(w),
        `mensaje SKU_NOT_IN_SAP_CATALOG tiene jerga: "${w}" en "${texto}"`
      ).toBe(false);
    }
  });
});

describe('v1475 §72 — contrato auto-send-sap-core degrada individualmente sap_item_not_found', () => {
  it('T30 grep: onlySapNotFound + envía keptLines + email alerta', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/auto-send-sap-core.js', 'utf8');
    expect(core).toMatch(/sapNotFoundDegraded/);
    expect(core).toMatch(/insufficientStockDegraded/);
    expect(core).toMatch(/onlySapNotFound/);
    // Enviar keptLines reemplazando DocumentLines.
    expect(core).toMatch(/built\.payload\.DocumentLines = stockCheck\.keptLines/);
    // Log a operations_log type='sap_item_not_found_degraded'.
    expect(core).toMatch(/type: 'sap_item_not_found_degraded'/);
    // Email alerta (si deps.sendAlertEmail existe).
    expect(core).toMatch(/deps\.sendAlertEmail/);
    // Marcar línea con _degradedReason.
    expect(core).toMatch(/_degradedReason: 'sap_item_not_found_app_only'/);
  });
});

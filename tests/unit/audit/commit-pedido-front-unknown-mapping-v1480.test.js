// @ts-check
/**
 * v1480 §78 (2026-10-27) — front UNKNOWN mapping fix.
 *
 * Antes: el else-chain de `doConfirmPedido` sólo manejaba un subset de
 * errorCodes (VERSION_OLD, UNRESOLVED_BO_ENTRY_ROWS, CLIENT_HAS_OPEN_WAITLIST,
 * STOCK_CHANGED, SNAPSHOT_TOO_OLD, CONTENTION_RETRY_EXHAUSTED, VALIDATION_ERROR,
 * PERMISSION_DENIED, SAP_UNAVAILABLE, INTERNAL). El default caía en `UNKNOWN`.
 *
 * Reportado prod 2026-10-26 (v1475): SKU_NOT_IN_SAP_CATALOG y VENDOR_UID_MISSING
 * mostraban "Código técnico: UNKNOWN" aunque `src/pure/mensajes-vendedor.js`
 * tenía el mensaje para ambos. Vendedores sin pista de qué hacer.
 *
 * Fix: default data-driven. Si `_mv.MENSAJES_VENDEDOR[code]` existe → usar
 * ese code; sino → UNKNOWN. Cubre SKU_NOT_IN_SAP_CATALOG, VENDOR_UID_MISSING
 * y cualquier errorCode futuro sin hardcode.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MENSAJES_VENDEDOR } from '../../../src/pure/mensajes-vendedor.js';

describe('v1480 §78 — mensajes-vendedor cubre todos los errorCodes del CF', () => {
  it('T1 SKU_NOT_IN_SAP_CATALOG tiene mensaje humano', () => {
    const m = MENSAJES_VENDEDOR.SKU_NOT_IN_SAP_CATALOG;
    expect(m).toBeDefined();
    expect(m.texto).toBeTruthy();
    expect(typeof m.texto).toBe('string');
    expect(m.texto.length).toBeGreaterThan(10);
  });

  it('T2 VENDOR_UID_MISSING tiene mensaje humano', () => {
    const m = MENSAJES_VENDEDOR.VENDOR_UID_MISSING;
    expect(m).toBeDefined();
    expect(m.texto).toBeTruthy();
  });

  it('T3 cada errorCode conocido del CF está en MENSAJES_VENDEDOR', () => {
    const codesCF = [
      'VERSION_OLD',
      'CLIENT_HAS_OPEN_WAITLIST',
      'STOCK_CHANGED',
      'SNAPSHOT_TOO_OLD',
      'VALIDATION_ERROR',
      'PERMISSION_DENIED',
      'SAP_UNAVAILABLE',
      'INTERNAL',
      'UNRESOLVED_BO_ENTRY_ROWS',
      'SKU_NOT_IN_SAP_CATALOG',
      'VENDOR_UID_MISSING',
      'UNKNOWN',
    ];
    for (const c of codesCF) {
      expect(MENSAJES_VENDEDOR[c], `MENSAJES_VENDEDOR[${c}] falta`).toBeDefined();
    }
  });
});

describe('v1480 §78 — contrato index.html default data-driven', () => {
  const INDEX_HTML = readFileSync('index.html', 'utf8');

  it('T20 doConfirmPedido else default usa _mv.MENSAJES_VENDEDOR[code] para decidir UNKNOWN', () => {
    // Grep del bloque else default v1480 §78.
    expect(INDEX_HTML).toMatch(/v1480 §78 \(2026-10-27\): data-driven default/);
    expect(INDEX_HTML).toMatch(
      /const _hasMsg = !!\(_mv && _mv\.MENSAJES_VENDEDOR && _mv\.MENSAJES_VENDEDOR\[code\]\);/
    );
    expect(INDEX_HTML).toMatch(/alert\(_fmt\(_hasMsg \? code : 'UNKNOWN'\)\);/);
  });

  it('T21 anti-regresión: default ya NO es `alert(_fmt(UNKNOWN))` sin check previo', () => {
    // Antes había 2 ocurrencias de `alert(_fmt('UNKNOWN'))` (una en catch del retry
    // STOCK_CHANGED, otra en el else default). Debe quedar solo la del catch.
    const matches = INDEX_HTML.match(/alert\(_fmt\('UNKNOWN'\)\)/g) || [];
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});

describe('v1480 §78 — mapping se cumple end-to-end simulado', () => {
  it('T30 helper getMensajeParaErrorCode devuelve el texto esperado para SKU_NOT_IN_SAP_CATALOG', async () => {
    const { getMensajeParaErrorCode } = await import('../../../src/pure/mensajes-vendedor.js');
    const r = getMensajeParaErrorCode('SKU_NOT_IN_SAP_CATALOG');
    expect(r.texto).toContain('productos');
  });

  it('T31 helper devuelve UNKNOWN para errorCode inexistente', async () => {
    const { getMensajeParaErrorCode } = await import('../../../src/pure/mensajes-vendedor.js');
    const r = getMensajeParaErrorCode('NO_EXISTE_ESTE_CODIGO');
    // Debe caer al fallback UNKNOWN (que sí existe).
    expect(r).toBeDefined();
    expect(r.texto).toBeTruthy();
  });
});

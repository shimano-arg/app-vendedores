// @ts-check
/**
 * v1480 §78 (2026-10-27) — front UNKNOWN mapping fix.
 *
 * Antes: el else-chain de `doConfirmPedido` sólo manejaba un subset de
 * errorCodes (VERSION_OLD, UNRESOLVED_BO_ENTRY_ROWS, CLIENT_HAS_OPEN_WAITLIST,
 * STOCK_CHANGED, SNAPSHOT_TOO_OLD, CONTENTION_RETRY_EXHAUSTED, VALIDATION_ERROR,
 * PERMISSION_DENIED, SAP_UNAVAILABLE, INTERNAL). El default caía en `UNKNOWN`.
 *
 * Reportado prod 2026-10-26 (v1475): VENDOR_UID_MISSING mostraba "Código
 * técnico: UNKNOWN" aunque `src/pure/mensajes-vendedor.js` tenía el mensaje.
 * Vendedores sin pista de qué hacer.
 *
 * Fix: default data-driven. Si `_mv.MENSAJES_VENDEDOR[code]` existe → usar
 * ese code; sino → UNKNOWN. Cubre VENDOR_UID_MISSING y cualquier errorCode
 * futuro sin hardcode.
 *
 * Update 2026-11-20 (incidente Federico): se removió `SKU_NOT_IN_SAP_CATALOG`
 * tras eliminar la CAPA (b) del gate en commit-pedido-core.js. Los SKUs sin
 * alta SAP ahora caen a BO y el pedido pasa como `app_only` sin rechazar
 * (ver CAPA (c) en auto-send-sap-core.js). El test se adapta: ese errorCode
 * ya no debe estar en MENSAJES_VENDEDOR.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MENSAJES_VENDEDOR } from '../../../src/pure/mensajes-vendedor.js';

describe('v1480 §78 — mensajes-vendedor cubre todos los errorCodes del CF', () => {
  it('T1 VENDOR_UID_MISSING tiene mensaje humano', () => {
    const m = MENSAJES_VENDEDOR.VENDOR_UID_MISSING;
    expect(m).toBeDefined();
    expect(m.texto).toBeTruthy();
  });

  it('T2 cada errorCode vigente del CF está en MENSAJES_VENDEDOR', () => {
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
      'VENDOR_UID_MISSING',
      'UNKNOWN',
    ];
    for (const c of codesCF) {
      expect(MENSAJES_VENDEDOR[c], `MENSAJES_VENDEDOR[${c}] falta`).toBeDefined();
    }
  });

  it('T3 SKU_NOT_IN_SAP_CATALOG removido (incidente Federico 2026-11-20)', () => {
    // Anti-regresión: el gate fue eliminado del CF. Si alguien reintroduce el
    // errorCode en `MENSAJES_VENDEDOR` sin reintroducir el gate (cumpliendo
    // §77 + §78 + §89), este test falla.
    expect(MENSAJES_VENDEDOR.SKU_NOT_IN_SAP_CATALOG).toBeUndefined();
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

  it('T22 anti-regresión: rama SKU_NOT_IN_SAP_CATALOG removida de index.html', () => {
    // Incidente Federico 2026-11-20: la rama era alcanzable por errorCode
    // que el CF ya no emite. Al removerla, el default data-driven (T20) se
    // encarga del fallback si por alguna razón reaparece el código.
    expect(INDEX_HTML).not.toMatch(/code === 'SKU_NOT_IN_SAP_CATALOG'/);
  });
});

describe('v1480 §78 — mapping se cumple end-to-end simulado', () => {
  it('T30 helper devuelve UNKNOWN para errorCode inexistente', async () => {
    const { getMensajeParaErrorCode } = await import('../../../src/pure/mensajes-vendedor.js');
    const r = getMensajeParaErrorCode('NO_EXISTE_ESTE_CODIGO');
    // Debe caer al fallback UNKNOWN (que sí existe).
    expect(r).toBeDefined();
    expect(r.texto).toBeTruthy();
  });
});

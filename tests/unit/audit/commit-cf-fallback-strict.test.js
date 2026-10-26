// @ts-check
/**
 * v1431 hotfix §stock-servidor-atomico — tests estrictos del flow fallback.
 *
 * Requisito Mariano (2026-10-23): el fallback legacy a pedidos.add directo
 * SOLO se activa si commitPedidoCF no responde (red / función caída).
 * NUNCA ante STOCK_CHANGED, CLIENT_HAS_OPEN_WAITLIST, VERSION_OLD ni
 * ningún otro error de negocio.
 *
 * Validaciones:
 * 1. _tryCommitPedidoCF distingue error de red vs error de negocio.
 * 2. Error de red (unavailable, deadline-exceeded, cancelled, not-found,
 *    aborted, network-request-failed) → return null → fallback OK.
 * 3. Error de negocio (unauthenticated, permission-denied, invalid-argument,
 *    internal) → return {ok:false, errorCode} → NO fallback.
 * 4. Logging best-effort a operations_log + console.error con campos
 *    completos (motivo, user, pedido, versión).
 * 5. doConfirmPedido maneja los 7 errorCodes del contrato explícitamente.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1431 fallback strict', () => {
  describe('_tryCommitPedidoCF distingue red vs negocio', () => {
    it('declara set de códigos NETWORK_CODES (fallback OK)', () => {
      expect(INDEX_HTML).toMatch(/window\._FALLBACK_LEGACY_NETWORK_CODES\s*=\s*new Set/);
    });

    it('incluye functions/unavailable en NETWORK_CODES', () => {
      expect(INDEX_HTML).toContain("'functions/unavailable'");
    });

    it('incluye functions/deadline-exceeded en NETWORK_CODES', () => {
      expect(INDEX_HTML).toContain("'functions/deadline-exceeded'");
    });

    it('incluye functions/cancelled en NETWORK_CODES', () => {
      expect(INDEX_HTML).toContain("'functions/cancelled'");
    });

    it('incluye functions/not-found en NETWORK_CODES', () => {
      expect(INDEX_HTML).toContain("'functions/not-found'");
    });

    it('incluye functions/aborted en NETWORK_CODES', () => {
      expect(INDEX_HTML).toContain("'functions/aborted'");
    });

    it('incluye network-request-failed en NETWORK_CODES', () => {
      expect(INDEX_HTML).toContain("'network-request-failed'");
    });

    it('catch distingue isNetwork → null, resto → {ok:false, errorCode}', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      const code = INDEX_HTML.slice(start, start + 9500);
      expect(code).toMatch(/const\s+isNetwork\s*=\s*window\._FALLBACK_LEGACY_NETWORK_CODES\.has/);
      // v1432: entre `if (isNetwork)` y `return null` ahora hay query _draftId
      // + idempotency recovery. Dejar la regex más ancha para cubrir ambos.
      expect(code).toMatch(/if\s*\(\s*isNetwork\s*\)\s*\{[\s\S]*?return null/);
      // Non-network → return {ok: false, errorCode}
      expect(code).toMatch(/return\s*\{\s*ok:\s*false\s*,\s*errorCode:/);
    });

    it('mapea functions/unauthenticated → PERMISSION_DENIED', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      const code = INDEX_HTML.slice(start, start + 9500);
      expect(code).toMatch(/functions\/unauthenticated[\s\S]{0,80}PERMISSION_DENIED/);
    });

    it('mapea functions/permission-denied → PERMISSION_DENIED', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      const code = INDEX_HTML.slice(start, start + 9500);
      expect(code).toMatch(/functions\/permission-denied[\s\S]{0,80}PERMISSION_DENIED/);
    });

    it('mapea functions/invalid-argument → VALIDATION_ERROR', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      const code = INDEX_HTML.slice(start, start + 9500);
      expect(code).toMatch(/functions\/invalid-argument[\s\S]{0,80}VALIDATION_ERROR/);
    });

    it('firebase no inicializado → return null + log fallback', () => {
      const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
      const code = INDEX_HTML.slice(start, start + 9500);
      expect(code).toMatch(/firebase_not_initialized/);
      expect(code).toMatch(/if\s*\(!firebase[\s\S]*?return null/);
    });
  });

  describe('_logCommitCfFallback escribe a operations_log + console', () => {
    it('existe _logCommitCfFallback helper', () => {
      expect(INDEX_HTML).toMatch(/function\s+_logCommitCfFallback\s*\(/);
    });

    it('escribe a operations_log collection', () => {
      const start = INDEX_HTML.indexOf('function _logCommitCfFallback');
      const code = INDEX_HTML.slice(start, start + 1500);
      expect(code).toMatch(/fbDb\.collection\(['"]operations_log['"]\)\.add/);
    });

    it('log entry incluye motivo, userUid, userEmail, draftId, cardCode, clientVersion', () => {
      const start = INDEX_HTML.indexOf('function _logCommitCfFallback');
      const code = INDEX_HTML.slice(start, start + 1500);
      expect(code).toMatch(/type:\s*['"]commitPedidoCF_fallback_legacy['"]/);
      expect(code).toMatch(/motivo/);
      expect(code).toMatch(/userUid/);
      expect(code).toMatch(/userEmail/);
      expect(code).toMatch(/draftId/);
      expect(code).toMatch(/cardCode/);
      expect(code).toMatch(/clientVersion/);
    });

    it('console.error con marker [FALLBACK_LEGACY_COMMIT_CF]', () => {
      const start = INDEX_HTML.indexOf('function _logCommitCfFallback');
      const code = INDEX_HTML.slice(start, start + 1500);
      expect(code).toMatch(/console\.error\(['"]?\[FALLBACK_LEGACY_COMMIT_CF\]/);
    });

    it('write operations_log es best-effort (.catch no bloquea)', () => {
      const start = INDEX_HTML.indexOf('function _logCommitCfFallback');
      const code = INDEX_HTML.slice(start, start + 1500);
      expect(code).toMatch(/\.add\(logEntry\)\.catch\(/);
    });
  });

  describe('doConfirmPedido maneja los 7 errorCodes sin caer al fallback', () => {
    const codes = [
      'VERSION_OLD',
      'CLIENT_HAS_OPEN_WAITLIST',
      'STOCK_CHANGED',
      'SNAPSHOT_TOO_OLD',
      'CONTENTION_RETRY_EXHAUSTED',
      'VALIDATION_ERROR',
      'PERMISSION_DENIED',
      'INTERNAL',
    ];
    for (const c of codes) {
      it(`maneja ${c} explícitamente`, () => {
        expect(INDEX_HTML).toContain(`code === '${c}'`);
      });
    }

    it('después del handler de ok=false hay return (NO cae a fallback)', () => {
      const start = INDEX_HTML.indexOf('_commitCfResult && _commitCfResult.ok === false');
      // 2026-10-23 §60: handler SNAPSHOT_TOO_OLD expandió el bloque; aumentar margen.
      // §67 (v1454): el bloque post-ok=false ahora termina en `return;` seguido
      // del comentario "§67 (v1454 2026-10-25): FALLBACK LEGACY ELIMINADO" en
      // vez de "Fallback legacy". Match ambos para compat durante la transición.
      // v1469 (2026-10-26): handler CONTENTION_RETRY_EXHAUSTED agregó rama de
      // mensaje genérico; aumentar margen a 6000.
      const code = INDEX_HTML.slice(start, start + 6000);
      expect(code).toMatch(/return;\s*\n\s*\}\s*\n\s*\/\/\s*(Fallback legacy|§67 \(v1454)/);
    });
  });

  describe('§67 (v1454): fallback legacy eliminado — queda como código muerto bajo if(false) para rollback', () => {
    it('comentario de fallback dice "FALLBACK LEGACY ELIMINADO"', () => {
      expect(INDEX_HTML).toMatch(/FALLBACK LEGACY ELIMINADO/);
    });

    it('fallback pedidos.add sigue en el código pero preservado dentro de if(false)', () => {
      // §67 (v1454): el `pedidos.add(docData)` sigue físicamente en el archivo
      // envuelto en `if (false)` para rollback rápido. Deja de ejecutarse en
      // runtime (eliminar en v1455+).
      const addMatches = INDEX_HTML.match(/fbDb\.collection\(['"]pedidos['"]\)\.add\(docData\)/g);
      expect(addMatches).toBeTruthy();
      expect(addMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('bloque unreachable envuelto en if(false) con biome-ignore', () => {
      expect(INDEX_HTML).toMatch(/biome-ignore[\s\S]{0,200}noUnreachableCode/);
    });
  });
});

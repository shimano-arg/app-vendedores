// @ts-check
/**
 * v1432 §stock-servidor-atomico — tests contractuales sobre el inline helper
 * window._tryCommitPedidoCF en index.html. Valida que el inline helper
 * respete el mismo contrato que src/pure/commit-pedido-client.js (testeado
 * con mocks aparte en commit-pedido-client.test.js).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1432 inline contract: _tryCommitPedidoCF', () => {
  it('ABORTED_RETRY_CODES set declarado con functions/aborted y aborted', () => {
    expect(INDEX_HTML).toContain(
      "window._ABORTED_RETRY_CODES = new Set(['functions/aborted', 'aborted'])"
    );
  });

  it('ABORTED_RETRY_BACKOFFS_MS = [100, 300, 900]', () => {
    expect(INDEX_HTML).toContain('window._ABORTED_RETRY_BACKOFFS_MS = [100, 300, 900]');
  });

  it('NETWORK_CODES NO incluye aborted/functions/aborted (v1432: salió)', () => {
    const start = INDEX_HTML.indexOf('window._FALLBACK_LEGACY_NETWORK_CODES');
    const end = INDEX_HTML.indexOf(']);', start);
    const setContent = INDEX_HTML.slice(start, end);
    expect(setContent).not.toMatch(/['"](functions\/)?aborted['"]/);
  });

  it('rama aborted hace retry con backoff dentro del while', () => {
    const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
    const code = INDEX_HTML.slice(start, start + 7000);
    expect(code).toMatch(/_ABORTED_RETRY_CODES\.has\(code\)/);
    expect(code).toMatch(/abortedAttempts\s*<\s*window\._ABORTED_RETRY_BACKOFFS_MS\.length/);
    expect(code).toMatch(/setTimeout.*wait/);
    expect(code).toMatch(/continue;/); // reintenta
  });

  it('retries agotados → CONTENTION_RETRY_EXHAUSTED (NUNCA fallback)', () => {
    const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
    const code = INDEX_HTML.slice(start, start + 7000);
    expect(code).toMatch(/aborted retry exhausted/);
    expect(code).toMatch(/errorCode:\s*['"]CONTENTION_RETRY_EXHAUSTED['"]/);
  });

  it('idempotency check consulta _draftId ANTES del fallback (rama red)', () => {
    const start = INDEX_HTML.indexOf('const isNetwork = window._FALLBACK_LEGACY_NETWORK_CODES');
    const code = INDEX_HTML.slice(start, start + 3000);
    // Dentro de la rama isNetwork, antes del return null, se ejecuta query _draftId.
    const idxQuery = code.indexOf("where('_draftId'");
    const idxReturnNull = code.indexOf('return null');
    expect(idxQuery).toBeGreaterThan(0);
    expect(idxReturnNull).toBeGreaterThan(0);
    expect(idxQuery).toBeLessThan(idxReturnNull);
  });

  it('post-hoc recovery devuelve {ok:true, idempotentHit, _postHocRecovery}', () => {
    const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
    const code = INDEX_HTML.slice(start, start + 7000);
    expect(code).toContain("'post_hoc_recovery'");
    expect(code).toContain('_postHocRecovery: true');
    expect(code).toMatch(/idempotentHit:\s*true/);
  });

  it('_deriveLinesFromExistingPedido helper existe en inline', () => {
    expect(INDEX_HTML).toMatch(/function\s+_deriveLinesFromExistingPedido\s*\(/);
  });

  it('fallback log motivo = network_or_cf_down (red real)', () => {
    const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
    const code = INDEX_HTML.slice(start, start + 7000);
    expect(code).toContain("'network_or_cf_down'");
  });

  it('fallback log motivo = post_hoc_recovery cuando se recupera', () => {
    const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
    const code = INDEX_HTML.slice(start, start + 7000);
    expect(code).toContain("'post_hoc_recovery'");
  });

  it('errores de negocio NUNCA van a rama red/aborted', () => {
    const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
    const code = INDEX_HTML.slice(start, start + 7000);
    // Return con errorCode mapeado al final de las ramas red/aborted.
    expect(code).toContain('PERMISSION_DENIED');
    expect(code).toContain('VALIDATION_ERROR');
    // Error de negocio mapea sin query firestore.
    expect(code).toMatch(/error de negocio NO cae a fallback/);
  });
});

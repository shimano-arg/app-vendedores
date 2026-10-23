// @ts-check
/**
 * E3 §stock-servidor-atomico — tests que verifican que `doConfirmPedido`
 * llama a `commitPedidoCF` (via `_tryCommitPedidoCF`) y maneja los códigos
 * de error apropiadamente.
 *
 * Como `index.html` es monolítico y no se puede importar directo, hacemos
 * grep del código fuente para validar:
 * 1. El helper `_tryCommitPedidoCF` existe + envía payload correcto.
 * 2. `doConfirmPedido` invoca `window._tryCommitPedidoCF` antes del fallback.
 * 3. Modal maneja los errorCodes (VERSION_OLD, STOCK_CHANGED, CLIENT_HAS_OPEN_WAITLIST).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('E3 — doConfirmPedido usa commitPedidoCF', () => {
  it('existe el helper window._tryCommitPedidoCF', () => {
    expect(INDEX_HTML).toMatch(/window\._tryCommitPedidoCF\s*=\s*async function/);
  });

  it('_tryCommitPedidoCF llama a httpsCallable("commitPedidoCF")', () => {
    const match = INDEX_HTML.match(
      /window\._tryCommitPedidoCF\s*=[\s\S]{0,2000}httpsCallable\(['"]commitPedidoCF['"]\)/
    );
    expect(match, '_tryCommitPedidoCF debe llamar httpsCallable(commitPedidoCF)').toBeTruthy();
  });

  it('_tryCommitPedidoCF arma payload con draftId, cardCode, origen, lines, clientVersion', () => {
    const start = INDEX_HTML.indexOf('window._tryCommitPedidoCF');
    expect(start).toBeGreaterThan(0);
    const code = INDEX_HTML.slice(start, start + 2500);
    // ES6 shorthand o explícito.
    expect(code).toMatch(/draftId[:,]/);
    expect(code).toMatch(/cardCode:/);
    expect(code).toMatch(/origen:/);
    expect(code).toMatch(/lines:/);
    expect(code).toMatch(/clientVersion:/);
  });

  it('mapea source=stock-asignado-batch → origen=cpst', () => {
    const match = INDEX_HTML.match(/window\._tryCommitPedidoCF\s*=[\s\S]{0,2500}/);
    expect(match[0]).toMatch(/stock-asignado-batch[\s\S]{0,80}cpst/);
  });

  it('mapea source=excel → origen=excel', () => {
    const match = INDEX_HTML.match(/window\._tryCommitPedidoCF\s*=[\s\S]{0,2500}/);
    expect(match[0]).toMatch(/excel[\s\S]{0,80}excel/);
  });

  it('fallback a null si httpsCallable falla (CF no disponible)', () => {
    const match = INDEX_HTML.match(/window\._tryCommitPedidoCF\s*=[\s\S]{0,2500}/);
    expect(match[0]).toMatch(/fallback.*legacy|return null/i);
  });

  it('doConfirmPedido invoca window._tryCommitPedidoCF', () => {
    // Buscar en el bloque de persistPendingEntry (donde está el pedidos.add).
    expect(INDEX_HTML).toMatch(/window\._tryCommitPedidoCF\s*\(docData\)/);
  });

  it('doConfirmPedido maneja VERSION_OLD con reload prompt', () => {
    expect(INDEX_HTML).toContain("code === 'VERSION_OLD'");
    expect(INDEX_HTML).toMatch(/VERSION_OLD[\s\S]{0,200}location\.reload/);
  });

  it('doConfirmPedido maneja STOCK_CHANGED con confirm reintento', () => {
    expect(INDEX_HTML).toContain("code === 'STOCK_CHANGED'");
    expect(INDEX_HTML).toMatch(/STOCK_CHANGED[\s\S]{0,400}_autoAcceptStockChange/);
  });

  it('doConfirmPedido maneja CLIENT_HAS_OPEN_WAITLIST con alert', () => {
    expect(INDEX_HTML).toContain("code === 'CLIENT_HAS_OPEN_WAITLIST'");
  });

  it('fallback a pedidos.add directo si CF no disponible', () => {
    // Fallback legacy — mantiene el flow viejo intacto.
    expect(INDEX_HTML).toContain('Fallback legacy');
    // El segundo pedidos.add existe post-fallback (la vieja ruta se preserva).
    const addMatches = INDEX_HTML.match(/fbDb\.collection\(['"]pedidos['"]\)\.add\(docData\)/g);
    expect(addMatches, 'debe existir al menos un pedidos.add(docData) fallback').toBeTruthy();
    expect(addMatches.length).toBeGreaterThanOrEqual(1);
  });
});

// @ts-check
/**
 * E3 §auditgrises G5.18 — `window._pendingPedido*` globals leak:
 * si `fbDb.collection('pedidos').add(docData)` falla con `.catch`, los 5
 * globals pending (OrderNumber, WaitlistId, Source, Origenes, BypassAsigGate)
 * quedan vivos y el próximo pedido los hereda (ej. source='stock-asignado-batch'
 * contaminando un pedido manual → cancela ASIG ajenas).
 *
 * Fix v1424: `.finally()` después del `.then().catch()` resetea idempotente.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('G5.18 — pending globals cleanup en error path', () => {
  it('doConfirmPedido tiene .finally() post-catch para resetear globals pending', () => {
    const _idx = INDEX_HTML.indexOf("fbDb.collection('pedidos').add(docData).then");
    expect(_idx).toBeGreaterThan(0);
    const snippet = INDEX_HTML.slice(_idx, _idx + 30000);
    expect(snippet).toMatch(
      /\.finally\s*\(\s*\(?\s*\)?\s*=>\s*\{[\s\S]*?_pendingPedidoOrderNumber\s*=\s*null/
    );
    expect(snippet).toMatch(/_pendingPedidoWaitlistId\s*=\s*null/);
    expect(snippet).toMatch(/_pendingPedidoSource\s*=\s*null/);
    expect(snippet).toMatch(/_pendingPedidoOrigenes\s*=\s*null/);
    expect(snippet).toMatch(/_pendingBypassAsigGate\s*=\s*null/);
  });

  it('cleanup lleva marker G5.18 (anti-regresión futura)', () => {
    const _idx = INDEX_HTML.indexOf("fbDb.collection('pedidos').add(docData).then");
    const snippet = INDEX_HTML.slice(_idx, _idx + 30000);
    const finallyIdx = snippet.indexOf('.finally');
    expect(finallyIdx).toBeGreaterThan(0);
    const finallyBlock = snippet.slice(finallyIdx, finallyIdx + 1500);
    expect(finallyBlock).toMatch(/G5\.18/);
  });
});

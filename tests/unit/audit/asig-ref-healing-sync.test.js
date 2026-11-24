// @ts-nocheck
/**
 * Test de sincronía §57 entre `src/pure/asig-ref-healing.js` y
 * `functions/core/asig-ref-healing.js`. Si divergen, falla.
 *
 * v1565 Incidente Frente A (2026-11-24, §108 CLAUDE.md).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Strippa comentarios + whitespace extra para comparar solo lógica.
 * Los comentarios internos pueden diferir entre pure y mirror (contexto
 * pedagógico extra en el pure), pero la LÓGICA debe ser byte-for-byte
 * idéntica. Si el mirror diverge en lógica, el test falla.
 */
function stripCommentsAndWhitespace(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, '') // line comments
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

describe('asig-ref-healing sync pure <-> server mirror (§57)', () => {
  it('lógica de healAsigRefs + decideHealingAction + findSplitTwin idéntica', () => {
    const pureSrc = readFileSync(resolve(process.cwd(), 'src/pure/asig-ref-healing.js'), 'utf8');
    const serverSrc = readFileSync(
      resolve(process.cwd(), 'functions/core/asig-ref-healing.js'),
      'utf8'
    );
    const extract = (txt, fn) => {
      const re = new RegExp(`function ${fn}[\\s\\S]*?\\n\\}`);
      const m = txt.match(re);
      return m ? m[0].trim() : null;
    };
    for (const fn of ['healAsigRefs', 'decideHealingAction', 'findSplitTwin']) {
      const a = extract(pureSrc, fn);
      const b = extract(serverSrc, fn);
      expect(a, `${fn}: no se encontró en pure`).not.toBeNull();
      expect(b, `${fn}: no se encontró en mirror`).not.toBeNull();
      const na = stripCommentsAndWhitespace((a || '').replace(/^export\s+/, ''));
      const nb = stripCommentsAndWhitespace((b || '').replace(/^export\s+/, ''));
      expect(nb, `${fn}: LÓGICA divergió entre pure y mirror`).toBe(na);
    }
  });
});

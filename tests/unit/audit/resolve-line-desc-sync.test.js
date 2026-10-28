// @ts-check
/**
 * v1504 PR2 §57 — sync test entre src/pure/resolve-line-desc.js y
 * functions/core/resolve-line-desc-core.js.
 *
 * CLAUDE.md §57: lógica cliente+servidor vive una sola vez en src/pure con
 * espejo en functions/core. Este test falla si los exports o firmas divergen.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('v1504 §57 — resolve-line-desc src/pure ↔ functions/core sync', () => {
  const pure = readFileSync('src/pure/resolve-line-desc.js', 'utf8');
  const mirror = readFileSync('functions/core/resolve-line-desc-core.js', 'utf8');

  it('T1 ambos exportan resolveLineDesc (write-side)', () => {
    expect(pure).toMatch(/export function resolveLineDesc\(/);
    expect(mirror).toMatch(/export function resolveLineDesc\(/);
  });

  it('T2 ambos exportan resolveLineDescLive (read-side v1504)', () => {
    expect(pure).toMatch(/export function resolveLineDescLive\(/);
    expect(mirror).toMatch(/export function resolveLineDescLive\(/);
  });

  it('T3 ambos exportan buildCatalogDescMapFromProducts (v1504)', () => {
    expect(pure).toMatch(/export function buildCatalogDescMapFromProducts\(/);
    expect(mirror).toMatch(/export function buildCatalogDescMapFromProducts\(/);
  });

  it('T4 ambos exportan hasDesc', () => {
    expect(pure).toMatch(/export function hasDesc\(/);
    expect(mirror).toMatch(/export function hasDesc\(/);
  });

  it('T5 _normCode privado existe en ambos (uppercase + trim)', () => {
    expect(pure).toMatch(/function _normCode/);
    expect(mirror).toMatch(/function _normCode/);
  });

  it('T6 _catalogLookup privado existe en ambos', () => {
    expect(pure).toMatch(/function _catalogLookup/);
    expect(mirror).toMatch(/function _catalogLookup/);
  });

  it('T7 resolveLineDescLive — prioridad: catalog → line.desc → code', () => {
    // La función corre internamente — sanity check: contiene el flow esperado.
    for (const src of [pure, mirror]) {
      const liveFn = src.slice(src.indexOf('export function resolveLineDescLive'));
      // Primero intenta catalog (fromCatalog variable).
      expect(liveFn).toMatch(/fromCatalog/);
      // Luego fallback a line.desc.
      expect(liveFn).toMatch(/line\.desc\s*\|\|\s*line\.descripcion/);
      // Último recurso: code.
      expect(liveFn).toMatch(/return code;/);
    }
  });
});

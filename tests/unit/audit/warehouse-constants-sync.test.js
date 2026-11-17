import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Test de sincronía §57: src/pure/warehouse-constants.js debe ser byte-equivalent
 * con functions/core/warehouse-constants.js excepto por el comentario del encabezado.
 *
 * Si falla este test: cambiaste uno y no el otro. Replicar el cambio.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PURE_PATH = join(REPO_ROOT, 'src', 'pure', 'warehouse-constants.js');
const MIRROR_PATH = join(REPO_ROOT, 'functions', 'core', 'warehouse-constants.js');

function stripHeaderComment(src) {
  // Quita el bloque /** ... */ inicial para comparar solo el código.
  return src.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
}

describe('§57 sync — warehouse-constants pure vs mirror', () => {
  it('src/pure/warehouse-constants.js y functions/core/warehouse-constants.js tienen el mismo código (post header)', () => {
    const pure = stripHeaderComment(readFileSync(PURE_PATH, 'utf-8'));
    const mirror = stripHeaderComment(readFileSync(MIRROR_PATH, 'utf-8'));
    expect(mirror).toBe(pure);
  });

  it('ambos exportan DEP_FISICO=11 y DEP_TRANSITO=12', async () => {
    const pure = await import(`file://${PURE_PATH}`);
    const mirror = await import(`file://${MIRROR_PATH}`);
    expect(pure.DEP_FISICO).toBe(11);
    expect(pure.DEP_TRANSITO).toBe(12);
    expect(mirror.DEP_FISICO).toBe(11);
    expect(mirror.DEP_TRANSITO).toBe(12);
  });

  it('ambos exportan la misma lista WAREHOUSES_ASIGNABLES', async () => {
    const pure = await import(`file://${PURE_PATH}`);
    const mirror = await import(`file://${MIRROR_PATH}`);
    expect([...mirror.WAREHOUSES_ASIGNABLES]).toEqual([...pure.WAREHOUSES_ASIGNABLES]);
  });

  it('getQtyFromBreakdown devuelve el mismo valor desde ambos lados', async () => {
    const pure = await import(`file://${PURE_PATH}`);
    const mirror = await import(`file://${MIRROR_PATH}`);
    const bd = { 11: 5, 12: 3 };
    expect(mirror.getQtyFromBreakdown(bd, 11)).toBe(pure.getQtyFromBreakdown(bd, 11));
    expect(mirror.getQtyFromBreakdown(bd, 12)).toBe(pure.getQtyFromBreakdown(bd, 12));
    expect(mirror.getQtyFromBreakdown(null, 11)).toBe(0);
    expect(mirror.getQtyFromBreakdown({}, 11)).toBe(0);
    expect(mirror.getQtyFromBreakdown({ 11: 'not a number' }, 11)).toBe(0);
    expect(mirror.getQtyFromBreakdown({ 11: -5 }, 11)).toBe(0);
  });
});

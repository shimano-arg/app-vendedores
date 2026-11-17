import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PURE_PATH = join(REPO_ROOT, 'src', 'pure', 'detect-stock-increases.js');
const MIRROR_PATH = join(REPO_ROOT, 'functions', 'core', 'detect-stock-increases.js');

function stripHeaderComment(src) {
  return src.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
}

describe('§57 sync — detect-stock-increases pure vs mirror', () => {
  it('src/pure y functions/core tienen el mismo código (post header)', () => {
    const pure = stripHeaderComment(readFileSync(PURE_PATH, 'utf-8'));
    const mirror = stripHeaderComment(readFileSync(MIRROR_PATH, 'utf-8'));
    expect(mirror).toBe(pure);
  });

  it('detectStockIncreases devuelve el mismo output desde ambos lados', async () => {
    const pure = await import(`file://${PURE_PATH}`);
    const mirror = await import(`file://${MIRROR_PATH}`);
    const before = { warehouseBreakdown: JSON.stringify({ A: { 11: 1, 12: 0 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ A: { 11: 3, 12: 5 } }) };
    expect(mirror.detectStockIncreases(before, after)).toEqual(
      pure.detectStockIncreases(before, after)
    );
  });

  it('detectTransitoCancelaciones devuelve el mismo output desde ambos lados', async () => {
    const pure = await import(`file://${PURE_PATH}`);
    const mirror = await import(`file://${MIRROR_PATH}`);
    const before = { warehouseBreakdown: JSON.stringify({ X: { 11: 0, 12: 10 } }) };
    const after = { warehouseBreakdown: JSON.stringify({ X: { 11: 3, 12: 0 } }) };
    expect(mirror.detectTransitoCancelaciones(before, after)).toEqual(
      pure.detectTransitoCancelaciones(before, after)
    );
  });
});

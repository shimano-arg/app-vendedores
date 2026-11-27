// @ts-check
/**
 * S-12 Phase 2 (ADR-0016): verifica que `src/pure/dual-write-pg-helpers.js`
 * y `functions/core/dual-write-pg-helpers.js` son byte-equivalente (§57).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dual-write-pg-helpers — sync cliente/servidor (§57)', () => {
  it('byte-equivalente entre src/pure y functions/core', () => {
    const pureSrc = readFileSync(
      resolve(process.cwd(), 'src/pure/dual-write-pg-helpers.js'),
      'utf8'
    );
    const mirrorSrc = readFileSync(
      resolve(process.cwd(), 'functions/core/dual-write-pg-helpers.js'),
      'utf8'
    );
    expect(mirrorSrc).toBe(pureSrc);
  });
});

// @ts-check
/**
 * §57 (2026-11-25) — Test de sincronía entre `src/pure/interno-pareja-helpers.js`
 * y `functions/core/interno-pareja-helpers.js`.
 *
 * CLAUDE.md §57: cualquier chequeo de negocio que se evalúe en cliente y
 * servidor DEBE vivir una sola vez en `src/pure/<name>.js` con copia espejo
 * en `functions/core/<name>.js` y test de sincronía que falla si los dos
 * archivos divergen.
 *
 * El shape de los helpers es idéntico byte-for-byte (ambos usan `export`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('§57 sync — interno-pareja-helpers', () => {
  it('src/pure y functions/core tienen el mismo cuerpo', () => {
    const srcPath = resolve(__dirname, '../../../src/pure/interno-pareja-helpers.js');
    const fnsPath = resolve(__dirname, '../../../functions/core/interno-pareja-helpers.js');
    const src = readFileSync(srcPath, 'utf8');
    const fns = readFileSync(fnsPath, 'utf8');
    // Normalizar: remover líneas en blanco y stripear whitespace trailing.
    // Permite diferencias insignificantes de formato sin dejar pasar cambios
    // reales de lógica (identificadores, orden de returns, etc.).
    const normalize = (/** @type {string} */ s) =>
      s
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+$/, ''))
        .filter((l) => l.length > 0)
        .join('\n');
    expect(normalize(src)).toEqual(normalize(fns));
  });

  it('ambos exportan getVendorsPairedWithInterno', async () => {
    const pure = await import('../../../src/pure/interno-pareja-helpers.js');
    const mirror = await import('../../../functions/core/interno-pareja-helpers.js');
    expect(typeof pure.getVendorsPairedWithInterno).toBe('function');
    expect(typeof mirror.getVendorsPairedWithInterno).toBe('function');
  });

  it('ambos exportan isVendorInInternoPair', async () => {
    const pure = await import('../../../src/pure/interno-pareja-helpers.js');
    const mirror = await import('../../../functions/core/interno-pareja-helpers.js');
    expect(typeof pure.isVendorInInternoPair).toBe('function');
    expect(typeof mirror.isVendorInInternoPair).toBe('function');
  });
});

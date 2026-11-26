/**
 * Sync test entre pure (src/pure/dual-write/*) y espejo
 * (functions/core/dual-write/*). Patrón §57.
 *
 * Falla si:
 *  - Los archivos no existen en ambos lados.
 *  - El contenido post-header diverge.
 *
 * La idea: el pure es fuente de verdad; el espejo se copia y solo cambia el
 * header JSDoc. El test verifica byte-equivalencia del body.
 *
 * @module tests/unit/audit/dual-write-sync.test.js
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/**
 * Elimina el bloque JSDoc inicial (hasta el primer cierre) + espacios al
 * principio. El resto del archivo es el "body" que debe ser byte-equivalente.
 *
 * @param {string} content
 * @returns {string}
 */
function stripHeader(content) {
  // Elimina el primer bloque `/** ... */` + whitespace siguiente.
  const match = content.match(/^\/\*\*[\s\S]*?\*\/\s*/);
  if (!match) return content;
  return content.slice(match[0].length);
}

/**
 * Normaliza EOL para que CRLF vs LF no rompa la comparación en Windows.
 *
 * @param {string} content
 * @returns {string}
 */
function normalize(content) {
  return content.replace(/\r\n/g, '\n');
}

const MODULES = ['transform-pedido-to-pg.js', 'compare-pedido-parity.js'];

describe('§57 dual-write sync — pure vs mirror', () => {
  for (const mod of MODULES) {
    describe(mod, () => {
      const purePath = resolve(REPO_ROOT, 'src', 'pure', 'dual-write', mod);
      const mirrorPath = resolve(REPO_ROOT, 'functions', 'core', 'dual-write', mod);

      it('ambos archivos existen', () => {
        expect(existsSync(purePath), 'pure missing: ' + purePath).toBe(true);
        expect(existsSync(mirrorPath), 'mirror missing: ' + mirrorPath).toBe(true);
      });

      it('body post-header es byte-equivalente', () => {
        const pure = normalize(readFileSync(purePath, 'utf8'));
        const mirror = normalize(readFileSync(mirrorPath, 'utf8'));
        const pureBody = stripHeader(pure);
        const mirrorBody = stripHeader(mirror);
        expect(mirrorBody).toBe(pureBody);
      });

      it('mirror header contiene la referencia al pure (§57)', () => {
        const mirror = normalize(readFileSync(mirrorPath, 'utf8'));
        expect(mirror).toMatch(/Mirror server-side.*src\/pure\/dual-write/);
        expect(mirror).toMatch(/§57/);
      });

      it('pure header NO debe decir "Mirror"', () => {
        const pure = normalize(readFileSync(purePath, 'utf8'));
        expect(pure.slice(0, 500)).not.toMatch(/^\s*\/\*\*[\s\S]{0,400}Mirror server/);
      });
    });
  }
});

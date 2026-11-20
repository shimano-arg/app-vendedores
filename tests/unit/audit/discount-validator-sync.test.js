// @ts-check
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §57 (sync test): src/pure/discount-validator.js y
 * functions/core/discount-validator.js DEBEN ser byte-identicos (modulo CR/LF).
 *
 * Si alguien edita uno sin el otro, este test falla.
 */

function readNormalized(/** @type {string} */ p) {
  const buf = readFileSync(p, 'utf8');
  // Normaliza CRLF -> LF para que Windows (el repo mezcla line endings) no
  // falle el diff falsamente.
  return buf.replace(/\r\n/g, '\n');
}

describe('discount-validator sync between src/pure and functions/core (§57)', () => {
  it('src/pure/discount-validator.js === functions/core/discount-validator.js', () => {
    const client = readNormalized(resolve(__dirname, '../../../src/pure/discount-validator.js'));
    const server = readNormalized(
      resolve(__dirname, '../../../functions/core/discount-validator.js')
    );
    expect(client).toBe(server);
  });

  it('ambos exportan sanitizeDiscountSnapshot + resolveAndValidateDiscount + resolveDiscountForPersist', () => {
    const client = readNormalized(resolve(__dirname, '../../../src/pure/discount-validator.js'));
    const server = readNormalized(
      resolve(__dirname, '../../../functions/core/discount-validator.js')
    );
    for (const txt of [client, server]) {
      expect(txt).toContain('export function sanitizeDiscountSnapshot');
      expect(txt).toContain('export function resolveAndValidateDiscount');
      expect(txt).toContain('export function resolveDiscountForPersist');
    }
  });

  it('error code DISCOUNT_COHERENCE_MISMATCH presente en ambos', () => {
    const client = readNormalized(resolve(__dirname, '../../../src/pure/discount-validator.js'));
    const server = readNormalized(
      resolve(__dirname, '../../../functions/core/discount-validator.js')
    );
    expect(client).toContain('DISCOUNT_COHERENCE_MISMATCH');
    expect(server).toContain('DISCOUNT_COHERENCE_MISMATCH');
  });
});

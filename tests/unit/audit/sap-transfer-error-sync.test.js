/** §57: src/pure/sap-transfer-error.js y su espejo de functions/core son idénticos. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('sap-transfer-error: espejo §57', () => {
  it('functions/core/sap-transfer-error.js es copia verbatim de src/pure', () => {
    const root = resolve(__dirname, '../../..');
    const a = readFileSync(resolve(root, 'src/pure/sap-transfer-error.js'), 'utf8');
    const b = readFileSync(resolve(root, 'functions/core/sap-transfer-error.js'), 'utf8');
    expect(b).toBe(a);
  });
});

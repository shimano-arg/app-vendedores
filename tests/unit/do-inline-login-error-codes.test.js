// @ts-check
/**
 * §SEC-AUTH-001 ítem 0.c (PR #1 v1507) — grep test del handler nuevo
 * en index.html doInlineLogin.
 *
 * Verifica que los 2 branches nuevos existen con mensaje literal + código
 * técnico al final (§68 CLAUDE.md) + que los branches históricos siguen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = join(__dirname, '../../index.html');
const indexHtml = readFileSync(indexHtmlPath, 'utf-8');

describe('doInlineLogin — handlers nuevos', () => {
  it('T1: branch auth/admin-restricted-operation con mensaje literal + código técnico', () => {
    const needle = `code === 'auth/admin-restricted-operation'`;
    expect(indexHtml.split(needle).length - 1).toBe(1);

    // Mensaje completo con newline + código técnico al final (§68 compliance).
    const msgNeedle = `'Pedile al admin que te dé de alta. Las cuentas nuevas se crean desde el Panel.\\n\\nCódigo técnico: auth/admin-restricted-operation'`;
    expect(indexHtml.includes(msgNeedle)).toBe(true);
  });

  it('T2: branch auth/user-disabled con mensaje literal + código técnico', () => {
    // Nota: existe otro handler auth/user-disabled en index.html (línea 31260)
    // que es parte de otra función de auth no relacionada con doInlineLogin.
    // Verificamos presencia del branch + mensaje literal del fix PR #1.
    const needle = `code === 'auth/user-disabled'`;
    expect(indexHtml.includes(needle)).toBe(true);

    const msgNeedle = `'Tu cuenta está deshabilitada. Pedile al admin que la reactive.\\n\\nCódigo técnico: auth/user-disabled'`;
    expect(indexHtml.includes(msgNeedle)).toBe(true);
  });

  it('T3: los 2 branches nuevos van antes de auth/too-many-requests (orden)', () => {
    const idxAdminRestricted = indexHtml.indexOf(`code === 'auth/admin-restricted-operation'`);
    const idxUserDisabled = indexHtml.indexOf(`code === 'auth/user-disabled'`);
    const idxTooMany = indexHtml.indexOf(`code === 'auth/too-many-requests'`);
    expect(idxAdminRestricted).toBeGreaterThan(0);
    expect(idxUserDisabled).toBeGreaterThan(0);
    expect(idxAdminRestricted).toBeLessThan(idxTooMany);
    expect(idxUserDisabled).toBeLessThan(idxTooMany);
  });

  it('T4: branches históricos preservados (regresión)', () => {
    const legacyCodes = [
      `code === 'auth/wrong-password'`,
      `code === 'auth/user-not-found'`,
      `code === 'auth/operation-not-allowed'`,
      `code === 'auth/too-many-requests'`,
      `code === 'auth/network-request-failed'`,
    ];
    for (const needle of legacyCodes) {
      expect(indexHtml.includes(needle)).toBe(true);
    }
  });

  it('T5: fallback escapeHtml preservado (v876 CodeQL XSS)', () => {
    const hasFallback =
      /escapeHtml\s*\(\s*\(e\s*&&\s*\(e\.message\s*\|\|\s*e\.code\)\)\s*\|\|\s*'Error desconocido'\s*\)/.test(
        indexHtml
      );
    expect(hasFallback).toBe(true);
  });
});

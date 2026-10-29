// @ts-check
/**
 * Rescatado y adaptado del PR #1284 (SEC-AUTH-001 0.c, 2026-10-29).
 *
 * doInlineLogin (login email + contraseña) tiene mensajes propios para
 * `auth/admin-restricted-operation` (alta de cuentas deshabilitada en Firebase
 * Auth) y `auth/user-disabled` (cuenta deshabilitada por el admin), con el
 * código técnico al final en línea aparte (CLAUDE.md §68).
 *
 * Diferencias con el #1284:
 * - el mensaje se asigna con errEl.innerHTML, así que el salto es `<br><br>`
 *   (con `\n\n` el código técnico quedaba pegado al texto);
 * - el login con Google SE CONSERVA (el #1284 lo quitaba).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(__dirname, '../../index.html'), 'utf-8');

/** Cuerpo del catch de doInlineLogin. */
function doInlineLoginCatch() {
  const i = indexHtml.indexOf("console.error('doInlineLogin', e);");
  expect(i).toBeGreaterThan(0);
  return indexHtml.slice(i, indexHtml.indexOf('errEl.innerHTML = msg;', i));
}

describe('doInlineLogin — mensajes de auth', () => {
  it('T1: auth/admin-restricted-operation con qué pasó + qué hacer + código técnico en línea aparte', () => {
    const body = doInlineLoginCatch();
    expect(body).toContain("code === 'auth/admin-restricted-operation'");
    expect(body).toContain(
      "'Tu email todavía no tiene una cuenta. Pedile al admin que te dé de alta.<br><br>Código técnico: auth/admin-restricted-operation'"
    );
  });

  it('T2: auth/user-disabled con mensaje propio + código técnico', () => {
    const body = doInlineLoginCatch();
    expect(body).toContain("code === 'auth/user-disabled'");
    expect(body).toContain(
      "'Tu cuenta está deshabilitada. Pedile al admin que la reactive.<br><br>Código técnico: auth/user-disabled'"
    );
  });

  it('T3: los branches nuevos van antes del fallback genérico', () => {
    const body = doInlineLoginCatch();
    expect(body.indexOf("'auth/admin-restricted-operation'")).toBeLessThan(
      body.indexOf('escapeHtml(')
    );
    expect(body.indexOf("'auth/user-disabled'")).toBeLessThan(body.indexOf('escapeHtml('));
  });

  it('T4: branches históricos preservados', () => {
    const body = doInlineLoginCatch();
    for (const c of [
      'auth/wrong-password',
      'auth/user-not-found',
      'auth/operation-not-allowed',
      'auth/too-many-requests',
      'auth/network-request-failed',
    ]) {
      expect(body).toContain(`'${c}'`);
    }
  });

  it('T5: fallback escapeHtml preservado (v876 CodeQL XSS)', () => {
    expect(doInlineLoginCatch()).toMatch(
      /escapeHtml\(\(e && \(e\.message \|\| e\.code\)\) \|\| 'Error desconocido'\)/
    );
  });

  it('T6: el login con Google se conserva (botón + handler + proveedor)', () => {
    expect(indexHtml).toMatch(/onclick="signInWithGoogle\(\)"/);
    expect(indexHtml).toMatch(/window\.signInWithGoogle\s*=/);
    expect(indexHtml).toMatch(/new firebase\.auth\.GoogleAuthProvider\(\)/);
  });
});

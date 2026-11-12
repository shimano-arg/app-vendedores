// @ts-check
/**
 * D8 (2026-11-06) — el reset de la password-gate por admin usa el mecanismo
 * server-side existente (setPasswordGate CF, scrypt-v2 dual-write a
 * auth_secrets + roles vía Admin SDK) en vez de escribir passwordHash/
 * passwordSalt a /roles desde el cliente.
 *
 * Por qué: el write client-side a /roles quedó BLOQUEADO por el freeze S04b
 * PR-B (roles.update con esos campos → denegado), así que el reset admin estaba
 * ROTO en main. setPasswordGate (admin-op, sin reauth del target) es el camino
 * correcto y ya existe. No se inventa mecanismo nuevo (regla del pedido).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const adminUsers = readFileSync(new URL('src/domains/admin-users.js', ROOT), 'utf8');

/** Recorta la función window.changeUserPassword para acotar los asserts. */
const changePwdFn = (() => {
  const i = adminUsers.indexOf('changeUserPassword');
  if (i < 0) return '';
  // Hasta el próximo `window.` de nivel superior (siguiente handler).
  const next = adminUsers.indexOf('\nwindow.saveUserRole', i);
  return adminUsers.slice(i, next > i ? next : i + 4000);
})();

describe('D8 — reset de password-gate admin vía setPasswordGate CF', () => {
  it('A1: invoca el CF setPasswordGate (región southamerica-east1)', () => {
    expect(changePwdFn).toContain("httpsCallable('setPasswordGate')");
    expect(changePwdFn).toContain("functions('southamerica-east1')");
  });

  it('A2: pasa targetUid + password al CF', () => {
    expect(changePwdFn).toMatch(/setPasswordGate'\)[\s\S]{0,200}targetUid/);
    expect(changePwdFn).toMatch(/password:/);
  });

  it('A3: ya NO escribe passwordHash/passwordSalt a /roles desde el cliente', () => {
    expect(changePwdFn).not.toContain('passwordHash:');
    expect(changePwdFn).not.toContain('passwordSalt:');
    expect(changePwdFn).not.toContain('buildPasswordCredentials(');
  });
});

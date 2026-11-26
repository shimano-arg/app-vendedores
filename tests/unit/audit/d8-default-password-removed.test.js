// @ts-check
/**
 * D8 (2026-11-06) — eliminación de la contraseña por defecto hard-codeada
 * ('Shi0*') y del init client-side de credenciales en el password-gate.
 *
 * Contexto (flujo completo, ver informe 55):
 *  - El gate de contraseña es una capa UX sobre el login Google. La validación
 *    real de acceso la dan Firebase Auth + reglas + CFs por ROL.
 *  - El init client-side (`ensurePasswordGate` escribía el default en /roles)
 *    ya estaba MUERTO en main por el freeze S04b PR-B (roles.update con
 *    passwordHash/passwordSalt → denegado). Removerlo es cleanup + quita el
 *    string de credencial pública del archivo servido al cliente.
 *  - La validación client-side (SHA-256 1 ronda + compare en el DOM) se
 *    mantiene de forma INTERINA: migrarla a verifyPasswordGate (scrypt
 *    server-side) requiere poblar /auth_secrets primero (migración sobre
 *    usuarios reales) para no dejar a nadie sin acceso. Ver informe 55 §11-§12.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('index.html', ROOT), 'utf8');

/** Cuerpo de una función `async function <name>(` hasta el primer `\n}\n`. */
const fnBody = (name) => {
  const i = html.indexOf(`async function ${name}(`);
  if (i < 0) return '';
  return html.slice(i, html.indexOf('\n}\n', i));
};

describe('D8 — sin contraseña por defecto hard-codeada', () => {
  it('P1: no existe la constante DEFAULT_USER_PASSWORD', () => {
    expect(html).not.toMatch(/DEFAULT_USER_PASSWORD/);
  });

  it('P2: no aparece el literal de la contraseña por defecto en index.html', () => {
    expect(html).not.toContain("'Shi0*'");
    expect(html).not.toContain('"Shi0*"');
  });

  it('P3: ensurePasswordGate NO lee passwordHash ni passwordSalt del Firestore (B2-A: verificacion movida a CF)', () => {
    // B2-A (2026-11-26): la verificacion de credenciales se movio server-side via
    // authVerifyLoginCF. ensurePasswordGate ya no lee /roles/{uid} para obtener
    // passwordHash/passwordSalt — esos secretos nunca deben llegar al browser.
    // Este test verifica que la implementacion nueva NO contiene los patrones viejos.
    const body = fnBody('ensurePasswordGate');
    expect(body).not.toContain('buildPasswordCredentials(');
    // No escribe credenciales a /roles desde el cliente.
    expect(body).not.toMatch(/\.update\(/);
    // B2-A: ya NO debe leer data.passwordHash ni data.passwordSalt del Firestore.
    expect(body).not.toContain('data.passwordHash');
    expect(body).not.toContain('data.passwordSalt');
    // B2-A: debe existir la funcion (no fue eliminada).
    expect(body.length).toBeGreaterThan(0);
  });

  it('P4: ensurePasswordGate usa flujo CF (no llama a showPasswordGateModal con hash/salt)', () => {
    // B2-A (2026-11-26): la firma vieja showPasswordGateModal(data.passwordSalt, data.passwordHash)
    // era el punto de inyeccion de secretos al browser. Con B2-A el modal se muestra
    // sin recibir secretos como parametros — la verificacion ocurre en la CF.
    const body = fnBody('ensurePasswordGate');
    // El patron viejo con secretos como args NO debe existir.
    expect(body).not.toContain('showPasswordGateModal(data.passwordSalt, data.passwordHash)');
    expect(body).not.toContain('showPasswordGateModal(data.passwordHash');
    // La funcion showPasswordGateModal puede seguir siendo llamada pero sin hash/salt.
    // (puede llamarse con solo el email, o puede no llamarse directamente desde ensurePasswordGate)
  });

  it('P5: se eliminan los helpers client-side de armado de credenciales (dead code)', () => {
    expect(html).not.toMatch(/async function buildPasswordCredentials\(/);
    expect(html).not.toMatch(/function generatePasswordSalt\(/);
  });
});

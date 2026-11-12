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

  it('P3: ensurePasswordGate NO inicializa credenciales client-side (sin hash → sin gate)', () => {
    const body = fnBody('ensurePasswordGate');
    expect(body).not.toContain('buildPasswordCredentials(');
    // No escribe credenciales a /roles desde el cliente.
    expect(body).not.toMatch(/\.update\(/);
    expect(body).toMatch(/if \(!data\.passwordHash \|\| !data\.passwordSalt\) return true;/);
  });

  it('P4: con hash configurado el gate se sigue mostrando (verify interino preservado)', () => {
    expect(fnBody('ensurePasswordGate')).toContain(
      'showPasswordGateModal(data.passwordSalt, data.passwordHash)'
    );
  });

  it('P5: se eliminan los helpers client-side de armado de credenciales (dead code)', () => {
    expect(html).not.toMatch(/async function buildPasswordCredentials\(/);
    expect(html).not.toMatch(/function generatePasswordSalt\(/);
  });
});

// @ts-check
/**
 * SEC-06 parcial (2026-10-29): la contraseña por defecto del password-gate
 * estaba escrita en index.html (archivo público) y se usaba para inicializar
 * el gate de quien no tenía hash. Se eliminó: sin hash configurado, no hay gate.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const fnBody = (name) => {
  const i = html.indexOf(`async function ${name}(`);
  return html.slice(i, html.indexOf('\n}\n', i));
};

describe('SEC-06 — sin contraseña por defecto en el frontend', () => {
  it('P1: no existe la constante DEFAULT_USER_PASSWORD', () => {
    expect(html).not.toMatch(/DEFAULT_USER_PASSWORD/);
  });
  it('P2: ensurePasswordGate no escribe credenciales en roles (sin hash → sin gate)', () => {
    const body = fnBody('ensurePasswordGate');
    expect(body).not.toContain('buildPasswordCredentials(');
    expect(body).not.toMatch(/\.update\(/);
    expect(body).toMatch(/if \(!data\.passwordHash \|\| !data\.passwordSalt\) return true;/);
  });
  it('P3: con hash configurado el gate se sigue mostrando (función preservada)', () => {
    expect(fnBody('ensurePasswordGate')).toContain(
      'showPasswordGateModal(data.passwordSalt, data.passwordHash)'
    );
  });
  it('P4: el admin conserva buildPasswordCredentials para setear la contraseña desde Panel Usuarios', () => {
    expect(html).toContain('async function buildPasswordCredentials(');
  });
});

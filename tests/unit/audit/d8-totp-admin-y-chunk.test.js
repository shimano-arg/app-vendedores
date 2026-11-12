// @ts-check
/**
 * D8 — Tarea 63: TOTP administrable vía CFs y chunk compilado sincronizado.
 *
 * - El panel admin activa/desactiva 2FA con setTotpGate / disableTotpGate
 *   (Admin SDK, dual-write auth_secrets + roles) en vez de escribir
 *   totpSecret/totpEnabled en /roles desde el cliente (bloqueado por el
 *   freeze S04b PR-B).
 * - Lo que carga el navegador es chunks/admin-users.js (artefacto commiteado,
 *   generado por `node build.js`). Los tests de la Tarea 55 miraban solo src/;
 *   estos miran el CHUNK, para que un src corregido sin rebuild no pase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/domains/admin-users.js'), 'utf8');
const CHUNK = fs.readFileSync(path.join(ROOT, 'chunks/admin-users.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

/** Cuerpo de `window.<name> = async function (...) { ... };` (hasta el siguiente `window.`). */
const fnBody = (src, name) => {
  const i = src.indexOf(`window.${name} = async function`);
  if (i < 0) return '';
  const j = src.indexOf('\nwindow.', i + 1);
  return src.slice(i, j > i ? j : undefined);
};
/** Literales de objeto que escriben campos de credenciales (clave seguida de `:`). */
const CRED_WRITE = /\b(passwordHash|passwordSalt|totpSecret|totpEnabled)\s*:/;

describe('TOTP admin vía CFs (src)', () => {
  it('confirmTotpSetup llama setTotpGate con targetUid + secretBase32 y no escribe /roles', () => {
    const b = fnBody(SRC, 'confirmTotpSetup');
    expect(b).toMatch(/httpsCallable\(\s*['"]setTotpGate['"]\s*\)/);
    expect(b).toMatch(/targetUid:\s*totpSetupState\.uid/);
    expect(b).toMatch(/secretBase32:\s*totpSetupState\.secret/);
    expect(b).not.toMatch(CRED_WRITE);
    expect(b).not.toMatch(/collection\(\s*['"]roles['"]\s*\)/);
  });
  it('disableTotp llama disableTotpGate con targetUid y no escribe /roles', () => {
    const b = fnBody(SRC, 'disableTotp');
    expect(b).toMatch(/httpsCallable\(\s*['"]disableTotpGate['"]\s*\)/);
    expect(b).toMatch(/targetUid:\s*uid/);
    expect(b).not.toMatch(CRED_WRITE);
    expect(b).not.toMatch(/collection\(\s*['"]roles['"]\s*\)/);
  });
  it('los 3 llamados usan la región de las CFs (southamerica-east1)', () => {
    for (const n of ['confirmTotpSetup', 'disableTotp', 'changeUserPassword']) {
      expect(fnBody(SRC, n)).toMatch(/functions\(\s*['"]southamerica-east1['"]\s*\)/);
    }
  });
  it('el src de admin-users no escribe ningún campo de credenciales', () => {
    expect(SRC).not.toMatch(CRED_WRITE);
  });
});

describe('Chunk compilado (lo que carga el navegador)', () => {
  it('usa las 3 CFs (prueba que se regeneró después del cambio de src)', () => {
    for (const cf of ['setPasswordGate', 'setTotpGate', 'disableTotpGate']) {
      expect(CHUNK).toMatch(new RegExp(`httpsCallable\\(\\s*['"]${cf}['"]\\s*\\)`));
    }
  });
  it('no escribe credenciales desde el cliente ni depende de helpers eliminados', () => {
    expect(CHUNK).not.toMatch(CRED_WRITE);
    expect(CHUNK).not.toMatch(
      /buildPasswordCredentials|generatePasswordSalt|DEFAULT_USER_PASSWORD/
    );
  });
  it('index.html tampoco define ni usa los helpers eliminados', () => {
    expect(INDEX).not.toMatch(
      /buildPasswordCredentials|generatePasswordSalt|DEFAULT_USER_PASSWORD/
    );
  });
});

describe('Versión coherente para invalidar la caché del Service Worker', () => {
  it('APP_VERSION (index.html) == CACHE_VERSION (sw.js) y > v1554 (versión publicada sin el fix)', () => {
    const app = /const APP_VERSION = 'v(\d+)'/.exec(INDEX);
    const cache = /CACHE_VERSION\s*=\s*'v(\d+)'/.exec(SW);
    expect(app && cache).toBeTruthy();
    expect(app?.[1]).toBe(cache?.[1]);
    expect(Number(app?.[1])).toBeGreaterThan(1554);
  });
});

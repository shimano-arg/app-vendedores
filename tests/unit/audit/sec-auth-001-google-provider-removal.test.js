// @ts-check
/**
 * v1521 §SEC-AUTH-001 ítem 0.b (2026-10-29): verifica que el provider Google
 * fue removido del cliente. Microsoft + email-link + email/password siguen OK.
 *
 * El provider se deshabilita además en Firebase Auth Console (paso manual
 * Mariano post-merge). Estos tests son grep-level sobre el DOM + bundle del
 * cliente — garantizan que no quedó código vivo que llame signInWithPopup
 * con GoogleAuthProvider ni botón funcional de Google.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIRNAME, '..', '..', '..');

const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');

describe('§SEC-AUTH-001 ítem 0.b: provider Google removido del cliente', () => {
  it('index.html NO declara window.signInWithGoogle', () => {
    const matches = INDEX_HTML.match(/window\.signInWithGoogle\s*=/g);
    expect(matches, 'window.signInWithGoogle debería estar removido').toBeNull();
  });

  it('index.html NO instancia firebase.auth.GoogleAuthProvider', () => {
    const matches = INDEX_HTML.match(/new\s+firebase\.auth\.GoogleAuthProvider\s*\(/g);
    expect(matches, 'GoogleAuthProvider no debería instanciarse').toBeNull();
  });

  it('index.html NO tiene botón onclick="signInWithGoogle()"', () => {
    const matches = INDEX_HTML.match(/onclick\s*=\s*["']signInWithGoogle\s*\(\s*\)["']/g);
    expect(matches, 'botón "Continuar con Google" debería estar eliminado').toBeNull();
  });

  it('index.html NO contiene el label "Continuar con Google" dentro de un <button>', () => {
    // Scope dentro de <button>…Continuar con Google…</button>. Comentarios HTML
    // (`<!-- ... -->`) que mencionen el label por histórico están permitidos.
    const buttonBlocks = INDEX_HTML.match(/<button[^>]*>[\s\S]*?<\/button>/g) || [];
    const offenders = buttonBlocks.filter((b) => /Continuar con Google/.test(b));
    expect(offenders, 'ningún <button> debería renderear "Continuar con Google"').toEqual([]);
  });

  it('Microsoft login sigue vivo (regresión)', () => {
    expect(INDEX_HTML).toMatch(/window\.signInWithMicrosoft\s*=/);
    expect(INDEX_HTML).toMatch(
      /new\s+firebase\.auth\.OAuthProvider\s*\(\s*['"]microsoft\.com['"]\s*\)/
    );
  });

  it('email-link login sigue vivo (regresión)', () => {
    expect(INDEX_HTML).toMatch(/window\.openEmailLinkModal\s*=/);
  });

  it('signInWithPopup sigue vivo para Microsoft (regresión)', () => {
    // Microsoft login usa signInWithPopup → la primitiva no debe desaparecer.
    expect(INDEX_HTML).toMatch(/fbAuth\.signInWithPopup\s*\(/);
  });
});

// @ts-check
/**
 * S-10 P2.8 (2026-11-26) — extraccion verbatim de initVersionCheck.
 *
 * Objetivo: validar que la extraccion no perdio nada y el pattern queda:
 *   T1. `src/domains/version-check.js` existe.
 *   T2. `src/main.js` importa el modulo (side-effect).
 *   T3. `index.html` NO contiene mas la IIFE `(function initVersionCheck(){`.
 *   T4. `index.html` contiene el comentario stub nuevo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const MAIN_JS = readFileSync(resolve(ROOT, 'src/main.js'), 'utf8');
const DOMAIN_FILE = resolve(ROOT, 'src/domains/version-check.js');

describe('S-10 P2.8 extract-version-check', () => {
  it('T1. src/domains/version-check.js existe', () => {
    expect(existsSync(DOMAIN_FILE)).toBe(true);
  });

  it('T1b. domain file contiene initVersionCheck + handlers clave', () => {
    const content = readFileSync(DOMAIN_FILE, 'utf8');
    expect(content).toMatch(/\(function initVersionCheck\(\)\s*\{/);
    expect(content).toMatch(/function _showVersionAlert/);
    expect(content).toMatch(/async function _checkRemoteVersion/);
    expect(content).toMatch(/_checkAppVersion\s*=\s*_checkRemoteVersion/);
  });

  it('T2. src/main.js importa ./domains/version-check.js', () => {
    expect(MAIN_JS).toMatch(/import\s+['"]\.\/domains\/version-check\.js['"]/);
  });

  it('T3. index.html NO contiene mas la IIFE initVersionCheck', () => {
    expect(INDEX).not.toMatch(/\(function initVersionCheck\(\)\{/);
    expect(INDEX).not.toMatch(/function _showVersionAlert\(remoteVer\)/);
    expect(INDEX).not.toMatch(/async function _checkRemoteVersion\(\)/);
  });

  it('T4. index.html contiene el comentario stub nuevo', () => {
    expect(INDEX).toMatch(
      /initVersionCheck extraído a src\/domains\/version-check\.js \(S-10 P2\.8\)/
    );
  });
});

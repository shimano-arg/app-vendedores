// @ts-check
/**
 * E10 Fase 1+3 §stock-servidor-atomico (v1434) — tests version_minima modal.
 *
 * Validaciones:
 * 1. _parseVersion y _isVersionLessThan comparan correctamente.
 * 2. _checkMinVersionAndMaybeBlock lee app_config/version_minima.
 * 3. Si APP_VERSION < minVersion → modal bloqueante.
 * 4. Si APP_VERSION >= minVersion → NO modal.
 * 5. Modal tiene 1 botón "Recargar ahora" + previene cierre.
 * 6. Botón llama forceUpdateApp (unregister SW + clear caches + reload).
 * 7. SW existente usa skipWaiting + clients.claim (anti-regresión).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const SW_JS = readFileSync('sw.js', 'utf8');

describe('E10 version_minima modal', () => {
  describe('version parse + compare helpers', () => {
    it('_parseVersion existe', () => {
      expect(INDEX_HTML).toMatch(/window\._parseVersion\s*=\s*function/);
    });

    it('_isVersionLessThan existe', () => {
      expect(INDEX_HTML).toMatch(/window\._isVersionLessThan\s*=\s*function/);
    });

    it('_parseVersion handles "v1430" y "1430" y bare numbers', () => {
      const start = INDEX_HTML.indexOf('window._parseVersion');
      const code = INDEX_HTML.slice(start, start + 400);
      expect(code).toMatch(/replace\(\/\^v\//);
      expect(code).toMatch(/Number\.isFinite\(n\)/);
    });
  });

  describe('_checkMinVersionAndMaybeBlock', () => {
    it('lee app_config/version_minima', () => {
      const start = INDEX_HTML.indexOf('async function _checkMinVersionAndMaybeBlock');
      expect(start).toBeGreaterThan(0);
      const code = INDEX_HTML.slice(start, start + 1200);
      expect(code).toMatch(/collection\(['"]app_config['"]\)\.doc\(['"]version_minima['"]\)/);
    });

    it('short-circuits si doc no existe', () => {
      const start = INDEX_HTML.indexOf('async function _checkMinVersionAndMaybeBlock');
      const code = INDEX_HTML.slice(start, start + 1200);
      expect(code).toMatch(/if\s*\(!snap\.exists\)\s*return/);
    });

    it('short-circuits si minVersion vacío', () => {
      const start = INDEX_HTML.indexOf('async function _checkMinVersionAndMaybeBlock');
      const code = INDEX_HTML.slice(start, start + 1200);
      expect(code).toMatch(/if\s*\(!minVersion\)\s*return/);
    });

    it('compara con _isVersionLessThan', () => {
      const start = INDEX_HTML.indexOf('async function _checkMinVersionAndMaybeBlock');
      const code = INDEX_HTML.slice(start, start + 1200);
      expect(code).toMatch(/window\._isVersionLessThan\(current,\s*minVersion\)/);
    });

    it('dispara _renderVersionMinimaBlockingModal cuando current < min', () => {
      const start = INDEX_HTML.indexOf('async function _checkMinVersionAndMaybeBlock');
      const code = INDEX_HTML.slice(start, start + 1200);
      expect(code).toMatch(/_renderVersionMinimaBlockingModal\(message\)/);
    });
  });

  describe('modal bloqueante shape', () => {
    it('crea div id="e10-min-version-modal"', () => {
      expect(INDEX_HTML).toContain("overlay.id = 'e10-min-version-modal'");
    });

    it('overlay position:fixed z-index muy alto', () => {
      const start = INDEX_HTML.indexOf('_renderVersionMinimaBlockingModal');
      const code = INDEX_HTML.slice(start, start + 2500);
      expect(code).toMatch(/position:fixed/);
      expect(code).toMatch(/z-index:999999/);
    });

    it('body overflow hidden (bloquea scroll)', () => {
      const start = INDEX_HTML.indexOf('_renderVersionMinimaBlockingModal');
      const code = INDEX_HTML.slice(start, start + 2500);
      expect(code).toMatch(/document\.body\.style\.overflow\s*=\s*['"]hidden['"]/);
    });

    it('botón único "Recargar ahora" con id=e10-reload-btn', () => {
      const start = INDEX_HTML.indexOf('_renderVersionMinimaBlockingModal');
      const code = INDEX_HTML.slice(start, start + 2500);
      expect(code).toMatch(/id="e10-reload-btn"/);
      expect(code).toMatch(/Recargar ahora/);
    });

    it('Escape key previene cierre', () => {
      const start = INDEX_HTML.indexOf('_renderVersionMinimaBlockingModal');
      const code = INDEX_HTML.slice(start, start + 2500);
      expect(code).toMatch(/e\.key\s*===?\s*['"]Escape['"]/);
      expect(code).toMatch(/e\.preventDefault\(\)/);
    });
  });

  describe('botón reload', () => {
    it('unregister service workers', () => {
      const start = INDEX_HTML.indexOf('_renderVersionMinimaBlockingModal');
      const code = INDEX_HTML.slice(start, start + 3500);
      expect(code).toMatch(/serviceWorker.*getRegistrations/);
      expect(code).toMatch(/r\.unregister/);
    });

    it('clear caches', () => {
      const start = INDEX_HTML.indexOf('_renderVersionMinimaBlockingModal');
      const code = INDEX_HTML.slice(start, start + 3500);
      expect(code).toMatch(/caches\.keys/);
      expect(code).toMatch(/caches\.delete/);
    });

    it('reload con cache-bust', () => {
      const start = INDEX_HTML.indexOf('_renderVersionMinimaBlockingModal');
      const code = INDEX_HTML.slice(start, start + 3500);
      expect(code).toMatch(/window\.location\.replace\(.*\?_t=/);
    });
  });

  describe('integración onAuthStateChanged', () => {
    it('_checkMinVersionAndMaybeBlock se invoca post-login', () => {
      expect(INDEX_HTML).toMatch(/await _checkMinVersionAndMaybeBlock\(\)/);
    });
  });

  describe('SW skipWaiting + clients.claim (anti-regresión)', () => {
    it('install → skipWaiting()', () => {
      expect(SW_JS).toMatch(/\.then\(\(\)\s*=>\s*self\.skipWaiting\(\)\)/);
    });

    it('activate → clients.claim()', () => {
      expect(SW_JS).toMatch(/self\.clients\.claim\(\)/);
    });
  });
});

describe('E10 version_minima logic (unit test de los helpers puros)', () => {
  // Reimplementación local de los helpers para test puro (sin DOM).
  function parseVersion(v) {
    const n = Number(String(v || '').replace(/^v/, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function isVersionLessThan(a, b) {
    return parseVersion(a) < parseVersion(b);
  }

  describe('parseVersion', () => {
    it('"v1430" → 1430', () => {
      expect(parseVersion('v1430')).toBe(1430);
    });

    it('"1430" → 1430', () => {
      expect(parseVersion('1430')).toBe(1430);
    });

    it('"V1434" → 0 (uppercase V no match)', () => {
      // Nuestro regex solo matchea lowercase 'v'. Robustez: aceptamos solo
      // el formato que usamos (APP_VERSION siempre lowercase 'v').
      // Pero V mayúscula se queda como "V1434" → NaN → 0.
      expect(parseVersion('V1434')).toBe(0);
    });

    it('inválido → 0', () => {
      expect(parseVersion('abc')).toBe(0);
      expect(parseVersion('')).toBe(0);
      expect(parseVersion(null)).toBe(0);
      expect(parseVersion(undefined)).toBe(0);
    });
  });

  describe('isVersionLessThan', () => {
    it('v1430 < v1434 → true', () => {
      expect(isVersionLessThan('v1430', 'v1434')).toBe(true);
    });

    it('v1434 < v1434 → false (igual)', () => {
      expect(isVersionLessThan('v1434', 'v1434')).toBe(false);
    });

    it('v1435 < v1434 → false (mayor)', () => {
      expect(isVersionLessThan('v1435', 'v1434')).toBe(false);
    });

    it('v1200 < v1434 → true (muy viejo)', () => {
      expect(isVersionLessThan('v1200', 'v1434')).toBe(true);
    });

    it('"" < v1434 → true (unknown se considera menor)', () => {
      expect(isVersionLessThan('', 'v1434')).toBe(true);
    });
  });
});
